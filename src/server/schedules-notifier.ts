// Schedule imminent-alert notifier.
// Runs every 60 s, checks schedules whose notification.minutesBefore threshold is crossed.
// Idempotency key = `sched_${id}_${start}` — prevents duplicate alerts on restart (R4).

import { listInRange } from "./schedules.js";
import { emitNotification, purgeExpiredNotifications } from "./notifications.js";

const TICK_MS = 60_000;
// minutesBefore는 schedules.ts에서 0~1440분(최대 24h)으로 clamp되므로, 25h 창이면
// 알림 시점(start - minutesBefore)이 도래한 모든 항목을 반드시 조회창에 포함할 수 있다.
const LOOK_AHEAD_MS = 25 * 60 * 60 * 1000; // scan 25 h ahead (24h 최대 리드 + 1h 여유)

let tickTimer: NodeJS.Timeout | null = null;

function tick(): void {
  const now = new Date();
  const from = now.toISOString();
  const to = new Date(now.getTime() + LOOK_AHEAD_MS).toISOString();

  let schedules;
  try {
    schedules = listInRange(from, to, "me");
  } catch (err) {
    console.warn("[SchedulesNotifier] listInRange 실패:", err);
    return;
  }

  for (const s of schedules) {
    if (typeof s.notification?.minutesBefore !== "number") continue;
    const alertMs = new Date(s.start).getTime() - s.notification.minutesBefore * 60 * 1000;
    // Catch-up: 알림 시점이 도래한 미발화 항목을 발화. 단일 60s 윈도우 대신 alertMs<=now 비교라
    // 틱 누락/서버 재시작에도 누락 없이 발화되고, 중복은 idempotencyKey(sched_id_start)로
    // emitNotification이 no-op 처리하여 차단한다.
    if (now.getTime() >= alertMs) {
      const mins = s.notification.minutesBefore;
      const label = mins >= 60 ? `${mins / 60}시간` : `${mins}분`;
      emitNotification({
        kind: "schedule",
        title: `📅 ${s.title}`,
        body: `${label} 후 시작합니다.`,
        deepLink: { panel: "schedules" },
        source: { appId: "host", refId: s.id },
        idempotencyKey: `sched_${s.id}_${s.start}`, // R4 dedup
      });
    }
  }

  // Hourly purge of expired notifications (run on every ~60th tick ≈ 1 h)
  // Simple check: run when minute is 0 (top of hour within a 60 s window).
  if (now.getMinutes() === 0) {
    const purged = purgeExpiredNotifications();
    if (purged.length > 0) {
      console.log(`[SchedulesNotifier] purgeExpired: ${purged.length}건 삭제`);
    }
  }
}

export function startSchedulesNotifier(): void {
  if (tickTimer) return;
  tick(); // run immediately on start
  tickTimer = setInterval(tick, TICK_MS);
  console.log("[SchedulesNotifier] 시작 (60s 간격)");
}

export function stopSchedulesNotifier(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}
