// 아난다라 → MyCrew 일정 단방향 동기화 (2026-07-18)
//
// 아난다라(강사 교육 캘린더, Supabase)의 교육 일정을 MyCrew 일정(schedules.json)에 반영해
// 대시보드 예약/일정 패널과 schedules-notifier 알림에서 교육 일정이 함께 보이게 한다.
//
// 설계:
// - 소스 오브 트루스는 아난다라 — 여기서는 읽기만 하고, 아난다라 쪽 데이터는 절대 수정하지 않는다.
// - 아난다라의 기존 내부 API GET /api/mycrew/educations?month=YYYY-MM 사용 (ssoToken 검증 —
//   서버 내부이므로 createSSOToken으로 소유자 토큰을 직접 발급해 전달).
// - 동기화 창: 이번 달 포함 3개월. 항목 식별은 description 끝의 `[anandara:<eduId>]` 마커.
// - upsert: 마커 매칭으로 생성/갱신, 동기화 창 안에서 사라진 교육의 일정은 삭제(취소 반영).
// - 실패는 조용히 로그만 — 아난다라가 꺼져 있어도 MyCrew 본체에 영향 없음. 다음 주기에 재시도.
import { createSSOToken } from "./sso-token.js";
import { listInRange, createSchedule, updateSchedule, deleteSchedule } from "./schedules.js";

const ANANDARA_BASE = process.env.ANANDARA_BASE_URL || "http://127.0.0.1:13210";
const OWNER_EMAIL = process.env.MYCREW_OWNER_EMAIL || "gbrielkim@gmail.com";
const SYNC_INTERVAL_MS = 24 * 60 * 60_000; // 하루 1회 (수동 동기화는 POST /api/anandara-sync)
const SYNC_MONTHS = 3;                // 이번 달 포함 3개월
const MARKER_RE = /\[anandara:([0-9a-f-]{36})\]/;

interface AnandaraEducation {
  id: string;
  edu_date: string;    // YYYY-MM-DD
  start_time: string;  // HH:MM(:SS)
  end_time: string;
  client_name: string;
  topic?: string | null;
  location?: string | null;
  status?: string;
}

let timer: NodeJS.Timeout | null = null;

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function toIso(dateStr: string, timeStr: string): string {
  const t = timeStr.length === 5 ? `${timeStr}:00` : timeStr;
  return `${dateStr}T${t}+09:00`; // 교육 일정은 KST 기준
}

async function fetchMonth(month: string): Promise<AnandaraEducation[] | null> {
  try {
    const token = createSSOToken(OWNER_EMAIL);
    const res = await fetch(
      `${ANANDARA_BASE}/api/apps/anandara/proxy/api/mycrew/educations?month=${month}&ssoToken=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) return null;
    const data = await res.json() as { ok?: boolean; educations?: AnandaraEducation[] };
    if (!data.ok || !Array.isArray(data.educations)) return null;
    return data.educations;
  } catch {
    return null; // 앱 미기동 등 — 다음 주기에 재시도
  }
}

export async function syncAnandaraSchedules(): Promise<{ created: number; updated: number; deleted: number } | null> {
  // 1) 동기화 창의 교육 수집
  const months: string[] = [];
  const now = new Date();
  for (let i = 0; i < SYNC_MONTHS; i++) {
    months.push(monthKey(new Date(now.getFullYear(), now.getMonth() + i, 1)));
  }
  const edus = new Map<string, AnandaraEducation>();
  let anyOk = false;
  const okMonths = new Set<string>();
  for (const m of months) {
    const rows = await fetchMonth(m);
    if (rows === null) continue;
    anyOk = true;
    okMonths.add(m);
    for (const e of rows) if (e?.id && e.edu_date && e.start_time && e.end_time) edus.set(e.id, e);
  }
  if (!anyOk) return null; // 전 월 실패 → 삭제 판단 불가하므로 아무것도 안 건드림

  // 2) 기존 동기화 일정 인덱스 (마커 기준)
  const windowFrom = `${months[0]}-01T00:00:00+09:00`;
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() + SYNC_MONTHS, 1);
  const windowTo = `${monthKey(lastMonthStart)}-01T00:00:00+09:00`;
  const existing = new Map<string, { id: string; title: string; start: string; end: string; description?: string; location?: string }>();
  for (const s of listInRange(windowFrom, windowTo, "me")) {
    const m = s.description?.match(MARKER_RE);
    if (m) existing.set(m[1], s);
  }

  // 3) upsert
  let created = 0, updated = 0, deleted = 0;
  for (const [eduId, e] of edus) {
    const title = `[교육] ${e.client_name}${e.topic && e.topic !== e.client_name ? ` — ${e.topic}` : ""}`.slice(0, 120);
    const start = toIso(e.edu_date, e.start_time);
    const end = toIso(e.edu_date, e.end_time);
    const description = `아난다라 교육 일정 (자동 동기화)${e.status && e.status !== "scheduled" ? ` · 상태: ${e.status}` : ""} [anandara:${eduId}]`;
    const cur = existing.get(eduId);
    if (!cur) {
      const r = createSchedule({ title, start, end, description, location: e.location ?? undefined, color: "green" });
      if (r.ok) created++;
    } else if (cur.title !== title || cur.start !== start || cur.end !== end || cur.location !== (e.location ?? undefined) || cur.description !== description.trim()) {
      const r = updateSchedule(cur.id, { title, start, end, description, location: e.location ?? undefined });
      if (r.ok) updated++;
    }
    existing.delete(eduId);
  }
  // 4) 동기화 창 안에서 아난다라에 더 이상 없는 항목 = 취소/삭제된 교육 → 일정도 제거
  //    단, fetch 실패한 달의 일정은 stale로 단정할 수 없으므로 삭제 대상에서 제외한다.
  for (const [, stale] of existing) {
    if (!okMonths.has(monthKey(new Date(stale.start)))) continue;
    const r = deleteSchedule(stale.id);
    if (r.ok) deleted++;
  }

  if (created || updated || deleted) {
    console.log(`[AnandaraSync] 교육→일정 동기화: +${created} ~${updated} -${deleted} (${months.join(",")})`);
  }
  return { created, updated, deleted };
}

export function startAnandaraSync(): void {
  if (timer) return;
  // 부팅 직후엔 아난다라 앱이 아직 안 떠 있을 수 있어 90초 뒤 첫 실행
  setTimeout(() => { void syncAnandaraSchedules(); }, 90_000).unref?.();
  timer = setInterval(() => { void syncAnandaraSchedules(); }, SYNC_INTERVAL_MS);
  timer.unref?.();
  console.log("[AnandaraSync] 시작 (일 1회 주기, 3개월 창, 수동: POST /api/anandara-sync)");
}

export function stopAnandaraSync(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
