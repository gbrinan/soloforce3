// Track-timeline model. Pure helpers mapping the declarative Action list to
// visual track segments and back. No React here so the logic stays testable.
import type {
  Action,
  BgmAction,
  CaptionAction,
  CutAction,
  ImageOverlayAction,
  TrimAction,
} from "./action-types";

export interface TimelineScale {
  pxPerMs: number;
}

// 0.05 px/ms == 50px per second. Tuned so a 60s clip fits a typical panel.
export const DEFAULT_PX_PER_MS = 0.05;
export const MIN_PX_PER_MS = 0.01;
export const MAX_PX_PER_MS = 0.3;

// Trim/cut drags never produce a segment shorter than this.
export const MIN_SEGMENT_MS = 100;

export function msToPx(ms: number, scale: TimelineScale): number {
  return ms * scale.pxPerMs;
}

export function pxToMs(px: number, scale: TimelineScale): number {
  return scale.pxPerMs > 0 ? px / scale.pxPerMs : 0;
}

export function clampMs(ms: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, ms));
}

export interface VideoSegment {
  clipId: string;
  title: string;
  startMs: number;
  endMs: number;
  source?: "user" | "ai" | "system";
}

// PoC: one video track driven by the primary clip. A user trim narrows the
// visible segment; otherwise it spans the full clip duration.
export function deriveVideoSegment(
  primaryClipId: string,
  primaryTitle: string,
  actions: Action[],
  durationMs: number,
): VideoSegment {
  const trim = actions.find(
    (a): a is TrimAction => a.type === "trim" && a.clipId === primaryClipId,
  );
  const startMs = trim ? trim.start : 0;
  const endMs = trim ? trim.end : durationMs;
  const source = trim?.meta.source;
  return { clipId: primaryClipId, title: primaryTitle, startMs, endMs, source };
}

export interface BgmSegment {
  id: string;
  startMs: number;
  endMs: number;
  label: string;
  source?: "user" | "ai" | "system";
}

export function deriveBgmSegments(actions: Action[], durationMs: number): BgmSegment[] {
  return actions
    .filter((a): a is BgmAction => a.type === "bgm")
    .map((a) => ({
      id: a.meta.id,
      startMs: a.start ?? 0,
      endMs: a.end ?? durationMs,
      label: a.source,
      source: a.meta.source,
    }));
}

export interface CutMarker {
  id: string;
  atMs: number;
  source?: "user" | "ai" | "system";
}

export function deriveCutMarkers(primaryClipId: string, actions: Action[]): CutMarker[] {
  return actions
    .filter((a): a is CutAction => a.type === "cut" && a.clipId === primaryClipId)
    .map((a) => ({ id: a.meta.id, atMs: a.at, source: a.meta.source }));
}

export interface TextSegment {
  id: string;
  startMs: number;
  endMs: number;
  label: string;
  source?: "user" | "ai" | "system";
}

export function deriveTextSegments(actions: Action[], durationMs: number): TextSegment[] {
  return actions
    .filter((a): a is CaptionAction => a.type === "caption")
    .map((a) => ({
      id: a.meta.id,
      startMs: clampMs(a.start, 0, durationMs),
      endMs: clampMs(a.end, 0, durationMs),
      label: a.text,
      source: a.meta.source,
    }));
}

export interface ImageSegment {
  id: string;
  startMs: number;
  endMs: number;
  label: string;
  source?: "user" | "ai" | "system";
}

export function deriveImageSegments(actions: Action[], durationMs: number): ImageSegment[] {
  return actions
    .filter((a): a is ImageOverlayAction => a.type === "imageOverlay")
    .map((a) => {
      const file = a.source.split("/").pop() ?? a.source;
      return {
        id: a.meta.id,
        startMs: clampMs(a.start, 0, durationMs),
        endMs: clampMs(a.end, 0, durationMs),
        label: file,
        source: a.meta.source,
      };
    });
}

// ---------------------------------------------------------------------------
// P0 foundation: multi-clip timeline model.
// `Clip` represents a placed instance on the NLE timeline (one footage may be
// referenced by multiple clips). `TimelineState` bundles clips + the declarative
// Action[] so reducers/engines (snap, ripple, keyframe) can stay pure.
// ClipMeta from clip-meta.ts is retained for legacy single-track flows; a Clip
// can be derived from a ClipMeta by attaching placement fields (timelineStartMs,
// source* range, track) — see helpers below.
// ---------------------------------------------------------------------------

export interface Clip {
  id: string;
  jobId: string;
  title?: string;
  sourceStartMs: number;
  sourceEndMs: number;
  timelineStartMs: number;
  track: number; // 0 = primary video, 1+ = overlay
  source: string; // url or path
}

export interface TimelineState {
  clips: Clip[];
  actions: Action[];
}

function clipDurationMs(c: Clip): number {
  return Math.max(0, c.sourceEndMs - c.sourceStartMs);
}

// moveClip: shift a clip's timelineStartMs by deltaMs (clamped to >= 0).
// Pure: returns a new array; non-target clips are referentially preserved.
export function moveClip(clips: Clip[], clipId: string, deltaMs: number): Clip[] {
  return clips.map((c) => {
    if (c.id !== clipId) return c;
    const next = Math.max(0, c.timelineStartMs + deltaMs);
    return { ...c, timelineStartMs: next };
  });
}

// reorderClip: within track 0, reposition the clip at logical newIndex.
// Logical index = order after sorting by timelineStartMs. After the swap, the
// moved clip inherits the original timelineStartMs of the slot it landed in.
// Other-track clips are passed through unchanged. Bounds: newIndex clamped to
// [0, track0.length - 1].
export function reorderClip(clips: Clip[], clipId: string, newIndex: number): Clip[] {
  const track0 = clips
    .filter((c) => c.track === 0)
    .sort((a, b) => a.timelineStartMs - b.timelineStartMs);
  const others = clips.filter((c) => c.track !== 0);
  const fromIdx = track0.findIndex((c) => c.id === clipId);
  if (fromIdx < 0 || track0.length === 0) return clips;
  const toIdx = Math.max(0, Math.min(track0.length - 1, newIndex));
  if (toIdx === fromIdx) return clips;
  const moved = track0[fromIdx];
  const rest = [...track0.slice(0, fromIdx), ...track0.slice(fromIdx + 1)];
  rest.splice(toIdx, 0, moved);
  // Re-pack timelineStartMs sequentially so reorder is visible. Anchor at the
  // first slot's original start; each subsequent clip starts where the prior
  // one ends.
  const anchor = track0[0].timelineStartMs;
  let cursor = anchor;
  const repacked = rest.map((c) => {
    const placed = { ...c, timelineStartMs: cursor };
    cursor += clipDurationMs(c);
    return placed;
  });
  return [...others, ...repacked];
}

// duplicateClip: clone the given clip on the same track. The duplicate keeps
// the source range, gets a fresh id (caller-supplied or auto-generated), and
// is placed at the first non-overlapping slot on the same track at or after
// the original's end. Existing clips on the same track are left in place; if
// none come after the original, the duplicate lands right after it. Pure —
// returns a new array.
export function duplicateClip(
  clips: Clip[],
  clipId: string,
  newId?: string,
): Clip[] {
  const src = clips.find((c) => c.id === clipId);
  if (!src) return clips;
  const duration = clipDurationMs(src);
  const sameTrack = clips
    .filter((c) => c.track === src.track && c.id !== src.id)
    .sort((a, b) => a.timelineStartMs - b.timelineStartMs);
  // Walk same-track clips: start at original.end, push forward past any clip
  // whose range overlaps the candidate slot.
  let candidateStart = src.timelineStartMs + duration;
  for (const other of sameTrack) {
    const otherEnd = other.timelineStartMs + clipDurationMs(other);
    if (other.timelineStartMs < candidateStart + duration && otherEnd > candidateStart) {
      candidateStart = otherEnd;
    }
  }
  const dupId =
    newId ?? `${src.id}-dup-${Math.random().toString(36).slice(2, 8)}`;
  const dup: Clip = {
    ...src,
    id: dupId,
    timelineStartMs: candidateStart,
  };
  return [...clips, dup];
}

// insertClipAt: push newClip into clips at the given timelineStartMs. The new
// clip's track is respected (caller decides). Result is sorted by track then
// timelineStartMs so downstream rendering is deterministic. This does NOT
// ripple existing clips — use ripple-engine.rippleInsert for that.
export function insertClipAt(clips: Clip[], newClip: Clip, atMs: number): Clip[] {
  const placed: Clip = {
    ...newClip,
    timelineStartMs: Math.max(0, atMs),
  };
  const next = [...clips, placed];
  next.sort((a, b) =>
    a.track === b.track ? a.timelineStartMs - b.timelineStartMs : a.track - b.track,
  );
  return next;
}

// mm:ss for ruler tick labels.
export function formatTimecode(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Ruler tick spacing (ms) chosen so labels stay ~60px+ apart at the given scale.
export function tickStepMs(scale: TimelineScale): number {
  const steps = [1000, 2000, 5000, 10000, 30000, 60000];
  for (const step of steps) {
    if (msToPx(step, scale) >= 60) return step;
  }
  return steps[steps.length - 1];
}
