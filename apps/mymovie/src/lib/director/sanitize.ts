// LLM 출력 → 엄격한 Action[] 변환. 알 수 없는 type/필드는 드롭(환각 가드).
// validator는 별도로 동작 — 여기는 1차 정형화.

import type { Action, ActionType } from "../core/action-types";

const ALLOWED_TYPES: ActionType[] = ["cut", "trim", "reframe", "caption", "bgm", "transition"];

function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

let counter = 0;
function freshId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

function normalizeMeta(raw: unknown): { id: string; createdAt: number; source: "ai" } {
  const r = (raw ?? {}) as { id?: unknown; createdAt?: unknown };
  return {
    id: typeof r.id === "string" && r.id.length > 0 ? r.id : freshId("a"),
    createdAt: typeof r.createdAt === "number" ? r.createdAt : Date.now(),
    source: "ai",
  };
}

export interface SanitizeReport {
  accepted: Action[];
  rejected: Array<{ index: number; reason: string; raw: unknown }>;
}

export function sanitizeActions(parsed: unknown[], opts?: { clipId?: string }): SanitizeReport {
  const accepted: Action[] = [];
  const rejected: SanitizeReport["rejected"] = [];
  const defaultClip = opts?.clipId ?? "clip-1";

  parsed.forEach((rawUnknown, index) => {
    if (!rawUnknown || typeof rawUnknown !== "object") {
      rejected.push({ index, reason: "not an object", raw: rawUnknown });
      return;
    }
    const raw = rawUnknown as Record<string, unknown>;
    const type = raw.type as string | undefined;
    if (!type || !ALLOWED_TYPES.includes(type as ActionType)) {
      rejected.push({ index, reason: `unknown type ${String(type)}`, raw });
      return;
    }
    const meta = normalizeMeta(raw.meta);
    switch (type) {
      case "cut": {
        if (!isNumber(raw.at)) {
          rejected.push({ index, reason: "cut.at missing/non-number", raw });
          return;
        }
        accepted.push({
          type: "cut",
          meta,
          clipId: asString(raw.clipId, defaultClip),
          at: raw.at,
        });
        return;
      }
      case "trim": {
        if (!isNumber(raw.start) || !isNumber(raw.end)) {
          rejected.push({ index, reason: "trim.start/end missing/non-number", raw });
          return;
        }
        accepted.push({
          type: "trim",
          meta,
          clipId: asString(raw.clipId, defaultClip),
          start: raw.start,
          end: raw.end,
        });
        return;
      }
      case "reframe": {
        const aspect = raw.aspect as { w?: unknown; h?: unknown } | undefined;
        if (!aspect || !isNumber(aspect.w) || !isNumber(aspect.h)) {
          rejected.push({ index, reason: "reframe.aspect missing", raw });
          return;
        }
        const focal = raw.focal as { x?: unknown; y?: unknown } | undefined;
        accepted.push({
          type: "reframe",
          meta,
          clipId: asString(raw.clipId, defaultClip),
          aspect: { w: aspect.w, h: aspect.h },
          focal:
            focal && isNumber(focal.x) && isNumber(focal.y)
              ? { x: focal.x, y: focal.y }
              : undefined,
        });
        return;
      }
      case "caption": {
        if (!isNumber(raw.start) || !isNumber(raw.end) || typeof raw.text !== "string") {
          rejected.push({ index, reason: "caption fields invalid", raw });
          return;
        }
        const style = raw.style as
          | { color?: unknown; size?: unknown; pos?: unknown }
          | undefined;
        accepted.push({
          type: "caption",
          meta,
          clipId: asString(raw.clipId, defaultClip),
          start: raw.start,
          end: raw.end,
          text: raw.text,
          style: style
            ? {
                color: typeof style.color === "string" ? style.color : undefined,
                size: isNumber(style.size) ? style.size : undefined,
                pos:
                  style.pos === "top" || style.pos === "bottom" || style.pos === "center"
                    ? style.pos
                    : undefined,
              }
            : undefined,
        });
        return;
      }
      case "bgm": {
        if (typeof raw.source !== "string" || !isNumber(raw.volume)) {
          rejected.push({ index, reason: "bgm fields invalid", raw });
          return;
        }
        accepted.push({
          type: "bgm",
          meta,
          source: raw.source,
          volume: Math.max(0, Math.min(1, raw.volume)),
          start: isNumber(raw.start) ? raw.start : undefined,
          end: isNumber(raw.end) ? raw.end : undefined,
        });
        return;
      }
      case "transition": {
        const kind = raw.kind;
        const allowedKinds = ["fade", "wipe", "slide", "cut"];
        if (
          typeof raw.fromClipId !== "string" ||
          typeof raw.toClipId !== "string" ||
          typeof kind !== "string" ||
          !allowedKinds.includes(kind) ||
          !isNumber(raw.durationMs)
        ) {
          rejected.push({ index, reason: "transition fields invalid", raw });
          return;
        }
        accepted.push({
          type: "transition",
          meta,
          fromClipId: raw.fromClipId,
          toClipId: raw.toClipId,
          kind: kind as "fade" | "wipe" | "slide" | "cut",
          durationMs: raw.durationMs,
        });
        return;
      }
      default: {
        rejected.push({ index, reason: "unhandled type", raw });
        return;
      }
    }
  });

  return { accepted, rejected };
}
