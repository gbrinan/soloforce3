// 워커 잡의 «단계»별 모델 고정 — 계획 단계와 실행 단계에 서로 다른 모델을 쓴다.
//
// 왜 별도 모듈인가: 판정이 jobs.ts(3,400행, 잡 큐·PTY·파일 IO 동반) 안에 있으면 단위 테스트가
// 그 전부를 끌고 온다. internal-source-tier.ts / effort-policy.ts / cost-entry.ts 와 같은
// "순수 판정 모듈" 패턴을 따른다.
//
// ⚠️ internal-source-tier.ts 와 헷갈리지 마라. 저쪽은 «genie 내부 발화(sendMessage source)» 축이고
//    이쪽은 «워커 잡 단계(계획/실행)» 축이다. 축이 다르므로 표를 합치지 않는다.
//    합치면 "job:notify:ok" 와 "dev-pm" 이 한 표에 섞여 둘 다 못 읽게 된다.
//
// 2026-09-15 아난 승인: 아샬은 계획과 실행 모두 Opus 5를 사용한다.
//   → dev-pm 실행 모델은 agents.json/meta.json의 Opus 5를 따르고,
//     계획 단계도 이 표에서 Opus 5로 고정한다.

/**
 * 계획 단계에서만 강제할 모델. 표에 없는 에이전트는 undefined → 실행 모델을 그대로 쓴다
 * (= 기존 동작 불변). 새 에이전트를 넣을 때는 반드시 음성 대조(표 밖 에이전트 불변)를 함께 짜라.
 */
export const PLAN_STAGE_MODELS: Record<string, string> = {
  "dev-pm": "claude-opus-5",
};

export interface PlanStageModelInput {
  agentId: string;
  /** 실행 단계에서 쓸 모델(= toAgentConfig 가 agents.json 에서 해석한 값). */
  executeModel: string | null | undefined;
  /**
   * 호출자가 잡에 model 을 명시했는가(DelegateTask model override / 티어 승격 해석값).
   * true 면 계획 단계도 그 값을 따른다 — 명시 지정이 표보다 세다.
   */
  hasJobModelOverride: boolean;
  /**
   * agents.json 의 agentDef.planModel — 사람이 직접 고른 계획 단계 모델(예: claude-fable-5).
   * 2026-08-24: "Opus5 하드코딩"을 "설정으로 선택"으로 확장하려고 신설.
   * PLAN_STAGE_MODELS 표보다 세지만 hasJobModelOverride 보다는 약하다(잡 단위 명시 지정이 최우선).
   */
  configuredModel?: string | null;
}

/**
 * 계획 단계에 쓸 모델. 실행 모델과 같으면(=승격 없음) 같은 값을 그대로 돌려준다.
 * 우선순위: hasJobModelOverride > configuredModel(agents.json) > PLAN_STAGE_MODELS 표 기본값 > executeModel.
 * 호출부는 `planConfig.model = planStageModel(...)` 한 자리뿐이어야 한다.
 */
export function planStageModel(input: PlanStageModelInput): string | null | undefined {
  if (input.hasJobModelOverride) return input.executeModel;
  if (input.configuredModel) return input.configuredModel;
  const forced = PLAN_STAGE_MODELS[input.agentId];
  return forced ?? input.executeModel;
}

/** 이 에이전트가 단계별로 다른 모델을 쓰는가(보고·로그용). */
export function hasStageSplit(agentId: string, executeModel: string | null | undefined): boolean {
  const forced = PLAN_STAGE_MODELS[agentId];
  return !!forced && forced !== executeModel;
}
