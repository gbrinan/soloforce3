// 모델 티어(cheap/standard/frontier) → 실제 모델 ID 매핑.
// ModelTier 타입은 loops/types.ts를 재사용(type-only import — 순환 의존 없음).
// env override: MODEL_TIER_CHEAP / MODEL_TIER_STANDARD / MODEL_TIER_FRONTIER
import type { ModelTier } from "./loops/types.js";

// claude-code 어댑터가 실제로 지원하는 모델 ID (src/adapters/claude-code.ts supportedModels 참고).
// 2026-07-17: opus-4-7/sonnet-4-6 지원 종료 → active 모델(opus-4-8/sonnet-5)로 갱신.
export const DEFAULT_TIER_MODELS: Record<ModelTier, string> = {
  cheap: "claude-haiku-4-5-20251001",
  standard: "claude-sonnet-5",
  frontier: "claude-opus-4-8",
};

const ENV_KEYS: Record<ModelTier, string> = {
  cheap: "MODEL_TIER_CHEAP",
  standard: "MODEL_TIER_STANDARD",
  frontier: "MODEL_TIER_FRONTIER",
};

/** tier → 모델 ID 해석. env override(MODEL_TIER_*) 우선, 없으면 기본값. tier 미지정 시 undefined. */
export function resolveTier(tier: ModelTier | undefined | null): string | undefined {
  if (!tier) return undefined;
  const envKey = ENV_KEYS[tier];
  const override = envKey ? process.env[envKey]?.trim() : undefined;
  return override || DEFAULT_TIER_MODELS[tier];
}

/**
 * 모델 우선순위 해석: 명시적 model이 있으면 그것을, 없고 tier가 있으면 tier 기본값,
 * 둘 다 없으면 null(=상위 설정값 유지, 기존 동작 불변).
 */
export function pickModel(
  explicit: string | null | undefined,
  fallbackTier?: ModelTier | null,
): string | null {
  if (explicit) return explicit;
  const tierModel = resolveTier(fallbackTier ?? undefined);
  return tierModel ?? null;
}

/**
 * 티어 승격(escalation) — 실패 재시도 시 값싼 모델→상위 모델로 한 단계 올리기 위한 순수 매핑.
 * cheap→standard, standard→frontier, frontier→frontier(이미 최상위 — no-op).
 * 무한 승격 방지를 위해 frontier에서 멈춘다(호출부에서 job당 1회 상한을 별도로 관리해야 함).
 */
export function escalateTier(current: ModelTier | undefined): ModelTier {
  if (current === "cheap") return "standard";
  if (current === "standard") return "frontier";
  return "frontier";
}
