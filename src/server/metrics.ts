// 작업 지표(metrics) 계측 — 모델 티어 다운그레이드(dev-pm/planner→Sonnet, qa→Haiku, 2026-07-06 적용)가
// 품질에 미친 영향을 설문이 아닌 자동 지표로 판단하기 위한 v1.
//
// 설계 원칙:
// - 이벤트/결과만 기록한다. 사용자 프롬프트 원문·파일 내용은 절대 기록하지 않는다 (개인정보보호법 대응).
// - append-only JSONL — cost-log.jsonl과 동일한 포맷 관례를 따른다.
// - 잡 실행 경로(hot path)를 절대 실패시키지 않는다 — 기록 실패는 콘솔 경고로만 처리하고 예외를 던지지 않는다.

import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HISTORY_DIR } from "../config.js";

const METRICS_LOG_FILE = join(HISTORY_DIR, "metrics.jsonl");

export type JobMetricStatus = "completed" | "failed" | "outputs_missing";
export type ApprovalOverride = "none" | "allowed" | "denied";

export interface JobMetricRecord {
  ts: string; // ISO8601
  jobId: string;
  agentId: string;
  model?: string | null;
  jobType?: string;
  status: JobMetricStatus;
  durationMs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  retried?: boolean;
  approvalOverride?: ApprovalOverride;
  /** 재시도 시 모델 티어 승격이 적용됐다면 원본/승격 후 모델 ID (jobs.ts escalateTier 연동, 미승격 시 둘 다 undefined). */
  escalatedFrom?: string;
  escalatedTo?: string;
}

export interface RecordJobMetricInput {
  jobId: string;
  agentId: string;
  model?: string | null;
  jobType?: string;
  status: JobMetricStatus;
  durationMs: number;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  retried?: boolean;
  approvalOverride?: ApprovalOverride;
  escalatedFrom?: string;
  escalatedTo?: string;
}

/**
 * 종결(terminal) job 1건당 1레코드 append. jobs.ts의 processJob() finally 블록(단일 경로, 5-stage
 * 파이프라인 모두 공통 통과) 최종 지점에서 호출한다.
 *
 * 크래시 안전: 기록 실패(디스크 오류 등)가 잡 처리 자체를 실패시키지 않도록 반드시 catch로 감싼다.
 * 호출부에서 별도 try/catch 불필요 — 이 함수 자체가 절대 throw하지 않는다.
 */
export function recordJobMetric(input: RecordJobMetricInput): void {
  try {
    if (!existsSync(HISTORY_DIR)) mkdirSync(HISTORY_DIR, { recursive: true });
    const record: JobMetricRecord = {
      ts: new Date().toISOString(),
      jobId: input.jobId,
      agentId: input.agentId,
      model: input.model ?? undefined,
      jobType: input.jobType,
      status: input.status,
      durationMs: input.durationMs,
      costUsd: input.costUsd ?? 0,
      inputTokens: input.inputTokens ?? 0,
      outputTokens: input.outputTokens ?? 0,
      retried: input.retried ?? false,
      approvalOverride: input.approvalOverride ?? "none",
      escalatedFrom: input.escalatedFrom,
      escalatedTo: input.escalatedTo,
    };
    appendFileSync(METRICS_LOG_FILE, JSON.stringify(record) + "\n");
  } catch (e) {
    // 지표 기록 실패는 잡 처리 흐름에 절대 영향을 주면 안 됨 — 콘솔 경고만.
    console.error("[Metrics] recordJobMetric 실패 (job 처리는 계속됨):", e instanceof Error ? e.message : e);
  }
}

/** metrics.jsonl 전체를 읽어 파싱. 손상된 라인은 무시. 파일 부재 시 빈 배열. */
export function getMetricsLog(): JobMetricRecord[] {
  if (!existsSync(METRICS_LOG_FILE)) return [];
  try {
    const lines = readFileSync(METRICS_LOG_FILE, "utf-8").trim().split("\n").filter(Boolean);
    const out: JobMetricRecord[] = [];
    for (const line of lines) {
      try {
        out.push(JSON.parse(line) as JobMetricRecord);
      } catch {
        /* 손상 라인 무시 */
      }
    }
    return out;
  } catch {
    return [];
  }
}

export interface RollupStats {
  count: number;
  completed: number;
  failed: number;
  outputsMissing: number;
  successRate: number; // completed / count
  avgDurationMs: number;
  totalCostUsd: number;
  avgCostPerJob: number;
  retriedCount: number;
  retryRate: number; // retried / count
}

/** jobType 단위 성공률 급락 경보 1건 — summarize()가 byJobType과 함께 계산해 UI 하이라이트용으로 노출. */
export interface SuccessRateAlert {
  jobType: string;
  recentSuccessRate: number; // 최근 N건 기준
  baselineSuccessRate: number; // 그 이전 N건 기준
  recentCount: number;
  threshold: number;
}

export interface MetricsSummary {
  sinceTs?: string;
  totalJobs: number;
  byAgent: Record<string, RollupStats & { name?: string; models: string[] }>;
  byModel: Record<string, RollupStats>;
  byJobType: Record<string, RollupStats>;
  /** 성공률이 임계치 밑으로 떨어졌고(직전 구간 대비 유의미한 하락 포함) jobType 목록 — 없으면 빈 배열. */
  alerts: SuccessRateAlert[];
  recentTraces: JobMetricRecord[];
}

function emptyRollup(): { count: number; completed: number; failed: number; outputsMissing: number; totalDurationMs: number; totalCostUsd: number; retriedCount: number } {
  return { count: 0, completed: 0, failed: 0, outputsMissing: 0, totalDurationMs: 0, totalCostUsd: 0, retriedCount: 0 };
}

function finalizeRollup(acc: ReturnType<typeof emptyRollup>): RollupStats {
  const count = acc.count;
  return {
    count,
    completed: acc.completed,
    failed: acc.failed,
    outputsMissing: acc.outputsMissing,
    successRate: count > 0 ? acc.completed / count : 0,
    avgDurationMs: count > 0 ? acc.totalDurationMs / count : 0,
    totalCostUsd: acc.totalCostUsd,
    avgCostPerJob: count > 0 ? acc.totalCostUsd / count : 0,
    retriedCount: acc.retriedCount,
    retryRate: count > 0 ? acc.retriedCount / count : 0,
  };
}

// === 성공률 급락 경보(alerts) 설정 ===
// 최근 N건 기준 성공률이 이 값 밑으로 떨어지고, 그 이전 N건(baseline) 대비 유의미하게(DROP 이상) 하락했을 때만 경보.
// "최근 N건" 방식을 쓰는 이유: jobType별 실행 빈도 편차가 커서(하루 1건~수십 건) 날짜창 고정보다
// 건수 기준 슬라이딩 윈도우가 저빈도 jobType에서도 노이즈 없이 동작한다.
export const ALERT_WINDOW_SIZE = 20;
export const ALERT_SUCCESS_RATE_THRESHOLD = 0.7;
export const ALERT_MIN_MEANINGFUL_DROP = 0.15; // baseline 대비 최소 하락폭 — 미세 변동 노이즈 제외

/**
 * jobType별 전체(시간 무관) 레코드를 최신순으로 최근 N건/그 이전 N건으로 나눠 성공률을 비교.
 * baseline 구간이 ALERT_WINDOW_SIZE에 못 미치면(데이터 부족) 비교 불가로 간주해 경보하지 않는다.
 * 순수 함수 — getMetricsLog() 결과를 인자로 받아 테스트에서 합성 데이터로 직접 검증 가능.
 */
export function computeSuccessRateAlerts(
  records: JobMetricRecord[],
  windowSize = ALERT_WINDOW_SIZE,
  threshold = ALERT_SUCCESS_RATE_THRESHOLD,
  minDrop = ALERT_MIN_MEANINGFUL_DROP,
): SuccessRateAlert[] {
  const byType = new Map<string, JobMetricRecord[]>();
  for (const r of records) {
    const jobType = r.jobType || "unknown";
    if (!byType.has(jobType)) byType.set(jobType, []);
    byType.get(jobType)!.push(r);
  }

  const alerts: SuccessRateAlert[] = [];
  for (const [jobType, recs] of byType) {
    const sorted = [...recs].sort((a, b) => b.ts.localeCompare(a.ts)); // 최신순
    const recent = sorted.slice(0, windowSize);
    const baseline = sorted.slice(windowSize, windowSize * 2);
    // baseline 구간 데이터 부족 시(신규 jobType 등) 비교 기준이 없으므로 경보 스킵.
    if (baseline.length < windowSize) continue;

    const recentSuccessRate = recent.filter((r) => r.status === "completed").length / recent.length;
    const baselineSuccessRate = baseline.filter((r) => r.status === "completed").length / baseline.length;

    const droppedBelowThreshold = recentSuccessRate < threshold;
    const meaningfulDrop = baselineSuccessRate - recentSuccessRate >= minDrop;

    if (droppedBelowThreshold && meaningfulDrop) {
      alerts.push({
        jobType,
        recentSuccessRate,
        baselineSuccessRate,
        recentCount: recent.length,
        threshold,
      });
    }
  }
  return alerts;
}

/**
 * 시간창(sinceTs 이후) 필터 후 에이전트별/모델별/jobType별 롤업 + 최근 트레이스 목록을 계산.
 * sinceTs 미지정 시 전체 기간. alerts는 sinceTs와 무관하게 전체 로그 기준 슬라이딩 윈도우로 계산한다
 * (jobType별 급락 감지는 조회 기간(days=7/14/30)보다 최근 실행 건수 기준이 더 안정적).
 */
export function summarize(sinceTs?: string, recentLimit = 50): MetricsSummary {
  const all = getMetricsLog();
  const sinceMs = sinceTs ? Date.parse(sinceTs) : NaN;
  const filtered = Number.isNaN(sinceMs) ? all : all.filter((r) => Date.parse(r.ts) >= sinceMs);

  const agentAcc = new Map<string, ReturnType<typeof emptyRollup>>();
  const agentModels = new Map<string, Set<string>>();
  const modelAcc = new Map<string, ReturnType<typeof emptyRollup>>();
  const jobTypeAcc = new Map<string, ReturnType<typeof emptyRollup>>();

  for (const r of filtered) {
    // 에이전트별
    if (!agentAcc.has(r.agentId)) {
      agentAcc.set(r.agentId, emptyRollup());
      agentModels.set(r.agentId, new Set());
    }
    const aAcc = agentAcc.get(r.agentId)!;
    aAcc.count++;
    if (r.status === "completed") aAcc.completed++;
    else if (r.status === "failed") aAcc.failed++;
    else if (r.status === "outputs_missing") aAcc.outputsMissing++;
    aAcc.totalDurationMs += r.durationMs || 0;
    aAcc.totalCostUsd += r.costUsd || 0;
    if (r.retried) aAcc.retriedCount++;
    if (r.model) agentModels.get(r.agentId)!.add(r.model);

    // 모델별
    const modelKey = r.model || "unknown";
    if (!modelAcc.has(modelKey)) modelAcc.set(modelKey, emptyRollup());
    const mAcc = modelAcc.get(modelKey)!;
    mAcc.count++;
    if (r.status === "completed") mAcc.completed++;
    else if (r.status === "failed") mAcc.failed++;
    else if (r.status === "outputs_missing") mAcc.outputsMissing++;
    mAcc.totalDurationMs += r.durationMs || 0;
    mAcc.totalCostUsd += r.costUsd || 0;
    if (r.retried) mAcc.retriedCount++;

    // jobType별 — 성공률 급락 경보의 UI 표시 단위(byModel/byAgent와 별개로 직군 카테고리 기준).
    const jobTypeKey = r.jobType || "unknown";
    if (!jobTypeAcc.has(jobTypeKey)) jobTypeAcc.set(jobTypeKey, emptyRollup());
    const jtAcc = jobTypeAcc.get(jobTypeKey)!;
    jtAcc.count++;
    if (r.status === "completed") jtAcc.completed++;
    else if (r.status === "failed") jtAcc.failed++;
    else if (r.status === "outputs_missing") jtAcc.outputsMissing++;
    jtAcc.totalDurationMs += r.durationMs || 0;
    jtAcc.totalCostUsd += r.costUsd || 0;
    if (r.retried) jtAcc.retriedCount++;
  }

  const byAgent: MetricsSummary["byAgent"] = {};
  for (const [agentId, acc] of agentAcc) {
    byAgent[agentId] = { ...finalizeRollup(acc), models: [...(agentModels.get(agentId) ?? [])] };
  }

  const byModel: MetricsSummary["byModel"] = {};
  for (const [model, acc] of modelAcc) {
    byModel[model] = finalizeRollup(acc);
  }

  const byJobType: MetricsSummary["byJobType"] = {};
  for (const [jobType, acc] of jobTypeAcc) {
    byJobType[jobType] = finalizeRollup(acc);
  }

  const recentTraces = [...filtered]
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, recentLimit);

  // alerts는 sinceTs 필터와 무관하게 전체 로그(all) 기준 — 위 주석 참고.
  const alerts = computeSuccessRateAlerts(all);

  return {
    sinceTs,
    totalJobs: filtered.length,
    byAgent,
    byModel,
    byJobType,
    alerts,
    recentTraces,
  };
}

/** 특정 job의 metric 레코드 단건 조회 (트레이스 상세 뷰용). */
export function getJobMetric(jobId: string): JobMetricRecord | undefined {
  const all = getMetricsLog();
  // 동일 jobId가 여러 번 기록될 일은 없으나(잡당 1레코드), 방어적으로 마지막 항목 반환.
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].jobId === jobId) return all[i];
  }
  return undefined;
}
