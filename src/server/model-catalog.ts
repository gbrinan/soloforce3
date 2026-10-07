// 모델 카탈로그 — 스토어 `/api/models/catalog` 사본과, 지원 종료 모델의 자동 승계.
//
// 카탈로그는 이미 `replacement` 를 담고 있었다. 그런데 코드는 그걸 알면서도 알림만 띄우고
// "설정에서 바꿔 주세요"라고 사람에게 미뤘다. 실제로 코퍼스키퍼가 죽은 모델(sonnet-4-6)로
// 몇 세대를 돌았다 — 아무도 그 알림을 처리하지 않았기 때문이다.
//
// **저장된 값은 건드리지 않는다.** 읽는 시점에만 승계 모델로 바꿔 준다.
//   - `config/agents/*/meta.json` 은 이제 git 체크아웃이다. 자동 수정하면 `git pull` 이 깨진다.
//   - `history/agents.json` 은 사용자 데이터다. 사용자가 고른 값을 말없이 덮어쓰지 않는다.
// 그래서 원본은 그대로 두고 해석만 바꾼다 — 카탈로그가 틀렸다면 되돌릴 것도 없다.
//
// 끄려면 `MYCREW_NO_MODEL_AUTOMIGRATE=1`.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { HISTORY_DIR } from "../config.js";

export const MODEL_CATALOG_FILE = join(HISTORY_DIR, "model-catalog.json");

export interface CatalogModel {
  id: string;
  label: string;
  status: "active" | "deprecated";
  replacement?: string;
  note?: string;
}

export interface Succession {
  agentId: string;
  from: string;
  to: string;
}

/** 마지막으로 받아 둔 카탈로그. 없거나 깨졌으면 null — 그 경우 승계는 일어나지 않는다. */
export function loadModelCatalog(): CatalogModel[] | null {
  try {
    if (!existsSync(MODEL_CATALOG_FILE)) return null;
    const parsed = JSON.parse(readFileSync(MODEL_CATALOG_FILE, "utf-8")) as { models?: CatalogModel[] };
    return Array.isArray(parsed.models) ? parsed.models : null;
  } catch {
    return null;
  }
}

// 카탈로그는 자주 안 바뀌므로 mtime 없이 짧게 캐시한다(레지스트리가 매 요청 호출할 수 있다).
let cache: { at: number; map: Map<string, string> } | null = null;
const CACHE_MS = 60_000;

/** `지원종료 ID → 승계 ID` 맵. 승계 대상이 active 가 아니면 싣지 않는다(연쇄 승계 방지). */
function successionMap(): Map<string, string> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.map;
  const map = new Map<string, string>();
  const models = loadModelCatalog();
  if (models) {
    const active = new Set(models.filter((m) => m.status === "active").map((m) => m.id));
    for (const m of models) {
      if (m.status === "deprecated" && m.replacement && active.has(m.replacement)) {
        map.set(m.id, m.replacement);
      }
    }
  }
  cache = { at: now, map };
  return map;
}

/**
 * 이 모델이 지원 종료면 승계 모델 ID를, 아니면 null.
 *
 * prefix 매칭이다 — `claude-haiku-4-5-20251001` 처럼 날짜가 붙은 ID도 잡아야 한다.
 * 알림 쪽(`agentsUsingModel`)이 같은 규칙을 쓴다.
 */
export function resolveDeprecatedModel(model: string | null | undefined): string | null {
  if (!model) return null;
  if (process.env.MYCREW_NO_MODEL_AUTOMIGRATE === "1") return null;
  const map = successionMap();
  const exact = map.get(model);
  if (exact) return exact;
  for (const [from, to] of map) {
    if (model.startsWith(from)) return to;
  }
  return null;
}

// 실제로 적용된 승계 — 알림이 "바꿔 주세요" 대신 "바꿨습니다"를 말할 수 있게 남긴다.
const applied = new Map<string, Succession>();

export function recordSuccession(agentId: string, from: string, to: string): void {
  const key = `${agentId}:${from}`;
  if (applied.has(key)) return; // 레지스트리는 자주 재로드된다 — 로그는 한 번만
  applied.set(key, { agentId, from, to });
  console.log(`[ModelCatalog] ${agentId}: ${from} 지원 종료 → ${to} 로 승계`);
}

export function getAppliedSuccessions(): Succession[] {
  return [...applied.values()];
}

/** 카탈로그가 갱신되면 캐시를 버린다(update-check 가 새로 받아 쓸 때 호출). */
export function invalidateCatalogCache(): void {
  cache = null;
}
