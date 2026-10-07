// cost-log.jsonl 1행을 조립하는 순수 모듈.
//
// 왜 별도 모듈인가: 조립 규칙이 jobs.ts(2,900행, 파일 IO·잡 큐·PTY 동반) 안에 있으면
// 단위 테스트가 그 전부를 끌고 온다. internal-source-tier.ts / effort-policy.ts 와 같은
// "순수 판정 모듈" 패턴을 따른다.
//
// ★ 하위호환 계약 (2026-08-23) — 이걸 깨면 과거 원장 해석이 통째로 틀어진다:
//   1. source 가 없으면 **키 자체를 넣지 않는다**. `source: undefined` 도 아니고 `""` 도 아니다.
//      2026-08-23 이전 5,334행은 이 필드가 없는 상태로 남는다. 소급 채우기는 날조다.
//   2. 기존 키(timestamp/agentId/jobId + AgentCost 스프레드)의 이름·순서·의미를 바꾸지 않는다.
//   3. source 는 스프레드 **뒤에** 붙인다. AgentCost 가 훗날 source 를 갖게 돼도
//      발화 출처가 조용히 덮이지 않는다.
import type { AgentCost } from "../types.js";

/** 내부 발화인데 source 를 안 넘긴 경로. "user" 로 위장시키지 않고 드러낸다. */
export const UNTAGGED_INTERNAL = "internal:untagged";

/** 사용자(아난)가 직접 입력한 채팅. */
export const USER_SOURCE = "user";

/**
 * genie 행의 source 결정.
 * 내부 발화인데 source 가 비어 있으면 UNTAGGED_INTERNAL — 배선 누락이 원장에 드러나게 한다.
 * (이 값이 원장에 보이면 "태깅이 됐다"가 아니라 "어딘가 안 됐다"는 신호다.)
 */
export function resolveGenieSource(isInternal: boolean, source: string | undefined | null): string {
  if (source) return source;
  return isInternal ? UNTAGGED_INTERNAL : USER_SOURCE;
}

/**
 * cost-log 1행 조립. source 가 falsy 면 키를 넣지 않는다(형식 불변).
 * nowIso 는 테스트 주입용 — 생략하면 현재 시각.
 */
export function buildCostEntry(
  agentId: string,
  jobId: string | undefined,
  cost: AgentCost,
  source?: string,
  nowIso?: string,
): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    timestamp: nowIso ?? new Date().toISOString(),
    agentId,
    jobId: jobId || null,
    ...cost,
  };
  if (source) entry.source = source;
  return entry;
}
