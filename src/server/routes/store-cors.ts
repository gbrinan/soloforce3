import type { Context, Next } from "hono";

// mycrew-store(store.dooitspace.com)는 별도 오리진에서 이 서버(localhost)로 fetch하므로
// 명시적으로 허용한 오리진에 한해 CORS 응답 헤더를 붙인다. 매칭 실패 시 헤더 없이 통과
// (브라우저가 응답 본문 읽기를 차단 — 서버측 상태는 변경되지 않으므로 안전).
// store.ts의 페어링/설치 라우트와 동일 정책 — catalog/installed 라우터가 공유한다.
export function allowedStoreOrigins(): string[] {
  return (
    process.env.STORE_ORIGIN ||
    "http://localhost:3000,https://store.dooitspace.com,https://mycrew-store.vercel.app"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function corsHeadersFor(origin: string | undefined): Record<string, string> | undefined {
  if (!origin || !allowedStoreOrigins().includes(origin)) return undefined;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    // store.dooitspace.com(공개 HTTPS)이 localhost(사설망) 대상으로 fetch하므로
    // Chrome Private Network Access(PNA) preflight가 이 헤더 없이는 실 요청을 차단한다.
    "Access-Control-Allow-Private-Network": "true",
  };
}

// Hono 미들웨어: OPTIONS preflight 204 응답 + 실제 응답에 CORS 헤더 부착.
export function storeCorsMiddleware() {
  return async (c: Context, next: Next) => {
    const headers = corsHeadersFor(c.req.header("Origin"));
    if (c.req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    await next();
    if (headers) {
      for (const [k, v] of Object.entries(headers)) c.res.headers.set(k, v);
    }
  };
}
