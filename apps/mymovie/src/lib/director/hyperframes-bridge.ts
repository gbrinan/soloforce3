// HyperFrames 브리지 (stub) — 그래픽 계열 액션(caption/bgm/transition)을
// HyperFrames 컴포지션으로 라우팅하는 경로의 골격.
// Step 3 범위: 실 컴포지션 생성/렌더는 Step 4-5. 여기서는 액션을 수신·검증·드라이런 결과 반환.

import type { Action, Footage } from "../core/action-types";

export interface GraphicDispatchResult {
  ok: boolean;
  /** dry-run 단계에서 받아들여진 액션 id */
  acceptedIds: string[];
  /** HyperFrames 컴포지션 JSON 스텁 — Step 4에서 실 export 형식과 매핑 예정 */
  composition: {
    target: { width: number; height: number };
    layers: Array<{
      kind: "caption" | "bgm" | "transition";
      actionId: string;
      payload: Record<string, unknown>;
    }>;
  };
  note?: string;
}

const ACCEPTED_TYPES = new Set(["caption", "bgm", "transition"]);

export async function applyGraphicActions(
  actions: Action[],
  footage: Footage,
): Promise<GraphicDispatchResult> {
  const layers: GraphicDispatchResult["composition"]["layers"] = [];
  const acceptedIds: string[] = [];
  for (const a of actions) {
    if (!ACCEPTED_TYPES.has(a.type)) continue;
    acceptedIds.push(a.meta.id);
    switch (a.type) {
      case "caption":
        layers.push({
          kind: "caption",
          actionId: a.meta.id,
          payload: {
            clipId: a.clipId,
            startMs: a.start,
            endMs: a.end,
            text: a.text,
            style: a.style ?? {},
          },
        });
        break;
      case "bgm":
        layers.push({
          kind: "bgm",
          actionId: a.meta.id,
          payload: {
            source: a.source,
            volume: a.volume,
            startMs: a.start ?? 0,
            endMs: a.end ?? footage.durationMs,
          },
        });
        break;
      case "transition":
        layers.push({
          kind: "transition",
          actionId: a.meta.id,
          payload: {
            fromClipId: a.fromClipId,
            toClipId: a.toClipId,
            kind: a.kind,
            durationMs: a.durationMs,
          },
        });
        break;
      default:
        // 다른 액션 타입은 dispatch.ts에서 footage로 분류돼 여기에 오지 않음.
        break;
    }
  }
  return {
    ok: true,
    acceptedIds,
    composition: {
      target: { width: footage.width, height: footage.height },
      layers,
    },
    note:
      "HyperFrames 컴포지션 dry-run — 실 렌더는 Step 4-5에서 hyperframes-bridge에 wiring 예정",
  };
}
