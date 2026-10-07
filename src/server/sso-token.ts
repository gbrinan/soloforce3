// SSO 토큰 발급·검증 — 호스트→iframe 앱 자동 로그인용
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// SSO_SECRET 영속화: env 우선 → 프로젝트 루트 `.sso-secret` 파일 → 신규 생성(0600).
// 재시작마다 새 키 생성되면 발급된 모든 토큰이 무효화되므로 디스크 캐시.
function loadSecret(): string {
  if (process.env.SSO_SECRET) return process.env.SSO_SECRET;
  const here = dirname(fileURLToPath(import.meta.url));
  // 빌드 산출물 위치는 dist/server/sso-token.js, 소스는 src/server/sso-token.ts
  // 어느 쪽이든 ../../ 가 프로젝트 루트.
  const secretPath = resolve(here, "..", "..", ".sso-secret");
  if (existsSync(secretPath)) return readFileSync(secretPath, "utf-8").trim();
  const fresh = randomBytes(32).toString("hex");
  writeFileSync(secretPath, fresh, { mode: 0o600 });
  return fresh;
}

const SSO_SECRET = loadSecret();
const TOKEN_TTL_SEC = 300; // 5분

interface SSOPayload {
  email: string;
  name?: string;
  picture?: string;
  exp: number;
}

function base64url(data: string): string {
  return Buffer.from(data).toString("base64url");
}

function base64urlDecode(data: string): string {
  return Buffer.from(data, "base64url").toString("utf-8");
}

export function createSSOToken(email: string, name?: string, picture?: string): string {
  const payload: SSOPayload = {
    email,
    name,
    picture,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC,
  };
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  const signature = createHmac("sha256", SSO_SECRET)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${signature}`;
}

export function verifySSOToken(token: string): SSOPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  
  // 서명 검증 (timing-safe)
  const expected = createHmac("sha256", SSO_SECRET)
    .update(`${header}.${body}`)
    .digest("base64url");
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
  
  // 페이로드 파싱
  let payload: SSOPayload;
  try {
    payload = JSON.parse(base64urlDecode(body));
  } catch {
    return null;
  }
  
  // 만료 검증
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  
  return payload;
}
