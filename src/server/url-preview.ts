import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface UrlPreview {
  url: string;
  finalUrl?: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  ok: boolean;
  error?: string;
}

interface CacheEntry {
  data: UrlPreview;
  expiresAt: number;
}

const CACHE = new Map<string, CacheEntry>();
const TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;
const MAX_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 5000;
const HTML_SCAN_LIMIT = 256 * 1024;

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("fe80")) return true;
  if (lower.startsWith("::ffff:")) {
    const v4 = lower.slice("::ffff:".length);
    if (isIP(v4) === 4) return isPrivateIPv4(v4);
  }
  return false;
}

async function isSafeHost(hostname: string): Promise<boolean> {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local")) return false;
  if (lower === "metadata.google.internal") return false;

  const ipKind = isIP(hostname);
  if (ipKind === 4) return !isPrivateIPv4(hostname);
  if (ipKind === 6) return !isPrivateIPv6(hostname);

  try {
    const addrs = await lookup(hostname, { all: true });
    for (const a of addrs) {
      if (a.family === 4 && isPrivateIPv4(a.address)) return false;
      if (a.family === 6 && isPrivateIPv6(a.address)) return false;
    }
    return addrs.length > 0;
  } catch {
    return false;
  }
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function extractMeta(html: string, propPattern: RegExp): string | undefined {
  const m = html.match(propPattern);
  if (!m) return undefined;
  const raw = m[1];
  if (!raw) return undefined;
  const decoded = decodeHtmlEntities(raw).trim();
  return decoded || undefined;
}

function extractTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return undefined;
  const decoded = decodeHtmlEntities(m[1]).replace(/\s+/g, " ").trim();
  return decoded || undefined;
}

function parseOg(html: string, baseUrl: string): Omit<UrlPreview, "url" | "ok"> {
  const titleOg = extractMeta(
    html,
    /<meta[^>]+(?:property|name)\s*=\s*["']og:title["'][^>]+content\s*=\s*["']([^"']*)["']/i,
  );
  const titleAlt = extractMeta(
    html,
    /<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]+(?:property|name)\s*=\s*["']og:title["']/i,
  );
  const descOg = extractMeta(
    html,
    /<meta[^>]+(?:property|name)\s*=\s*["']og:description["'][^>]+content\s*=\s*["']([^"']*)["']/i,
  );
  const descAlt = extractMeta(
    html,
    /<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]+(?:property|name)\s*=\s*["']og:description["']/i,
  );
  const descName = extractMeta(
    html,
    /<meta[^>]+name\s*=\s*["']description["'][^>]+content\s*=\s*["']([^"']*)["']/i,
  );
  const descNameAlt = extractMeta(
    html,
    /<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]+name\s*=\s*["']description["']/i,
  );
  const imageOg = extractMeta(
    html,
    /<meta[^>]+(?:property|name)\s*=\s*["']og:image(?::secure_url|:url)?["'][^>]+content\s*=\s*["']([^"']*)["']/i,
  );
  const imageAlt = extractMeta(
    html,
    /<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]+(?:property|name)\s*=\s*["']og:image(?::secure_url|:url)?["']/i,
  );
  const twImage = extractMeta(
    html,
    /<meta[^>]+(?:name|property)\s*=\s*["']twitter:image["'][^>]+content\s*=\s*["']([^"']*)["']/i,
  );
  const siteOg = extractMeta(
    html,
    /<meta[^>]+(?:property|name)\s*=\s*["']og:site_name["'][^>]+content\s*=\s*["']([^"']*)["']/i,
  );

  const title = titleOg || titleAlt || extractTitle(html);
  const description = descOg || descAlt || descName || descNameAlt;
  const imageRaw = imageOg || imageAlt || twImage;
  const image = imageRaw ? safeResolveUrl(imageRaw, baseUrl) : undefined;
  const siteName = siteOg;

  return { title, description, image, siteName };
}

function safeResolveUrl(target: string, base: string): string | undefined {
  try {
    return new URL(target, base).toString();
  } catch {
    return undefined;
  }
}

async function fetchHtml(targetUrl: string, redirectsLeft = 3): Promise<{ html: string; finalUrl: string }> {
  const parsed = new URL(targetUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("unsupported_protocol");
  }
  const safe = await isSafeHost(parsed.hostname);
  if (!safe) throw new Error("blocked_host");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(targetUrl, {
      method: "GET",
      redirect: "manual",
      signal: ctrl.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; JarvisURLPreview/1.0; +https://jarvis.local/url-preview)",
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "Accept-Language": "ko,en;q=0.9",
      },
    });
  } finally {
    clearTimeout(timer);
  }

  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    if (!loc || redirectsLeft <= 0) throw new Error("too_many_redirects");
    const next = new URL(loc, targetUrl).toString();
    return fetchHtml(next, redirectsLeft - 1);
  }
  if (!res.ok) throw new Error(`http_${res.status}`);

  const contentType = res.headers.get("content-type") || "";
  if (!/text\/html|application\/xhtml/i.test(contentType)) {
    throw new Error("not_html");
  }
  const contentLength = Number(res.headers.get("content-length") || 0);
  if (contentLength && contentLength > MAX_BYTES) throw new Error("too_large");

  const reader = res.body?.getReader();
  if (!reader) throw new Error("no_body");
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    received += value.length;
    if (received > MAX_BYTES) {
      try { await reader.cancel(); } catch { /* */ }
      throw new Error("too_large");
    }
    chunks.push(value);
    if (received >= HTML_SCAN_LIMIT) {
      try { await reader.cancel(); } catch { /* */ }
      break;
    }
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  const charsetMatch = contentType.match(/charset=([^;]+)/i);
  const charset = (charsetMatch?.[1] || "utf-8").trim().toLowerCase();
  let html: string;
  try {
    html = new TextDecoder(charset, { fatal: false }).decode(buf);
  } catch {
    html = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  }
  return { html, finalUrl: res.url || targetUrl };
}

function pruneCache(): void {
  if (CACHE.size < CACHE_MAX) return;
  const now = Date.now();
  for (const [k, v] of CACHE) {
    if (v.expiresAt < now) CACHE.delete(k);
  }
  if (CACHE.size < CACHE_MAX) return;
  const overflow = CACHE.size - Math.floor(CACHE_MAX * 0.8);
  let i = 0;
  for (const k of CACHE.keys()) {
    if (i++ >= overflow) break;
    CACHE.delete(k);
  }
}

export async function getUrlPreview(rawUrl: string): Promise<UrlPreview> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { url: rawUrl, ok: false, error: "invalid_url" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { url: rawUrl, ok: false, error: "unsupported_protocol" };
  }

  const cacheKey = parsed.toString();
  const cached = CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  try {
    const { html, finalUrl } = await fetchHtml(cacheKey);
    const meta = parseOg(html, finalUrl);
    const data: UrlPreview = {
      url: cacheKey,
      finalUrl,
      ok: true,
      title: meta.title,
      description: meta.description,
      image: meta.image,
      siteName: meta.siteName,
    };
    pruneCache();
    CACHE.set(cacheKey, { data, expiresAt: Date.now() + TTL_MS });
    return data;
  } catch (err) {
    const code = err instanceof Error ? err.message : "unknown";
    const failData: UrlPreview = { url: cacheKey, ok: false, error: code };
    pruneCache();
    CACHE.set(cacheKey, { data: failData, expiresAt: Date.now() + 10 * 60 * 1000 });
    return failData;
  }
}
