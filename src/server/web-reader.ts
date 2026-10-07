// 웹 리더 — 차단/일반 웹페이지 본문 텍스트를 우회 수집 (insane-search 경량 이식)
// 전략 체인: (a) 브라우저 헤더 직접 fetch → (b) Jina Reader 무료 프록시 → (c) 로그인/페이월 감지 시 authRequired
// 네이티브 브라우저/헤드리스 렌더링 없음 — 순수 Node fetch + 텍스트 처리만 사용.
// SSRF 방어: url-preview.ts의 isSafeHost와 동일한 정책을 이 파일에서도 독립적으로 재구현해
// "타겟 URL의 호스트가 안전한지"를 모든 전략 시도 이전에 반드시 검증한다 (Jina 프록시에도 동일 적용).

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface WebReaderResult {
  ok: boolean;
  url: string;
  finalUrl?: string;
  title?: string;
  text?: string;
  contentType?: string;
  strategy?: "direct" | "jina-reader";
  authRequired?: boolean;
  truncated?: boolean;
  error?: string;
}

export interface WebReaderOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxTextLength?: number;
}

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5MB
const DEFAULT_MAX_TEXT_LENGTH = 100 * 1024; // 100KB
const JINA_READER_BASE = "https://r.jina.ai/";

// 실제 크롬과 유사한 브라우저 헤더 — 단순 봇 차단(WAF 룰) 우회용.
// (JS 챌린지/CAPTCHA는 우회 불가 — 그 경우는 authRequired 또는 error로 정직하게 종료)
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "ko,en-US;q=0.9,en;q=0.8",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

// === SSRF 가드 (url-preview.ts와 동일 정책 — 독립 재구현으로 모듈 결합도 최소화) ===

export function isPrivateIPv4(ip: string): boolean {
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

export function isPrivateIPv6(ip: string): boolean {
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

export async function isSafeHost(hostname: string): Promise<boolean> {
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

// === URL 파싱/검증 ===

export function parseTargetUrl(rawUrl: string): { ok: true; url: URL } | { ok: false; error: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, error: "invalid_url" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "unsupported_protocol" };
  }
  return { ok: true, url: parsed };
}

// === 리다이렉트 대상 해석 (SSRF 재검증의 1단계 — 순수 함수, 네트워크 없음) ===
// Location 헤더를 현재 URL 기준으로 절대 URL로 해석한다.
// new URL(loc, base)가 상대경로("/next"), 프로토콜 상대("//evil.com"), 절대 URL을 모두 올바르게 처리한다.
//   - "//evil.com" → 현재 스킴 상속 (http://evil.com) : 별도 스킴 검증으로 http/https만 허용
//   - "/path"      → 현재 호스트 유지
//   - "https://x"  → 그대로
// 반환된 URL의 스킴이 http/https가 아니면(예: Location: javascript:...) 거부한다.
export function resolveRedirectTarget(
  location: string,
  currentUrl: string,
): { ok: true; url: URL } | { ok: false; error: string } {
  if (!location) return { ok: false, error: "no_location" };
  let resolved: URL;
  try {
    resolved = new URL(location, currentUrl);
  } catch {
    return { ok: false, error: "invalid_redirect" };
  }
  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
    return { ok: false, error: "unsupported_redirect_protocol" };
  }
  return { ok: true, url: resolved };
}

// === 리다이렉트 홉 안전성 검증 (SSRF 재검증의 2단계 — resolve + isSafeHost 결합) ===
// Location을 절대 URL로 해석한 뒤, 그 호스트명을 반드시 isSafeHost로 재검증한다.
// hostCheck를 주입 가능하게 하여(기본값 isSafeHost) 실제 네트워크 없이 테스트할 수 있다.
// airtight 요건:
//   1) 상대/프로토콜-상대/절대 Location 모두 resolveRedirectTarget이 해석 후 검증 (우회 불가)
//   2) 해석된 호스트명은 원본과 동일한 isSafeHost 로직으로 재검증 (약화 없이 "더 자주" 호출)
//   3) IP 리터럴/DNS 조회 판정은 isSafeHost에 위임 — 별도 재구현 없음 (판정 불일치 방지)
export async function checkRedirectHopSafe(
  location: string,
  currentUrl: string,
  hostCheck: (hostname: string) => Promise<boolean> = isSafeHost,
): Promise<{ ok: true; url: URL } | { ok: false; error: string }> {
  const resolved = resolveRedirectTarget(location, currentUrl);
  if (!resolved.ok) return resolved;
  let safe: boolean;
  try {
    safe = await hostCheck(resolved.url.hostname);
  } catch {
    safe = false; // fail-closed: 판정 중 예외 시 차단
  }
  if (!safe) return { ok: false, error: "blocked_host" };
  return { ok: true, url: resolved.url };
}

// === 페이월/로그인 벽 감지 ===
// 완벽한 감지는 불가능 — 흔한 신호(로그인 유도 문구, 페이월 마커 클래스명 등)만 휴리스틱으로 판정.
const AUTH_WALL_MARKERS = [
  /please\s+log\s*in/i,
  /sign\s*in\s+to\s+continue/i,
  /subscribe\s+to\s+continue\s+reading/i,
  /this\s+content\s+is\s+for\s+subscribers/i,
  /로그인\s*(하시면|후)?[\s\S]{0,20}(이용|열람|계속)/,
  /구독(하시면|자만)[\s\S]{0,20}(이용|열람)/,
  /class=["'][^"']*paywall[^"']*["']/i,
  /class=["'][^"']*(login-wall|auth-wall)[^"']*["']/i,
];

export function detectAuthWall(html: string): boolean {
  if (!html) return false;
  const sample = html.slice(0, 20_000);
  return AUTH_WALL_MARKERS.some((re) => re.test(sample));
}

// === 차단 감지 (직접 fetch 실패 판정) ===
const BLOCK_MARKERS = [
  /captcha/i,
  /checking\s+your\s+browser/i,
  /cloudflare/i,
  /access\s+denied/i,
  /just\s+a\s+moment/i,
  /perimeterx/i,
  /unusual\s+traffic/i,
];

export function detectBlockedContent(status: number, html: string): boolean {
  if (status === 403 || status === 429 || status === 503) return true;
  if (!html || html.trim().length === 0) return true;
  const sample = html.slice(0, 5_000);
  return BLOCK_MARKERS.some((re) => re.test(sample));
}

// === URL 변형 (모바일/AMP 등 — 단순 후보 생성만, 실제 요청 여부는 direct 전략에서 1개만 사용) ===
export function buildUrlVariants(rawUrl: string): string[] {
  const variants = new Set<string>();
  variants.add(rawUrl);
  try {
    const u = new URL(rawUrl);
    // AMP 후보: 경로 끝에 /amp 부착 (일부 뉴스 사이트 컨벤션)
    if (!u.pathname.endsWith("/amp") && !u.pathname.endsWith("/amp/")) {
      const ampUrl = new URL(u.toString());
      ampUrl.pathname = ampUrl.pathname.replace(/\/?$/, "/amp");
      variants.add(ampUrl.toString());
    }
  } catch {
    /* 무시 — 원본만 사용 */
  }
  return Array.from(variants);
}

// === HTML → 텍스트 추출 (완전한 readability 알고리즘 대신 경량 태그 스트립 + OGP) ===

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

export function extractTitleFromHtml(html: string): string | undefined {
  const ogMatch = html.match(
    /<meta[^>]+property\s*=\s*["']og:title["'][^>]+content\s*=\s*["']([^"']*)["']/i,
  );
  if (ogMatch?.[1]) return decodeHtmlEntities(ogMatch[1]).trim();
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch?.[1]) return decodeHtmlEntities(titleMatch[1]).replace(/\s+/g, " ").trim();
  return undefined;
}

// JSON-LD에서 headline/description 추출 (schema.org Article/NewsArticle 등)
export function extractJsonLdMeta(html: string): { title?: string; description?: string } {
  const result: { title?: string; description?: string } = {};
  const scriptRe = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        if (node && typeof node === "object") {
          if (!result.title && typeof node.headline === "string") result.title = node.headline;
          if (!result.description && typeof node.description === "string") result.description = node.description;
        }
      }
    } catch {
      /* JSON-LD 파싱 실패는 무시 — 본문 추출에 영향 없음 */
    }
    if (result.title && result.description) break;
  }
  return result;
}

export function stripHtmlToText(html: string): string {
  let s = html;
  // script/style/noscript 블록 완전 제거 (본문 오염 방지)
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  // 블록 요소 경계에 줄바꿈 삽입 (문단 구분 유지)
  s = s.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, "\n");
  // 나머지 태그 제거
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeHtmlEntities(s);
  // 공백 정리: 각 줄 내부 다중 공백 축소, 3줄 이상 개행은 2줄로 축소
  s = s
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

export function truncateText(
  text: string,
  maxLength: number,
): { text: string; truncated: boolean } {
  if (text.length <= maxLength) return { text, truncated: false };
  return { text: text.slice(0, maxLength) + "\n\n[...truncated]", truncated: true };
}

// === 전략 (a): 직접 fetch (브라우저 헤더) ===

// 리다이렉트 최대 홉 수 — url-preview.ts와 동일 정책(합리적 상한). 무한/과다 리다이렉트 방어.
const MAX_REDIRECTS = 5;

async function fetchDirect(
  targetUrl: string,
  timeoutMs: number,
  maxBytes: number,
): Promise<{ status: number; html: string; finalUrl: string; contentType: string } | { error: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // SSRF 방어 핵심: redirect:"follow"를 절대 사용하지 않는다.
    // fetch가 자동으로 리다이렉트를 따라가면 최종 URL이 isSafeHost 검증을 우회할 수 있으므로
    // redirect:"manual"로 3xx를 직접 받아, 매 홉마다 Location을 해석하고 isSafeHost로 재검증한다.
    //
    // [잔존 리스크 — DNS 리바인딩 TOCTOU]
    // isSafeHost(hostname)의 DNS 조회와, 실제 fetch(url) 내부의 DNS 조회는 별개로 수행된다.
    // 따라서 공격자가 짧은 TTL로 "검증 시점=안전 IP, fetch 시점=내부 IP"로 응답을 바꾸면
    // (DNS rebinding) 이 방어를 우회할 여지가 원리상 남는다. Node/undici의 fetch는
    // 해석된 IP를 직접 고정(pin)하는 옵션을 기본 제공하지 않아, 완전한 차단은
    // 커스텀 dns.lookup으로 IP를 고정하고 그 IP로 직접 연결하는 별도 작업이 필요하다(향후 과제).
    // 현재 구현은 매 홉 재검증으로 "리다이렉트 기반 SSRF"는 airtight하게 막지만,
    // 위 rebinding 잔존 리스크는 명시적으로 남겨둔다.
    let currentUrl = targetUrl;
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      res = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: ctrl.signal,
        headers: BROWSER_HEADERS,
      });

      if (res.status >= 300 && res.status < 400) {
        if (hop >= MAX_REDIRECTS) return { error: "too_many_redirects" };
        const loc = res.headers.get("location");
        if (!loc) return { error: "redirect_without_location" };
        // 다음 홉 진입 전 반드시 재검증 — 상대/프로토콜-상대 Location 포함 모두 해석 후 isSafeHost.
        const hopCheck = await checkRedirectHopSafe(loc, currentUrl);
        if (!hopCheck.ok) return { error: hopCheck.error };
        // 리다이렉트 응답 본문은 소비하지 않고 폐기(다음 홉으로 진행).
        try {
          await res.body?.cancel();
        } catch {
          /* 취소 실패는 무시 */
        }
        currentUrl = hopCheck.url.toString();
        continue;
      }
      break; // 3xx가 아니면 최종 응답 — 루프 종료
    }
    if (!res) return { error: "fetch_failed" };

    const contentType = res.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml|text\/plain/i.test(contentType)) {
      return { error: "not_text_content" };
    }

    const contentLength = Number(res.headers.get("content-length") || 0);
    if (contentLength && contentLength > maxBytes) return { error: "too_large" };

    const reader = res.body?.getReader();
    if (!reader) return { error: "no_body" };
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.length;
      if (received > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          /* 취소 실패는 무시 */
        }
        return { error: "too_large" };
      }
      chunks.push(value);
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
    // finalUrl은 실제로 검증 후 fetch한 마지막 홉 URL(currentUrl). res.url도 동일하지만 명시적으로 사용.
    return { status: res.status, html, finalUrl: currentUrl || res.url || targetUrl, contentType };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "fetch_failed" };
  } finally {
    clearTimeout(timer);
  }
}

// === 전략 (b): Jina Reader 무료 프록시 ===

async function fetchViaJinaReader(
  targetUrl: string,
  timeoutMs: number,
  maxBytes: number,
): Promise<{ text: string; finalUrl: string } | { error: string }> {
  const jinaUrl = JINA_READER_BASE + encodeURI(targetUrl);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(jinaUrl, {
      method: "GET",
      signal: ctrl.signal,
      headers: {
        "User-Agent": BROWSER_HEADERS["User-Agent"],
        Accept: "text/plain, text/markdown, */*;q=0.5",
      },
    });
    if (!res.ok) return { error: `jina_http_${res.status}` };
    const reader = res.body?.getReader();
    if (!reader) return { error: "jina_no_body" };
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.length;
      if (received > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          /* 취소 실패는 무시 */
        }
        break;
      }
      chunks.push(value);
    }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    return { text, finalUrl: targetUrl };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "jina_fetch_failed" };
  } finally {
    clearTimeout(timer);
  }
}

// === 메인 진입점 ===

export async function readWebPage(url: string, opts?: WebReaderOptions): Promise<WebReaderResult> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxTextLength = opts?.maxTextLength ?? DEFAULT_MAX_TEXT_LENGTH;

  const parsedResult = parseTargetUrl(url);
  if (!parsedResult.ok) {
    return { ok: false, url, error: parsedResult.error };
  }
  const parsed = parsedResult.url;

  // SSRF 가드 — 모든 전략(direct, jina 프록시 포함) 시도 이전에 타겟 호스트를 반드시 검증.
  // Jina Reader는 우리 서버가 대신 호출하는 프록시이므로, 검증 없이 넘기면
  // "우리 서버 = 내부망 오픈 프록시"가 되어버린다 (예: 169.254.169.254 메타데이터 엔드포인트 우회 시도).
  let safe: boolean;
  try {
    safe = await isSafeHost(parsed.hostname);
  } catch {
    safe = false;
  }
  if (!safe) {
    return { ok: false, url, error: "blocked_host" };
  }

  const cacheKey = parsed.toString();

  // 전략 (a): 직접 fetch
  let directHtml = "";
  let directStatus = 0;
  try {
    const direct = await fetchDirect(cacheKey, timeoutMs, maxBytes);
    if (!("error" in direct)) {
      directHtml = direct.html;
      directStatus = direct.status;
      const blocked = detectBlockedContent(direct.status, direct.html);
      if (!blocked) {
        if (detectAuthWall(direct.html)) {
          return {
            ok: false,
            url: cacheKey,
            finalUrl: direct.finalUrl,
            authRequired: true,
            strategy: "direct",
            error: "auth_required",
          };
        }
        const title = extractTitleFromHtml(direct.html);
        const jsonLd = extractJsonLdMeta(direct.html);
        const rawText = stripHtmlToText(direct.html);
        const { text, truncated } = truncateText(rawText, maxTextLength);
        return {
          ok: true,
          url: cacheKey,
          finalUrl: direct.finalUrl,
          title: title || jsonLd.title,
          text,
          contentType: direct.contentType,
          strategy: "direct",
          truncated,
        };
      }
    }
  } catch {
    /* direct 전략 실패 — jina 폴백으로 진행 */
  }

  // 전략 (b): Jina Reader 폴백
  try {
    const jina = await fetchViaJinaReader(cacheKey, timeoutMs, maxBytes);
    if (!("error" in jina)) {
      if (detectAuthWall(jina.text)) {
        return {
          ok: false,
          url: cacheKey,
          finalUrl: jina.finalUrl,
          authRequired: true,
          strategy: "jina-reader",
          error: "auth_required",
        };
      }
      const { text, truncated } = truncateText(jina.text.trim(), maxTextLength);
      if (text.length > 0) {
        // Jina 결과 첫 줄이 보통 "Title: ..." 형태 — 있으면 title로 승격.
        const titleLineMatch = text.match(/^Title:\s*(.+)$/m);
        return {
          ok: true,
          url: cacheKey,
          finalUrl: jina.finalUrl,
          title: titleLineMatch?.[1]?.trim(),
          text,
          strategy: "jina-reader",
          truncated,
        };
      }
    }
  } catch {
    /* jina 전략도 실패 — 아래 최종 실패 처리로 진행 */
  }

  // 전략 (c): 로그인/페이월 감지 (direct 응답이 있었다면 재확인)
  if (directHtml && detectAuthWall(directHtml)) {
    return { ok: false, url: cacheKey, authRequired: true, error: "auth_required" };
  }

  return {
    ok: false,
    url: cacheKey,
    error: directStatus ? `http_${directStatus}` : "fetch_failed",
  };
}
