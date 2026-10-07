// cost-log.jsonl 읽기 전용 해석기 — 행마다 «이 비용을 얼마나 믿을 수 있는가» 등급을 붙인다.
//
// 왜 필요한가(2026-10-07 실측): 패치 80(2026-10-02) 이전 genie 행은 CLI 세션 누적값이 그대로 기록돼
// 토큰 재산정 대비 약 10배 부풀어 있다. 원장은 append-only 라 고치지 않는다(소급 수정은 날조).
// 대신 읽는 쪽이 등급을 나눠, 부풀린 과거 행이 측정값 합계에 섞이지 않게 한다.
//
// 등급:
//   measured   — CLI 보고값(cli) 또는 세션 누적 차분(session-delta). 외부 정답에 가장 가깝다.
//   estimated  — 토큰 × 단가(tokens). invocation-cost.ts 의 단가 정본으로 산정.
//   unpriced   — 토큰은 있으나 달러를 모름(구독제 codex·gemini 등). $0을 무료로 세지 않는다.
//   legacy     — 컷오프 이전, 산정 방식 없음. 로그값은 보존하고 토큰 재산정 추정치를 따로 낸다.
//   unrecorded — 컷오프 이후인데 산정 방식이 없음(앱 경로 등). 배선 누락 신호.
import { priceTokens } from "./invocation-cost.js";

/** 패치 80이 라이브에서 처음 costMethod 를 기록한 행의 시각. */
export const COST_METHOD_CUTOFF = "2026-10-02T04:47:17.484Z";

export type CostTrust = "measured" | "estimated" | "unpriced" | "legacy" | "unrecorded";
export const COST_TRUSTS: readonly CostTrust[] = ["measured", "estimated", "unpriced", "legacy", "unrecorded"];

export interface CostRow {
  timestamp?: string;
  agentId?: string;
  costUsd?: number;
  costMethod?: string;
  model?: string | null;
  source?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreateTokens?: number;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const tokensOf = (r: CostRow): number =>
  num(r.inputTokens) + num(r.outputTokens) + num(r.cacheReadTokens) + num(r.cacheCreateTokens);
const isClaudeModel = (m: string | null | undefined): boolean => !!m && m.toLowerCase().includes("claude");

export function classifyCostRow(r: CostRow): CostTrust {
  switch (r.costMethod) {
    case "cli":
    case "session-delta":
      return "measured";
    case "tokens":
      return "estimated";
    case "unpriced":
      return "unpriced";
  }
  if (r.model && !isClaudeModel(r.model) && num(r.costUsd) === 0) return "unpriced";
  if ((r.timestamp ?? "") < COST_METHOD_CUTOFF) return "legacy";
  return "unrecorded";
}

export interface TrustBucket { rows: number; loggedUsd: number; tokenEstimateUsd: number; tokens: number }
export interface AgentCostSummary { rows: number; trustedUsd: number; legacyEstimateUsd: number; unpricedRows: number }
export interface CostSummary {
  rows: number;
  /** measured + estimated 의 로그값 합. 의사결정에 쓸 수 있는 유일한 합계. */
  trustedUsd: number;
  byTrust: Record<CostTrust, TrustBucket>;
  byAgent: Record<string, AgentCostSummary>;
}

/** 토큰 재산정. claude 모델만 단가를 안다 — 그 밖은 0(unpriced 로 따로 센다). */
function tokenEstimate(r: CostRow): number {
  if (!isClaudeModel(r.model)) return 0;
  return priceTokens({
    inputTokens: num(r.inputTokens),
    outputTokens: num(r.outputTokens),
    cacheReadTokens: num(r.cacheReadTokens),
    cacheCreateTokens: num(r.cacheCreateTokens),
  }, r.model);
}

export function summarizeCosts(rows: CostRow[], window: { since?: string; until?: string } = {}): CostSummary {
  const byTrust = Object.fromEntries(
    COST_TRUSTS.map((t) => [t, { rows: 0, loggedUsd: 0, tokenEstimateUsd: 0, tokens: 0 }]),
  ) as Record<CostTrust, TrustBucket>;
  const byAgent: Record<string, AgentCostSummary> = {};
  let count = 0;
  let trustedUsd = 0;

  for (const r of rows) {
    const ts = r.timestamp ?? "";
    if (window.since && ts < window.since) continue;
    if (window.until && ts >= window.until) continue;
    count++;
    const trust = classifyCostRow(r);
    const logged = num(r.costUsd);
    const est = tokenEstimate(r);
    const b = byTrust[trust];
    b.rows++;
    b.loggedUsd += logged;
    b.tokenEstimateUsd += est;
    b.tokens += tokensOf(r);

    const id = r.agentId ?? "(unknown)";
    const a = (byAgent[id] ??= { rows: 0, trustedUsd: 0, legacyEstimateUsd: 0, unpricedRows: 0 });
    a.rows++;
    if (trust === "measured" || trust === "estimated") {
      a.trustedUsd += logged;
      trustedUsd += logged;
    } else if (trust === "legacy") {
      a.legacyEstimateUsd += est;
    } else if (trust === "unpriced") {
      a.unpricedRows++;
    }
  }
  return { rows: count, trustedUsd, byTrust, byAgent };
}
