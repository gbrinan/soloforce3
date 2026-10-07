/**
 * watchdog.ts — 멈춤 감시 단일화 (Phase 2).
 *
 * 기획: history/outputs/planner-researcher/worker-redesign-2026-05-22.md §4, §7-2
 *
 * 매분 1회, 워커 시스템의 "멈춤"을 한 곳에서 감시한다. 세 점검을 통합:
 *  1) lease 만료 회수      — checkExpiredLeases (jobs.ts). 인터랙티브는 ptyAdapter.abort(ESC).
 *  2) 큐 정체 cascade 정리  — sweepStuckQueueOnBoot (jobs.ts). 선행 실패 → 후속 queued cascade fail.
 *                            (idempotent: 정리 후 queued가 아니므로 재실행해도 no-op. 부팅 1회는
 *                             jobs.ts 부팅 경로에서 별도 호출.)
 *  3) open 고아 알림        — runStuckCheck (todo-monitor.ts). received/plan_review 정체를
 *                            "상태"가 아니라 "알림 이벤트"로만 처리(state 미변경).
 */
import { checkExpiredLeases, sweepStuckQueueOnBoot, triggerProcessQueue } from "./jobs.js";
import { runStuckCheck, runBacklogDigest } from "./todo-monitor.js";
import { sweepZombieWorkerPtys } from "./worker-pty.js";
import { isGeniePtyHealthy, ptyRespawnForReset } from "./terminal-ws.js";

/**
 * 좀비/소켓끊김 PTY 정리 — 워커 + 마이크루.
 * 워치독·부팅 hook이 호출. 워커는 force terminate+맵제거, 마이크루는 force terminate+재spawn.
 */
export async function sweepZombiePtys(): Promise<number> {
  let cleaned = 0;
  try {
    cleaned += sweepZombieWorkerPtys();
  } catch (e) {
    console.error("[Watchdog] sweepZombieWorkerPtys 실패:", e instanceof Error ? e.message : e);
  }
  // 마이크루 PTY: 한 번도 spawn 안 된 상태(부팅 직후)면 isGeniePtyHealthy=false지만 정리 대상 아님.
  // ready 기준은 isHealthy 내부의 proc 존재 검사로 충분 — proc 없으면 healthy=false이지만,
  // 그땐 ptyRespawnForReset를 굳이 부르지 않아도 다음 WebSocket 연결이 ensureReady 호출.
  // → "ready이지만 unhealthy" 케이스만 좀비로 본다.
  try {
    const { isPtyReady } = await import("./terminal-ws.js");
    if (isPtyReady() && !isGeniePtyHealthy()) {
      console.warn("[Watchdog] 마이크루 PTY 좀비 감지 — force respawn");
      await ptyRespawnForReset();
      cleaned++;
    }
  } catch (e) {
    console.error("[Watchdog] 마이크루 PTY sweep 실패:", e instanceof Error ? e.message : e);
  }
  if (cleaned > 0) console.log(`[Watchdog] PTY 좀비 ${cleaned}건 정리`);
  return cleaned;
}

/** 매분 호출 — lease 만료 회수 + 큐 정체 정리 + open 고아 감지·알림 + PTY 좀비 정리 + 백로그 일일점검. */
export async function runWatchdog(): Promise<void> {
  checkExpiredLeases();
  sweepStuckQueueOnBoot();
  // 상류 세션 한도로 지연된 잡(deferredUntilMs)은 외부 이벤트 없이도 재개돼야 한다.
  // 매분 큐를 한 번 두드려 재개 시각이 지난 잡을 집게 한다 (processQueue는 재진입 락으로 보호됨).
  triggerProcessQueue();
  await sweepZombiePtys();
  await runStuckCheck();
  await runBacklogDigest(); // 내부 게이트로 하루 1회만 실제 발화
}
