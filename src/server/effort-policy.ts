// CLI --effort 수준 결정 — 기본 low, 오래 걸리는 작업만 medium.
//
// 왜 함수 하나로 모았는가: --effort 를 조립하는 자리가 셋이다(agent.ts / worker-pty.ts /
// terminal-ws.ts). 각 자리에서 따로 `?? "low"` 를 쓰면 우선순위가 조용히 갈라진다 —
// 이 시스템에서 실제로 그런 사고가 있었다(직접위임 경로가 buildStepPrompt 결과를 버린 건).
// 세 지점이 **같은 함수를 부르게** 하면 "일관되게 동작한다"를 테스트로 증명할 필요가 없다.
// 구조적으로 갈라질 수 없다.
//
// 정책(2026-08-18 아난 지시):
//   - 기본은 low. 속도는 CLI 기본값 그대로 둔다(fast/speed 축은 이 코드베이스에 없다).
//   - 오래 걸리는 작업만 medium 으로 올린다.
//   - high 는 이 정책이 만들지 않는다. 수동 지정만 통과시킨다.

export type EffortLevel = "low" | "medium" | "high";

/** 아무 설정도 없을 때의 값. */
export const DEFAULT_EFFORT: EffortLevel = "low";

/**
 * 자동 승격 임계 — 기본 lease(초). jobs.ts LEASE_DURATION_MS(15분)와 같은 값이어야 한다.
 * 이보다 크게 명시했다는 건 호출자가 "이건 오래 걸린다"를 이미 선언한 것이다.
 */
export const DEFAULT_LEASE_SEC = 900;

const RANK: Record<EffortLevel, number> = { low: 0, medium: 1, high: 2 };

export interface EffortInput {
  /** 잡 단위 명시값 (DelegateTask effort / Job.effort). 있으면 무조건 이긴다. */
  jobEffort?: string | null;
  /** 에이전트 기본값 (agents.json / genie-config.json). */
  configEffort?: string | null;
  /** 호출자가 명시한 lease 초. 미지정이면 undefined — 0 이나 기본값과 구분해야 한다. */
  leaseSec?: number | null;
  /** 잡 단위 maxTurns 오버라이드. */
  jobMaxTurns?: number | null;
  /** 해당 에이전트의 정의 기본 maxTurns (오버라이드 적용 **전** 값). */
  agentMaxTurns?: number | null;
}

export interface EffortDecision {
  effort: EffortLevel;
  /** job=잡 명시 / auto=자동 승격 / agent=에이전트 기본 / default=코드 기본 */
  source: "job" | "auto" | "agent" | "default";
  /** 자동 승격일 때만 값이 있다. 잡 로그에 그대로 한 줄 남긴다 — 조용히 올리지 않는다. */
  reason?: string;
}

/** 문자열을 EffortLevel 로 정규화. 모르는 값은 null(= 미지정 취급). */
export function normalizeEffort(v: unknown): EffortLevel | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return s === "low" || s === "medium" || s === "high" ? s : null;
}

/**
 * 자동 승격 사유 — 조건이 없으면 null.
 *
 * 왜 maxTurns 를 고정 임계값으로 재지 않는가: 에이전트마다 기본이 12(잭키)/50(동국)/100(아샬)로
 * 제각각이다. 고정 임계 30을 쓰면 잭키는 거의 항상 승격되고 아샬은 절대 승격되지 않는다.
 * "기본보다 크게 지정했다"는 상대 비교여야 의미가 같다.
 */
function autoPromoteReason(input: EffortInput): string | null {
  const lease = typeof input.leaseSec === "number" ? input.leaseSec : null;
  if (lease !== null && lease > DEFAULT_LEASE_SEC) {
    return `leaseSec=${lease} > 기본 ${DEFAULT_LEASE_SEC}`;
  }
  const jobTurns = typeof input.jobMaxTurns === "number" ? input.jobMaxTurns : null;
  const agentTurns = typeof input.agentMaxTurns === "number" ? input.agentMaxTurns : null;
  if (jobTurns !== null && jobTurns > 0 && agentTurns !== null && agentTurns > 0 && jobTurns > agentTurns) {
    return `maxTurns=${jobTurns} > 에이전트 기본 ${agentTurns}`;
  }
  return null;
}

/**
 * 우선순위: 잡 명시값 > 자동 승격 > 에이전트 기본 > 코드 기본(low).
 *
 * 자동 승격은 **낮추지 않는다**. 에이전트가 high 로 설정돼 있으면 medium 으로 깎지 않는다 —
 * '승격'은 올리는 것이지 정규화가 아니다. 그래서 max(base, medium) 로 계산한다.
 */
export function resolveEffort(input: EffortInput): EffortDecision {
  const explicit = normalizeEffort(input.jobEffort);
  if (explicit) return { effort: explicit, source: "job" };

  const agent = normalizeEffort(input.configEffort);
  const base: EffortLevel = agent ?? DEFAULT_EFFORT;

  const reason = autoPromoteReason(input);
  if (reason && RANK[base] < RANK.medium) {
    return { effort: "medium", source: "auto", reason };
  }

  return { effort: base, source: agent ? "agent" : "default" };
}

/**
 * 소비 지점용 축약형 — AgentConfig.effort 만 있고 잡 문맥이 없는 자리(터미널·워커 PTY)에서 쓴다.
 * 잡 문맥이 있는 자리는 resolveEffort 를 직접 부른다.
 */
export function effortForConfig(configEffort?: string | null): EffortLevel {
  return resolveEffort({ configEffort }).effort;
}
