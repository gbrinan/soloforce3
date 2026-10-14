// 내부 발화(sendMessage options.source)별 모델 티어 고정.
//
// 왜 별도 모듈인가: 표가 chat.ts 안에 있으면 단위 테스트가 chat.ts 전체(세션·PTY·파일 IO)를
// 끌고 온다. effort-policy.ts / internal-reply-emit.ts 와 같은 "순수 판정 모듈" 패턴을 따른다.
//
// 티어 어휘는 model-tiers.ts(cheap/standard/frontier)를 그대로 재사용한다 —
// 루프 YAML의 `model_tier` 와 같은 언어로 통일해 두 곳이 서로 다른 말을 쓰지 않게 한다.
//
// 기본 모델을 유지할 source 는 DEFAULT_MODEL_SOURCES 에 명시한다(job:report — 사용자가 그대로 읽는 문장).
// 표에도 거기에도 없는 내부 source 는 standard 로 보내고 경고한다(2026-10-13 아난 결정) —
// 미등재 source 가 기본 모델(opus)로 새며 비용의 73%를 차지했던 사고(2026-09-24)를 구조적으로 막는다.
import type { ModelTier } from "./loops/types.js";
import { resolveTier } from "./model-tiers.js";

// ⚠️ W4(2026-08-22 미확인): model-tiers.ts 의 cheap 은 `claude-haiku-4-5-20251001` 인데,
// 실측으로 작동이 확인된 표기는 이 `claude-haiku-4-5` 다(cost-log 단가 지문 대조).
// 어느 쪽이 CLI 에 통하는지 라이브로 확인하기 전까지 cheap 만 검증된 표기를 하드핀한다.
// standard/frontier 는 model-tiers.ts 의 값을 그대로 쓴다(env override MODEL_TIER_* 존중).
const CHEAP_INTERNAL_MODEL = "claude-haiku-4-5";

/**
 * source → 티어 표.
 * - cheap    : 단순 안내성. 응답이 무응답이거나 한 줄. 틀려도 되돌릴 수 있다.
 * - standard : 후속 판단이 필요하나 정형적인 발화(실패 알림·루프/스케줄 트리거·태스크 보고).
 * - 기본 유지: DEFAULT_MODEL_SOURCES(job:report). 사용자 채팅은 내부 호출이 아니라 해당 없음.
 * - 미등재   : standard + 경고(한 source 당 한 번).
 */
export const INTERNAL_SOURCE_TIERS: Record<string, ModelTier> = {
  "job:notify:ok": "cheap",
  "scheduler:notify": "cheap",
  "scheduler:state-change": "cheap",
  // 자동 진행 정체 시 «무엇이 막혔는지» 한 단락 보고(AI-last). 비재개 단발이라 cheap 으로 충분.
  "chat:auto-continuation-stalled": "cheap",
  "job:notify:fail": "standard",
  "loop:runner": "standard",
  "scheduler:trigger": "standard",
  "task:report": "standard",
  // 2026-09-24 실측: 아래 3종이 표에 없어 기본 모델(opus)로 새며 genie 비용의 73%를 차지했다
  // (3일 $18.44 / 전체 $25.41, 사장님 직접 대화는 $0.83). 모두 지니가 스스로 시작하는 정형 발화라
  // 후속 판단은 필요하되 프론티어까지는 불필요 — standard 로 고정한다.
  "chat:auto-continuation": "standard",
  "owner-away:returned": "standard",
  "todo-monitor:backlog": "standard",
};

/** 기본 모델(genie-config)을 그대로 쓰는 내부 source — 일부러 비싼 모델을 쓰는 자리만 명시한다. */
export const DEFAULT_MODEL_SOURCES = new Set<string>(["job:report"]);

/** 미등재 내부 source 에 쓰는 티어. */
export const UNREGISTERED_SOURCE_TIER: ModelTier = "standard";

const warned = new Set<string>();

/** source 의 고정 티어. DEFAULT_MODEL_SOURCES 면 undefined(기본 모델 유지), 미등재면 standard. */
export function tierForInternalSource(source: string | undefined | null): ModelTier | undefined {
  const key = source || "internal:untagged";
  if (DEFAULT_MODEL_SOURCES.has(key)) return undefined;
  const tier = INTERNAL_SOURCE_TIERS[key];
  if (tier) return tier;
  if (!warned.has(key)) {
    warned.add(key);
    console.warn(`[InternalSourceTier] 미등재 내부 source "${key}" → ${UNREGISTERED_SOURCE_TIER}. internal-source-tier.ts 표에 등록하세요.`);
  }
  return UNREGISTERED_SOURCE_TIER;
}

/**
 * 내부 발화에 강제할 모델 ID. 내부 호출이 아니거나 DEFAULT_MODEL_SOURCES 면 undefined
 * (= runAgent 에 model 을 안 넘김 = 기본 모델 유지). 미등재 내부 source 는 standard.
 */
export function modelForInternalSource(
  isInternal: boolean,
  source: string | undefined | null,
): string | undefined {
  if (!isInternal) return undefined;
  const tier = tierForInternalSource(source);
  if (!tier) return undefined;
  if (tier === "cheap") return CHEAP_INTERNAL_MODEL;
  return resolveTier(tier);
}
