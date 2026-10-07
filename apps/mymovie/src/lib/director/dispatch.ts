// 이중 디스패치 — footage 계열은 OpenReel executor, 그래픽 계열은 HyperFrames 브리지로 라우팅.

import type { Action, Footage } from "../core/action-types";
import { executeMany, type ExtendedExecuteResult } from "../core/action-executor";
import { applyGraphicActions } from "./hyperframes-bridge";
import type { GraphicDispatchResult } from "./hyperframes-bridge";

export const FOOTAGE_ACTION_TYPES = new Set(["cut", "trim", "reframe"]);
export const GRAPHIC_ACTION_TYPES = new Set(["caption", "bgm", "transition"]);

export interface DispatchResult {
  footage: ExtendedExecuteResult;
  graphic: GraphicDispatchResult;
  /** 분기 통계 */
  routed: { footage: string[]; graphic: string[]; unknown: string[] };
}

export async function dispatchActions(
  actions: Action[],
  footage: Footage,
): Promise<DispatchResult> {
  const footageActions: Action[] = [];
  const graphicActions: Action[] = [];
  const unknown: string[] = [];
  for (const a of actions) {
    if (FOOTAGE_ACTION_TYPES.has(a.type)) footageActions.push(a);
    else if (GRAPHIC_ACTION_TYPES.has(a.type)) graphicActions.push(a);
    else unknown.push(a.meta.id);
  }

  // executeMany는 footage.path를 input으로 사용한다 — 호출 측이 path를 보장해야 한다.
  const footageRes = await executeMany(footageActions, footage);
  const graphicRes = await applyGraphicActions(graphicActions, footage);

  return {
    footage: footageRes,
    graphic: graphicRes,
    routed: {
      footage: footageActions.map((a) => a.meta.id),
      graphic: graphicActions.map((a) => a.meta.id),
      unknown,
    },
  };
}
