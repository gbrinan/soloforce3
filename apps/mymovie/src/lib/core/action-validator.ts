// OpenReel core — Action[] 스키마·범위 검증 (스텁).
// 실 코어 fetch 시 OpenReel-video의 packages/core/action-validator로 교체.

import type { Action, Footage } from "./action-types";

export interface ValidationResult {
  ok: boolean;
  errors: { actionId?: string; reason: string }[];
}

function isFiniteMs(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

export function validateActions(actions: Action[], footage?: Footage): ValidationResult {
  const errors: ValidationResult["errors"] = [];
  for (const a of actions) {
    if (!a.meta?.id) {
      errors.push({ reason: "missing meta.id" });
      continue;
    }
    switch (a.type) {
      case "cut": {
        if (!isFiniteMs(a.at)) errors.push({ actionId: a.meta.id, reason: "cut.at must be finite non-negative ms" });
        if (footage && a.at > footage.durationMs) {
          errors.push({ actionId: a.meta.id, reason: "cut.at exceeds footage duration" });
        }
        break;
      }
      case "trim": {
        if (!isFiniteMs(a.start) || !isFiniteMs(a.end)) {
          errors.push({ actionId: a.meta.id, reason: "trim.start/end must be finite non-negative ms" });
        } else if (a.start >= a.end) {
          errors.push({ actionId: a.meta.id, reason: "trim.start must be < trim.end" });
        }
        break;
      }
      case "reframe": {
        if (a.aspect.w <= 0 || a.aspect.h <= 0) {
          errors.push({ actionId: a.meta.id, reason: "reframe.aspect must be positive" });
        }
        if (a.focal && (a.focal.x < 0 || a.focal.x > 1 || a.focal.y < 0 || a.focal.y > 1)) {
          errors.push({ actionId: a.meta.id, reason: "reframe.focal must be in [0,1]" });
        }
        break;
      }
      case "caption": {
        if (!isFiniteMs(a.start) || !isFiniteMs(a.end) || a.start >= a.end) {
          errors.push({ actionId: a.meta.id, reason: "caption.start must be < caption.end" });
        }
        if (typeof a.text !== "string" || a.text.length === 0) {
          errors.push({ actionId: a.meta.id, reason: "caption.text must be non-empty string" });
        }
        break;
      }
      case "bgm": {
        if (typeof a.volume !== "number" || a.volume < 0 || a.volume > 1) {
          errors.push({ actionId: a.meta.id, reason: "bgm.volume must be in [0,1]" });
        }
        if (a.fadeInMs !== undefined && !isFiniteMs(a.fadeInMs)) {
          errors.push({ actionId: a.meta.id, reason: "bgm.fadeInMs must be finite non-negative ms" });
        }
        if (a.fadeOutMs !== undefined && !isFiniteMs(a.fadeOutMs)) {
          errors.push({ actionId: a.meta.id, reason: "bgm.fadeOutMs must be finite non-negative ms" });
        }
        break;
      }
      case "transition": {
        if (!isFiniteMs(a.durationMs) || a.durationMs <= 0) {
          errors.push({ actionId: a.meta.id, reason: "transition.durationMs must be positive" });
        }
        break;
      }
      case "speed": {
        if (typeof a.factor !== "number" || a.factor < 0.25 || a.factor > 4.0) {
          errors.push({ actionId: a.meta.id, reason: "speed.factor must be in [0.25, 4.0]" });
        }
        break;
      }
      case "opacity": {
        if (!isFiniteMs(a.start) || !isFiniteMs(a.end) || a.start >= a.end) {
          errors.push({ actionId: a.meta.id, reason: "opacity.start must be < opacity.end" });
        }
        if (typeof a.from !== "number" || a.from < 0 || a.from > 1) {
          errors.push({ actionId: a.meta.id, reason: "opacity.from must be in [0,1]" });
        }
        if (typeof a.to !== "number" || a.to < 0 || a.to > 1) {
          errors.push({ actionId: a.meta.id, reason: "opacity.to must be in [0,1]" });
        }
        break;
      }
      case "transform": {
        if (a.scale !== undefined && (typeof a.scale !== "number" || a.scale <= 0)) {
          errors.push({ actionId: a.meta.id, reason: "transform.scale must be positive" });
        }
        if (a.rotateDeg !== undefined && (typeof a.rotateDeg !== "number" || a.rotateDeg < -360 || a.rotateDeg > 360)) {
          errors.push({ actionId: a.meta.id, reason: "transform.rotateDeg must be in [-360, 360]" });
        }
        if (a.translate !== undefined) {
          if (typeof a.translate.x !== "number" || typeof a.translate.y !== "number") {
            errors.push({ actionId: a.meta.id, reason: "transform.translate must have numeric x,y" });
          }
        }
        break;
      }
      case "imageOverlay": {
        if (!isFiniteMs(a.start) || !isFiniteMs(a.end) || a.start >= a.end) {
          errors.push({ actionId: a.meta.id, reason: "imageOverlay.start must be < imageOverlay.end" });
        }
        if (typeof a.source !== "string" || a.source.length === 0) {
          errors.push({ actionId: a.meta.id, reason: "imageOverlay.source must be non-empty path" });
        }
        if (typeof a.opacity !== "number" || a.opacity < 0 || a.opacity > 1) {
          errors.push({ actionId: a.meta.id, reason: "imageOverlay.opacity must be in [0,1]" });
        }
        if (typeof a.scale !== "number" || a.scale <= 0) {
          errors.push({ actionId: a.meta.id, reason: "imageOverlay.scale must be positive" });
        }
        if (
          !a.position ||
          typeof a.position.x !== "number" || a.position.x < 0 || a.position.x > 1 ||
          typeof a.position.y !== "number" || a.position.y < 0 || a.position.y > 1
        ) {
          errors.push({ actionId: a.meta.id, reason: "imageOverlay.position.{x,y} must be in [0,1]" });
        }
        break;
      }
      case "keyframe": {
        if (typeof a.clipId !== "string" || a.clipId.length === 0) {
          errors.push({ actionId: a.meta.id, reason: "keyframe.clipId must be non-empty string" });
        }
        const validProps = ["opacity", "position", "scale", "rotation", "crop", "volume"];
        if (!validProps.includes(a.property)) {
          errors.push({
            actionId: a.meta.id,
            reason: `keyframe.property must be one of ${validProps.join("|")}`,
          });
        }
        if (!Array.isArray(a.keyframes) || a.keyframes.length === 0) {
          errors.push({ actionId: a.meta.id, reason: "keyframe.keyframes must be non-empty array" });
        } else {
          for (const kf of a.keyframes) {
            if (!isFiniteMs(kf.atMs)) {
              errors.push({
                actionId: a.meta.id,
                reason: "keyframe.keyframes[*].atMs must be finite non-negative ms",
              });
              break;
            }
            if (kf.interp !== "linear" && kf.interp !== "smooth" && kf.interp !== "hold") {
              errors.push({
                actionId: a.meta.id,
                reason: "keyframe.keyframes[*].interp must be linear|smooth|hold",
              });
              break;
            }
          }
        }
        break;
      }
      case "generate": {
        if (a.kind !== "image" && a.kind !== "video" && a.kind !== "audio") {
          errors.push({ actionId: a.meta.id, reason: "generate.kind must be image|video|audio" });
        }
        if (typeof a.prompt !== "string" || a.prompt.length === 0) {
          errors.push({ actionId: a.meta.id, reason: "generate.prompt must be non-empty string" });
        }
        if (!isFiniteMs(a.insertAtMs)) {
          errors.push({ actionId: a.meta.id, reason: "generate.insertAtMs must be finite non-negative ms" });
        }
        if (a.durationMs !== undefined && !isFiniteMs(a.durationMs)) {
          errors.push({ actionId: a.meta.id, reason: "generate.durationMs must be finite non-negative ms" });
        }
        if (a.aspect !== undefined && (a.aspect.w <= 0 || a.aspect.h <= 0)) {
          errors.push({ actionId: a.meta.id, reason: "generate.aspect must be positive" });
        }
        break;
      }
      default: {
        const _exhaustive: never = a;
        errors.push({ reason: `unknown action type: ${JSON.stringify(_exhaustive)}` });
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
