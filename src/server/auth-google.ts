// Google OAuth SSO — ALLOWED_EMAILS에 등록한 계정만 접근 허용 (.env 설정 필수).
// 설계 원칙:
// - GOOGLE_CLIENT_ID/SECRET 미설정 시 전체 비활성(통과) → 자기 잠김(lockout) 방지. 설정+재시작 시 활성.
// - 내부 self-fetch(127.0.0.1, XFF 없음)는 면제 → 워커/코덱스/터미널 MCP 무한루프 방지.
//   (routes.ts:620 /api/genie/* loopback 게이트와 동일 기준)
// - friends(/api/external/*)는 자체 partner token 게이트가 검증 → SSO 면제.
// - 세션은 파일 기반(HISTORY_DIR/auth-sessions.json) → self 재시작에도 로그인 유지.
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Context, Hono, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HISTORY_DIR } from "../config.js";
import { verifyPairingToken } from "./app-bus.js";
import { detectClaudeCli } from "./claude-cli.js";
import { allowedStoreOrigins } from "./routes/store-cors.js";

const SESSION_COOKIE = "mycrew_sid";
const STATE_COOKIE = "mycrew_oauth_state";
const SESSIONS_FILE = join(HISTORY_DIR, "auth-sessions.json");
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30일

interface Session {
  email: string;
  name?: string;
  picture?: string;
  createdAt: number;
  expiresAt: number;
  googleRefreshToken?: string;
  // store.dooitspace.com(Supabase Auth)에서 브릿지된 세션만 보유 — installations.user_id 매핑용.
  supabaseUserId?: string;
}

const sessions = new Map<string, Session>();

export function loadAuthSessions(): void {
  if (!existsSync(SESSIONS_FILE)) return;
  try {
    const raw = JSON.parse(readFileSync(SESSIONS_FILE, "utf-8")) as Record<string, Session>;
    const now = Date.now();
    for (const [sid, s] of Object.entries(raw)) {
      if (s && typeof s.expiresAt === "number" && s.expiresAt > now) sessions.set(sid, s);
    }
    console.log(`[SSO] 세션 복원 ${sessions.size}건`);
  } catch (err) {
    console.error("[SSO] 세션 로드 실패:", err);
  }
}

function saveSessions(): void {
  try {
    if (!existsSync(HISTORY_DIR)) mkdirSync(HISTORY_DIR, { recursive: true });
    const obj: Record<string, Session> = {};
    for (const [sid, s] of sessions) obj[sid] = s;
    writeFileSync(SESSIONS_FILE, JSON.stringify(obj, null, 2));
  } catch (err) {
    console.error("[SSO] 세션 저장 실패:", err);
  }
}

function createSession(email: string, name?: string, picture?: string, refreshToken?: string, supabaseUserId?: string): string {
  const sid = randomUUID();
  const now = Date.now();
  sessions.set(sid, { email, name, picture, createdAt: now, expiresAt: now + SESSION_TTL_MS, googleRefreshToken: refreshToken, supabaseUserId });
  saveSessions();
  return sid;
}

function getValidSession(sid: string): Session | null {
  const s = sessions.get(sid);
  if (!s) return null;
  if (s.expiresAt <= Date.now()) {
    sessions.delete(sid);
    saveSessions();
    return null;
  }
  return s;
}

function destroySession(sid: string): void {
  if (sessions.delete(sid)) saveSessions();
}

// 패키지 배포본 최초 로그인 오너 클레임 — ALLOWED_EMAILS 미설정 상태에서 첫 SSO 사용자를
// 소유자로 영구 기록한다(history/auth-owner.json). 이후엔 그 이메일만 허용.
const OWNER_FILE = join(HISTORY_DIR, "auth-owner.json");

function ownerEmails(): string[] {
  try {
    if (!existsSync(OWNER_FILE)) return [];
    const data = JSON.parse(readFileSync(OWNER_FILE, "utf-8")) as { emails?: string[] };
    return (data.emails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean);
  } catch {
    return [];
  }
}

export function claimOwnerEmail(email: string): void {
  const normalized = email.trim().toLowerCase();
  const current = ownerEmails();
  if (current.includes(normalized)) return;
  writeFileSync(OWNER_FILE, JSON.stringify({ emails: [...current, normalized], claimedAt: new Date().toISOString() }, null, 2) + "\n", "utf-8");
  console.log(`[SSO] 최초 로그인 오너 클레임: ${normalized}`);
}

function allowedEmails(): string[] {
  const env = (process.env.ALLOWED_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return [...env, ...ownerEmails()];
}

// 아직 아무도 허용되지 않은 신품 상태 — 최초 로그인 클레임 허용 조건.
export function noEmailsConfigured(): boolean {
  return allowedEmails().length === 0;
}

function isEmailAllowed(email: string): boolean {
  return allowedEmails().includes(email.trim().toLowerCase());
}

export function isSsoEnabled(): boolean {
  // 패키지 배포본: Google OAuth 자격증명 없이도 MYCREW_REQUIRE_SSO=1이면 SSO 게이트 활성
  // (인증은 스토어 Supabase SSO 브릿지 /api/store/session-import로 수행).
  if (process.env.MYCREW_REQUIRE_SSO === "1") return true;
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

// 로컬 Google OAuth 자격증명 보유 여부 — /auth/google 직접 플로우 가능 여부 판별.
export function hasGoogleCredentials(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function callbackUrl(c?: Context): string {
  if (process.env.GOOGLE_CALLBACK_URL) return process.env.GOOGLE_CALLBACK_URL;
  if (c) {
    const host = c.req.header("X-Forwarded-Host") || c.req.header("Host") || "";
    const proto = c.req.header("X-Forwarded-Proto") || (host.startsWith("localhost") ? "http" : "https");
    if (host) return `${proto}://${host}/auth/google/callback`;
  }
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  if (base) return `${base}/auth/google/callback`;
  return "http://localhost:3456/auth/google/callback";
}

function isLoopback(remote: string): boolean {
  return remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
}

// 내부 loopback self-fetch 판별 (XFF/X-Real-IP 없음 + remoteAddress loopback).
function isLoopbackInternal(c: Context): boolean {
  const fwd = c.req.header("X-Forwarded-For") || c.req.header("X-Real-IP");
  if (fwd) return false;
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } })?.incoming;
  return isLoopback(incoming?.socket?.remoteAddress ?? "");
}

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return undefined;
}

function isLikelyPageRequest(path: string, method: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  if (
    path.startsWith("/api/") ||
    path.startsWith("/assets/") ||
    path.startsWith("/attachments/") ||
    path.startsWith("/ws/")
  ) {
    return false;
  }
  const last = path.split("/").pop() ?? "";
  return !last.includes(".");
}

// WebSocket upgrade 검증용 (raw IncomingMessage).
// 내부 loopback(XFF 없음)이거나 유효 세션 쿠키면 허용.
export function isWsRequestAuthorized(req: import("node:http").IncomingMessage): boolean {
  if (!isSsoEnabled()) return true;
  const fwd = req.headers["x-forwarded-for"] || req.headers["x-real-ip"];
  if (!fwd && isLoopback(req.socket?.remoteAddress ?? "")) return true;
  const sid = parseCookie(req.headers.cookie, SESSION_COOKIE);
  if (!sid) return false;
  const s = getValidSession(sid);
  return !!s && isEmailAllowed(s.email);
}

// 현재 요청의 사용자 키(로그인 이메일, 소문자). 사용자별 데이터 격리에 사용.
// SSO 비활성/미인증/내부 self-fetch는 단일 사용자("__local__")로 통합.
export function getRequestUserKey(c: Context): string {
  if (!isSsoEnabled()) return "__local__";
  const sid = getCookie(c, SESSION_COOKIE);
  const sess = sid ? getValidSession(sid) : null;
  if (sess && isEmailAllowed(sess.email)) return sess.email.trim().toLowerCase();
  return "__local__";
}

// 유효한 로그인 세션이 하나라도 있는가 — 스토어 자동 로그인 트리거 판단용(불리언만 노출).
export function hasAnyValidSession(): boolean {
  if (!isSsoEnabled()) return false;
  const now = Date.now();
  for (const s of sessions.values()) {
    if (s.expiresAt > now && isEmailAllowed(s.email)) return true;
  }
  return false;
}

// SSO 토큰 발급을 위한 현재 세션 정보 조회 (routes.ts에서 사용)
export function getCurrentSession(c: Context): Session | null {
  if (!isSsoEnabled()) return null;
  const sid = getCookie(c, SESSION_COOKIE);
  const sess = sid ? getValidSession(sid) : null;
  if (sess && isEmailAllowed(sess.email)) return sess;
  return null;
}

export interface StoreSessionImportResult {
  ok: boolean;
  reason?: "email_not_allowed" | "sso_disabled";
  email?: string;
  name?: string;
  picture?: string;
}

// mycrew-store(Supabase Google SSO)에서 검증된 사용자 정보를 받아 MyCrew 세션 쿠키로 브릿지.
// 별도 Google 재인증 없이 기존 auth-sessions.json 세션 저장소에 합류시켜 ssoMiddleware와 그대로 호환된다.
export function importStoreSession(c: Context, email: string, name?: string, picture?: string, supabaseUserId?: string): StoreSessionImportResult {
  if (!isSsoEnabled()) return { ok: false, reason: "sso_disabled" };
  const normalized = email.trim().toLowerCase();
  // 신품 패키지(허용 이메일 미설정): 최초 로그인 사용자를 오너로 클레임하고 통과시킨다.
  if (noEmailsConfigured()) claimOwnerEmail(normalized);
  if (!isEmailAllowed(normalized)) return { ok: false, reason: "email_not_allowed" };
  const sid = createSession(normalized, name, picture, undefined, supabaseUserId);
  const isHttps = callbackUrl(c).startsWith("https://");
  setCookie(c, SESSION_COOKIE, sid, { httpOnly: true, secure: isHttps, sameSite: "Lax", maxAge: Math.floor(SESSION_TTL_MS / 1000), path: "/" });
  return { ok: true, email: normalized, name, picture };
}

// 세션에서 refresh_token만 제거 (재인증 후 새 토큰 저장하기 위함). 다른 필드는 유지.
function clearSessionRefreshToken(c: Context): void {
  const sid = getCookie(c, SESSION_COOKIE);
  if (!sid) return;
  const sess = sessions.get(sid);
  if (!sess || !sess.googleRefreshToken) return;
  delete sess.googleRefreshToken;
  saveSessions();
}

export interface FreshIdTokenResult {
  idToken: string | null;
  // true → 클라이언트가 사용자를 /auth/google 로 재로그인 유도해야 한다.
  // (세션에 refresh_token 없음 / Google이 refresh_token 만료·revoke / Google 응답에 id_token 없음)
  needsReauth: boolean;
}

// Use stored refresh_token to get a fresh Google id_token for Firebase signInWithCredential.
// Returns { idToken: null, needsReauth: true } when stored refresh_token is missing or rejected.
export async function getFreshGoogleIdToken(c: Context): Promise<FreshIdTokenResult> {
  const sess = getCurrentSession(c);
  if (!sess) {
    // 세션 자체가 없으면 ssoMiddleware가 이미 401/redirect로 잡았어야 함.
    // 여기 도달했다면 SSO 비활성(__local__) 상태 → 재인증으로 해결 불가.
    return { idToken: null, needsReauth: false };
  }
  if (!sess.googleRefreshToken) {
    console.warn("[google-id-token] 세션에 refresh_token 없음 — prompt=consent로 재로그인 필요");
    return { idToken: null, needsReauth: true };
  }
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID as string,
        client_secret: process.env.GOOGLE_CLIENT_SECRET as string,
        refresh_token: sess.googleRefreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[google-id-token] Google 토큰 교환 실패 status=${res.status} body=${body.slice(0,200)}`);
      // invalid_grant → refresh_token이 만료·revoke됨. 세션에서 제거하고 재로그인 유도.
      // (다른 5xx 일시 오류도 보수적으로 재로그인 유도; 성공 케이스는 한 번 더 시도하면 회복됨)
      const isInvalidGrant = res.status === 400 || res.status === 401;
      if (isInvalidGrant) clearSessionRefreshToken(c);
      return { idToken: null, needsReauth: isInvalidGrant };
    }
    const data = (await res.json()) as { id_token?: string };
    if (!data.id_token) {
      console.warn("[google-id-token] Google 응답에 id_token 없음");
      return { idToken: null, needsReauth: true };
    }
    console.log("[google-id-token] id_token 발급 성공");
    return { idToken: data.id_token, needsReauth: false };
  } catch (err) {
    console.warn("[google-id-token] 네트워크/예외:", err);
    // 네트워크 일시 장애는 재인증으로 해결 안 됨 → needsReauth=false.
    return { idToken: null, needsReauth: false };
  }
}

export function ssoMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    if (!isSsoEnabled()) return next();
    const p = c.req.path;
    // 인증 흐름 경로
    if (p === "/auth/google" || p === "/auth/google/callback" || p === "/auth/logout") return next();
    // 스토어 SSO 로그인 브릿지 — 세션이 없는 상태에서 실행되는 로그인 진입점이므로 SSO 게이트를 통과해야 한다.
    // (게이트로 막으면 store-callback이 /onboarding으로 튕겨 약관→로그인 무한 루프. 인증은 세션-임포트가
    //  스토어 Supabase access_token 검증으로 자체 수행한다.)
    if (p === "/auth/store-callback" || p === "/api/store/session-import") return next();
    // 스토어 프론트(store.dooitspace.com) 크로스오리진 연동 API — 브라우저는 크로스오리진 요청에
    // 세션 쿠키를 싣지 않으므로 SSO 게이트로는 인증 불가. 오리진 화이트리스트 + 각 라우트의
    // CORS/PNA 검증으로 보호한다. (WSL2 등 비-loopback 환경에서 스토어→로컬 연동 401 차단 해소)
    if (p.startsWith("/api/store/") && allowedStoreOrigins().includes(c.req.header("Origin") || "")) return next();
    if (p === "/favicon.ico" || p === "/favicon.png") return next();
    // 약관 정책 조회(읽기 전용 공개 문서) — /onboarding 동의 화면이 로그인 전에 내용보기를 렌더링해야 함
    if (c.req.method === "GET" && p.startsWith("/api/consent/policies")) return next();
    // 클로드코드 연동 상태 조회(설치/인증 불리언만 노출) — /onboarding 클로드 게이트가 로그인 전에 폴링해야 함
    if (c.req.method === "GET" && p === "/api/notes/ai/claude/detect") return next();
    // 클로드코드 설치 트리거 — 로그인 전 게이트의 [연동 시작] 버튼이 호출(로컬 self 대상, 상태 변경은 사용자 머신 한정)
    if (c.req.method === "POST" && p === "/api/notes/ai/claude/install") return next();
    // 클로드코드 로그인 반자동(1-2) — 로그인 전 게이트가 PTY 세션 시작/상태/입력 중계에 사용(동일 신뢰 수준)
    if (p.startsWith("/api/notes/ai/claude/login/")) return next();
    // 개인정보 처리방침 상시 공개 (PIPA §30) — 로그인 없이 열람 가능해야 함
    if (c.req.method === "GET" && p === "/privacy") return next();
    // friends 외부 API — 자체 partner token 게이트(routes.ts:1173)가 검증
    if (p.startsWith("/api/external/")) return next();
    // CF Email Worker inbound webhook — X-Mail-Worker-Secret 헤더로 자체 인증
    if (p.startsWith("/api/apps/mail/proxy/api/mail/inbound")) return next();
    // 내부 self-fetch (워커/코덱스/터미널 MCP) — 무한루프 방지
    if (isLoopbackInternal(c)) return next();
    // 세션 검증
    const sid = getCookie(c, SESSION_COOKIE);
    const sess = sid ? getValidSession(sid) : null;
    if (sess && isEmailAllowed(sess.email)) return next();
    // 앱 프록시 경로: pair token이 유효하면 SSO 없이 통과 (proxy handler보다 ssoMiddleware가 먼저 실행되므로 여기서 처리)
    const proxyMatch = /^\/api\/apps\/([^/]+)\/proxy/.exec(p);
    if (proxyMatch) {
      const appId = proxyMatch[1];
      const pairToken = c.req.query("token") || c.req.header("X-MyCrew-App-Token");
      if (pairToken && verifyPairingToken(appId, pairToken)) return next();
    }
    // 미인증 — 네비게이션은 로그인 리디렉션, 그 외(XHR/SSE/이미지)는 401.
    // 회원가입 플로우: 약관 동의(/onboarding) → SSO → 마이크루 설정.
    // 필수 약관 동의 후에만 Google 로그인 버튼이 활성화되므로 항상 /onboarding을 경유한다.
    if (p === "/onboarding") return next();
    const loginPath = "/onboarding";
    const accept = c.req.header("Accept") || "";
    const fetchMode = c.req.header("Sec-Fetch-Mode") || "";
    if (fetchMode === "navigate" || accept.includes("text/html") || isLikelyPageRequest(p, c.req.method)) {
      return c.redirect(loginPath, 302);
    }
    return c.json({ error: "unauthorized", login: loginPath }, 401);
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string));
}

function currentPlatform(): "mac" | "windows" | "linux" {
  return process.platform === "darwin" ? "mac" : process.platform === "win32" ? "windows" : "linux";
}

// 설치 퍼널 텔레메트리(1-4) 인라인 스크립트 — window.__mcFunnel(step)을 정의한다.
// install_id는 localStorage UUID(PII 아님, 서버 렌더 페이지 ↔ SPA 공유), 스토어로 fire-and-forget.
// text/plain sendBeacon으로 보내 크로스오리진(localhost→store) CORS 프리플라이트를 피한다.
function funnelPingScript(storeUrl: string): string {
  const base = JSON.stringify(storeUrl.replace(/\/+$/, ""));
  const platform = JSON.stringify(currentPlatform());
  return `<script>
(function(){
  var KEY = "mycrew:installId";
  function iid(){
    try {
      var v = localStorage.getItem(KEY);
      if (!v) { v = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())+Math.random().toString(16).slice(2)).replace(/-/g,"").slice(0,32); localStorage.setItem(KEY, v); }
      return v;
    } catch(e) { return "anon"; }
  }
  window.__mcFunnel = function(step){
    try {
      var payload = JSON.stringify({ installId: iid(), step: step, platform: ${platform} });
      var url = ${base} + "/api/telemetry/funnel";
      if (navigator.sendBeacon) { navigator.sendBeacon(url, new Blob([payload], { type: "text/plain" })); }
      else { fetch(url, { method:"POST", headers:{"Content-Type":"text/plain"}, body: payload, keepalive: true }).catch(function(){}); }
    } catch(e) { /* 텔레메트리 실패는 무시 */ }
  };
})();
</script>`;
}

// 첫 실행 온보딩 위저드 스텝 표시 (Phase 2) — 게이트(설치→로그인)와 약관·SSO가
// 한 흐름(하나의 창에서 자동 진행)임을 시각화한다. 1=설치, 2=로그인, 3=약관·시작.
function wizardStepper(active: 1 | 2 | 3): string {
  const steps = ["클로드코드 설치", "클로드코드 로그인", "약관 동의·시작"];
  const items = steps
    .map((label, i) => {
      const n = i + 1;
      const state = n < active ? "done" : n === active ? "on" : "todo";
      const circle =
        state === "done"
          ? `<span style="width:20px;height:20px;border-radius:50%;background:#22C55E;color:#04070F;font-size:12px;font-weight:700;display:inline-flex;align-items:center;justify-content:center">✓</span>`
          : `<span style="width:20px;height:20px;border-radius:50%;background:${state === "on" ? "#6366F1" : "#252B3A"};color:${state === "on" ? "#fff" : "#7D8699"};font-size:11px;font-weight:700;display:inline-flex;align-items:center;justify-content:center">${n}</span>`;
      return `<span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;color:${state === "on" ? "#F8F8F8" : "#7D8699"};white-space:nowrap">${circle}${label}</span>`;
    })
    .join(`<span style="flex:1;height:1px;background:#252B3A;min-width:10px"></span>`);
  return `<div style="display:flex;align-items:center;gap:8px;margin:0 0 20px">${items}</div>`;
}

// 클로드코드 미연동 안내 페이지 — /onboarding(약관·로그인)보다 먼저 표시되는 하드 게이트.
// 연동 완료를 10초 간격으로 폴링해 자동으로 다음 단계(약관 동의)로 넘어간다.
function claudeGatePage(storeUrl: string, phase: "not-installed" | "not-authenticated"): string {
  const isInstall = phase === "not-installed";
  const title = isInstall ? "클로드코드 설치가 필요합니다" : "클로드코드 로그인이 필요합니다";
  const desc = isInstall
    ? "마이크루는 클로드코드(Claude Code) 위에서 동작합니다. 아래 버튼 한 번으로 설치를 진행할 수 있어요."
    : "클로드코드가 설치되어 있지만 아직 로그인되지 않았습니다. 아래 버튼을 누르면 로그인 링크가 나타납니다 — 브라우저에서 Claude 계정으로 로그인만 하면 돼요.";
  // 미설치: [자동 설치] 버튼(서버가 npm i -g 대신 실행) + 수동 폴백.
  // 미인증: [로그인 시작] 버튼(서버가 claude를 PTY로 띄워 OAuth URL 표시) + 수동 폴백 (1-2).
  const steps = isInstall
    ? `<button class="btn" id="autoInstall">클로드코드 자동 설치</button>
<div class="note" id="installStatus"></div>
<details class="manual"><summary>직접 설치하기 (자동 설치가 안 될 때)</summary>
<div class="step"><span class="n">1</span><div>터미널에서 클로드코드 설치<pre>npm install -g @anthropic-ai/claude-code</pre></div></div>
<div class="step"><span class="n">2</span><div>설치 후 로그인<pre>claude</pre></div></div>
</details>`
    : `<button class="btn" id="autoLogin">클로드코드 로그인 시작</button>
<div class="note" id="loginStatus"></div>
<div id="loginBox" style="display:none">
  <a class="btn" id="oauthLink" href="#" target="_blank" rel="noopener noreferrer">브라우저에서 Claude 로그인 열기</a>
  <input id="loginInput" placeholder="인증 코드가 요청되면 여기 붙여넣고 Enter" style="display:none;width:100%;box-sizing:border-box;margin-top:10px;background:#151F32;border:1px solid #252B3A;border-radius:10px;padding:11px 14px;color:#F8F8F8;font-size:13px;font-family:monospace">
  <pre id="loginTail" style="max-height:130px;overflow:auto;white-space:pre-wrap;font-size:11px;color:#7D8699"></pre>
</div>
<details class="manual"><summary>직접 로그인하기 (자동 로그인이 안 될 때)</summary>
<div class="step"><span class="n">1</span><div>터미널에서 실행 후 안내에 따라 로그인<pre>claude</pre></div></div>
</details>`;
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>클로드코드 연동 필요 — MyCrew</title>
<link rel="icon" type="image/png" href="/favicon.png?v=20260706-transparent">
<style>
  body{margin:0;font-family:'Pretendard Variable',Pretendard,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#04070F;color:#F8F8F8;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px 16px;box-sizing:border-box}
  .card{max-width:480px;width:100%;background:#0B0F1A;border:1px solid #252B3A;border-radius:16px;padding:36px 32px;box-sizing:border-box}
  .logo{width:56px;height:56px;object-fit:contain;display:block;border-radius:14px;border:1px solid #252B3A;margin-bottom:14px}
  h1{font-size:20px;margin:0 0 12px}
  p.desc{font-size:14px;line-height:1.7;color:#C6CBD8;margin:0 0 22px}
  .step{display:flex;gap:12px;margin-bottom:14px;font-size:14px;line-height:1.6}
  .step .n{flex-shrink:0;width:22px;height:22px;border-radius:50%;background:#6366F1;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;margin-top:2px}
  .step div{flex:1;min-width:0}
  pre{background:#151F32;border-radius:10px;padding:12px 16px;margin:8px 0 0;font-size:13px;font-family:monospace;overflow-x:auto;user-select:all}
  .btn{display:flex;align-items:center;justify-content:center;width:100%;background:#6366F1;color:#fff;border:0;padding:13px 0;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer;margin-top:22px;font-family:inherit;text-decoration:none;box-sizing:border-box;transition:background .15s}
  .btn:hover{background:#4F46E5}
  .btn.ghost{background:transparent;border:1px solid #252B3A;color:#C6CBD8;margin-top:10px}
  .btn.ghost:hover{background:#151F32}
  .btn:disabled{opacity:.55;cursor:progress}
  .note{margin-top:16px;font-size:12px;color:#7D8699;text-align:center}
  .note.err{color:#F87171}
  details.manual{margin-top:16px}
  details.manual summary{font-size:13px;color:#818CF8;cursor:pointer;list-style:none}
  details.manual summary::-webkit-details-marker{display:none}
  details.manual[open] summary{margin-bottom:6px}
</style></head><body>
<div class="card">
  <img class="logo" src="/favicon.png" alt="MyCrew">
  ${wizardStepper(isInstall ? 1 : 2)}
  <h1>${title}</h1>
  <p class="desc">${desc}</p>
  ${steps}
  <a class="btn" href="${escapeHtml(storeUrl)}/guide" target="_blank" rel="noopener noreferrer">설치 가이드 열기 (02 클로드코드 연동하기)</a>
  <button class="btn ghost" onclick="location.reload()">다시 확인</button>
  <div class="note" id="poll">연동이 완료되면 자동으로 다음 단계로 넘어갑니다.</div>
</div>
${funnelPingScript(storeUrl)}
<script>
(function(){
  // 퍼널: 게이트 노출. 미설치면 gate_shown, 미인증(설치됨)이면 claude_connected는 아직.
  if (window.__mcFunnel) window.__mcFunnel("gate_shown");

  // [연동 시작] 자동 설치 — 서버가 npm i -g를 대신 실행. 실패 시 수동 폴백 안내를 펼친다.
  var btn = document.getElementById("autoInstall");
  var status = document.getElementById("installStatus");
  if (btn) btn.addEventListener("click", async function(){
    if (window.__mcFunnel) window.__mcFunnel("claude_install_clicked");
    btn.disabled = true;
    status.className = "note"; status.textContent = "클로드코드 설치 중… (수 분 걸릴 수 있어요, 창을 닫지 마세요)";
    try {
      var res = await fetch("/api/notes/ai/claude/install", { method: "POST" });
      var d = await res.json();
      if (d && d.ok) { status.textContent = "설치 완료! 다음 단계로 이동합니다…"; location.reload(); return; }
      status.className = "note err";
      status.textContent = "자동 설치 실패 — 아래 '직접 설치하기'로 진행해주세요.";
      var man = document.querySelector("details.manual"); if (man) man.open = true;
    } catch (e) {
      status.className = "note err";
      status.textContent = "자동 설치 요청 실패 — 아래 '직접 설치하기'로 진행해주세요.";
      var m = document.querySelector("details.manual"); if (m) m.open = true;
    } finally { btn.disabled = false; }
  });

  // [로그인 시작] 반자동 로그인 (1-2) — 서버가 claude를 PTY로 띄우고, 여기서는 상태를 폴링해
  // OAuth URL 링크·인증 코드 입력창을 보여준다. 완료되면 아래 detect 폴링이 다음 단계로 넘긴다.
  var loginBtn = document.getElementById("autoLogin");
  var loginStatus = document.getElementById("loginStatus");
  var loginBox = document.getElementById("loginBox");
  var oauthLink = document.getElementById("oauthLink");
  var loginInput = document.getElementById("loginInput");
  var loginTail = document.getElementById("loginTail");
  var loginPoll = null;
  function renderLogin(st){
    if (!st) return;
    if (st.url) {
      loginBox.style.display = "block";
      if (oauthLink.getAttribute("href") !== st.url) {
        oauthLink.setAttribute("href", st.url);
        try { window.open(st.url, "_blank", "noopener"); } catch (e) {}
      }
      loginInput.style.display = "block";
      loginStatus.textContent = "브라우저에서 로그인해주세요. 인증 코드를 요청받으면 아래 입력창에 붙여넣으세요.";
    }
    if (st.tail) { loginTail.textContent = st.tail.slice(-1200); loginTail.scrollTop = loginTail.scrollHeight; }
    if (st.done) {
      if (loginPoll) { clearInterval(loginPoll); loginPoll = null; }
      if (st.authenticated) {
        if (window.__mcFunnel) window.__mcFunnel("claude_connected");
        loginStatus.textContent = "로그인 완료! 다음 단계로 이동합니다…";
        location.reload();
      } else {
        loginStatus.className = "note err";
        loginStatus.textContent = (st.error || "로그인이 완료되지 않았습니다") + " — 아래 '직접 로그인하기'로 진행해주세요.";
        var lm = document.querySelector("details.manual"); if (lm) lm.open = true;
        loginBtn.disabled = false;
      }
    }
  }
  if (loginBtn) loginBtn.addEventListener("click", async function(){
    if (window.__mcFunnel) window.__mcFunnel("claude_login_clicked");
    loginBtn.disabled = true;
    loginStatus.className = "note"; loginStatus.textContent = "클로드코드 로그인 준비 중…";
    try {
      var res = await fetch("/api/notes/ai/claude/login/start", { method: "POST" });
      renderLogin(await res.json());
      if (!loginPoll) loginPoll = setInterval(async function(){
        try {
          var r = await fetch("/api/notes/ai/claude/login/status");
          renderLogin(await r.json());
        } catch (e) { /* 일시 오류 — 다음 폴링에 재시도 */ }
      }, 1500);
    } catch (e) {
      loginStatus.className = "note err";
      loginStatus.textContent = "로그인 시작 실패 — 아래 '직접 로그인하기'로 진행해주세요.";
      var m2 = document.querySelector("details.manual"); if (m2) m2.open = true;
      loginBtn.disabled = false;
    }
  });
  if (loginInput) loginInput.addEventListener("keydown", async function(ev){
    if (ev.key !== "Enter") return;
    var text = loginInput.value.trim();
    loginInput.value = "";
    try { await fetch("/api/notes/ai/claude/login/input", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: text }) }); } catch (e) {}
  });

  // 10초 간격 폴링 — 사용자가 연동을 마치면(자동/수동 무관) 자동으로 다음 단계로 진행.
  var timer = setInterval(async function(){
    try {
      var res = await fetch("/api/notes/ai/claude/detect");
      var d = await res.json();
      if (d && d.installed && d.authenticated) {
        if (window.__mcFunnel) window.__mcFunnel("claude_connected");
        clearInterval(timer); location.reload();
      }
    } catch (e) { /* 서버 재기동 등 일시 오류 — 다음 폴링에 재시도 */ }
  }, 10000);
})();
</script>
</body></html>`;
}

export function registerAuthRoutes(app: Hono): void {
  // 회원가입 1단계 — 서비스 약관 동의 화면 (국내법: 개인정보 보호법 §15·§22·§22조의2, 정보통신망법 §50).
  // 필수 약관 전체 동의 시에만 Google 로그인 버튼이 활성화되며, 동의 선택은 sessionStorage에
  // 보관했다가 SSO 완료 후 SPA가 /api/consent/record로 기록한다(약관 동의 → SSO → 마이크루 설정).
  // 로그인 대상: 로컬 Google OAuth 자격증명이 있으면 /auth/google, 없으면(패키지 배포본) 스토어 SSO 브릿지.
  app.get("/onboarding", async (c) => {
    // 이미 로그인된 사용자(북마크·브라우저 자동완성으로 재진입)에게 약관·로그인을 다시 요구하지 않는다.
    if (getCurrentSession(c)) return c.redirect("/", 302);
    const storeUrl = process.env.MYCREW_STORE_URL || "https://store.dooitspace.com";
    // 클로드코드 연동 게이트 — 설치 가이드 02(클로드코드 연동)를 건너뛴 채 로그인/설정으로 진입하면
    // SSO 완료 후에도 에이전트가 전혀 동작하지 않는 반쪽 상태가 되므로, 연동 완료 전에는 약관·로그인을 차단한다.
    const claude = await detectClaudeCli();
    if (!claude.installed || !claude.authenticated) {
      return c.html(claudeGatePage(storeUrl, claude.installed ? "not-authenticated" : "not-installed"));
    }
    const useLocalGoogle = hasGoogleCredentials();
    return c.html(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MyCrew 시작하기</title>
<link rel="icon" type="image/png" href="/favicon.png?v=20260706-transparent">
<link rel="shortcut icon" href="/favicon.ico?v=20260706-transparent" sizes="any">
<link rel="apple-touch-icon" href="/favicon.png?v=20260706-transparent">
<style>
  body{margin:0;font-family:'Pretendard Variable',Pretendard,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#04070F;color:#F8F8F8;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px 16px;box-sizing:border-box}
  .card{max-width:480px;width:100%;background:#0B0F1A;border:1px solid #252B3A;border-radius:16px;padding:36px 32px;box-sizing:border-box}
  .logo{width:56px;height:56px;object-fit:contain;display:block;border-radius:14px;border:1px solid #252B3A;margin-bottom:14px}
  h1{font-size:20px;margin:0 0 22px}
  .row{display:flex;align-items:center;gap:10px;padding:7px 0;font-size:14px}
  .row label{display:flex;align-items:center;gap:10px;cursor:pointer;flex:1;min-width:0}
  .row input{width:18px;height:18px;accent-color:#6366F1;flex-shrink:0;cursor:pointer}
  .all{font-weight:600}
  .req{color:#F87171;font-weight:600;margin-right:2px}
  .opt{color:#818CF8;font-weight:600;margin-right:2px}
  .view{color:#818CF8;font-size:13px;text-decoration:underline;cursor:pointer;background:none;border:0;padding:0;flex-shrink:0;font-family:inherit}
  .sub{padding-left:30px}
  .sub .tick{color:#7D8699;margin-right:2px}
  hr{border:0;border-top:1px solid #252B3A;margin:10px 0}
  .btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;background:#6366F1;color:#fff;border:0;padding:13px 0;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer;margin-top:22px;font-family:inherit;transition:background .15s}
  .btn:hover:not(:disabled){background:#4F46E5}
  .btn:disabled{background:#252B3A;color:#7D8699;cursor:not-allowed}
  .note{margin-top:16px;font-size:12px;color:#7D8699;text-align:center}
  .overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);display:none;align-items:center;justify-content:center;padding:20px;box-sizing:border-box}
  .overlay.open{display:flex}
  .modal{background:#0B0F1A;border:1px solid #252B3A;border-radius:14px;max-width:560px;width:100%;max-height:80vh;display:flex;flex-direction:column}
  .modal h2{font-size:16px;margin:0;padding:18px 20px;border-bottom:1px solid #252B3A}
  .modal .body{padding:18px 20px;overflow-y:auto;font-size:13px;line-height:1.7;white-space:pre-wrap;color:#C6CBD8}
  .modal .foot{padding:14px 20px;border-top:1px solid #252B3A;text-align:right}
  .modal .close{background:#252B3A;color:#F8F8F8;border:0;padding:9px 20px;border-radius:9px;font-size:13px;cursor:pointer;font-family:inherit}
</style></head><body>
<div class="card">
  <img class="logo" src="/favicon.png" alt="MyCrew">
  ${wizardStepper(3)}
  <h1>서비스 약관 동의</h1>
  <div class="row all"><label><input type="checkbox" id="all"> 모든 약관을 확인하였으며 이에 동의합니다.</label></div>
  <hr>
  <div class="row"><label><input type="checkbox" class="c" id="age"><span><span class="req">[필수]</span> 만 14세 이상의 회원입니다.</span></label></div>
  <div class="row"><label><input type="checkbox" class="c" id="terms"><span><span class="req">[필수]</span> 서비스 이용약관에 동의합니다.</span></label><button class="view" data-doc="terms">내용보기</button></div>
  <div class="row"><label><input type="checkbox" class="c" id="privacy"><span><span class="req">[필수]</span> 개인정보 수집 및 이용에 동의합니다.</span></label><button class="view" data-doc="privacy">내용보기</button></div>
  <div class="row"><label><input type="checkbox" class="c" id="marketing_privacy"><span><span class="opt">[선택]</span> 마케팅 목적 개인정보 수집 및 이용에 동의합니다.</span></label><button class="view" data-doc="marketing_privacy">내용보기</button></div>
  <div class="row"><label><input type="checkbox" class="c" id="marketing_ads"><span><span class="opt">[선택]</span> 마케팅 및 광고성 정보 수신에 동의합니다.</span></label><button class="view" data-doc="marketing_ads">내용보기</button></div>
  <div class="row sub"><label><input type="checkbox" class="c ch" id="marketing_ads_sms"><span><span class="tick">└</span> 문자 또는 카카오 알림톡</span></label></div>
  <div class="row sub"><label><input type="checkbox" class="c ch" id="marketing_ads_push"><span><span class="tick">└</span> 앱 푸시</span></label></div>
  <div class="row sub"><label><input type="checkbox" class="c ch" id="marketing_ads_email"><span><span class="tick">└</span> 이메일</span></label></div>
  <button class="btn" id="login" disabled>
    <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10 5.35 0 9.25-3.67 9.25-9.09 0-1.15-.15-1.81-.15-1.81Z"/></svg>
    Google 계정으로 로그인하기
  </button>
  <div class="note">최초 로그인 계정이 이 마이크루의 소유자로 등록됩니다.</div>
  <div class="note"><a href="/privacy" target="_blank" style="color:#818CF8">개인정보 처리방침</a></div>
</div>
<div class="overlay" id="overlay"><div class="modal"><h2 id="mTitle"></h2><div class="body" id="mBody">불러오는 중…</div><div class="foot"><button class="close" id="mClose">닫기</button></div></div></div>
${funnelPingScript(storeUrl)}
<script>
(function(){
  // 퍼널: 클로드 연동 완료 후 약관 화면 도달.
  if (window.__mcFunnel) window.__mcFunnel("terms_shown");
  var VERSION = "2026-07-07";
  var ids = ["age","terms","privacy","marketing_privacy","marketing_ads","marketing_ads_sms","marketing_ads_push","marketing_ads_email"];
  var el = function(id){ return document.getElementById(id); };
  var login = el("login");
  function sync(from){
    var ads = el("marketing_ads"), sms = el("marketing_ads_sms"), push = el("marketing_ads_push"), email = el("marketing_ads_email");
    if (from === "marketing_ads") { sms.checked = ads.checked; push.checked = ads.checked; email.checked = ads.checked; }
    if (from === "marketing_ads_sms" || from === "marketing_ads_push" || from === "marketing_ads_email") ads.checked = sms.checked || push.checked || email.checked;
    if (from === "all") ids.forEach(function(id){ el(id).checked = el("all").checked; });
    el("all").checked = ids.every(function(id){ return el(id).checked; });
    login.disabled = !(el("age").checked && el("terms").checked && el("privacy").checked);
  }
  el("all").addEventListener("change", function(){ sync("all"); });
  ids.forEach(function(id){ el(id).addEventListener("change", function(){ sync(id); }); });
  // 내용보기 모달 — 약관 본문은 /api/consent/policies/:type (SSO 게이트 면제 GET)
  var titles = { terms: "서비스 이용약관", privacy: "개인정보 수집 및 이용 동의", marketing_privacy: "마케팅 목적 개인정보 수집 및 이용 동의", marketing_ads: "마케팅 및 광고성 정보 수신 동의" };
  document.querySelectorAll(".view").forEach(function(btn){
    btn.addEventListener("click", async function(){
      var doc = btn.getAttribute("data-doc");
      el("mTitle").textContent = titles[doc] || "약관";
      el("mBody").textContent = "불러오는 중…";
      el("overlay").classList.add("open");
      try {
        var res = await fetch("/api/consent/policies/" + doc);
        var body = await res.json();
        el("mBody").textContent = body.content || body.summary || "약관 내용을 불러올 수 없습니다.";
      } catch (e) { el("mBody").textContent = "약관 내용을 불러올 수 없습니다. 네트워크를 확인해주세요."; }
    });
  });
  el("mClose").addEventListener("click", function(){ el("overlay").classList.remove("open"); });
  el("overlay").addEventListener("click", function(e){ if (e.target === el("overlay")) el("overlay").classList.remove("open"); });
  // 필수 동의 완료 → 동의 선택을 보관하고 SSO로 이동. SSO 완료 후 SPA가 /api/consent/record로 기록.
  login.addEventListener("click", function(){
    if (login.disabled) return;
    if (window.__mcFunnel) window.__mcFunnel("sso_started");
    var picked = { version: VERSION };
    ids.forEach(function(id){ picked[id] = el(id).checked; });
    try { sessionStorage.setItem("mycrew.pendingConsent", JSON.stringify(picked)); } catch (e) { /* 기록은 로그인 후 재시도 가능 */ }
    ${useLocalGoogle
      ? `location.href = "/auth/google";`
      : `var ret = encodeURIComponent(location.origin + "/?onboarding=settings");
    location.href = ${JSON.stringify(storeUrl)} + "/login?next=" + encodeURIComponent("/auth/bridge?return=" + ret);`}
  });
})();
</script>
</body></html>`);
  });

  // 스토어 SSO 브릿지 콜백 — 스토어가 #at=<supabase_access_token> fragment로 되돌린다.
  // 이 페이지가 same-origin으로 /api/store/session-import에 POST해 세션 쿠키를 first-party로
  // 설정하므로 크로스사이트 쿠키 차단 문제가 없다. 성공 시 설정 화면(?onboarding=settings)으로.
  app.get("/auth/store-callback", (c) => {
    return c.html(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
<title>로그인 처리 중…</title>
<style>body{margin:0;font-family:'Pretendard Variable',Pretendard,-apple-system,sans-serif;background:#04070F;color:#F8F8F8;display:flex;align-items:center;justify-content:center;min-height:100vh}
.box{text-align:center}.err{color:#F87171;font-size:13px;margin-top:12px}</style></head>
<body><div class="box"><p id="msg">로그인 처리 중…</p></div>
<script>
(async function(){
  var m = location.hash.match(/at=([^&]+)/);
  var token = m ? decodeURIComponent(m[1]) : null;
  history.replaceState(null, "", location.pathname); // fragment 즉시 제거
  if (!token) { document.getElementById("msg").innerHTML = "토큰이 없습니다. <a href='/onboarding' style='color:#818CF8'>다시 시도</a>"; return; }
  try {
    var res = await fetch("/api/store/session-import", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_token: token }),
    });
    var body = await res.json().catch(function(){ return {}; });
    if (res.ok && body.ok) { location.replace("/?onboarding=settings"); return; }
    document.getElementById("msg").innerHTML = "로그인 실패: " + (body.error || res.status) + " <a href='/onboarding' style='color:#818CF8'>다시 시도</a>";
  } catch (e) {
    document.getElementById("msg").innerHTML = "연결 오류. <a href='/onboarding' style='color:#818CF8'>다시 시도</a>";
  }
})();
</script></body></html>`);
  });

  app.get("/auth/google", (c) => {
    if (!isSsoEnabled()) return c.text("SSO 미설정: GOOGLE_CLIENT_ID/SECRET가 .env에 없습니다.", 503);
    const state = randomBytes(16).toString("hex");
    const cb = callbackUrl(c);
    const isHttps = cb.startsWith("https://");
    setCookie(c, STATE_COOKIE, state, { httpOnly: true, secure: isHttps, sameSite: "Lax", maxAge: 600, path: "/" });
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID as string);
    u.searchParams.set("redirect_uri", cb);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", "openid email profile");
    u.searchParams.set("state", state);
    u.searchParams.set("access_type", "offline");
    // refresh_token을 확실히 받기 위해 consent 강제(이미 동의한 사용자도 재발급).
  // select_account도 유지해 계정 선택 가능.
  u.searchParams.set("prompt", "consent select_account");
    return c.redirect(u.toString(), 302);
  });

  app.get("/auth/google/callback", async (c) => {
    if (!isSsoEnabled()) return c.text("SSO 미설정", 503);
    const code = c.req.query("code");
    const state = c.req.query("state");
    const savedState = getCookie(c, STATE_COOKIE);
    deleteCookie(c, STATE_COOKIE, { path: "/" });
    if (!code || !state || !savedState || state !== savedState) {
      return c.text("잘못된 인증 요청 (state 불일치)", 400);
    }
    let email = "";
    let verified = false;
    let name: string | undefined;
    let picture: string | undefined;
    let refreshToken: string | undefined;
    try {
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_CLIENT_ID as string,
          client_secret: process.env.GOOGLE_CLIENT_SECRET as string,
          redirect_uri: callbackUrl(c),
          grant_type: "authorization_code",
        }),
      });
      if (!tokenRes.ok) return c.text("Google 토큰 교환 실패", 502);
      const tok = (await tokenRes.json()) as { access_token?: string; refresh_token?: string };
      if (!tok.access_token) return c.text("Google 토큰 없음", 502);
      if (tok.refresh_token) refreshToken = tok.refresh_token;
      const uiRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${tok.access_token}` },
      });
      if (!uiRes.ok) return c.text("Google 사용자 정보 조회 실패", 502);
      const info = (await uiRes.json()) as { email?: string; email_verified?: boolean; name?: string; picture?: string };
      email = (info.email || "").toLowerCase();
      verified = info.email_verified === true;
      name = info.name;
      picture = info.picture;
    } catch (err) {
      console.error("[SSO] OAuth 콜백 처리 실패:", err);
      return c.text("인증 처리 중 오류", 502);
    }
    if (!email || !verified || !isEmailAllowed(email)) {
      return c.html(
        `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;text-align:center;padding:60px">`
        + `<h2>접근 거부</h2><p><b>${escapeHtml(email || "(이메일 없음)")}</b> 계정은 허용 목록에 없습니다.</p>`
        + `<p><a href="/auth/logout">다른 계정으로 로그인</a></p></body>`,
        403,
      );
    }
    const sid = createSession(email, name, picture, refreshToken);
    const isHttps = callbackUrl(c).startsWith("https://");
    setCookie(c, SESSION_COOKIE, sid, { httpOnly: true, secure: isHttps, sameSite: "Lax", maxAge: Math.floor(SESSION_TTL_MS / 1000), path: "/" });
    return c.redirect("/", 302);
  });

  app.get("/auth/logout", (c) => {
    const sid = getCookie(c, SESSION_COOKIE);
    if (sid) destroySession(sid);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.redirect("/auth/google", 302);
  });

  // 현재 로그인 사용자 정보 — 프로필 UI용.
  // SSO 비활성(GOOGLE_CLIENT_ID/SECRET 미설정) → enabled:false → 클라이언트는 프로필 UI 숨김.
  // SSO 활성 + 미인증은 ssoMiddleware가 이미 401 처리하지만 방어적으로 동일 응답.
  // picture는 원본 구글 URL 대신 same-origin 프록시(/auth/avatar)로 반환 —
  // 크롬 ORB가 http://localhost 페이지의 lh3.googleusercontent.com 직접 로드를 차단하기 때문.
  app.get("/auth/me", (c) => {
    if (!isSsoEnabled()) return c.json({ enabled: false, authenticated: false });
    const sid = getCookie(c, SESSION_COOKIE);
    const sess = sid ? getValidSession(sid) : null;
    if (!sess || !isEmailAllowed(sess.email)) {
      // 로컬 Google 자격증명이 없는 패키지 배포본은 스토어 SSO 브릿지 온보딩으로 유도.
      return c.json({ enabled: true, authenticated: false, login: "/onboarding" }, 401);
    }
    return c.json({
      enabled: true,
      authenticated: true,
      email: sess.email,
      name: sess.name ?? null,
      picture: sess.picture ? "/auth/avatar" : null,
    });
  });

  // 구글 프로필 사진 프록시 — 세션의 picture URL을 서버가 대신 받아 same-origin으로 스트림.
  // (브라우저 직접 로드는 ERR_BLOCKED_BY_ORB로 차단되어 아바타가 이니셜 폴백으로 표시되던 문제)
  app.get("/auth/avatar", async (c) => {
    const sess = getCurrentSession(c);
    if (!sess?.picture) return c.body(null, 404);
    try {
      const res = await fetch(sess.picture, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return c.body(null, 502);
      const buf = await res.arrayBuffer();
      return c.body(buf, 200, {
        "Content-Type": res.headers.get("content-type") ?? "image/jpeg",
        "Cache-Control": "private, max-age=3600",
      });
    } catch {
      return c.body(null, 502);
    }
  });
}
