// 친구 일정 공유 요청 (outbound) 추적.
// 메모리 Map + history/schedule-requests.jsonl 영속.
// 1시간 timeout cron으로 응답 없으면 expired 마크 + 사용자 알림.

import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HISTORY_DIR } from "../config.js";

export type ScheduleRequestStatus = "pending" | "received" | "expired";

export interface ScheduleRequest {
  requestId: string;
  partnerId: string;
  from: string;       // ISO8601
  to: string;         // ISO8601
  sentAt: string;     // ISO8601
  status: ScheduleRequestStatus;
  resolvedAt?: string;
  schedulesReceived?: number;
}

const REQUESTS_FILE = join(HISTORY_DIR, "schedule-requests.jsonl");
const requests = new Map<string, ScheduleRequest>();

const TIMEOUT_MS = 60 * 60 * 1000;     // 1시간
const CRON_INTERVAL_MS = 5 * 60 * 1000; // 5분

type PartnerNameResolver = (partnerId: string) => string;
type ExpireNotifier = (msg: string) => void;

let onExpireNotify: ExpireNotifier | null = null;
let resolvePartnerName: PartnerNameResolver = (id) => id.slice(0, 8);

export function setScheduleRequestExpireNotifier(fn: ExpireNotifier): void {
  onExpireNotify = fn;
}

export function setPartnerNameResolver(fn: PartnerNameResolver): void {
  resolvePartnerName = fn;
}

function ensureDir(): void {
  if (!existsSync(HISTORY_DIR)) mkdirSync(HISTORY_DIR, { recursive: true });
}

function appendLine(entry: ScheduleRequest): void {
  try {
    ensureDir();
    appendFileSync(REQUESTS_FILE, JSON.stringify(entry) + "\n");
  } catch (err) {
    console.error("[ScheduleRequests] 영속 실패:", err);
  }
}

export function loadScheduleRequests(): void {
  if (!existsSync(REQUESTS_FILE)) return;
  try {
    const text = readFileSync(REQUESTS_FILE, "utf-8");
    const lines = text.split("\n").filter((l) => l.trim());
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as ScheduleRequest;
        if (entry && entry.requestId) {
          // append-only: 마지막 항목이 최신 상태
          requests.set(entry.requestId, entry);
        }
      } catch { /* skip malformed */ }
    }
    console.log(`[ScheduleRequests] 복원 ${requests.size}건`);
  } catch (err) {
    console.error("[ScheduleRequests] 로드 실패:", err);
  }
}

export function savePendingScheduleRequest(input: {
  requestId: string;
  partnerId: string;
  from: string;
  to: string;
}): ScheduleRequest {
  const entry: ScheduleRequest = {
    requestId: input.requestId,
    partnerId: input.partnerId,
    from: input.from,
    to: input.to,
    sentAt: new Date().toISOString(),
    status: "pending",
  };
  requests.set(entry.requestId, entry);
  appendLine(entry);
  return entry;
}

export function getPendingScheduleRequest(requestId: string | undefined): ScheduleRequest | null {
  if (!requestId) return null;
  const r = requests.get(requestId);
  if (!r || r.status !== "pending") return null;
  return r;
}

export function resolveScheduleRequest(
  requestId: string,
  status: "received" | "expired",
  schedulesReceived?: number,
): void {
  const cur = requests.get(requestId);
  if (!cur) return;
  if (cur.status !== "pending") return;
  const next: ScheduleRequest = {
    ...cur,
    status,
    resolvedAt: new Date().toISOString(),
    schedulesReceived,
  };
  requests.set(requestId, next);
  appendLine(next);
}

function checkExpired(): void {
  const now = Date.now();
  for (const r of requests.values()) {
    if (r.status !== "pending") continue;
    const age = now - new Date(r.sentAt).getTime();
    if (age < TIMEOUT_MS) continue;
    resolveScheduleRequest(r.requestId, "expired");
    const name = resolvePartnerName(r.partnerId);
    onExpireNotify?.(
      `⚠️ ${name} 일정 공유 응답이 1시간 내 도착하지 않았습니다. 상대 시스템이 다른 코드베이스이거나 자비스가 꺼져있을 수 있어요.`,
    );
  }
}

let cronStarted = false;
export function startScheduleRequestCron(): void {
  if (cronStarted) return;
  cronStarted = true;
  setInterval(checkExpired, CRON_INTERVAL_MS).unref();
}

// 디버그/UI용 — 전체 요청 조회
export function listScheduleRequests(): ScheduleRequest[] {
  return Array.from(requests.values()).sort((a, b) => b.sentAt.localeCompare(a.sentAt));
}
