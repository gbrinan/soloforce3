// 루프 정의 로더: <MYCREW_HOME>/loops/*.yaml|*.yml|*.json 를 읽어 LoopDefinition[]으로 파싱.
// 파일 하나가 깨져도 전체 로딩이 죽지 않도록 개별 try/catch — 스케줄러 tick을 절대 막지 않는다.
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { CronExpressionParser } from "cron-parser";
import { HISTORY_DIR } from "../../config.js";
import {
  MAX_ITERATIONS_HARD_CAP,
  type LoopDefinition,
  type LoopLoadResult,
  type LoopStep,
} from "./types.js";

// HISTORY_DIR = <MYCREW_HOME>/history → loops 디렉터리는 그 형제 디렉터리인 <MYCREW_HOME>/loops.
export const LOOPS_DEFINITIONS_DIR = join(dirname(HISTORY_DIR), "loops");

function ensureLoopsDir(): void {
  try {
    if (!existsSync(LOOPS_DEFINITIONS_DIR)) mkdirSync(LOOPS_DEFINITIONS_DIR, { recursive: true });
  } catch (err) {
    console.error("[LoopEngine] loops 디렉터리 생성 실패:", err);
  }
}

function isValidCron(expr: string): boolean {
  try {
    CronExpressionParser.parse(expr, { tz: "Asia/Seoul" });
    return true;
  } catch {
    return false;
  }
}

function validateStep(step: unknown, index: number): { ok: true; step: LoopStep } | { ok: false; message: string } {
  if (!step || typeof step !== "object") {
    return { ok: false, message: `steps[${index}]: 객체가 아닙니다` };
  }
  const s = step as Record<string, unknown>;
  if (typeof s.id !== "string" || !s.id.trim()) {
    return { ok: false, message: `steps[${index}]: id 필수` };
  }
  if (typeof s.prompt !== "string" || !s.prompt.trim()) {
    return { ok: false, message: `steps[${index}](${s.id}): prompt 필수` };
  }
  const type = (s.type as string) ?? "task";
  if (type !== "task" && type !== "until_done") {
    return { ok: false, message: `steps[${index}](${s.id}): type은 task|until_done만 허용` };
  }
  if (type === "until_done") {
    const doneCondition = s.done_condition as Record<string, unknown> | undefined;
    const hasCheck = typeof doneCondition?.check === "string" && doneCondition.check.trim().length > 0;
    const hasPromise = typeof doneCondition?.completion_promise === "string" && doneCondition.completion_promise.trim().length > 0;
    // 모델이 스스로 "완료"를 선언하지 못하도록 게이트 필수 — check 또는 completion_promise 중 최소 하나.
    if (!hasCheck && !hasPromise) {
      return { ok: false, message: `steps[${index}](${s.id}): until_done은 done_condition.check 또는 completion_promise 중 최소 하나 필수` };
    }
  }
  let maxIterations = typeof s.max_iterations === "number" ? s.max_iterations : undefined;
  if (maxIterations !== undefined && maxIterations > MAX_ITERATIONS_HARD_CAP) {
    maxIterations = MAX_ITERATIONS_HARD_CAP;
  }
  return {
    ok: true,
    step: {
      id: s.id as string,
      prompt: s.prompt as string,
      agent: typeof s.agent === "string" ? s.agent : undefined,
      project: typeof s.project === "string" ? s.project : undefined,
      type: type as LoopStep["type"],
      model_tier: (s.model_tier as LoopStep["model_tier"]) ?? undefined,
      done_condition: s.done_condition as LoopStep["done_condition"],
      max_iterations: maxIterations,
      no_progress_after: typeof s.no_progress_after === "number" ? s.no_progress_after : undefined,
      skip_output: typeof s.skip_output === "boolean" ? s.skip_output : undefined,
    },
  };
}

function validateLoop(raw: unknown, file: string): { ok: true; def: LoopDefinition } | { ok: false; message: string } {
  if (!raw || typeof raw !== "object") return { ok: false, message: "빈 파일이거나 객체가 아닙니다" };
  const obj = raw as Record<string, unknown>;
  const loop = (obj.loop ?? obj) as Record<string, unknown>; // "loop:" 최상위 래핑 허용 + 미래환 대비 언래핑도 허용

  if (typeof loop.id !== "string" || !loop.id.trim()) {
    return { ok: false, message: "loop.id 필수" };
  }

  const trigger = loop.trigger as Record<string, unknown> | undefined;
  if (!trigger || (trigger.type !== "cron" && trigger.type !== "manual")) {
    return { ok: false, message: "loop.trigger.type은 cron|manual 필수" };
  }
  if (trigger.type === "cron") {
    if (typeof trigger.cron !== "string" || !trigger.cron.trim()) {
      return { ok: false, message: "trigger.type=cron이면 trigger.cron 필수" };
    }
    if (!isValidCron(trigger.cron)) {
      return { ok: false, message: `trigger.cron 파싱 실패: "${trigger.cron}"` };
    }
  }

  const stepsRaw = loop.steps;
  if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) {
    return { ok: false, message: "loop.steps는 비어있지 않은 배열이어야 함" };
  }
  const steps: LoopStep[] = [];
  for (let i = 0; i < stepsRaw.length; i++) {
    const v = validateStep(stepsRaw[i], i);
    if (!v.ok) return { ok: false, message: v.message };
    steps.push(v.step);
  }

  const deliveryRaw = loop.delivery as Record<string, unknown> | undefined;
  const onSuccess = deliveryRaw?.on_success;

  const def: LoopDefinition = {
    id: loop.id as string,
    version: typeof loop.version === "string" ? loop.version : undefined,
    owner: typeof loop.owner === "string" ? loop.owner : undefined,
    description: typeof loop.description === "string" ? loop.description : undefined,
    enabled: typeof loop.enabled === "boolean" ? loop.enabled : true,
    trigger: {
      type: trigger.type as "cron" | "manual",
      cron: typeof trigger.cron === "string" ? trigger.cron : undefined,
      timezone: typeof trigger.timezone === "string" ? trigger.timezone : "Asia/Seoul",
      catch_up: "skip",
    },
    session: loop.session as LoopDefinition["session"],
    steps,
    budget: loop.budget as LoopDefinition["budget"],
    approval: {
      mode: (loop.approval as Record<string, unknown> | undefined)?.mode === "auto" ? "auto" : "draft_only",
    },
    delivery: {
      on_success: onSuccess === "full" || onSuccess === "silent" ? onSuccess : "summary",
      on_failure: "full",
    },
    expiry: loop.expiry as LoopDefinition["expiry"],
    __filePath: file,
  };

  return { ok: true, def };
}

export function loadLoops(): LoopLoadResult {
  ensureLoopsDir();
  const loops: LoopDefinition[] = [];
  const errors: Array<{ file: string; message: string }> = [];
  const seenIds = new Set<string>();

  let files: string[] = [];
  try {
    files = readdirSync(LOOPS_DEFINITIONS_DIR).filter((f) => /\.(ya?ml|json)$/i.test(f));
  } catch (err) {
    console.error("[LoopEngine] loops 디렉터리 읽기 실패:", err);
    return { loops, errors };
  }

  for (const file of files) {
    const fullPath = join(LOOPS_DEFINITIONS_DIR, file);
    try {
      const content = readFileSync(fullPath, "utf-8");
      const raw = /\.json$/i.test(file) ? JSON.parse(content) : parseYaml(content);
      const result = validateLoop(raw, fullPath);
      if (!result.ok) {
        errors.push({ file, message: result.message });
        continue;
      }
      if (seenIds.has(result.def.id)) {
        errors.push({ file, message: `중복 loop.id "${result.def.id}" — 첫 번째 정의만 유지` });
        continue;
      }
      seenIds.add(result.def.id);
      loops.push(result.def);
    } catch (err) {
      errors.push({ file, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return { loops, errors };
}
