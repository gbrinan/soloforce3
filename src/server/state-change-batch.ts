// scheduler:state-change 적응형 배칭 — 순수 판정 모듈.
//
// ACTIVE(실시간): 최근 N분(기본 10) 안에 사용자 채팅이 있었거나, 실행/대기 중 잡이 있으면
//                 지금처럼 즉시 처리한다.
// IDLE(배칭):     둘 다 없으면 상태 변화를 모았다가 BATCH_MS(기본 5분)마다 «한 번에» 처리한다.
// 활동이 재개되면(=ACTIVE 판정) 모아둔 것을 즉시 내보내고 실시간으로 돌아간다.
//
// 버퍼의 실체: 별도 큐가 아니다. 미보고 잡(reportedToGenie=false, 디스크 영속)이 곧 버퍼다.
// 보고를 미루면 detectChanges 가 다음 tick 에 같은 잡을 다시 집어 올린다. 그래서 재시작·종료에도
// 사건이 사라지지 않는다(종료 시 별도 flush 불필요). 여기서는 «언제 보낼지»만 판정한다.

export type StateChangeMode = "active" | "idle";

export const DEFAULT_ACTIVE_WINDOW_MS = 10 * 60 * 1000;
export const DEFAULT_BATCH_MS = 5 * 60 * 1000;

function envMs(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** SOLOFORCE_STATE_BATCH_MS(0 이면 배칭 끔 = 항상 실시간), SOLOFORCE_STATE_ACTIVE_WINDOW_MS. */
export function batchConfigFromEnv(env: NodeJS.ProcessEnv = process.env): { batchMs: number; activeWindowMs: number } {
  return {
    batchMs: envMs(env.SOLOFORCE_STATE_BATCH_MS, DEFAULT_BATCH_MS),
    activeWindowMs: envMs(env.SOLOFORCE_STATE_ACTIVE_WINDOW_MS, DEFAULT_ACTIVE_WINDOW_MS),
  };
}

export function decideStateChangeMode(i: {
  nowMs: number;
  lastUserMessageMs: number;
  runningOrQueuedJobs: number;
  activeWindowMs?: number;
}): StateChangeMode {
  const win = i.activeWindowMs ?? DEFAULT_ACTIVE_WINDOW_MS;
  if (i.runningOrQueuedJobs > 0) return "active";
  if (i.nowMs - i.lastUserMessageMs < win) return "active";
  return "idle";
}

/**
 * 배칭기 상태. bufferSinceMs = IDLE 에서 첫 사건을 보류한 시각(없으면 undefined).
 * shouldSend 가 send=true 를 주면 호출측이 보내고 markFlushed() 한다.
 */
export class StateChangeBatcher {
  bufferSinceMs: number | undefined;
  constructor(private readonly batchMs: number = DEFAULT_BATCH_MS) {}

  /** 사건이 있는 tick 마다 호출. 지금 보낼지 판정한다. */
  shouldSend(mode: StateChangeMode, nowMs: number): { send: boolean; reason: string } {
    if (this.batchMs <= 0) return { send: true, reason: "batching-disabled" };
    if (mode === "active") {
      return { send: true, reason: this.bufferSinceMs !== undefined ? "activity-resumed-flush" : "realtime" };
    }
    if (this.bufferSinceMs === undefined) {
      this.bufferSinceMs = nowMs;
      return { send: false, reason: "idle-buffer-start" };
    }
    if (nowMs - this.bufferSinceMs >= this.batchMs) return { send: true, reason: "idle-batch-due" };
    return { send: false, reason: "idle-buffering" };
  }

  markFlushed(): void {
    this.bufferSinceMs = undefined;
  }
}
