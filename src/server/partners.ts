// 동료(Partner) 등록·조회·토큰 회전.
// 영속: history/external/partners.json (mtime 캐시 + 원자적 쓰기).
// 토큰 변경/등록 이벤트는 audit log로 별도 기록.

import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { HISTORY_DIR } from "../config.js";
import type { Partner, PartnerScope, PartnerTokenHistoryEntry, MyProfile } from "../types.js";
import { auditEvent } from "./external-audit.js";

const PARTNERS_FILE = join(HISTORY_DIR, "external", "partners.json");

interface PartnersFile {
  version: number;
  myProfile?: MyProfile;
  partners: Partner[];
}

let cache: Partner[] = [];
let myProfile: MyProfile | undefined;
let lastMtime = 0;
let initialized = false;

function ensureDir(): void {
  const dir = dirname(PARTNERS_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readDisk(): Partner[] {
  if (!existsSync(PARTNERS_FILE)) return [];
  try {
    const raw = readFileSync(PARTNERS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as PartnersFile;
    if (parsed.myProfile) myProfile = parsed.myProfile;
    return Array.isArray(parsed.partners) ? parsed.partners : [];
  } catch (err) {
    console.warn(`[Partners] 파싱 실패, 마지막 캐시 유지: ${err instanceof Error ? err.message : err}`);
    return cache;
  }
}

function loadIfStale(): void {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(PARTNERS_FILE).mtimeMs;
  } catch {
    if (!initialized) {
      cache = [];
      initialized = true;
    }
    return;
  }
  if (initialized && mtimeMs === lastMtime) return;
  cache = readDisk();
  lastMtime = mtimeMs;
  initialized = true;
}

function persist(): void {
  ensureDir();
  const tmp = PARTNERS_FILE + ".tmp";
  const data: PartnersFile = { version: 1, ...(myProfile ? { myProfile } : {}), partners: cache };
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmp, PARTNERS_FILE);
  try {
    lastMtime = statSync(PARTNERS_FILE).mtimeMs;
  } catch { /* ignore */ }
}

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

// MYCREW_DEV_ALLOW_LOOPBACK — A↔B localhost 페어링 테스트 전용. http + loopback(127/8, localhost, ::1)만 완화.
// 그 외 private(10/172.16-31/192.168)·link-local(169.254)·0.0.0.0은 토글 ON에서도 여전히 차단.
const ALLOW_LOOPBACK_DEV =
  process.env.MYCREW_DEV_ALLOW_LOOPBACK === "1" ||
  process.env.MYCREW_DEV_ALLOW_LOOPBACK === "true";
if (ALLOW_LOOPBACK_DEV) {
  console.warn("⚠️ MYCREW_DEV_ALLOW_LOOPBACK enabled — loopback URLs allowed for partner API. NEVER use in production.");
}

export function getMyProfile(): MyProfile | undefined {
  loadIfStale();
  return myProfile;
}

export function setMyProfile(profile: MyProfile): void {
  loadIfStale();
  myProfile = profile;
  persist();
}

// 현재 프로필을 모든 활성 동료에게 발송 (버튼/엔드포인트가 명시 호출). 발송 수 반환.
export function broadcastMyProfile(): number {
  loadIfStale();
  if (!myProfile) return 0;
  return broadcastProfileUpdate(myProfile);
}

function broadcastProfileUpdate(profile: MyProfile): number {
  const activePartners = cache.filter(p => p.active);
  if (!activePartners.length) return 0;
  for (const partner of activePartners) {
    const url = `${partner.apiUrl}/api/external/inbound`;
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${partner.outboundToken}`,
      },
      body: JSON.stringify({
        sender: profile.secretaryName || "비서",
        message: "프로필이 업데이트되었습니다.",
        messageType: "profile_update",
        timestamp: new Date().toISOString(),
        payload: {
          companyName: profile.companyName,
          contactName: profile.contactName,
          secretaryName: profile.secretaryName,
          department: profile.department || "",
          contactEmail: profile.contactEmail || "",
          contactPhone: profile.contactPhone || "",
        },
      }),
      signal: AbortSignal.timeout(10_000),
    }).catch((err) => console.error(`[Partners] profile_update 발송 실패 (${partner.companyName}):`, err));
  }
  console.log(`[Partners] profile_update 발송: ${activePartners.length}명`);
  return activePartners.length;
}

// v1.13 Phase4: 파트너 원격 설치 승인/반려 결과 통보 — best-effort, 실패해도 로컬 처리는 유지.
// broadcastProfileUpdate와 동일한 fetch-with-Bearer-outboundToken 패턴 재사용.
export function notifyPartnerInstallResult(
  partnerId: string,
  result: { approvalId: string; itemId: string; kind: string; decision: "approved" | "rejected"; reason?: string },
): void {
  const partner = getPartnerWithTokens(partnerId);
  if (!partner || !partner.active) return;
  fetch(`${partner.apiUrl}/api/external/inbound`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${partner.outboundToken}`,
    },
    body: JSON.stringify({
      sender: "MyCrew Store",
      message: result.decision === "approved"
        ? `${result.kind}:${result.itemId} 설치가 승인되었습니다.`
        : `${result.kind}:${result.itemId} 설치가 반려되었습니다.`,
      messageType: "store_install_result",
      timestamp: new Date().toISOString(),
      payload: result,
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch((err) => console.error(`[Partners] store_install_result 발송 실패 (${partner.companyName}):`, err));
}

// 입력 정규화 — 호스트만 들어와도 동작하도록 https:// 자동 부여 + 끝 슬래시 제거.
// validateApiUrl 호출 전에 사용. 사용자가 ngrok-free.dev 같은 host-only를 붙여넣을 때 즉시 거부되는 문제 해결.
export function normalizeApiUrl(input: string): string {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return trimmed;
  let rest = trimmed;
  let sawHttps = false;
  let sawHttp = false;
  for (;;) {
    const m = rest.match(/^(https?):\/\//i);
    if (!m) break;
    if (m[1].toLowerCase() === "https") sawHttps = true;
    else sawHttp = true;
    rest = rest.slice(m[0].length);
  }
  const scheme = sawHttp && !sawHttps ? "http" : "https";
  return `${scheme}://${rest}`.replace(/\/+$/, "");
}

// 사설 IP/localhost 차단 — SSRF 방지. envvar로 dev 우회 가능.
export function validateApiUrl(input: string): void {
  if (process.env.MYCREW_ALLOW_INSECURE_APIURL === "true") return;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("apiUrl 형식이 잘못됐습니다");
  }
  const host = url.hostname.toLowerCase();
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  // loopback 판정: 127.0.0.0/8 + localhost + ::1
  const isLoopback =
    host === "localhost" ||
    host === "::1" ||
    (v4 !== null && parseInt(v4[1], 10) === 127);

  if (url.protocol !== "https:") {
    // dev 토글 ON + loopback 한정으로 http 허용
    if (!(ALLOW_LOOPBACK_DEV && url.protocol === "http:" && isLoopback)) {
      throw new Error("apiUrl은 https:// 시작 필요 (http 거부)");
    }
  }
  if (isLoopback) {
    if (ALLOW_LOOPBACK_DEV) return;
    throw new Error("apiUrl host는 사설 주소(localhost/127.0.0.0-8/::1) 거부");
  }
  if (host === "0.0.0.0") {
    throw new Error("apiUrl host는 사설 주소(0.0.0.0) 거부");
  }
  // IPv4 그 외 사설 대역 (loopback은 위에서 분기 — 토글과 무관하게 차단)
  if (v4) {
    const [a, b] = [parseInt(v4[1], 10), parseInt(v4[2], 10)];
    const isPrivate =
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 0 ||
      a === 169; // 169.254 link-local 포함
    if (isPrivate) {
      throw new Error(`apiUrl host는 사설 IP 대역 거부: ${host}`);
    }
  }
  // IPv6 사설/예약 대역: ULA(fc00::/7) · link-local(fe80::/10) · IPv4-mapped(::ffff:a.b.c.d) 차단
  if (host.includes(":")) {
    const mapped = host.match(/^::ffff:(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (mapped) {
      const [a, b] = [parseInt(mapped[1], 10), parseInt(mapped[2], 10)];
      if (
        a === 10 || a === 127 || a === 0 || a === 169 ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168)
      ) {
        throw new Error(`apiUrl host는 사설 IP 대역 거부: ${host}`);
      }
    }
    const first = parseInt(host.split(":")[0], 16);
    if (!Number.isNaN(first) && (((first & 0xfe00) === 0xfc00) || ((first & 0xffc0) === 0xfe80))) {
      throw new Error(`apiUrl host는 사설 IP 대역 거부: ${host}`);
    }
  }
}

function maskToken(token: string): string {
  if (!token) return "";
  if (token.length <= 8) return "****";
  return token.slice(0, 4) + "..." + token.slice(-4);
}

export function loadPartners(): void {
  ensureDir();
  loadIfStale();
}

export function listPartners(): Partner[] {
  loadIfStale();
  return cache.map((p) => ({
    ...p,
    inboundToken: maskToken(p.inboundToken),
    outboundToken: maskToken(p.outboundToken),
  }));
}

export function getPartner(id: string): Partner | undefined {
  loadIfStale();
  const p = cache.find((x) => x.id === id);
  if (!p) return undefined;
  return {
    ...p,
    inboundToken: maskToken(p.inboundToken),
    outboundToken: maskToken(p.outboundToken),
  };
}

// 평문 토큰 포함 — outbound 송신 등 내부 사용 전용. 라우트 응답으로 노출 금지.
export function getPartnerWithTokens(id: string): Partner | undefined {
  loadIfStale();
  const p = cache.find((x) => x.id === id);
  if (!p) return undefined;
  return { ...p };
}

// 상수시간 토큰 비교 — 타이밍 사이드채널 방지 (external-auth의 verifyBearer와 동일 원칙).
function tokensEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function findPartnerByInboundToken(token: string): Partner | undefined {
  loadIfStale();
  return cache.find((p) => p.active && p.inboundToken && tokensEqual(p.inboundToken, token));
}

export function createPartner(input: {
  companyName: string;
  department?: string;
  contactName: string;
  secretaryName?: string;
  contactEmail?: string;
  contactPhone?: string;
  apiUrl: string;
  scope?: PartnerScope;
  registeredBy?: string;
}): { partner: Partner; inboundToken: string; outboundToken: string } {
  loadIfStale();
  if (!input.companyName.trim() || !input.contactName.trim() || !input.apiUrl.trim()) {
    throw new Error("companyName, contactName, apiUrl 필수");
  }
  const normalizedApiUrl = normalizeApiUrl(input.apiUrl);
  validateApiUrl(normalizedApiUrl);
  const inboundToken = generateToken();
  const outboundToken = generateToken();
  const now = new Date().toISOString();
  const partner: Partner = {
    id: randomUUID(),
    companyName: input.companyName.trim(),
    department: input.department?.trim() || undefined,
    contactName: input.contactName.trim(),
    secretaryName: input.secretaryName?.trim() || undefined,
    contactEmail: input.contactEmail?.trim() || undefined,
    contactPhone: input.contactPhone?.trim() || undefined,
    apiUrl: normalizedApiUrl,
    inboundToken,
    outboundToken,
    scope: input.scope,
    registeredAt: now,
    registeredBy: input.registeredBy,
    active: true,
    tokenHistory: [],
  };
  cache.push(partner);
  persist();
  auditEvent({
    type: "partner_created",
    partnerId: partner.id,
    detail: { companyName: partner.companyName, contactName: partner.contactName },
  });
  // 평문 토큰은 1회만 노출 (호출자 책임 — 즉시 표시 후 잊어야 함)
  return { partner: { ...partner, inboundToken: maskToken(inboundToken), outboundToken: maskToken(outboundToken) }, inboundToken, outboundToken };
}

export function updatePartner(id: string, patch: {
  companyName?: string;
  department?: string;
  contactName?: string;
  secretaryName?: string;
  contactEmail?: string;
  contactPhone?: string;
  apiUrl?: string;
  scope?: PartnerScope;
  active?: boolean;
}): Partner | undefined {
  loadIfStale();
  const p = cache.find((x) => x.id === id);
  if (!p) return undefined;
  if (patch.companyName !== undefined) p.companyName = patch.companyName.trim();
  if (patch.department !== undefined) p.department = patch.department.trim() || undefined;
  if (patch.contactName !== undefined) p.contactName = patch.contactName.trim();
  if (patch.secretaryName !== undefined) p.secretaryName = patch.secretaryName.trim() || undefined;
  if (patch.contactEmail !== undefined) p.contactEmail = patch.contactEmail.trim() || undefined;
  if (patch.contactPhone !== undefined) p.contactPhone = patch.contactPhone.trim() || undefined;
  if (patch.apiUrl !== undefined) {
    const normalizedApiUrl = normalizeApiUrl(patch.apiUrl);
    validateApiUrl(normalizedApiUrl);
    p.apiUrl = normalizedApiUrl;
  }
  if (patch.scope !== undefined) p.scope = patch.scope;
  if (patch.active !== undefined) p.active = patch.active;
  persist();
  auditEvent({ type: "partner_updated", partnerId: id, detail: patch });
  return getPartner(id);
}

export function deletePartner(id: string): boolean {
  loadIfStale();
  const idx = cache.findIndex((x) => x.id === id);
  if (idx === -1) return false;
  cache.splice(idx, 1);
  persist();
  auditEvent({ type: "partner_deleted", partnerId: id });
  return true;
}

export function rotateInboundToken(id: string, opts?: { reason?: string; newToken?: string }): { partner: Partner; inboundToken: string } | undefined {
  loadIfStale();
  const p = cache.find((x) => x.id === id);
  if (!p) return undefined;
  const newToken = opts?.newToken ?? generateToken();
  const entry: PartnerTokenHistoryEntry = {
    rotatedAt: new Date().toISOString(),
    rotatedBy: "us",
    field: "inbound",
    reason: opts?.reason,
  };
  p.inboundToken = newToken;
  p.tokenHistory.push(entry);
  persist();
  auditEvent({ type: "token_rotated", partnerId: id, detail: { field: "inbound", reason: opts?.reason } });
  return { partner: getPartner(id)!, inboundToken: newToken };
}

// outbound 회전: us=우리가 새 토큰 발급(외부에 통보 필요), them=외부가 회전 통보(우리는 새 토큰 적용)
export function rotateOutboundToken(
  id: string,
  opts: { rotatedBy: "us" | "them"; newToken?: string; reason?: string },
): { partner: Partner; outboundToken: string } | undefined {
  loadIfStale();
  const p = cache.find((x) => x.id === id);
  if (!p) return undefined;
  const newToken = opts.rotatedBy === "us" ? generateToken() : (opts.newToken || "");
  if (!newToken) throw new Error("them 회전 시 newToken 필수");
  const entry: PartnerTokenHistoryEntry = {
    rotatedAt: new Date().toISOString(),
    rotatedBy: opts.rotatedBy,
    field: "outbound",
    reason: opts.reason,
  };
  p.outboundToken = newToken;
  p.tokenHistory.push(entry);
  persist();
  auditEvent({ type: "token_rotated", partnerId: id, detail: { field: "outbound", rotatedBy: opts.rotatedBy, reason: opts.reason } });
  return { partner: getPartner(id)!, outboundToken: newToken };
}

export function setActive(id: string, active: boolean, reason?: string): Partner | undefined {
  loadIfStale();
  const p = cache.find((x) => x.id === id);
  if (!p) return undefined;
  if (p.active === active) return getPartner(id);
  p.active = active;
  persist();
  auditEvent({ type: active ? "partner_activated" : "partner_deactivated", partnerId: id, detail: { reason } });
  return getPartner(id);
}

// presence 갱신 — 친구 측으로부터 응답을 받을 때마다 호출 (handleInbound, health ping 성공)
// audit log 남기지 않음 (10분 주기 호출이라 너무 시끄러움). lastMtime 갱신은 persist()에서.
export function touchLastSeen(id: string, at?: string): boolean {
  loadIfStale();
  const p = cache.find((x) => x.id === id);
  if (!p) return false;
  p.lastSeenAt = at ?? new Date().toISOString();
  persist();
  return true;
}

// SSOT: 공유 여부 판정은 오직 resumeSharedAt 존재 여부. (Phase2 resume-share 호환)
export function setResumeShared(id: string, on: boolean): Partner | undefined {
  loadIfStale();
  const p = cache.find((x) => x.id === id);
  if (!p) return undefined;
  if (on) {
    p.resumeSharedAt = new Date().toISOString();
  } else {
    delete p.resumeSharedAt;
  }
  persist();
  auditEvent({ type: on ? "resume_shared" : "resume_unshared", partnerId: id });
  return getPartner(id);
}

// rate limit 자동 비활성: 30분 5회 초과 시 active=false
export function recordRateBreach(id: string): { autoDeactivated: boolean } {
  loadIfStale();
  const p = cache.find((x) => x.id === id);
  if (!p) return { autoDeactivated: false };
  const now = Date.now();
  const cutoff = now - 30 * 60 * 1000;
  p.rateBreaches = (p.rateBreaches || []).filter((b) => new Date(b.at).getTime() > cutoff);
  p.rateBreaches.push({ at: new Date(now).toISOString() });
  if (p.rateBreaches.length >= 5 && p.active) {
    p.active = false;
    persist();
    auditEvent({ type: "partner_auto_deactivated", partnerId: id, detail: { breaches: p.rateBreaches.length } });
    return { autoDeactivated: true };
  }
  persist();
  return { autoDeactivated: false };
}

export { maskToken };
