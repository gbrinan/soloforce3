// OpenReel core — Undo 위한 역연산 생성 (Step 4 실구현).
// 각 forward 액션 타입별로 의미상 역연산을 동일 Action 유니온 안에서 표현한다.
// 별도 액션 타입을 신설하지 않고, 인자(범위/속성)를 역으로 채워 넣는 방식.

import { randomUUID } from "node:crypto";
import type {
  Action,
  ActionMeta,
  BgmAction,
  CaptionAction,
  CutAction,
  GenerateAction,
  ImageOverlayAction,
  KeyframeAction,
  ReframeAction,
  TransitionAction,
  TrimAction,
  SpeedAction,
  OpacityAction,
  TransformAction,
} from "./action-types";

export interface InverseRecord {
  forwardActionId: string;
  /** Step 4부터 실 Action 반환 (null 금지). */
  inverse: Action;
  note?: string;
}

function genMeta(forwardId: string): ActionMeta {
  return {
    id: `inv-${forwardId}-${randomUUID().slice(0, 8)}`,
    createdAt: Date.now(),
    source: "system",
  };
}

function invertCut(a: CutAction): InverseRecord {
  // cut(at) 의 역은 잘린 두 클립의 재결합(concat) 의미.
  // 단일 Action 유니온 안에서는 transition.kind="cut" durationMs=0 으로
  // "이어붙임" 의미만 보존한다. 실 concat 수행은 dispatcher Step 5 범위.
  const inv: TransitionAction = {
    type: "transition",
    meta: genMeta(a.meta.id),
    fromClipId: `${a.clipId}_A`,
    toClipId: `${a.clipId}_B`,
    kind: "cut",
    durationMs: 1, // validator가 >0 요구 — 0 대신 1ms
  };
  return {
    forwardActionId: a.meta.id,
    inverse: inv,
    note: `inverse of cut@${a.at}ms — represent as zero-length concat marker`,
  };
}

function invertTrim(a: TrimAction): InverseRecord {
  // trim(s, e) 의 역은 원본 범위로 되돌리는 trim(0, prevEnd).
  // prevEnd 정보는 forward action에는 없으므로 의미상 마커로 start=0, end=원 trim.end로 표현.
  // 실제 복원은 원본 클립을 다시 가져와야 함 (dispatcher Step 5에서 처리).
  const inv: TrimAction = {
    type: "trim",
    meta: genMeta(a.meta.id),
    clipId: a.clipId,
    start: 0,
    end: a.end,
  };
  return {
    forwardActionId: a.meta.id,
    inverse: inv,
    note: `inverse of trim(${a.start},${a.end}) — restore to (0, end)`,
  };
}

function invertReframe(a: ReframeAction): InverseRecord {
  // reframe 의 역은 원본 aspect(=현 aspect의 역수). focal은 0.5/0.5 중앙으로 리셋.
  const inv: ReframeAction = {
    type: "reframe",
    meta: genMeta(a.meta.id),
    clipId: a.clipId,
    aspect: { w: a.aspect.h, h: a.aspect.w },
    focal: { x: 0.5, y: 0.5 },
  };
  return {
    forwardActionId: a.meta.id,
    inverse: inv,
    note: `inverse of reframe ${a.aspect.w}:${a.aspect.h} — swap to ${a.aspect.h}:${a.aspect.w}`,
  };
}

function invertCaption(a: CaptionAction): InverseRecord {
  // caption 의 역은 같은 구간에 공백 caption 으로 제거 마커.
  // validator는 text non-empty 요구 → 마커 텍스트 " " (single space) 사용.
  const inv: CaptionAction = {
    type: "caption",
    meta: genMeta(a.meta.id),
    clipId: a.clipId,
    start: a.start,
    end: a.end,
    text: " ",
    style: { color: "transparent" },
  };
  return {
    forwardActionId: a.meta.id,
    inverse: inv,
    note: `inverse of caption "${a.text.slice(0, 20)}" — empty-text marker`,
  };
}

function invertBgm(a: BgmAction): InverseRecord {
  // bgm 의 역은 같은 source 를 volume=0 으로 덮어쓰기 = 무음화.
  const inv: BgmAction = {
    type: "bgm",
    meta: genMeta(a.meta.id),
    source: a.source,
    volume: 0,
    start: a.start,
    end: a.end,
  };
  return {
    forwardActionId: a.meta.id,
    inverse: inv,
    note: `inverse of bgm vol=${a.volume} — mute (vol=0)`,
  };
}

function invertTransition(a: TransitionAction): InverseRecord {
  // transition 의 역은 kind="cut", durationMs=1 (validator >0 요구) — 즉시 절단.
  const inv: TransitionAction = {
    type: "transition",
    meta: genMeta(a.meta.id),
    fromClipId: a.fromClipId,
    toClipId: a.toClipId,
    kind: "cut",
    durationMs: 1,
  };
  return {
    forwardActionId: a.meta.id,
    inverse: inv,
    note: `inverse of transition ${a.kind}/${a.durationMs}ms — revert to hard cut`,
  };
}

function invertSpeed(a: SpeedAction): InverseRecord {
  // speed(factor) 의 역은 speed(1/factor).
  // Example: 2.0x → 0.5x, 0.5x → 2.0x.
  const inverseFactor = Math.max(0.25, Math.min(4.0, 1.0 / a.factor));
  const inv: SpeedAction = {
    type: "speed",
    meta: genMeta(a.meta.id),
    clipId: a.clipId,
    factor: inverseFactor,
  };
  return {
    forwardActionId: a.meta.id,
    inverse: inv,
    note: `inverse of speed(${a.factor}) — speed(${inverseFactor})`,
  };
}

function invertOpacity(a: OpacityAction): InverseRecord {
  // opacity(from→to) 의 역은 opacity(to→from).
  const inv: OpacityAction = {
    type: "opacity",
    meta: genMeta(a.meta.id),
    clipId: a.clipId,
    start: a.start,
    end: a.end,
    from: a.to,
    to: a.from,
  };
  return {
    forwardActionId: a.meta.id,
    inverse: inv,
    note: `inverse of opacity(${a.from}→${a.to}) — opacity(${a.to}→${a.from})`,
  };
}

function invertTransform(a: TransformAction): InverseRecord {
  // transform 의 역은 각 속성의 반대 연산.
  // scale: 1/scale, rotateDeg: -rotateDeg, translate: -x,-y.
  const inv: TransformAction = {
    type: "transform",
    meta: genMeta(a.meta.id),
    clipId: a.clipId,
    scale: a.scale !== undefined ? 1.0 / a.scale : undefined,
    rotateDeg: a.rotateDeg !== undefined ? -a.rotateDeg : undefined,
    translate:
      a.translate !== undefined
        ? { x: -a.translate.x, y: -a.translate.y }
        : undefined,
  };
  return {
    forwardActionId: a.meta.id,
    inverse: inv,
    note: `inverse of transform(scale=${a.scale}, rotate=${a.rotateDeg}, translate=${JSON.stringify(a.translate)})`,
  };
}

function invertImageOverlay(a: ImageOverlayAction): InverseRecord {
  // imageOverlay 의 역은 같은 구간에 opacity=0 인 동일 오버레이 = 사실상 미표시 마커.
  const inv: ImageOverlayAction = {
    type: "imageOverlay",
    meta: genMeta(a.meta.id),
    clipId: a.clipId,
    source: a.source,
    start: a.start,
    end: a.end,
    position: { x: a.position.x, y: a.position.y },
    scale: a.scale,
    opacity: 0,
  };
  return {
    forwardActionId: a.meta.id,
    inverse: inv,
    note: `inverse of imageOverlay opacity=${a.opacity} — hide marker (opacity=0)`,
  };
}

function invertGenerate(a: GenerateAction): InverseRecord {
  // generate 의 역은 동일 prompt + 동일 insertAtMs 의 "no-op" 마커 — 의미상 "생성 취소".
  // 실제 자산 삭제는 dispatcher 범위 (현재 P2-1 scaffold 단계라 자산 생성 자체가 미실행).
  const inv: GenerateAction = {
    type: "generate",
    meta: genMeta(a.meta.id),
    kind: a.kind,
    prompt: `[REVERTED] ${a.prompt}`,
    model: a.model,
    durationMs: a.durationMs,
    aspect: a.aspect,
    insertAtMs: a.insertAtMs,
  };
  return {
    forwardActionId: a.meta.id,
    inverse: inv,
    note: `inverse of generate(${a.kind}) — revert marker`,
  };
}

function invertKeyframe(a: KeyframeAction): InverseRecord {
  // keyframe 의 역은 동일 property 에 첫 keyframe 값을 hold 로 단일 고정 — 변화 무효화 마커.
  // 실제 자산 상태 복원은 executor 구현 시점(P1)에 dispatcher 가 처리.
  const first = a.keyframes[0];
  const inv: KeyframeAction = {
    type: "keyframe",
    meta: genMeta(a.meta.id),
    clipId: a.clipId,
    property: a.property,
    keyframes: first
      ? [{ atMs: first.atMs, value: first.value, interp: "hold" }]
      : [],
  };
  return {
    forwardActionId: a.meta.id,
    inverse: inv,
    note: `inverse of keyframe(${a.property}, ×${a.keyframes.length}) — collapse to hold marker`,
  };
}

export function inverseOf(action: Action): InverseRecord {
  switch (action.type) {
    case "cut":
      return invertCut(action);
    case "trim":
      return invertTrim(action);
    case "reframe":
      return invertReframe(action);
    case "caption":
      return invertCaption(action);
    case "bgm":
      return invertBgm(action);
    case "transition":
      return invertTransition(action);
    case "speed":
      return invertSpeed(action);
    case "opacity":
      return invertOpacity(action);
    case "transform":
      return invertTransform(action);
    case "imageOverlay":
      return invertImageOverlay(action);
    case "generate":
      return invertGenerate(action);
    case "keyframe":
      return invertKeyframe(action);
    default: {
      const _exhaustive: never = action;
      void _exhaustive;
      throw new Error("unknown action type for inverse");
    }
  }
}
