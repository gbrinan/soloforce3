import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HISTORY_DIR } from "../config.js";
import type { SharedSchedule } from "../types.js";

export type ScheduleColor = "blue" | "green" | "red" | "yellow" | "violet" | "orange";

const VALID_COLORS: ReadonlySet<ScheduleColor> = new Set(["blue", "green", "red", "yellow", "violet", "orange"]);
const MAX_FRIEND_SCHEDULES = 1000;
const MAX_TITLE_LENGTH = 200;

// 알림 설정 — chat=true면 시작 minutesBefore분 전 데어스가 대화창 안내,
// toast=true면 같은 시점 우측 상단 토스트 팝업(클라이언트 전용, scheduler는 무관)
export interface ScheduleNotification {
  chat?: boolean;
  toast?: boolean;
  minutesBefore?: number;
}

// chat 또는 toast 중 하나라도 켜졌을 때만 정규화된 객체 반환. minutesBefore는 0~1440분 clamp(기본 10).
function normalizeNotification(n: ScheduleNotification | undefined): ScheduleNotification | undefined {
  if (!n || (!n.chat && !n.toast)) return undefined;
  let m = typeof n.minutesBefore === "number" && isFinite(n.minutesBefore) ? Math.round(n.minutesBefore) : 10;
  if (m < 0) m = 0;
  if (m > 1440) m = 1440;
  return { chat: !!n.chat, toast: !!n.toast, minutesBefore: m };
}

export interface Schedule {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  description?: string;
  location?: string;
  color?: ScheduleColor;
  owner: "me" | string;
  createdAt: string;
  updatedAt: string;
  notification?: ScheduleNotification;
}

const SCHEDULES_FILE = join(HISTORY_DIR, "schedules.json");
const schedules = new Map<string, Schedule>();

export function loadSchedules(): void {
  if (!existsSync(SCHEDULES_FILE)) return;
  try {
    const arr = JSON.parse(readFileSync(SCHEDULES_FILE, "utf-8")) as Schedule[];
    if (!Array.isArray(arr)) return;
    for (const s of arr) {
      if (s.id && s.title && s.start && s.end) schedules.set(s.id, s);
    }
    console.log(`[Schedules] 복원 ${schedules.size}건`);
  } catch (err) {
    console.error("[Schedules] 로드 실패:", err);
  }
}

function saveSchedules(): void {
  try {
    if (!existsSync(HISTORY_DIR)) mkdirSync(HISTORY_DIR, { recursive: true });
    writeFileSync(SCHEDULES_FILE, JSON.stringify(Array.from(schedules.values()), null, 2));
  } catch (err) {
    console.error("[Schedules] 저장 실패:", err);
  }
}

function isValidIso(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const d = new Date(s);
  return !isNaN(d.getTime());
}

export function listInRange(
  from?: string,
  to?: string,
  owner?: "me" | "friends" | "all",
): Schedule[] {
  const fromTs = from && isValidIso(from) ? new Date(from).getTime() : -Infinity;
  const toTs = to && isValidIso(to) ? new Date(to).getTime() : Infinity;
  const result: Schedule[] = [];
  for (const s of schedules.values()) {
    const sStart = new Date(s.start).getTime();
    const sEnd = new Date(s.end).getTime();
    if (sEnd < fromTs || sStart > toTs) continue;
    if (owner === "me" && s.owner !== "me") continue;
    if (owner === "friends" && s.owner === "me") continue;
    result.push(s);
  }
  result.sort((a, b) => a.start.localeCompare(b.start));
  return result;
}

export function getSchedule(id: string): Schedule | undefined {
  return schedules.get(id);
}

export interface CreateScheduleInput {
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  description?: string;
  location?: string;
  color?: ScheduleColor;
  notification?: ScheduleNotification;
}

export function createSchedule(input: CreateScheduleInput): { ok: true; schedule: Schedule } | { ok: false; error: string } {
  const title = input.title?.trim();
  if (!title) return { ok: false, error: "title required" };
  if (!isValidIso(input.start) || !isValidIso(input.end)) {
    return { ok: false, error: "start/end must be ISO8601" };
  }
  if (new Date(input.end).getTime() < new Date(input.start).getTime()) {
    return { ok: false, error: "end must be >= start" };
  }
  const now = new Date().toISOString();
  const s: Schedule = {
    id: randomUUID(),
    title,
    start: input.start,
    end: input.end,
    allDay: !!input.allDay,
    description: input.description?.trim() || undefined,
    location: input.location?.trim() || undefined,
    color: input.color,
    owner: "me",
    createdAt: now,
    updatedAt: now,
    notification: normalizeNotification(input.notification),
  };
  schedules.set(s.id, s);
  saveSchedules();
  return { ok: true, schedule: s };
}

export function updateSchedule(
  id: string,
  patch: Partial<CreateScheduleInput>,
): { ok: true; schedule: Schedule } | { ok: false; error: string } {
  const cur = schedules.get(id);
  if (!cur) return { ok: false, error: "not found" };
  if (cur.owner !== "me") return { ok: false, error: "friend schedule cannot be modified" };

  const next: Schedule = { ...cur, updatedAt: new Date().toISOString() };
  if (patch.title !== undefined) {
    const t = patch.title.trim();
    if (!t) return { ok: false, error: "title required" };
    next.title = t;
  }
  if (patch.start !== undefined) {
    if (!isValidIso(patch.start)) return { ok: false, error: "start must be ISO8601" };
    next.start = patch.start;
  }
  if (patch.end !== undefined) {
    if (!isValidIso(patch.end)) return { ok: false, error: "end must be ISO8601" };
    next.end = patch.end;
  }
  if (new Date(next.end).getTime() < new Date(next.start).getTime()) {
    return { ok: false, error: "end must be >= start" };
  }
  if (patch.allDay !== undefined) next.allDay = !!patch.allDay;
  if (patch.description !== undefined) next.description = patch.description.trim() || undefined;
  if (patch.location !== undefined) next.location = patch.location.trim() || undefined;
  if (patch.color !== undefined) next.color = patch.color;
  if (patch.notification !== undefined) next.notification = normalizeNotification(patch.notification);

  schedules.set(id, next);
  saveSchedules();
  return { ok: true, schedule: next };
}

export function deleteSchedule(id: string): { ok: true } | { ok: false; error: string } {
  const cur = schedules.get(id);
  if (!cur) return { ok: false, error: "not found" };
  if (cur.owner !== "me") return { ok: false, error: "friend schedule cannot be deleted" };
  schedules.delete(id);
  saveSchedules();
  return { ok: true };
}

// 내 일정을 SharedSchedule[]로 직렬화 (외부 공유용 — owner/timestamp 제외)
export function exportMySchedulesForShare(from?: string, to?: string): SharedSchedule[] {
  const fromTs = from && isValidIso(from) ? new Date(from).getTime() : -Infinity;
  const toTs = to && isValidIso(to) ? new Date(to).getTime() : Infinity;
  const out: SharedSchedule[] = [];
  for (const s of schedules.values()) {
    if (s.owner !== "me") continue;
    const sStart = new Date(s.start).getTime();
    const sEnd = new Date(s.end).getTime();
    if (sEnd < fromTs || sStart > toTs) continue;
    out.push({
      id: s.id,
      title: s.title,
      start: s.start,
      end: s.end,
      allDay: s.allDay,
      description: s.description,
      location: s.location,
      color: s.color,
    });
    if (out.length >= MAX_FRIEND_SCHEDULES) break;
  }
  return out;
}

// 친구 일정 영속화 — 범위 기반 replace
// 동일 partnerId + 범위 겹침인 기존 일정 삭제 후 새 list 적재
export function replaceFriendSchedules(
  partnerId: string,
  from: string,
  to: string,
  list: SharedSchedule[],
): { ok: true; saved: number } | { ok: false; error: string } {
  if (!partnerId || typeof partnerId !== "string") return { ok: false, error: "partnerId required" };
  if (partnerId === "me") return { ok: false, error: "partnerId cannot be 'me'" };
  if (!isValidIso(from) || !isValidIso(to)) return { ok: false, error: "from/to must be ISO8601" };
  if (!Array.isArray(list)) return { ok: false, error: "list must be array" };
  if (list.length > MAX_FRIEND_SCHEDULES) return { ok: false, error: `list exceeds max ${MAX_FRIEND_SCHEDULES}` };

  const fromTs = new Date(from).getTime();
  const toTs = new Date(to).getTime();

  // 기존 친구 일정 중 같은 partnerId + 범위 겹침 제거
  for (const [id, s] of schedules) {
    if (s.owner !== partnerId) continue;
    const sStart = new Date(s.start).getTime();
    const sEnd = new Date(s.end).getTime();
    if (sEnd < fromTs || sStart > toTs) continue;
    schedules.delete(id);
  }

  // 새 list 적재 — id 충돌 방지: `${partnerId}:${originalId}`
  const now = new Date().toISOString();
  let saved = 0;
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const title = typeof raw.title === "string" ? raw.title.trim().slice(0, MAX_TITLE_LENGTH) : "";
    if (!title) continue;
    if (!isValidIso(raw.start) || !isValidIso(raw.end)) continue;
    if (new Date(raw.end).getTime() < new Date(raw.start).getTime()) continue;
    const origId = typeof raw.id === "string" && raw.id ? raw.id : randomUUID();
    const id = `${partnerId}:${origId}`;
    const color = raw.color && VALID_COLORS.has(raw.color) ? raw.color : undefined;
    schedules.set(id, {
      id,
      title,
      start: raw.start,
      end: raw.end,
      allDay: !!raw.allDay,
      description: typeof raw.description === "string" ? raw.description.slice(0, 1000) : undefined,
      location: typeof raw.location === "string" ? raw.location.slice(0, 200) : undefined,
      color,
      owner: partnerId,
      createdAt: now,
      updatedAt: now,
    });
    saved++;
  }
  saveSchedules();
  return { ok: true, saved };
}
