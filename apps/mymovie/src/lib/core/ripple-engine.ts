// P0 foundation — ripple edit operations on Clip[]. Pure, React-free.
//
// All operations are scoped to the same `track` as the target/new clip. Other
// tracks are passed through unchanged so overlays don't shift when the primary
// video track ripples.

import type { Clip } from "./timeline-model";

function clipDuration(c: Clip): number {
  return Math.max(0, c.sourceEndMs - c.sourceStartMs);
}

// rippleDelete — remove the target clip, then shift every subsequent clip on
// the same track backwards by the deleted clip's duration. Predecessors and
// other-track clips are untouched.
export function rippleDelete(clips: Clip[], clipId: string): Clip[] {
  const target = clips.find((c) => c.id === clipId);
  if (!target) return clips;
  const dur = clipDuration(target);
  return clips
    .filter((c) => c.id !== clipId)
    .map((c) => {
      if (c.track !== target.track) return c;
      if (c.timelineStartMs <= target.timelineStartMs) return c;
      return { ...c, timelineStartMs: Math.max(0, c.timelineStartMs - dur) };
    });
}

// rippleInsert — open a gap of newClip.duration at `atMs` on newClip.track by
// shifting same-track clips that start at or after `atMs` forward, then place
// newClip at atMs. Existing clips that already start before atMs stay put.
export function rippleInsert(clips: Clip[], newClip: Clip, atMs: number): Clip[] {
  const at = Math.max(0, atMs);
  const dur = clipDuration(newClip);
  const placed: Clip = { ...newClip, timelineStartMs: at };
  const shifted = clips.map((c) => {
    if (c.track !== newClip.track) return c;
    if (c.timelineStartMs < at) return c;
    return { ...c, timelineStartMs: c.timelineStartMs + dur };
  });
  const next = [...shifted, placed];
  next.sort((a, b) =>
    a.track === b.track ? a.timelineStartMs - b.timelineStartMs : a.track - b.track,
  );
  return next;
}

// rippleOverwrite — drop any same-track clips whose time range overlaps with
// newClip's range, then insert newClip. No shifting (unlike rippleInsert).
// Overlap test is half-open [start, end).
export function rippleOverwrite(clips: Clip[], newClip: Clip): Clip[] {
  const newStart = newClip.timelineStartMs;
  const newEnd = newStart + clipDuration(newClip);
  const kept = clips.filter((c) => {
    if (c.track !== newClip.track) return true;
    const cStart = c.timelineStartMs;
    const cEnd = cStart + clipDuration(c);
    const overlaps = cStart < newEnd && cEnd > newStart;
    return !overlaps;
  });
  const next = [...kept, newClip];
  next.sort((a, b) =>
    a.track === b.track ? a.timelineStartMs - b.timelineStartMs : a.track - b.track,
  );
  return next;
}
