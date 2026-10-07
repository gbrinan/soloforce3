// OpenReel core — JSON Action 타입 정의 (스텁).
// 실 코드 fetch 시 이 파일은 OpenReel-video의 packages/core/action-types로 교체됨.

export type TimeMs = number;

export interface ActionMeta {
  id: string;
  createdAt: number;
  source: "user" | "ai" | "system";
}

export interface CutAction {
  type: "cut";
  meta: ActionMeta;
  clipId: string;
  at: TimeMs;
}

export interface TrimAction {
  type: "trim";
  meta: ActionMeta;
  clipId: string;
  start: TimeMs;
  end: TimeMs;
}

export interface ReframeAction {
  type: "reframe";
  meta: ActionMeta;
  clipId: string;
  // 9:16 ↔ 16:9 등. 비율을 분자/분모로 저장.
  aspect: { w: number; h: number };
  // 0..1 normalized focal point (자동 리프레이밍의 중심).
  focal?: { x: number; y: number };
}

export interface CaptionAction {
  type: "caption";
  meta: ActionMeta;
  clipId: string;
  start: TimeMs;
  end: TimeMs;
  text: string;
  style?: { color?: string; size?: number; pos?: "top" | "bottom" | "center" };
}

export interface BgmAction {
  type: "bgm";
  meta: ActionMeta;
  source: string;
  volume: number;
  start?: TimeMs;
  end?: TimeMs;
  // Audio fade lengths in ms. Both default to 0 (no fade). Applied as
  // afade=t=in/afade=t=out before amix in execBgm.
  fadeInMs?: TimeMs;
  fadeOutMs?: TimeMs;
}

export interface TransitionAction {
  type: "transition";
  meta: ActionMeta;
  fromClipId: string;
  toClipId: string;
  kind: "fade" | "wipe" | "slide" | "cut";
  durationMs: TimeMs;
}

export interface SpeedAction {
  type: "speed";
  meta: ActionMeta;
  clipId: string;
  factor: number; // 0.25~4.0
}

export interface OpacityAction {
  type: "opacity";
  meta: ActionMeta;
  clipId: string;
  start: TimeMs;
  end: TimeMs;
  from: number; // 0..1
  to: number;   // 0..1
}

export interface TransformAction {
  type: "transform";
  meta: ActionMeta;
  clipId: string;
  scale?: number;       // 1.0 = 100%
  rotateDeg?: number;   // -360..360
  translate?: { x: number; y: number }; // px or 0..1 normalized
}

export interface ImageOverlayAction {
  type: "imageOverlay";
  meta: ActionMeta;
  clipId: string;
  source: string;       // absolute path to PNG/JPG asset
  start: TimeMs;
  end: TimeMs;
  position: { x: number; y: number }; // 0..1 normalized (frame coords)
  scale: number;        // 0<scale; 1.0 = 100% of source asset
  opacity: number;      // 0..1
}

// P2-1 scaffold: AI 미디어 생성. 실제 호출은 env key 존재 시에만(현재 본 리포지토리는 호출하지 않음).
// 비용 발생 가능 — Toolbar UI는 키 미설정 시 disabled.
export interface GenerateAction {
  type: "generate";
  meta: ActionMeta;
  kind: "image" | "video" | "audio";
  prompt: string;
  model?: string;               // e.g. "gemini-2.5-pro", "veo-3", "elevenlabs"
  durationMs?: TimeMs;          // video/audio 한정
  aspect?: { w: number; h: number }; // image/video 한정
  insertAtMs: TimeMs;           // 타임라인 삽입 지점(전역 시각)
}

// P0 foundation: keyframe-driven property animation. Keyframes are emitted at
// authoring time and consumed by the executor (TODO: ffmpeg sendcmd / overlay
// curves). Property-specific value shape is encoded in the union below.
export type KeyframeValue =
  | number
  | { x: number; y: number }
  | { w: number; h: number };

export interface KeyframePoint {
  atMs: TimeMs;
  value: KeyframeValue;
  interp: "linear" | "smooth" | "hold";
}

export interface KeyframeAction {
  type: "keyframe";
  meta: ActionMeta;
  clipId: string;
  property: "opacity" | "position" | "scale" | "rotation" | "crop" | "volume";
  keyframes: KeyframePoint[];
}

export type Action =
  | CutAction
  | TrimAction
  | ReframeAction
  | CaptionAction
  | BgmAction
  | TransitionAction
  | SpeedAction
  | OpacityAction
  | TransformAction
  | ImageOverlayAction
  | GenerateAction
  | KeyframeAction;

export type ActionType = Action["type"];

export interface Footage {
  id: string;
  path: string;
  durationMs: TimeMs;
  width: number;
  height: number;
}

export interface ExecuteResult {
  ok: boolean;
  appliedActionIds: string[];
  failedActionIds: string[];
  errors?: { actionId: string; reason: string }[];
}
