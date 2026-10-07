// Real-time WYSIWYG compositor helpers used by Preview.tsx.
//
// Pure functions: given the current playhead (ms) and an Action[], they
// produce the canvas drawing parameters (transform/opacity) and the list of
// active overlays (captions, image overlays) at that moment.
//
// Anything that requires per-frame mutable state (image element cache, RAF
// handle) lives in Preview.tsx — these helpers stay testable in isolation.

import type {
  Action,
  CaptionAction,
  ImageOverlayAction,
  KeyframeAction,
  KeyframeValue,
  OpacityAction,
  TransformAction,
} from "@/lib/core/action-types";

export interface FrameStyle {
  // 0..1, multiplied into ctx.globalAlpha. Defaults to 1.
  opacity: number;
  // Around the canvas center, applied as translate→rotate→scale.
  scale: number;
  rotateRad: number;
  // In CSS pixels relative to canvas center; defaults 0,0.
  translateX: number;
  translateY: number;
}

const defaultStyle = (): FrameStyle => ({
  opacity: 1,
  scale: 1,
  rotateRad: 0,
  translateX: 0,
  translateY: 0,
});

// OpacityAction has explicit start/end and from/to. Linear interpolation.
function applyOpacityAction(style: FrameStyle, a: OpacityAction, tMs: number) {
  if (tMs < a.start || tMs > a.end) return;
  const span = Math.max(1, a.end - a.start);
  const k = Math.min(1, Math.max(0, (tMs - a.start) / span));
  const v = a.from + (a.to - a.from) * k;
  // Multiply rather than overwrite so multiple ramps compose.
  style.opacity *= Math.min(1, Math.max(0, v));
}

// Sample a KeyframeAction at a given time. Linear interpolation between
// adjacent keyframes; "hold" keeps the prior value until the next; "smooth"
// falls back to linear (conservative — full ease curves are follow-up work).
// Returns null when the keyframe list is empty.
export function sampleKeyframe(
  kf: KeyframeAction,
  tMs: number,
): KeyframeValue | null {
  const kfs = [...kf.keyframes].sort((a, b) => a.atMs - b.atMs);
  if (kfs.length === 0) return null;
  if (tMs <= kfs[0].atMs) return kfs[0].value;
  const last = kfs[kfs.length - 1];
  if (tMs >= last.atMs) return last.value;
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (tMs >= a.atMs && tMs < b.atMs) {
      if (a.interp === "hold" || b.atMs <= a.atMs) return a.value;
      const k = (tMs - a.atMs) / (b.atMs - a.atMs);
      return interpolateKfValue(a.value, b.value, k);
    }
  }
  return last.value;
}

function interpolateKfValue(
  a: KeyframeValue,
  b: KeyframeValue,
  k: number,
): KeyframeValue {
  if (typeof a === "number" && typeof b === "number") {
    return a + (b - a) * k;
  }
  if (
    typeof a === "object" &&
    typeof b === "object" &&
    a !== null &&
    b !== null &&
    "x" in a &&
    "x" in b
  ) {
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  }
  if (
    typeof a === "object" &&
    typeof b === "object" &&
    a !== null &&
    b !== null &&
    "w" in a &&
    "w" in b
  ) {
    return { w: a.w + (b.w - a.w) * k, h: a.h + (b.h - a.h) * k };
  }
  return a;
}

// Apply a single KeyframeAction to FrameStyle, matching execKeyframe's render
// semantics. Position is treated as a center-offset translation; values with
// |x|,|y| <= 1 are interpreted as normalized fractions of canvas dimensions.
function applyKeyframeAction(
  style: FrameStyle,
  kf: KeyframeAction,
  tMs: number,
  canvasW: number,
  canvasH: number,
) {
  const v = sampleKeyframe(kf, tMs);
  if (v === null) return;
  switch (kf.property) {
    case "opacity": {
      if (typeof v === "number") {
        style.opacity *= Math.min(1, Math.max(0, v));
      }
      return;
    }
    case "scale": {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) {
        style.scale *= v;
      }
      return;
    }
    case "rotation": {
      if (typeof v === "number" && Number.isFinite(v)) {
        style.rotateRad += (v * Math.PI) / 180;
      }
      return;
    }
    case "position": {
      if (
        typeof v === "object" &&
        v !== null &&
        "x" in v &&
        "y" in v &&
        Number.isFinite(v.x) &&
        Number.isFinite(v.y)
      ) {
        const normalized = Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
        style.translateX += normalized ? v.x * canvasW : v.x;
        style.translateY += normalized ? v.y * canvasH : v.y;
      }
      return;
    }
    case "crop":
    case "volume":
      // crop is unsupported in WYSIWYG today; volume has no visual effect.
      return;
  }
}

// TransformAction has no time range in the spec — it applies for the whole
// preview. translate is treated as normalized 0..1 (frame width/height) when
// |x|,|y| <= 1, otherwise as raw px. (Action-executor accepts both shapes.)
function applyTransformAction(
  style: FrameStyle,
  a: TransformAction,
  canvasW: number,
  canvasH: number,
) {
  if (typeof a.scale === "number" && Number.isFinite(a.scale) && a.scale > 0) {
    style.scale *= a.scale;
  }
  if (typeof a.rotateDeg === "number" && Number.isFinite(a.rotateDeg)) {
    style.rotateRad += (a.rotateDeg * Math.PI) / 180;
  }
  if (a.translate) {
    const { x, y } = a.translate;
    const normalized = Math.abs(x) <= 1 && Math.abs(y) <= 1;
    style.translateX += normalized ? x * canvasW : x;
    style.translateY += normalized ? y * canvasH : y;
  }
}

export function computeFrameStyle(
  actions: Action[],
  playheadMs: number,
  canvasW: number,
  canvasH: number,
): FrameStyle {
  const style = defaultStyle();
  for (const a of actions) {
    if (a.type === "opacity") applyOpacityAction(style, a, playheadMs);
    else if (a.type === "transform")
      applyTransformAction(style, a, canvasW, canvasH);
    else if (a.type === "keyframe")
      applyKeyframeAction(style, a, playheadMs, canvasW, canvasH);
  }
  return style;
}



export function activeCaptions(
  actions: Action[],
  playheadMs: number,
): CaptionAction[] {
  return actions.filter(
    (a): a is CaptionAction =>
      a.type === "caption" && a.start <= playheadMs && playheadMs <= a.end,
  );
}

export function activeImageOverlays(
  actions: Action[],
  playheadMs: number,
): ImageOverlayAction[] {
  return actions.filter(
    (a): a is ImageOverlayAction =>
      a.type === "imageOverlay" && a.start <= playheadMs && playheadMs <= a.end,
  );
}

// Caption renderer — burns text onto the canvas matching the DOM overlay
// behavior the previous Preview used (white text, dark shadow box).
export function drawCaption(
  ctx: CanvasRenderingContext2D,
  cap: CaptionAction,
  canvasW: number,
  canvasH: number,
) {
  const pos = cap.style?.pos ?? "bottom";
  const color = cap.style?.color ?? "#ffffff";
  const sizePx = cap.style?.size ?? 24;
  // Match the previous DOM rendering scale roughly — text width clamped to
  // 90% of the canvas width, wrapped on whitespace.
  const maxWidth = canvasW * 0.9;
  ctx.save();
  ctx.font = `700 ${sizePx}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const lines = wrapText(ctx, cap.text, maxWidth);
  const lineHeight = sizePx * 1.25;
  const totalH = lines.length * lineHeight;

  let cy: number;
  if (pos === "top") cy = canvasH * 0.1 + totalH / 2;
  else if (pos === "center") cy = canvasH / 2;
  else cy = canvasH * 0.9 - totalH / 2;

  // Translucent black backdrop (approx 4/8 px padding).
  const padX = 8;
  const padY = 4;
  const widest = lines.reduce((m, l) => {
    const w = ctx.measureText(l).width;
    return w > m ? w : m;
  }, 0);
  const boxW = Math.min(maxWidth, widest) + padX * 2;
  const boxH = totalH + padY * 2;
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(canvasW / 2 - boxW / 2, cy - boxH / 2, boxW, boxH);

  ctx.fillStyle = color;
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;
  ctx.shadowBlur = 4;
  lines.forEach((line, i) => {
    const y = cy - totalH / 2 + lineHeight / 2 + i * lineHeight;
    ctx.fillText(line, canvasW / 2, y, maxWidth);
  });
  ctx.restore();
}

// Word-wrap helper. Splits on existing newlines first, then greedy on spaces.
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    const words = para.split(/\s+/);
    let line = "";
    for (const w of words) {
      const probe = line ? `${line} ${w}` : w;
      if (ctx.measureText(probe).width > maxWidth && line) {
        out.push(line);
        line = w;
      } else {
        line = probe;
      }
    }
    out.push(line);
  }
  return out;
}
