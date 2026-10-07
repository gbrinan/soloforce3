// partner-request: 동료 자동 등록 공개 API.
// 외부가 우리 공개 라우트로 거래 요청 → 사장님 승인 → 양쪽 partners.json 자동 동기화.
//
// 보안 핵심 (잭키 우려 차용):
// - 평문 토큰은 메모리 캐시에만, 디스크는 maskToken().
// - 콜백은 X-Partner-Request-Callback-Secret 헤더 검증 (옵션 B 헤더 방식).
// - validateApiUrl 재사용 (https + 사설 IP 차단, 잭키 P0-3 패턴).
// - (IP, companyName) 쌍 단위 블랙리스트 (Q6 — 다른 회사명은 통과).
// - injection 14패턴 자동 거부 + 블랙리스트 추가.

import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { HISTORY_DIR } from "../config.js";
import {
  validateApiUrl,
  normalizeApiUrl,
  maskToken,
  createPartner,
  updatePartner,
  listPartners,
  getPartnerWithTokens,
  rotateOutboundToken,
  getMyProfile,
} from "./partners.js";
import { sendPartnerRequestCallback } from "./external-client.js";
import { auditEvent } from "./external-audit.js";
import { scanInjection } from "./external-injection-filter.js";
import { addGenieMessage } from "./chat.js";
import type {
  PartnerRequest,
  PartnerRequestBody,
  PartnerRequestCallback,
  PartnerRequestImmediateResponse,
  PartnerRequestRejectReason,
  PartnerRequestSentCache,
  PartnerScope,
} from "../types.js";

// ===== 환경변수 =====
const PUBLIC_ENABLED = process.env.MYCREW_PARTNER_REQUEST_PUBLIC !== "false";
const PENDING_MAX = parseInt(process.env.MYCREW_PARTNER_REQUEST_PENDING_MAX ?? "100", 10);
const TIMEOUT_HOURS = parseFloat(process.env.MYCREW_PARTNER_REQUEST_TIMEOUT_HOURS ?? "24");
const BLACKLIST_HOURS = parseFloat(process.env.MYCREW_PARTNER_REQUEST_BLACKLIST_HOURS ?? "24");
const TIMESTAMP_DRIFT_SEC = parseInt(process.env.MYCREW_PARTNER_REQUEST_TIMESTAMP_DRIFT_SEC ?? "60", 10);
const SWEEP_INTERVAL_MS = parseInt(process.env.MYCREW_PARTNER_REQUEST_SWEEP_INTERVAL_MS ?? String(60 * 60 * 1000), 10);
// 승인 콜백이 이 횟수 이상 실패(approve() 호출 단위, 내부 재시도 attempts와 별개)하면 pending 무한 잔존 방지 위해 자동 fail 전환.
const APPROVAL_FAIL_THRESHOLD = parseInt(process.env.MYCREW_PARTNER_REQUEST_APPROVAL_FAIL_THRESHOLD ?? "2", 10);
const SENT_CACHE_TTL_MS = TIMEOUT_HOURS * 60 * 60 * 1000; // 요청 만료와 동일 (기본 24h)
const MAX_BODY_TOTAL = 8000;
const MAX_MESSAGE = 4000;
const MAX_COMPANY_NAME = 128;
const MAX_CONTACT_NAME = 64;
const MAX_CONTACT_EMAIL = 128;

// ===== 디스크 경로 =====
const FILE_DIR = join(HISTORY_DIR, "external");
const REQUESTS_FILE = join(FILE_DIR, "partner-requests.jsonl");
const SENT_CACHE_FILE = join(FILE_DIR, "partner-request-sent.json");
const BLACKLIST_FILE = join(FILE_DIR, "partner-request-blacklist.jsonl");
const CHAOS_CALLBACK_DOWN_FILE = join(FILE_DIR, ".partner-request-callback-down");
// 승인 전 평문 inboundToken/callbackSecret 재시작 생존용. partners.json도 이미 plaintext 저장 관행(persist()가 마스킹 없이 씀)과
// 동일선상 — REQUESTS_FILE(감사로그)만 마스킹 유지, 이 파일은 pending 해소 즉시 삭제. gitignore 대상.
const REQUEST_SECRETS_FILE = join(FILE_DIR, "partner-request-secrets.json");

// ===== 메모리 캐시 =====
const pending = new Map<string, PartnerRequest>();
const sentCache = new Map<string, PartnerRequestSentCache>();
const blacklist = new Map<string, number>();

// ===== Helper =====
function ensureDir(): void {
  if (!existsSync(FILE_DIR)) mkdirSync(FILE_DIR, { recursive: true });
}

function appendJson(file: string, obj: unknown): void {
  ensureDir();
  appendFileSync(file, JSON.stringify(obj) + "\n", "utf-8");
}

function blacklistKey(ip: string, companyName: string): string {
  return `${ip}|${companyName.toLowerCase()}`;
}

function maskBody(body: PartnerRequestBody): PartnerRequestBody {
  return {
    ...body,
    inboundToken: maskToken(body.inboundToken),
    callbackSecret: maskToken(body.callbackSecret),
  };
}

function isMasked(token: string): boolean {
  return token.includes("...") || token === "****";
}

// ===== pending 요청 평문 secret 영속 (재시작 생존) =====
type RequestSecret = { inboundToken: string; callbackSecret: string };

function loadRequestSecrets(): Map<string, RequestSecret> {
  if (!existsSync(REQUEST_SECRETS_FILE)) return new Map();
  try {
    const data = JSON.parse(readFileSync(REQUEST_SECRETS_FILE, "utf-8")) as Record<string, RequestSecret>;
    return new Map(Object.entries(data));
  } catch {
    return new Map();
  }
}

function persistRequestSecret(id: string, inboundToken: string, callbackSecret: string): void {
  ensureDir();
  const secrets = loadRequestSecrets();
  secrets.set(id, { inboundToken, callbackSecret });
  writeFileSync(REQUEST_SECRETS_FILE, JSON.stringify(Object.fromEntries(secrets)), { mode: 0o600 });
}

function deleteRequestSecret(id: string): void {
  if (!existsSync(REQUEST_SECRETS_FILE)) return;
  const secrets = loadRequestSecrets();
  if (!secrets.delete(id)) return;
  writeFileSync(REQUEST_SECRETS_FILE, JSON.stringify(Object.fromEntries(secrets)), { mode: 0o600 });
}

// 자기 회사 정보 — myProfile 우선, 미설정 시 fallback
function getOurCompanyInfo(): { companyName: string; contactName: string; secretaryName?: string; department?: string; contactEmail?: string; contactPhone?: string } {
  const profile = getMyProfile();
  if (profile) {
    return {
      companyName: profile.companyName,
      contactName: profile.contactName,
      secretaryName: profile.secretaryName,
      department: profile.department,
      contactEmail: profile.contactEmail,
      contactPhone: profile.contactPhone,
    };
  }
  return {
    companyName: process.env.MYCREW_COMPANY_NAME ?? "(미설정)",
    contactName: process.env.MYCREW_CONTACT_NAME ?? "(미설정)",
    contactEmail: process.env.MYCREW_CONTACT_EMAIL || undefined,
  };
}

// ===== 부팅 시 디스크 로드 =====
export function loadPartnerRequests(): void {
  ensureDir();
  // 블랙리스트
  if (existsSync(BLACKLIST_FILE)) {
    try {
      const lines = readFileSync(BLACKLIST_FILE, "utf-8").split("\n").filter(Boolean);
      const now = Date.now();
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as { ip?: string; companyName?: string; expireAt?: string };
          if (!entry.ip || !entry.companyName || !entry.expireAt) continue;
          const expireAt = new Date(entry.expireAt).getTime();
          if (expireAt > now) blacklist.set(blacklistKey(entry.ip, entry.companyName), expireAt);
        } catch { /* skip */ }
      }
    } catch (err) {
      console.warn("[PartnerRequest] 블랙리스트 로드 실패:", err instanceof Error ? err.message : err);
    }
  }
  // pending (디스크 라인은 마스킹 — 평문은 부팅 후 휘발 정상)
  if (!existsSync(REQUESTS_FILE)) return;
  try {
    const lines = readFileSync(REQUESTS_FILE, "utf-8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as { op: string; request?: PartnerRequest; id?: string; patch?: Partial<PartnerRequest> };
        if (entry.op === "create" && entry.request) {
          pending.set(entry.request.id, entry.request);
        } else if (entry.op === "update" && entry.id && entry.patch) {
          const existing = pending.get(entry.id);
          if (existing) Object.assign(existing, entry.patch);
        }
      } catch { /* skip */ }
    }
  } catch (err) {
    console.warn("[PartnerRequest] pending 로드 실패:", err instanceof Error ? err.message : err);
  }
  // pending 요청에 평문 secret 복원 (REQUESTS_FILE은 항상 마스킹이라 이 파일 없이는 재승인 불가였던 버그 수정)
  const requestSecrets = loadRequestSecrets();
  for (const req of pending.values()) {
    if (req.status !== "pending") continue;
    const secret = requestSecrets.get(req.id);
    if (secret) {
      req.body.inboundToken = secret.inboundToken;
      req.body.callbackSecret = secret.callbackSecret;
    }
  }
  // sentCache 복원
  loadSentCache();
  console.log(`[PartnerRequest] sentCache 복원: ${sentCache.size}건`);
}

// ===== 블랙리스트 =====
export function isBlacklisted(ip: string, companyName: string): boolean {
  const key = blacklistKey(ip, companyName);
  const expireAt = blacklist.get(key);
  if (!expireAt) return false;
  if (Date.now() > expireAt) {
    blacklist.delete(key);
    return false;
  }
  return true;
}

export function addToBlacklist(ip: string, companyName: string, hours = BLACKLIST_HOURS): void {
  const expireAt = Date.now() + hours * 60 * 60 * 1000;
  blacklist.set(blacklistKey(ip, companyName), expireAt);
  appendJson(BLACKLIST_FILE, {
    ip,
    companyName,
    expireAt: new Date(expireAt).toISOString(),
    addedAt: new Date().toISOString(),
  });
  auditEvent({ type: "partner_request_blacklisted", detail: { ip, companyName, hours } });
}

// ===== 검증 (export — 단위 테스트용) =====
export type ValidationError =
  | "https_required"
  | "private_ip"
  | "schema_invalid"
  | "timestamp_drift"
  | "payload_too_large";

export function validatePartnerRequestBody(body: unknown): { ok: boolean; error?: ValidationError; errorDetail?: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "schema_invalid", errorDetail: "body must be object" };
  }
  const b = body as Partial<PartnerRequestBody>;
  for (const f of ["companyName", "contactName", "apiUrl", "inboundToken", "timestamp", "requestId", "callbackSecret"] as const) {
    if (typeof b[f] !== "string" || !(b[f] as string).trim()) {
      return { ok: false, error: "schema_invalid", errorDetail: `${f} required` };
    }
  }
  if (b.companyName!.length > MAX_COMPANY_NAME) return { ok: false, error: "schema_invalid", errorDetail: "companyName too long" };
  if (b.contactName!.length > MAX_CONTACT_NAME) return { ok: false, error: "schema_invalid", errorDetail: "contactName too long" };
  if (b.contactEmail && b.contactEmail.length > MAX_CONTACT_EMAIL) return { ok: false, error: "schema_invalid", errorDetail: "contactEmail too long" };
  if (b.message && b.message.length > MAX_MESSAGE) return { ok: false, error: "payload_too_large", errorDetail: `message > ${MAX_MESSAGE}` };
  if (!/^[a-f0-9]{32,64}$/i.test(b.inboundToken!)) return { ok: false, error: "schema_invalid", errorDetail: "inboundToken must be 32~64 hex" };
  if (!/^[a-f0-9]{32,64}$/i.test(b.callbackSecret!)) return { ok: false, error: "schema_invalid", errorDetail: "callbackSecret must be 32~64 hex" };
  const totalSize = JSON.stringify(body).length;
  if (totalSize > MAX_BODY_TOTAL) return { ok: false, error: "payload_too_large", errorDetail: `total > ${MAX_BODY_TOTAL}` };
  try {
    validateApiUrl(b.apiUrl!);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("https://")) return { ok: false, error: "https_required", errorDetail: msg };
    return { ok: false, error: "private_ip", errorDetail: msg };
  }
  const ts = Date.parse(b.timestamp!);
  if (Number.isNaN(ts)) return { ok: false, error: "schema_invalid", errorDetail: "timestamp invalid ISO" };
  const drift = Math.abs(Date.now() - ts) / 1000;
  if (drift > TIMESTAMP_DRIFT_SEC) return { ok: false, error: "timestamp_drift", errorDetail: `drift ${drift.toFixed(1)}s > ${TIMESTAMP_DRIFT_SEC}s` };
  return { ok: true };
}

// ===== 중복 검사 =====
function isDuplicateRequest(companyName: string, apiUrl: string): boolean {
  const cn = companyName.toLowerCase();
  const url = apiUrl.toLowerCase().replace(/\/+$/, "");
  for (const r of pending.values()) {
    if (r.status !== "pending") continue;
    if (r.body.companyName.toLowerCase() === cn && r.body.apiUrl.toLowerCase().replace(/\/+$/, "") === url) {
      return true;
    }
  }
  for (const p of listPartners()) {
    if (p.companyName.toLowerCase() === cn && p.apiUrl.toLowerCase().replace(/\/+$/, "") === url && p.active) {
      return true;
    }
  }
  return false;
}

// ===== 큐 정리 =====
function ensureQueueCapacity(): boolean {
  const pendingCount = Array.from(pending.values()).filter((r) => r.status === "pending").length;
  if (pendingCount < PENDING_MAX) return true;
  expireOverduePartnerRequests();
  const after = Array.from(pending.values()).filter((r) => r.status === "pending").length;
  return after < PENDING_MAX;
}

// ===== 공개 라우트 진입점 =====
export async function handlePartnerRequest(body: unknown, sourceIp: string): Promise<{ status: number; response: PartnerRequestImmediateResponse }> {
  if (!PUBLIC_ENABLED) {
    return { status: 404, response: { ok: false, error: "schema_invalid" } };
  }
  // apiUrl 정규화 — 검증/중복판정/저장 전에 스킴 중복(https://https://) 등 교정.
  // 실측: partner-requests.jsonl 최초 create 라인에 apiUrl="https://https://sample-mammal-passover.ngrok-free.dev"가
  // 그대로 저장돼 있었음 — 저장 시점(요청 수신 시점) 원본부터 이미 이중 스킴이었으므로 수신 즉시 정규화 필요.
  if (body && typeof body === "object" && typeof (body as { apiUrl?: unknown }).apiUrl === "string") {
    (body as { apiUrl: string }).apiUrl = normalizeApiUrl((body as { apiUrl: string }).apiUrl);
  }
  const v = validatePartnerRequestBody(body);
  if (!v.ok) {
    auditEvent({ type: "partner_request_received", detail: { ip: sourceIp, rejected: v.error, errorDetail: v.errorDetail } });
    const httpStatus = v.error === "payload_too_large" ? 413 : 400;
    return { status: httpStatus, response: { ok: false, error: v.error } };
  }
  const b = body as PartnerRequestBody;

  // 멱등성 우선 확인 — 동일 requestId 재전송(클라이언트 네트워크 재시도 등)은 블랙리스트/중복 검사보다 먼저 그대로 재생.
  // 기존에는 이 검사가 맨 뒤에 있어 같은 요청의 재전송이 duplicate_pending(409)으로 오인 거부될 수 있었음.
  const existingById = pending.get(b.requestId);
  if (existingById) {
    return { status: 202, response: { ok: true, requestId: existingById.id, status: existingById.status, expiresAt: existingById.expiresAt } };
  }

  if (isBlacklisted(sourceIp, b.companyName)) {
    auditEvent({ type: "partner_request_received", detail: { ip: sourceIp, companyName: b.companyName, rejected: "ip_blacklisted" } });
    return { status: 403, response: { ok: false, error: "ip_blacklisted" } };
  }

  if (isDuplicateRequest(b.companyName, b.apiUrl)) {
    auditEvent({ type: "partner_request_received", detail: { ip: sourceIp, companyName: b.companyName, rejected: "duplicate_pending" } });
    return { status: 409, response: { ok: false, error: "duplicate_pending" } };
  }

  // injection 자동 거부 + 블랙리스트
  if (b.message) {
    const flags = scanInjection(b.message);
    if (flags.length > 0) {
      addToBlacklist(sourceIp, b.companyName);
      auditEvent({ type: "partner_request_received", detail: { ip: sourceIp, companyName: b.companyName, rejected: "injection_detected", patterns: flags.map((f) => f.pattern) } });
      return { status: 400, response: { ok: false, error: "injection_detected" } };
    }
  }

  if (!ensureQueueCapacity()) {
    auditEvent({ type: "partner_request_received", detail: { ip: sourceIp, companyName: b.companyName, rejected: "queue_full" } });
    return { status: 503, response: { ok: false, error: "queue_full" } };
  }

  const now = new Date();
  const expireAt = new Date(now.getTime() + TIMEOUT_HOURS * 60 * 60 * 1000);
  const req: PartnerRequest = {
    id: b.requestId,
    receivedAt: now.toISOString(),
    status: "pending",
    body: b,
    sourceIp,
    expiresAt: expireAt.toISOString(),
    resultDeliveryAttempts: 0,
  };
  pending.set(req.id, req);
  appendJson(REQUESTS_FILE, { at: now.toISOString(), op: "create", request: { ...req, body: maskBody(b) } });
  persistRequestSecret(req.id, b.inboundToken, b.callbackSecret);
  auditEvent({ type: "partner_request_received", messageId: req.id, detail: { ip: sourceIp, companyName: b.companyName } });

  // NOTIFY 사장님
  addGenieMessage(
    `📋 새 거래 요청: ${b.companyName} ${b.contactName} (${sourceIp}). 인박스 → 거래 요청 섹션에서 확인하세요.`,
    { internal: false },
  );

  return {
    status: 202,
    response: { ok: true, requestId: req.id, status: "pending", expiresAt: expireAt.toISOString() },
  };
}

// ===== 발신 측 cache (디스크 영속) =====
function persistSentCache(): void {
  ensureDir();
  try {
    writeFileSync(SENT_CACHE_FILE, JSON.stringify(Array.from(sentCache.values())));
  } catch { /* */ }
}

function loadSentCache(): void {
  if (!existsSync(SENT_CACHE_FILE)) return;
  try {
    const data = JSON.parse(readFileSync(SENT_CACHE_FILE, "utf-8")) as PartnerRequestSentCache[];
    const now = Date.now();
    for (const entry of data) {
      // TTL 만료 체크 (sentAt 기준)
      if (now - new Date(entry.sentAt).getTime() < SENT_CACHE_TTL_MS) {
        sentCache.set(entry.requestId, entry);
      }
    }
  } catch { /* */ }
}

export function recordSentRequest(cache: PartnerRequestSentCache): void {
  sentCache.set(cache.requestId, cache);
  persistSentCache();
}

export function consumeSentRequest(requestId: string, callbackSecret: string): PartnerRequestSentCache | undefined {
  const cache = sentCache.get(requestId);
  if (!cache) return undefined;
  const a = Buffer.from(cache.callbackSecret);
  const b = Buffer.from(callbackSecret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined;
  sentCache.delete(requestId);
  persistSentCache();
  return cache;
}

export function findSentByRequestId(requestId: string): PartnerRequestSentCache | undefined {
  return sentCache.get(requestId);
}

export function listSentRequests(): PartnerRequestSentCache[] {
  return Array.from(sentCache.values());
}

// ===== 콜백 인증 (단위 테스트용) =====
export function verifyCallbackSecret(requestId: string, secret: string): boolean {
  const cache = sentCache.get(requestId);
  if (!cache) return false;
  const a = Buffer.from(cache.callbackSecret);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ===== UI 조회 =====
// 완료된 요청(approved/rejected/expired)은 sweep가 메모리에서 제거하지만 디스크(append-only)엔
// 최종 상태가 남는다. 메모리에 없으면 해당 id의 디스크 라인을 재생해 최종 상태를 복원한다
// (UI가 "만료됨/승인됨/거부됨"을 id로 조회 가능 — 이전엔 sweep 후 404였음).
function replayRequestFromDisk(id: string): PartnerRequest | undefined {
  if (!existsSync(REQUESTS_FILE)) return undefined;
  let acc: PartnerRequest | undefined;
  try {
    const lines = readFileSync(REQUESTS_FILE, "utf-8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as { op: string; request?: PartnerRequest; id?: string; patch?: Partial<PartnerRequest> };
        if (entry.op === "create" && entry.request?.id === id) acc = { ...entry.request };
        else if (entry.op === "update" && entry.id === id && entry.patch && acc) Object.assign(acc, entry.patch);
      } catch { /* skip */ }
    }
  } catch { /* ignore */ }
  return acc;
}

export function getPartnerRequest(id: string): PartnerRequest | undefined {
  return pending.get(id) ?? replayRequestFromDisk(id);
}

export function getPendingPartnerRequests(): PartnerRequest[] {
  return Array.from(pending.values()).filter((r) => r.status === "pending");
}

export function listAllPartnerRequests(): PartnerRequest[] {
  return Array.from(pending.values());
}

// ===== 승인 =====
export async function approvePartnerRequest(id: string, scopeOverride?: PartnerScope): Promise<{ ok: boolean; error?: string }> {
  const req = pending.get(id);
  if (!req) return { ok: false, error: "request not found" };
  if (req.status !== "pending") return { ok: false, error: `status=${req.status} (pending 아님)` };
  if (new Date(req.expiresAt).getTime() < Date.now()) return { ok: false, error: "요청이 만료되었습니다. 상대방에게 재요청을 안내하세요." };
  if (isMasked(req.body.inboundToken) || isMasked(req.body.callbackSecret)) {
    return { ok: false, error: "평문 토큰 휘발됨 (부팅 후 메모리 cache 미보존). 외부에 재요청 안내 필요." };
  }
  const finalScope = scopeOverride ?? req.body.scope;
  // apiUrl 정규화 + pending 레코드 자체도 즉시 교정 (재승인/재전송 시 이후 모든 참조가 정규화된 값을 씀).
  const normalizedApiUrl = normalizeApiUrl(req.body.apiUrl);
  req.body.apiUrl = normalizedApiUrl;

  // 중복 등록 방지 — 동일 이메일 + 정규화된 apiUrl 조합의 파트너가 이미 있으면 신규 생성 대신 재사용.
  // 실측 버그: 콜백 실패(예: apiUrl 오류로 network 실패) 후 상태가 pending으로 남아 있어 재승인 시
  // createPartner()가 매번 새 파트너를 만들어 "산체스" 파트너가 2건 중복 등록됐음 (partners.json 확인).
  const existingPartner = req.body.contactEmail
    ? listPartners().find((p) =>
        p.apiUrl.toLowerCase().replace(/\/+$/, "") === normalizedApiUrl.toLowerCase() &&
        (p.contactEmail || "").toLowerCase() === req.body.contactEmail!.toLowerCase(),
      )
    : undefined;

  let partnerId: string;
  let inboundTokenPlain: string;
  if (existingPartner) {
    updatePartner(existingPartner.id, {
      companyName: req.body.companyName,
      contactName: req.body.contactName,
      secretaryName: req.body.secretaryName,
      department: req.body.department,
      contactPhone: req.body.contactPhone,
      apiUrl: normalizedApiUrl,
      scope: finalScope,
      active: true,
    });
    const withTokens = getPartnerWithTokens(existingPartner.id);
    if (!withTokens) return { ok: false, error: "기존 파트너 조회 실패" };
    partnerId = existingPartner.id;
    inboundTokenPlain = withTokens.inboundToken;
  } else {
    let createResult: { partner: { id: string }; inboundToken: string };
    try {
      createResult = createPartner({
        companyName: req.body.companyName,
        contactName: req.body.contactName,
        secretaryName: req.body.secretaryName,
        department: req.body.department,
        contactEmail: req.body.contactEmail,
        contactPhone: req.body.contactPhone,
        apiUrl: normalizedApiUrl,
        scope: finalScope,
        registeredBy: "partner-request",
      });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    partnerId = createResult.partner.id;
    inboundTokenPlain = createResult.inboundToken;
  }
  // 우리 outboundToken을 외부의 inboundToken으로 덮어쓰기 (재승인 시 사실상 콜백 재시도 역할도 겸함)
  rotateOutboundToken(partnerId, {
    rotatedBy: "them",
    newToken: req.body.inboundToken,
    reason: "partner-request initial token",
  });

  const ourInfo = getOurCompanyInfo();
  const callback: PartnerRequestCallback = {
    requestId: req.id,
    status: "approved",
    inboundToken: inboundTokenPlain,
    partnerId,
    scope: finalScope,
    partnerCompanyName: ourInfo.companyName,
    partnerContactName: ourInfo.contactName,
    partnerSecretaryName: ourInfo.secretaryName,
    partnerDepartment: ourInfo.department,
    partnerContactEmail: ourInfo.contactEmail,
    partnerContactPhone: ourInfo.contactPhone,
  };
  const sendResult = await sendPartnerRequestCallback(req.body.apiUrl, callback, req.body.callbackSecret);
  req.resultDeliveryAttempts = (req.resultDeliveryAttempts ?? 0) + (sendResult.attempts ?? 1);
  if (!sendResult.ok) {
    req.approvalFailureCount = (req.approvalFailureCount ?? 0) + 1;
    auditEvent({ type: "partner_request_callback_failed", messageId: req.id, detail: { reason: sendResult.errorReason, attempts: req.resultDeliveryAttempts, approvalFailureCount: req.approvalFailureCount } });
    // 실측 버그: 이중 https로 apiUrl이 무효해 승인 콜백이 계속 실패했는데도 status가 pending에 머물러
    // getPendingPartnerRequests()가 계속 반환 → 좌측 UI에서 사라지지 않고 남아있었음.
    // N회(기본 2) 연속 실패 시 자동 fail 전환해 pending 목록에서 제거.
    if (req.approvalFailureCount >= APPROVAL_FAIL_THRESHOLD) {
      req.status = "failed";
      req.resolvedAt = new Date().toISOString();
      req.resolvedBy = "auto-fail";
      req.failReason = sendResult.errorReason;
      req.body = maskBody(req.body);
      appendJson(REQUESTS_FILE, {
        at: req.resolvedAt,
        op: "update",
        id: req.id,
        patch: {
          status: "failed",
          resolvedAt: req.resolvedAt,
          resolvedBy: req.resolvedBy,
          failReason: req.failReason,
          resultDeliveryAttempts: req.resultDeliveryAttempts,
          approvalFailureCount: req.approvalFailureCount,
          body: req.body,
        },
      });
      pending.delete(req.id);
      deleteRequestSecret(req.id);
      addGenieMessage(
        `❌ ${req.body.companyName} 거래 요청 승인 콜백이 ${req.approvalFailureCount}회 연속 실패해 자동으로 무효 처리됐어요 (사유: ${sendResult.errorReason}). 상대방에게 apiUrl 재확인 후 재요청을 안내하세요.`,
        { internal: false },
      );
      return { ok: false, error: `callback_failed_final: ${sendResult.errorReason}` };
    }
    addGenieMessage(
      `⚠️ ${req.body.companyName} 거래 요청 승인 결과를 외부에 전달하는 데 실패했어요. 인박스에서 [재전송]을 누르거나, 1시간 안에 안 누르면 등록이 무효화됩니다.`,
      { internal: false },
    );
    appendJson(REQUESTS_FILE, { at: new Date().toISOString(), op: "update", id: req.id, patch: { resultDeliveryAttempts: req.resultDeliveryAttempts, approvalFailureCount: req.approvalFailureCount } });
    return { ok: false, error: `callback_failed: ${sendResult.errorReason}` };
  }
  // 콜백 성공 → 상태 갱신 + 마스킹
  req.status = "approved";
  req.resolvedAt = new Date().toISOString();
  req.resolvedBy = "owner";
  req.resultDeliveredAt = req.resolvedAt;
  req.scopeOverride = finalScope;
  req.body = maskBody(req.body);
  appendJson(REQUESTS_FILE, {
    at: req.resolvedAt,
    op: "update",
    id: req.id,
    patch: { status: "approved", resolvedAt: req.resolvedAt, resolvedBy: "owner", resultDeliveredAt: req.resultDeliveredAt, resultDeliveryAttempts: req.resultDeliveryAttempts, scopeOverride: finalScope, body: req.body },
  });
  auditEvent({ type: "partner_request_approved", messageId: req.id, detail: { partnerId, companyName: req.body.companyName } });
  auditEvent({ type: "partner_request_callback_sent", messageId: req.id });
  const companyName = req.body.companyName;
  pending.delete(req.id); // 디스크에 기록 완료 → 메모리 해제
  deleteRequestSecret(req.id);
  addGenieMessage(
    `🤝 ${companyName} 거래 요청을 승인했습니다. 양쪽 시스템에 동료 등록 완료, 일반 메시지 통신 가능.`,
    { internal: false },
  );
  return { ok: true };
}

// ===== 거부 =====
export async function rejectPartnerRequest(id: string, reason: PartnerRequestRejectReason, reasonText?: string): Promise<{ ok: boolean; error?: string }> {
  const req = pending.get(id);
  if (!req) return { ok: false, error: "request not found" };
  if (req.status !== "pending") return { ok: false, error: `status=${req.status} (pending 아님)` };
  const callback: PartnerRequestCallback = {
    requestId: req.id,
    status: "rejected",
    reason,
    reasonText: reason === "other" ? reasonText?.slice(0, 64) : undefined,
  };
  let callbackOk = false;
  if (!isMasked(req.body.callbackSecret)) {
    const sendResult = await sendPartnerRequestCallback(req.body.apiUrl, callback, req.body.callbackSecret);
    callbackOk = sendResult.ok;
    if (!callbackOk) {
      auditEvent({ type: "partner_request_callback_failed", messageId: req.id, detail: { reason: sendResult.errorReason } });
    }
  }
  addToBlacklist(req.sourceIp, req.body.companyName);
  req.status = "rejected";
  req.resolvedAt = new Date().toISOString();
  req.resolvedBy = "owner";
  req.rejectReason = reason;
  if (reason === "other" && reasonText) req.rejectReasonText = reasonText.slice(0, 64);
  req.body = maskBody(req.body);
  appendJson(REQUESTS_FILE, {
    at: req.resolvedAt,
    op: "update",
    id: req.id,
    patch: { status: "rejected", resolvedAt: req.resolvedAt, resolvedBy: "owner", rejectReason: req.rejectReason, rejectReasonText: req.rejectReasonText, body: req.body },
  });
  auditEvent({ type: "partner_request_rejected", messageId: req.id, detail: { reason, callbackDelivered: callbackOk } });
  pending.delete(req.id); // 디스크에 기록 완료 → 메모리 해제
  deleteRequestSecret(req.id);
  return { ok: true };
}

// ===== 재전송 =====
export async function resendPartnerRequestCallback(id: string): Promise<{ ok: boolean; error?: string }> {
  const req = pending.get(id);
  if (!req) return { ok: false, error: "request not found" };
  if (req.status === "approved" && req.resultDeliveredAt) return { ok: false, error: "이미 전달 완료" };
  if (isMasked(req.body.callbackSecret)) {
    return { ok: false, error: "평문 secret 휘발 (1시간 경과)" };
  }
  const existingPartner = listPartners().find((p) => p.companyName === req.body.companyName && p.apiUrl === req.body.apiUrl);
  if (!existingPartner) {
    return { ok: false, error: "partner 등록 정보 없음 — 정상 [승인] 흐름 다시 시도 필요" };
  }
  const partner = getPartnerWithTokens(existingPartner.id);
  if (!partner) return { ok: false, error: "partner 조회 실패" };
  const ourInfo = getOurCompanyInfo();
  const callback: PartnerRequestCallback = {
    requestId: req.id,
    status: "approved",
    inboundToken: partner.inboundToken,
    partnerId: partner.id,
    scope: req.scopeOverride ?? req.body.scope,
    partnerCompanyName: ourInfo.companyName,
    partnerContactName: ourInfo.contactName,
    partnerSecretaryName: ourInfo.secretaryName,
    partnerDepartment: ourInfo.department,
    partnerContactEmail: ourInfo.contactEmail,
    partnerContactPhone: ourInfo.contactPhone,
  };
  const sendResult = await sendPartnerRequestCallback(req.body.apiUrl, callback, req.body.callbackSecret);
  req.resultDeliveryAttempts = (req.resultDeliveryAttempts ?? 0) + (sendResult.attempts ?? 1);
  if (!sendResult.ok) {
    auditEvent({ type: "partner_request_callback_failed", messageId: req.id, detail: { reason: sendResult.errorReason, retryFromOwner: true } });
    return { ok: false, error: sendResult.errorReason };
  }
  req.status = "approved";
  req.resolvedAt = req.resolvedAt ?? new Date().toISOString();
  req.resolvedBy = "owner";
  req.resultDeliveredAt = new Date().toISOString();
  req.body = maskBody(req.body);
  appendJson(REQUESTS_FILE, {
    at: req.resultDeliveredAt,
    op: "update",
    id: req.id,
    patch: { status: "approved", resolvedAt: req.resolvedAt, resolvedBy: "owner", resultDeliveredAt: req.resultDeliveredAt, resultDeliveryAttempts: req.resultDeliveryAttempts, body: req.body },
  });
  auditEvent({ type: "partner_request_callback_sent", messageId: req.id, detail: { retryFromOwner: true } });
  deleteRequestSecret(req.id);
  return { ok: true };
}

// ===== 만료 sweep =====
export function expireOverduePartnerRequests(): void {
  const now = Date.now();
  for (const req of pending.values()) {
    if (req.status !== "pending") continue;
    if (new Date(req.expiresAt).getTime() > now) continue;
    req.status = "expired";
    req.resolvedAt = new Date().toISOString();
    req.resolvedBy = "auto-expire";
    if (!isMasked(req.body.callbackSecret)) {
      void sendPartnerRequestCallback(req.body.apiUrl, {
        requestId: req.id,
        status: "expired",
      }, req.body.callbackSecret).catch(() => { /* swallow — audit만 */ });
    }
    req.body = maskBody(req.body);
    appendJson(REQUESTS_FILE, {
      at: req.resolvedAt,
      op: "update",
      id: req.id,
      patch: { status: "expired", resolvedAt: req.resolvedAt, resolvedBy: "auto-expire", body: req.body },
    });
    auditEvent({ type: "partner_request_expired", messageId: req.id });
    deleteRequestSecret(req.id);
  }
  // 완료된 건(approved/rejected/expired) 메모리에서 제거 — 디스크에만 보존
  for (const [id, req] of pending) {
    if (req.status !== "pending") pending.delete(id);
  }
}

// sentCache TTL 정리
function sweepSentCache(): void {
  const now = Date.now();
  let changed = false;
  for (const [id, entry] of sentCache) {
    if (now - new Date(entry.sentAt).getTime() >= SENT_CACHE_TTL_MS) {
      sentCache.delete(id);
      changed = true;
    }
  }
  if (changed) persistSentCache();
}

// ===== sweep timer =====
let sweepTimer: NodeJS.Timeout | null = null;
export function startPartnerRequestSweep(): void {
  if (sweepTimer) return;
  // 서버 시작 시 즉시 1회 실행 (재시작 중 밀린 만료 처리)
  try { expireOverduePartnerRequests(); }
  catch (err) { console.error("[PartnerRequest] 초기 sweep 실패:", err instanceof Error ? err.message : err); }
  // sentCache TTL 만료 정리
  sweepSentCache();
  sweepTimer = setInterval(() => {
    try { expireOverduePartnerRequests(); }
    catch (err) { console.error("[PartnerRequest] sweep 실패:", err instanceof Error ? err.message : err); }
    sweepSentCache();
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref();
}

export function stopPartnerRequestSweep(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

// ===== chaos flag (T9 통합 테스트용) =====
export function isCallbackChaosDown(): boolean {
  return existsSync(CHAOS_CALLBACK_DOWN_FILE);
}
