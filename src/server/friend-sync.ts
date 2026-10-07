// 친구 presence + 일정 10분 주기 자동 동기화.
//
// 흐름:
//  1) presence ping: 모든 active partner의 apiUrl/api/external/health GET 호출.
//     200 OK 응답 시 touchLastSeen(partner.id) → partners.json.lastSeenAt 갱신.
//     실패하면 갱신 안 함 → 클라이언트가 자동으로 회색 표시.
//  2) schedule-request: presence ping 성공한 partner에 대해서만 schedule_request 발송.
//     마지막 발송으로부터 SCHEDULE_REQUEST_DEBOUNCE_MS 미만 경과면 skip (친구 부담 감소).
//     발송 범위: 오늘 00:00:00+09:00 ~ 14일 후 23:59:59+09:00.
//
// 친구별 캘린더 토글은 클라이언트 사이드(localStorage)라 서버에서 알 수 없음. 우선 모든 active 친구에
// schedule-request 발송. 추후 토글 정보를 서버에 동기화하면 그 친구만 sync 가능.
//
// 영속 상태: history/external/friend-sync-state.json — partnerId별 lastScheduleRequestAt만 보관.
// lastSeenAt은 partners.json에 직접 저장 (touchLastSeen).

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { HISTORY_DIR } from "../config.js";
import { getGenieName } from "./chat.js";
import { listPartners, touchLastSeen, getPartnerWithTokens, validateApiUrl, updatePartner } from "./partners.js";
import { sendExternal } from "./external-client.js";
import { savePendingScheduleRequest } from "./schedule-requests.js";
import { randomUUID } from "node:crypto";
import type { MyProfile, Partner } from "../types.js";

const STATE_FILE = join(HISTORY_DIR, "external", "friend-sync-state.json");
const HEALTH_TIMEOUT_MS = 5_000;
const SCHEDULE_REQUEST_DEBOUNCE_MS = 30 * 60 * 1000; // 30분 — 친구 부담 감소
const USER_AGENT = "mycrew/1.0";

interface FriendSyncState {
  version: number;
  // partnerId → ISO timestamp of last schedule_request sent
  lastScheduleRequestByPartner: Record<string, string>;
  lastCycleAt?: string;
}

function loadState(): FriendSyncState {
  if (!existsSync(STATE_FILE)) {
    return { version: 1, lastScheduleRequestByPartner: {} };
  }
  try {
    const raw = readFileSync(STATE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as FriendSyncState;
    if (!parsed.lastScheduleRequestByPartner) parsed.lastScheduleRequestByPartner = {};
    return parsed;
  } catch {
    return { version: 1, lastScheduleRequestByPartner: {} };
  }
}

function saveState(state: FriendSyncState): void {
  const dir = dirname(STATE_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

async function pingHealth(apiUrl: string): Promise<boolean> {
  try {
    validateApiUrl(apiUrl);
  } catch {
    return false;
  }
  const url = `${apiUrl.replace(/\/+$/, "")}/api/external/health`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// 친구 측 공개 명함(my-profile) 1회 GET. 실패 시 null (graceful fallback).
async function fetchPartnerProfile(apiUrl: string): Promise<Partial<MyProfile> | null> {
  try {
    validateApiUrl(apiUrl);
  } catch {
    return null;
  }
  const url = `${apiUrl.replace(/\/+$/, "")}/api/external/my-profile`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": USER_AGENT, "Accept": "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const j = await res.json().catch(() => null) as Partial<MyProfile> | null;
    if (!j || typeof j !== "object") return null;
    return j;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 친구 응답을 우리 partners.json 갱신 patch로 변환.
// 규칙:
//  - 응답에 키 자체가 없으면 (undefined) 우리 값 유지 — 친구가 제공 안 함
//  - 트림 후 값이 현재와 다르면 patch
//  - companyName/contactName(식별자)는 빈 값으로 덮어쓰지 않음
type ProfilePatch = NonNullable<Parameters<typeof updatePartner>[1]>;
function buildProfilePatch(profile: Partial<MyProfile>, current: Partner): ProfilePatch {
  const patch: ProfilePatch = {};
  const fields: Array<keyof MyProfile> = [
    "companyName", "contactName", "department", "secretaryName", "contactEmail", "contactPhone",
  ];
  for (const key of fields) {
    const raw = profile[key];
    if (raw === undefined) continue;
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    const currentVal = current[key];
    const currentNormalized = currentVal ?? "";
    if (trimmed === currentNormalized) continue;
    if ((key === "companyName" || key === "contactName") && !trimmed) continue;
    (patch as Record<string, string>)[key] = trimmed;
  }
  return patch;
}

// 한국 시간 기준 오늘 00:00 ~ 14일 후 23:59 ISO 범위
function getScheduleWindow(): { from: string; to: string } {
  const now = new Date();
  // KST 기준 오늘 0시 — 표시용. partners 측에서도 KST 변환은 알아서.
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const future = new Date(today);
  future.setDate(future.getDate() + 14);
  future.setHours(23, 59, 59, 999);
  return { from: today.toISOString(), to: future.toISOString() };
}

interface CycleResult {
  totalPartners: number;
  pingedOk: number;
  scheduleRequestsSent: number;
  scheduleRequestsSkipped: number;
  profilesUpdated: number;
  errors: string[];
}

export async function runFriendSyncCycle(): Promise<CycleResult> {
  const result: CycleResult = {
    totalPartners: 0,
    pingedOk: 0,
    scheduleRequestsSent: 0,
    scheduleRequestsSkipped: 0,
    profilesUpdated: 0,
    errors: [],
  };
  const state = loadState();
  state.lastCycleAt = new Date().toISOString();

  const partners = listPartners().filter((p) => p.active);
  result.totalPartners = partners.length;
  if (partners.length === 0) {
    saveState(state);
    return result;
  }

  const { from, to } = getScheduleWindow();
  const debounceCutoff = Date.now() - SCHEDULE_REQUEST_DEBOUNCE_MS;

  // 병렬로 ping (네트워크 IO bound — Promise.all OK).
  await Promise.all(partners.map(async (p) => {
    // partners.ts listPartners는 마스킹된 토큰만 노출 → apiUrl만 사용
    const full = getPartnerWithTokens(p.id);
    if (!full) return;
    const alive = await pingHealth(full.apiUrl);
    if (alive) {
      touchLastSeen(full.id);
      result.pingedOk++;
    }

    // schedule-request: ping 실패한 partner에는 발송 안 함 (네트워크 낭비)
    if (!alive) return;

    // 친구 프로필 동기화 — ping 성공한 partner에만. 실패해도 사이클 중단 X.
    try {
      const profile = await fetchPartnerProfile(full.apiUrl);
      if (profile) {
        const patch = buildProfilePatch(profile, full);
        if (Object.keys(patch).length > 0) {
          updatePartner(full.id, patch);
          result.profilesUpdated++;
        }
      }
    } catch (err) {
      result.errors.push(`profile-fetch ${full.companyName}: ${err instanceof Error ? err.message : String(err)}`);
    }

    // schedule_request 자동 발화는 FRIEND_SCHEDULE_SYNC=true 환경변수가 명시된 경우에만 활성화.
    // 기본값 OFF — 사용자가 명시적으로 트리거할 때만 동작하도록 차단.
    if (process.env.FRIEND_SCHEDULE_SYNC !== "true") {
      result.scheduleRequestsSkipped++;
      return;
    }

    const lastReq = state.lastScheduleRequestByPartner[full.id];
    if (lastReq && new Date(lastReq).getTime() > debounceCutoff) {
      result.scheduleRequestsSkipped++;
      return;
    }

    const requestId = randomUUID();
    try {
      savePendingScheduleRequest({ requestId, partnerId: full.id, from, to });
      const ourLabel = getGenieName();
      const greetingName = full.contactName || full.companyName;
      const fromLabel = from.slice(0, 10);
      const toLabel = to.slice(0, 10);
      const messageBody = [
        `안녕하세요 ${greetingName}님. ${ourLabel}입니다.`,
        ``,
        `일정 자동 동기화로 ${fromLabel} ~ ${toLabel} 기간 일정을 요청드립니다.`,
        `같은 시스템이라면 자동으로 응답 payload에 일정이 포함됩니다.`,
        ``,
        `(자동 발송 — 10분 주기)`,
      ].join("\n");

      const sendResult = await sendExternal(full.id, messageBody, {
        messageType: "request",
        ourLabel,
        payload: { kind: "schedule_request", requestId, from, to },
      });
      if (sendResult.ok) {
        state.lastScheduleRequestByPartner[full.id] = new Date().toISOString();
        result.scheduleRequestsSent++;
      } else {
        result.errors.push(`schedule-request ${full.companyName}: ${sendResult.errorReason ?? "unknown"}`);
      }
    } catch (err) {
      result.errors.push(`schedule-request ${full.companyName}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }));

  saveState(state);
  return result;
}

let lastTriggerMs = 0;
const TRIGGER_INTERVAL_MS = 10 * 60 * 1000; // 10분

// scheduler가 매분 호출. 마지막 실행으로부터 10분 미만 경과면 skip (force=true면 무시).
export async function maybeRunFriendSyncCycle(opts?: { force?: boolean }): Promise<CycleResult | null> {
  const now = Date.now();
  if (!opts?.force && now - lastTriggerMs < TRIGGER_INTERVAL_MS) return null;
  lastTriggerMs = now;
  try {
    const r = await runFriendSyncCycle();
    console.log(`[FriendSync] cycle: partners=${r.totalPartners} alive=${r.pingedOk} sched_sent=${r.scheduleRequestsSent} sched_skip=${r.scheduleRequestsSkipped} profiles_updated=${r.profilesUpdated} errors=${r.errors.length}`);
    return r;
  } catch (err) {
    console.error("[FriendSync] cycle 실패:", err);
    return null;
  }
}

// 단일 partner에 대해 즉시 health ping. UI "지금 핑" 버튼용.
// 자동 사이클(lastTriggerMs)과 독립 — 호출해도 다음 자동 사이클은 지연되지 않음.
export interface PingResult {
  ok: boolean;
  status?: number;
  responseTimeMs: number;
  error?: string;
  lastSeenAt?: string;
}

export async function pingPartnerOnce(partnerId: string): Promise<PingResult> {
  const t0 = Date.now();
  const partner = getPartnerWithTokens(partnerId);
  if (!partner) return { ok: false, responseTimeMs: 0, error: "partner_not_found" };
  if (!partner.active) return { ok: false, responseTimeMs: 0, error: "partner_inactive" };

  try {
    validateApiUrl(partner.apiUrl);
  } catch (err) {
    return { ok: false, responseTimeMs: Date.now() - t0, error: err instanceof Error ? err.message : "invalid_api_url" };
  }
  const url = `${partner.apiUrl.replace(/\/+$/, "")}/api/external/health`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
    const elapsed = Date.now() - t0;
    if (res.ok) {
      touchLastSeen(partnerId);
      const updated = getPartnerWithTokens(partnerId);
      return { ok: true, status: res.status, responseTimeMs: elapsed, lastSeenAt: updated?.lastSeenAt };
    }
    return { ok: false, status: res.status, responseTimeMs: elapsed, error: `http_${res.status}` };
  } catch (err) {
    const elapsed = Date.now() - t0;
    const msg = err instanceof Error ? err.message : "unknown";
    const errorCode = msg.includes("aborted") || msg.includes("AbortError") ? "timeout" : msg;
    return { ok: false, responseTimeMs: elapsed, error: errorCode };
  } finally {
    clearTimeout(timer);
  }
}

// 부팅 시 lastTriggerMs를 디스크 상태에서 복구 (재시작 직후 즉시 재실행 방지)
export function initFriendSyncState(): void {
  const state = loadState();
  if (state.lastCycleAt) {
    const t = new Date(state.lastCycleAt).getTime();
    if (!isNaN(t)) lastTriggerMs = t;
  }
}
