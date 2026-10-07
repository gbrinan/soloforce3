// 루프 엔진 진입점: 매분 스케줄러 tick에서 호출되는 checkLoops() +
// 라우트에서 호출하는 runLoopManually().
import { existsSync, statSync } from "node:fs";
import { CronExpressionParser } from "cron-parser";
import { addGenieMessage } from "../chat.js";
import { loadLoops } from "./loader.js";
import { clearStaleBudgetPause } from "./budget.js";
import { loadState, saveState } from "./ledger.js";
import { runLoop } from "./runner.js";
import { DEFAULT_REVIEW_AFTER_DAYS, MAX_CONCURRENT_LOOP_RUNS, type LoopDefinition } from "./types.js";

let runningCount = 0;
let lastExpiryCheckDate: string | undefined;

function isDueNow(def: LoopDefinition, lastFiredKey: string | undefined): { due: boolean; key?: string } {
  if (def.trigger.type !== "cron" || !def.trigger.cron) return { due: false };
  try {
    const interval = CronExpressionParser.parse(def.trigger.cron, { tz: def.trigger.timezone || "Asia/Seoul" });
    const prev = interval.prev().toDate();
    const now = new Date();
    if (Math.abs(now.getTime() - prev.getTime()) >= 60_000) return { due: false };
    // 분 단위 dedup 키 — 같은 분에 중복 실행 방지 (findDueItems의 firedKey 패턴과 동일 원리)
    const key = `${prev.toISOString().slice(0, 16)}`; // YYYY-MM-DDTHH:MM
    if (lastFiredKey === key) return { due: false };
    return { due: true, key };
  } catch (err) {
    console.error(`[LoopEngine] cron 파싱 실패(${def.id}):`, err);
    return { due: false };
  }
}

function checkExpiryNudge(def: LoopDefinition): void {
  const reviewAfterDays = def.expiry?.review_after_days ?? DEFAULT_REVIEW_AFTER_DAYS;
  const state = loadState(def.id);
  const today = new Date().toISOString().slice(0, 10);
  if (lastExpiryCheckDate === today) return; // 하루 1회만 검토 알림 (전역 가드, checkLoops에서 세팅)

  let baselineMs: number | undefined;
  if (state.lastReviewedAt) {
    baselineMs = new Date(state.lastReviewedAt).getTime();
  } else if (def.__filePath && existsSync(def.__filePath)) {
    try {
      baselineMs = statSync(def.__filePath).mtimeMs;
    } catch {
      baselineMs = undefined;
    }
  }
  if (baselineMs === undefined) return;

  const elapsedDays = (Date.now() - baselineMs) / (24 * 60 * 60 * 1000);
  if (elapsedDays < reviewAfterDays) return;

  // 하루 1회 알림 — state에 마지막 알림 날짜를 별도로 남기지 않고 lastExpiryCheckDate(전역, 프로세스 수명)로 근사.
  // 재시작 시 하루 중복 알림 가능성은 있으나 v1에서는 허용 범위(비침습적 리마인더).
  try {
    addGenieMessage(
      `📋 루프 "${def.description || def.id}"가 ${Math.floor(elapsedDays)}일간 검토되지 않았습니다 — 계속 실행할까요? 검토했다면 확인 처리해주세요.`,
    );
  } catch (err) {
    console.error(`[LoopEngine] 검토 알림 실패(${def.id}):`, err);
  }
}

export async function checkLoops(): Promise<void> {
  let loops: LoopDefinition[] = [];
  try {
    const result = loadLoops();
    loops = result.loops;
    for (const e of result.errors) {
      console.error(`[LoopEngine] 정의 파일 오류 (${e.file}): ${e.message}`);
    }
  } catch (err) {
    console.error("[LoopEngine] loadLoops 실패:", err);
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const runExpiryCheckThisTick = lastExpiryCheckDate !== today;

  for (const def of loops) {
    try {
      if (def.enabled === false) continue;

      const state = loadState(def.id);
      // [2026-08-15 P0 F-3] 지난 달 예산 자동 정지는 여기서 푼다.
      // ★ 이 게이트가 cron 경로의 실제 차단 지점이다 — runLoop()/checkPreRun()보다 앞서므로
      //   budget.ts만 고치면 cron 루프는 그대로 영구 정지로 남는다.
      if (clearStaleBudgetPause(state)) {
        saveState(def.id, state);
        console.log(`[LoopEngine] 월 롤오버 — 루프 "${def.id}" 예산 자동 정지 해제 (지난달 지출 $${(state.monthSpend?.usd ?? 0).toFixed(2)})`);
      }
      if (state.paused) continue;

      if (runExpiryCheckThisTick) {
        checkExpiryNudge(def);
      }

      if (def.trigger.type !== "cron") continue;
      const { due, key } = isDueNow(def, state.lastFiredKey);
      if (!due) continue;

      if (runningCount >= MAX_CONCURRENT_LOOP_RUNS) {
        console.log(`[LoopEngine] 동시 실행 한도(${MAX_CONCURRENT_LOOP_RUNS}) 도달 — 루프 "${def.id}" 이번 tick 스킵`);
        continue;
      }

      state.lastFiredKey = key;
      saveState(def.id, state);

      runningCount++;
      runLoop(def, "cron")
        .catch((err) => console.error(`[LoopEngine] 루프 실행 실패(${def.id}):`, err))
        .finally(() => { runningCount--; });
    } catch (err) {
      console.error(`[LoopEngine] 루프 처리 중 오류(${def.id}):`, err);
    }
  }

  if (runExpiryCheckThisTick) lastExpiryCheckDate = today;
}

export async function runLoopManually(loopId: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const { loops } = loadLoops();
    const def = loops.find((l) => l.id === loopId);
    if (!def) return { ok: false, message: "루프를 찾을 수 없습니다" };

    if (runningCount >= MAX_CONCURRENT_LOOP_RUNS) {
      return { ok: false, message: "동시 실행 한도에 도달했습니다. 잠시 후 다시 시도하세요." };
    }

    runningCount++;
    runLoop(def, "manual")
      .catch((err) => console.error(`[LoopEngine] 수동 루프 실행 실패(${loopId}):`, err))
      .finally(() => { runningCount--; });

    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
