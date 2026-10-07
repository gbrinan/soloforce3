// app-proxy: REST proxy from host (/api/apps/:appId/*) to the app server (e.g. 127.0.0.1:3201).
// Used for large payloads (image originals, xlsx export) where WS is inefficient.
// 503 if the app is not registered.
import type { Context } from "hono";
import { getManifest, ensureAppWarm } from "./app-registry.js";

const CONN_ERR_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH"]);
// Wait up to ~10s total for cold-starting apps (Next.js can take 5-20s on first boot).
const UPSTREAM_RETRY_DELAYS_MS = [500, 1500, 3000, 5000] as const;

function isConnError(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  const code = e?.code ?? e?.cause?.code;
  return typeof code === "string" && CONN_ERR_CODES.has(code);
}

// Retries on connection errors only for bodyless (GET/HEAD) requests.
// ReadableStream bodies can only be consumed once, so POST/PUT with body cannot be retried.
async function fetchUpstream(
  target: string,
  init: RequestInit & { duplex?: "half" },
  retryable: boolean,
  onConnError?: () => void,
): Promise<Response> {
  let warmed = false;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(target, init);
    } catch (err) {
      // 죽은 앱을 처음 감지하면 온디맨드 기동을 트리거한다. 이후 재시도 지연(~10s)이
      // 콜드스타트 시간을 벌어주므로, autostart=false 앱도 열면 자동으로 뜬다.
      if (isConnError(err) && !warmed) { warmed = true; onConnError?.(); }
      const canRetry = retryable && isConnError(err) && attempt < UPSTREAM_RETRY_DELAYS_MS.length;
      if (!canRetry) throw err;
      const delay = UPSTREAM_RETRY_DELAYS_MS[attempt];
      console.log(
        `[app-proxy] upstream not ready, retry ${attempt + 1}/${UPSTREAM_RETRY_DELAYS_MS.length} in ${delay}ms — ${target}`,
      );
      await new Promise<void>((r) => setTimeout(r, delay));
    }
  }
}

export async function proxyAppRequest(c: Context, appId: string, restPath: string): Promise<Response> {
  const m = getManifest(appId);
  if (!m) return c.text(`app '${appId}' not installed`, 503);
  const port = m.ports?.http;
  if (!port) return c.text(`app '${appId}' has no http port`, 503);
  // path traversal 방어: raw + decoded restPath 모두 `..` 세그먼트 검사.
  // 업스트림이 127.0.0.1 고정이라 SSRF는 없지만 앱 내부 경로 이탈 방지.
  let decodedRest = restPath;
  try { decodedRest = decodeURIComponent(restPath); } catch { /* malformed → 아래 검사로 차단 */ }
  const hasDotDot = (s: string) => s.split(/[/\\]/).some((seg) => seg === ".." || seg === ".");
  if (hasDotDot(restPath) || hasDotDot(decodedRest)) {
    return c.text("invalid path", 400);
  }
  const reqUrl = new URL(c.req.url);
  const qs = reqUrl.search || "";
  // passthrough: Next.js basePath 앱은 `/api/apps/:id/proxy` 프리픽스를 유지한 채 전달해야
  // 업스트림의 basePath 라우팅(_next, 페이지, API)이 맞아떨어진다. strip(기본)은 프리픽스 제거.
  // restPath가 빈 문자열일 때 trailing slash를 붙이면 Next.js가 308 리다이렉트를 반환하므로
  // restPath가 있을 때만 슬래시를 삽입한다.
  const upstreamPath =
    m.proxyMode === "passthrough"
      ? `/api/apps/${appId}/proxy${restPath ? `/${restPath}` : ""}`
      : `/${restPath}`;
  const target = `http://127.0.0.1:${port}${upstreamPath}${qs}`;
  const method = c.req.method.toUpperCase();
  const bodyless = method === "GET" || method === "HEAD";
  // Strip hop-by-hop & host headers so upstream sees a clean request.
  const fwdHeaders = new Headers(c.req.raw.headers);
  fwdHeaders.delete("host");
  fwdHeaders.delete("connection");
  // The portal proxies local app servers only. Avoid retaining thousands of
  // idle upstream keep-alive sockets when app pages/assets are loaded in bulk.
  fwdHeaders.set("connection", "close");
  // Strip x-forwarded-* so the upstream Next.js router doesn't self-proxy to
  // https://localhost:<port> (EPROTO + ::1 ECONNREFUSED → ~22s hang → 500).
  fwdHeaders.delete("x-forwarded-proto");
  fwdHeaders.delete("x-forwarded-host");
  fwdHeaders.delete("x-forwarded-port");
  // 마이크루 설정 언어(mycrew_lang 쿠키, I18nProvider가 기록)를 Accept-Language로 강제 —
  // 로케일 라우팅 앱(계약 등)이 브라우저 언어가 아닌 마이크루 언어 설정을 따르게 한다.
  const langCookie = /(?:^|;\s*)mycrew_lang=(ko|en|ja)(?:;|$)/.exec(c.req.header("cookie") ?? "");
  if (langCookie) fwdHeaders.set("accept-language", `${langCookie[1]},${langCookie[1]};q=0.9`);
  const origContentLength = fwdHeaders.get("content-length");
  fwdHeaders.delete("content-length");
  try {
    let retryable = bodyless;
    const init: RequestInit & { duplex?: "half" } = {
      method,
      headers: fwdHeaders,
    };
    if (!bodyless) {
      const rawBody = (c.req.raw as Request).body;
      if (rawBody) {
        // Buffer bodies ≤ 512 KB: fixes duplex-streaming errors on undici keep-alive pools
        // and enables retry on transient connection errors.
        // Large bodies (image originals, xlsx) remain as streaming ReadableStream.
        const cl = origContentLength ? parseInt(origContentLength, 10) : NaN;
        if (!isNaN(cl) && cl >= 0 && cl <= 512 * 1024) {
          init.body = await (c.req.raw as Request).arrayBuffer();
          retryable = true;
        } else {
          init.body = rawBody as BodyInit;
          // Node/undici requires duplex: "half" when body is a ReadableStream.
          init.duplex = "half";
        }
      }
    }
    const upstream = await fetchUpstream(target, init, retryable, () => ensureAppWarm(appId));
    const respHeaders = new Headers(upstream.headers);
    // undici fetch 는 gzip/br 응답 본문을 자동 해제해서 upstream.body 로 준다. 하지만 content-encoding
    // 헤더는 원본(gzip)이 그대로 남아, 그대로 전달하면 브라우저가 "이미 해제된 평문"을 또 gunzip 시도 →
    // 실패 → CSS/JS 깨짐. 해제된 본문이므로 인코딩/길이 헤더를 제거한다.
    // 단, content-encoding 이 없는 응답(video/audio streaming 포함)은 content-length 를 보존해야
    // <video> 가 seek/buffering 길이를 알 수 있다. 무조건 삭제하면 모바일 사파리에서 미리보기 깨짐.
    const hadEncoding = respHeaders.has("content-encoding");
    if (hadEncoding) {
      respHeaders.delete("content-encoding");
      respHeaders.delete("content-length");
    }
    // HTML 문서는 prerender 시 s-maxage(공유캐시 1년)가 붙어 브라우저/CDN이 옛 페이지(없는 에셋 해시 참조)를
    // 계속 서빙 → 무스타일/깨짐. 문서만 no-store 강제(해시드 _next 에셋은 immutable 유지).
    const ct = respHeaders.get("content-type") || "";
    if (ct.includes("text/html")) {
      respHeaders.set("cache-control", "no-store, must-revalidate");
      respHeaders.delete("etag");
    }
    return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
  } catch (err) {
    console.warn(`[app-proxy] ${appId} ${method} ${target} upstream failed:`, err instanceof Error ? err.message : err);
    return c.text(`app '${appId}' unreachable`, 502);
  }
}
