// 호출 1회분 비용 산정 — 순수 모듈.
//
// 왜 필요한가(2026-10-02 실측): claude CLI 의 `total_cost_usd` 는 «세션 누적» 값이다.
// --resume 으로 같은 세션을 이어받으면 직전까지의 비용이 계속 더해져 나온다.
// genie 세션 행이 모델과 무관하게 1.78 → 1.82 → 1.96 → … → 2.56 으로 단조 증가했고,
// haiku 1회(캐시읽기 114k·생성 3.4k·출력 319)가 $2.15 로 찍혔다(실제 ≈ $0.02).
// cost-log 의 genie 비용이 약 10~70배 부풀려져 있던 원인이다.
//
// 산정 우선순위:
//   1. 새 세션(비재개)        → CLI 값 그대로("cli"). 누적 = 이번 호출분.
//   2. 재개 + 직전 누적값 앎  → 누적 차분("session-delta"). 서브에이전트 등 타 모델 비용까지 포함.
//   3. 재개 + 직전값 모름     → 토큰 × 모델 단가("tokens"). 서버 재시작 직후 첫 호출 등.
import type { AgentCost } from "../types.js";

export type CostMethod = "cli" | "session-delta" | "tokens";

/**
 * $ / 1M tokens. 이 리포의 단가 정본 — 다른 모듈은 priceForModel 로 가져다 쓴다.
 * cacheWrite 는 1시간 TTL 단가(입력 단가 2배). claude CLI 세션의 캐시 생성은 1시간 TTL로 과금된다:
 * 2026-10-07 라이브 원장 cli 행(비재개) 대조에서 1시간 가정은 추정/CLI 중앙값 1.000,
 * 5분 가정(1.25배)은 0.66~0.68 이었다 (scripts/cost-price-calibration-test.ts).
 */
export interface TokenPrice { input: number; output: number; cacheWrite: number; cacheRead: number }

const PRICE_FABLE: TokenPrice = { input: 10, output: 50, cacheWrite: 20, cacheRead: 0.25 };
const PRICE_OPUS_5_5: TokenPrice = { input: 4, output: 20, cacheWrite: 8, cacheRead: 0.2 };
const PRICE_OPUS: TokenPrice = { input: 5, output: 25, cacheWrite: 10, cacheRead: 0.5 };
const PRICE_SONNET_4: TokenPrice = { input: 3, output: 15, cacheWrite: 6, cacheRead: 0.3 };
const PRICE_SONNET: TokenPrice = { input: 2, output: 10, cacheWrite: 4, cacheRead: 0.2 };
const PRICE_HAIKU: TokenPrice = { input: 1, output: 5, cacheWrite: 2, cacheRead: 0.1 };

/**
 * 모델명 → 단가. 세대 차이가 있는 ID 접두사를 먼저 보고, 없으면 «계열» 부분일치로 판정한다 —
 * 신모델이 나올 때마다 표 누락으로 폴백 단가가 새는 사고(2026-07-17)를 막기 위해서다.
 * 모르는 계열은 가장 비싼 단가(과소계상보다 과대계상이 안전).
 */
export function priceForModel(model: string | undefined | null): TokenPrice {
  const m = (model ?? "").toLowerCase();
  if (m.includes("opus-5-5")) return PRICE_OPUS_5_5;
  if (m.includes("sonnet-4")) return PRICE_SONNET_4;
  if (m.includes("haiku")) return PRICE_HAIKU;
  if (m.includes("sonnet")) return PRICE_SONNET;
  if (m.includes("opus")) return PRICE_OPUS;
  return PRICE_FABLE;
}

export interface UsageTokens {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
}

/** 토큰 × 단가. 캐시 생성은 5분 TTL 단가(1h 구분 정보가 result 에 없음). */
export function priceTokens(u: UsageTokens, model: string | undefined | null): number {
  const p = priceForModel(model);
  return (
    u.inputTokens * p.input +
    u.outputTokens * p.output +
    u.cacheCreateTokens * p.cacheWrite +
    u.cacheReadTokens * p.cacheRead
  ) / 1_000_000;
}

export interface InvocationCostInput {
  /** CLI 가 돌려준 total_cost_usd (세션 누적). */
  cliTotalUsd: number;
  /** --resume 으로 기존 세션을 이어받았는가. */
  resumed: boolean;
  /** 같은 세션의 직전 누적값(이 프로세스가 기억하는 값). 모르면 undefined. */
  prevCumulativeUsd?: number;
  usage: UsageTokens;
  /** 실제 사용 모델(지정값 또는 CLI modelUsage 키). */
  model?: string;
}

export function computeInvocationCost(i: InvocationCostInput): { costUsd: number; costMethod: CostMethod } {
  if (!i.resumed) return { costUsd: i.cliTotalUsd, costMethod: "cli" };
  if (typeof i.prevCumulativeUsd === "number" && i.cliTotalUsd >= i.prevCumulativeUsd) {
    return { costUsd: i.cliTotalUsd - i.prevCumulativeUsd, costMethod: "session-delta" };
  }
  return { costUsd: priceTokens(i.usage, i.model), costMethod: "tokens" };
}

/**
 * 세션별 누적값 기억소. 프로세스 메모리에만 둔다 — 재시작 후 첫 재개 호출은 "tokens" 로 떨어지고
 * 그 호출의 누적값부터 다시 기억한다. 무한 증가 방지로 상한(오래된 것부터 버림).
 */
export class SessionCostTracker {
  private readonly last = new Map<string, number>();
  constructor(private readonly cap = 500) {}
  get(sessionId: string | undefined): number | undefined {
    return sessionId ? this.last.get(sessionId) : undefined;
  }
  set(sessionId: string | undefined, cumulativeUsd: number): void {
    if (!sessionId || !Number.isFinite(cumulativeUsd)) return;
    this.last.delete(sessionId);
    this.last.set(sessionId, cumulativeUsd);
    while (this.last.size > this.cap) {
      const oldest = this.last.keys().next().value;
      if (oldest === undefined) break;
      this.last.delete(oldest);
    }
  }
}

/** AgentCost 의 costUsd 를 이번 호출분으로 교체하고 산정 방식을 붙인다. */
export function withInvocationCost(cost: AgentCost, r: { costUsd: number; costMethod: CostMethod }): AgentCost {
  return { ...cost, costUsd: r.costUsd, costMethod: r.costMethod };
}
