// 루프 엔진 타입 정의.
// LoopDefinition: YAML/JSON에서 파싱되는 루프 정의(스키마).
// LoopRunRecord: 실행 이력(ledger)에 남는 1회 실행 기록.
// LoopState: 루프별 영속 상태(다음 실행 dedup, 예산 누적, 일시정지 등).

export type ModelTier = "cheap" | "standard" | "frontier";
export type StepType = "task" | "until_done";
export type ApprovalMode = "draft_only" | "auto";
export type DeliveryMode = "summary" | "full" | "silent";
export type CatchUpMode = "skip";
export type SessionMode = "isolated";

export interface LoopTrigger {
  type: "cron" | "manual";
  cron?: string;
  /** 기본값 Asia/Seoul */
  timezone?: string;
  /** v1은 skip만 지원 — 놓친 실행은 건너뛴다 */
  catch_up?: CatchUpMode;
}

export interface LoopSession {
  /** v1은 isolated만 지원 */
  mode?: SessionMode;
  state_files?: string[];
}

export interface LoopDoneCondition {
  /** 쉘 명령. exit 0 = 완료 */
  check?: string;
  /** job 결과 텍스트 내 정확 일치 문자열 */
  completion_promise?: string;
}

export interface LoopStep {
  id: string;
  prompt: string;
  agent?: string;
  project?: string;
  type?: StepType;
  model_tier?: ModelTier;
  done_condition?: LoopDoneCondition;
  max_iterations?: number;
  no_progress_after?: number;
  /**
   * 산출물(보고서/MD 파일) 생성 생략 여부. 미지정 시 true(생략) — /api/delegate의 기존 기본값과 동일.
   * 발굴·리서치·감사처럼 파일 산출물이 본질인 스텝에만 false를 명시한다.
   * (2026-08-10: 이 필드가 없어 모든 루프 스텝이 상시 산출물 억제 상태였다 — repo-scout 발굴 3주 유실)
   */
  skip_output?: boolean;
}

export interface LoopBudget {
  max_cost_usd_per_run?: number;
  max_duration_minutes?: number;
  max_runs_per_day?: number;
  monthly_cap_usd?: number;
}

export interface LoopApproval {
  mode?: ApprovalMode;
}

export interface LoopDelivery {
  on_success?: DeliveryMode;
  /** v1은 항상 full */
  on_failure?: "full";
}

export interface LoopExpiry {
  review_after_days?: number;
}

export interface LoopDefinition {
  id: string;
  version?: string;
  owner?: string;
  description?: string;
  enabled?: boolean;
  trigger: LoopTrigger;
  session?: LoopSession;
  steps: LoopStep[];
  budget?: LoopBudget;
  approval?: LoopApproval;
  delivery?: LoopDelivery;
  expiry?: LoopExpiry;
  /** 정의 파일 경로 (loader가 채움, 저장은 안 함) */
  __filePath?: string;
}

export type LoopExitReason = "done" | "max_iterations" | "budget_exceeded" | "no_progress" | "error" | "paused" | "interrupted";

export interface LoopRunStepResult {
  stepId: string;
  jobIds: string[];
  iterations?: number;
  exitReason?: LoopExitReason;
}

export interface LoopRunRecord {
  runId: string;
  loopId: string;
  startedAt: string;
  endedAt?: string;
  trigger: "cron" | "manual";
  steps: LoopRunStepResult[];
  costUsd: number;
  exitReason: LoopExitReason;
  error?: string;
  /** 시작 시점에만 기록되는 마커 라인 구분용 (reader가 runId 기준 마지막 라인만 채택) */
  status?: "running" | "done";
}

export interface LoopState {
  lastFiredKey?: string;
  runsToday?: { date: string; count: number };
  monthSpend?: { month: string; usd: number };
  consecutiveFailures: number;
  paused?: { reason: string; at: string };
  lastReviewedAt?: string;
}

export interface LoopLoadResult {
  loops: LoopDefinition[];
  errors: Array<{ file: string; message: string }>;
}

export const MAX_ITERATIONS_HARD_CAP = 25;
export const DEFAULT_MAX_ITERATIONS = 5;
export const DEFAULT_NO_PROGRESS_AFTER = 2;
export const DEFAULT_TIMEZONE = "Asia/Seoul";
export const DEFAULT_REVIEW_AFTER_DAYS = 30;
export const MAX_CONCURRENT_LOOP_RUNS = 2;
