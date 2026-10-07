// "완료까지 반복" 스텝 실행기.
// 5중 안전장치 중 3가지를 여기서 강제: max_iterations 하드캡, done_condition 게이트(모델 자기선언 금지),
// no_progress_after(진행 없음 감지).
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { platform } from "node:os";
import { getJob } from "../jobs.js";
import { getTask, createRoutineInstance, getOrCreateRoutineMaster, setTaskModel } from "../tasks.js";
import { getTodoById } from "../todos.js";
import { sendMessage } from "../chat.js";
import { checkMidRun, sumRunCost } from "./budget.js";
import { resolveTier } from "../model-tiers.js";
import { DEFAULT_MAX_ITERATIONS, DEFAULT_NO_PROGRESS_AFTER, MAX_ITERATIONS_HARD_CAP, type LoopDefinition, type LoopStep } from "./types.js";

export interface UntilDoneContext {
  runId: string;
  startedAtMs: number;
  buildPrompt: (step: LoopStep, iteration: number) => string;
  /** 매 반복 사이 예산 초과 여부 확인 콜백 — true면 중단 */
  onBudgetCheck: (spentUsd: number) => boolean;
}

export interface UntilDoneResult {
  jobIds: string[];
  iterations: number;
  exitReason: "done" | "max_iterations" | "no_progress" | "budget_exceeded" | "error";
  error?: string;
}

const POLL_INTERVAL_MS = 5_000;
const CHECK_TIMEOUT_MS = 60_000;
const TERMINAL_STATUSES = new Set(["completed", "outputs_missing", "failed"]);

function runCheckCommand(command: string, cwd: string | undefined): Promise<{ exitCode: number; stdout: string }> {
  return new Promise((resolve) => {
    const isWin = platform() === "win32";
    const cmd = isWin ? "cmd" : "sh";
    const args = isWin ? ["/c", command] : ["-c", command];
    execFile(cmd, args, { cwd, timeout: CHECK_TIMEOUT_MS }, (error, stdout) => {
      // exitCode: 정상 종료(에러 없음) → 0. execFile 에러 시 error.code에 숫자 종료코드가 실리는 경우가
      // 있으나(자식이 nonzero exit) 타임아웃/spawn 실패 등은 code가 문자열(errno)이거나 없음 → 그 경우 1로 취급.
      let exitCode = 0;
      if (error) {
        const code = (error as NodeJS.ErrnoException).code;
        exitCode = typeof code === "number" ? code : 1;
      }
      resolve({ exitCode, stdout: stdout ?? "" });
    });
  });
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** 방금 위임한 job이 끝날 때까지 대기 (jobs.ts getJob 상태 폴링). max_duration 예산도 함께 체크. */
async function waitForJobTerminal(
  jobId: string,
  def: LoopDefinition,
  startedAtMs: number,
): Promise<{ ok: boolean; reason?: string }> {
  for (;;) {
    const job = getJob(jobId);
    if (!job) return { ok: false, reason: "job을 찾을 수 없음" };
    if (TERMINAL_STATUSES.has(job.status)) return { ok: true };

    const midCheck = checkMidRun(def, sumRunCost([jobId]), startedAtMs);
    if (!midCheck.ok) return { ok: false, reason: midCheck.reason };

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

/** GenieTask의 todoIds 순회하며 가장 최근 관련 job을 찾는다 (tasks.ts:reportTaskToGenie와 동일 순회 패턴). */
function findLatestJobIdForTask(taskId: string): string | undefined {
  const task = getTask(taskId);
  if (!task) return undefined;
  for (let i = task.todoIds.length - 1; i >= 0; i--) {
    const todo = getTodoById(task.todoIds[i]);
    const jobId = todo?.relatedJobIds?.[todo.relatedJobIds.length - 1];
    if (jobId) return jobId;
  }
  return undefined;
}

export async function runUntilDone(
  def: LoopDefinition,
  step: LoopStep,
  ctx: UntilDoneContext,
): Promise<UntilDoneResult> {
  const maxIterations = Math.min(step.max_iterations ?? DEFAULT_MAX_ITERATIONS, MAX_ITERATIONS_HARD_CAP);
  const noProgressAfter = step.no_progress_after ?? DEFAULT_NO_PROGRESS_AFTER;
  const jobIds: string[] = [];
  let lastHash: string | undefined;
  let noProgressCount = 0;
  const cwd = step.project;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    // 1) 반복마다 예산 재확인
    const spentSoFar = sumRunCost(jobIds);
    if (ctx.onBudgetCheck(spentSoFar)) {
      return { jobIds, iterations: iteration - 1, exitReason: "budget_exceeded" };
    }

    // 2) 위임 1건 dispatch + 완료 대기 (scheduler.ts의 루틴 마스터/인스턴스 + sendMessage 패턴 재사용)
    const master = getOrCreateRoutineMaster(step.prompt, `loop:${def.id}:${step.id}`);
    const instance = createRoutineInstance(master.id, step.prompt);
    // model_tier 실제 고정 — 반복마다 새 인스턴스가 생기므로 매 iteration 저장.
    const resolvedModel = resolveTier(step.model_tier);
    if (resolvedModel) setTaskModel(instance.id, resolvedModel);
    const prompt = ctx.buildPrompt(step, iteration);
    const requestWithMarker = `${prompt}\n\n<!-- ROUTINE_INSTANCE_TASK:${instance.id} -->`;

    try {
      await sendMessage(requestWithMarker, undefined, undefined, { internal: true, source: "loop:until-done" });
    } catch (err) {
      if (!(err instanceof Error && (err.message === "genie_queued" || err.message === "genie_busy"))) {
        return { jobIds, iterations: iteration - 1, exitReason: "error", error: err instanceof Error ? err.message : String(err) };
      }
      // 큐잉된 경우 — job이 언젠가 생성될 것으로 보고 계속 폴링
    }

    // job 생성 대기 (즉시 생성되지 않을 수 있음 — 짧게 폴링)
    let jobId: string | undefined;
    for (let tries = 0; tries < 12 && !jobId; tries++) {
      jobId = findLatestJobIdForTask(instance.id);
      if (!jobId) await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    if (!jobId) {
      return { jobIds, iterations: iteration - 1, exitReason: "error", error: `iteration ${iteration}: job이 생성되지 않음` };
    }
    jobIds.push(jobId);

    const waitResult = await waitForJobTerminal(jobId, def, ctx.startedAtMs);
    if (!waitResult.ok) {
      return { jobIds, iterations: iteration, exitReason: "budget_exceeded", error: waitResult.reason };
    }

    const job = getJob(jobId);
    const resultText = (job?.summary?.trim() || job?.fullResult || job?.content || "").trim();

    // 3) done_condition 게이트 평가 — check 우선, completion_promise는 보조 확인
    let done = false;
    let progressSignal = resultText;
    if (step.done_condition?.check) {
      const { exitCode, stdout } = await runCheckCommand(step.done_condition.check, cwd);
      done = exitCode === 0;
      progressSignal = `${exitCode}:${stdout}`;
    } else if (step.done_condition?.completion_promise) {
      done = resultText.includes(step.done_condition.completion_promise);
    }

    if (done) {
      return { jobIds, iterations: iteration, exitReason: "done" };
    }

    // 4) no-progress 감지 — 게이트 신호(체크 출력 또는 job 결과 텍스트)의 해시 비교
    const currentHash = hashText(progressSignal);
    if (lastHash !== undefined && currentHash === lastHash) {
      noProgressCount++;
      if (noProgressCount >= noProgressAfter) {
        return { jobIds, iterations: iteration, exitReason: "no_progress" };
      }
    } else {
      noProgressCount = 0;
    }
    lastHash = currentHash;
  }

  return { jobIds, iterations: maxIterations, exitReason: "max_iterations" };
}
