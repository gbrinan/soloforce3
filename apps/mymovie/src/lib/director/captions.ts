// Auto-caption mapper — Whisper transcript segments → CaptionAction[].
// Pure algorithm, safe to run on both server and client (no node imports).

import type { CaptionAction } from "../core/action-types";
import type { TranscriptSegment } from "./signals";

/** Long segments are split into chunks of at most this many characters. */
export const CAPTION_MAX_CHARS = 42;

function newActionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `act-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

/**
 * Split caption text at word boundaries so each chunk stays <= maxChars.
 * Words longer than maxChars are hard-split as a last resort.
 */
export function splitCaptionText(text: string, maxChars: number = CAPTION_MAX_CHARS): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];
  const words = trimmed.split(/\s+/);
  const chunks: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if (current.length + 1 + word.length <= maxChars) {
      current = `${current} ${word}`;
    } else {
      chunks.push(current);
      current = word;
    }
  }
  if (current) chunks.push(current);
  return chunks.flatMap((chunk) => {
    if (chunk.length <= maxChars) return [chunk];
    const hard: string[] = [];
    for (let i = 0; i < chunk.length; i += maxChars) {
      hard.push(chunk.slice(i, i + maxChars));
    }
    return hard;
  });
}

/**
 * Map transcript segments onto caption actions. A segment split into N chunks
 * divides its time range proportionally to chunk length. Times are clamped to
 * [0, durationMs] when durationMs > 0; zero-length captions are dropped.
 */
export function segmentsToCaptionActions(
  segments: TranscriptSegment[],
  clipId: string,
  durationMs = 0,
): CaptionAction[] {
  const actions: CaptionAction[] = [];
  for (const seg of segments) {
    const chunks = splitCaptionText(seg.text);
    if (chunks.length === 0) continue;
    const segStart = Math.max(0, Math.round(seg.startMs));
    const segEnd = Math.max(segStart + 1, Math.round(seg.endMs));
    const totalChars = chunks.reduce((acc, c) => acc + c.length, 0);
    let cursor = segStart;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const isLast = i === chunks.length - 1;
      const share = isLast
        ? segEnd - cursor
        : Math.max(1, Math.round(((segEnd - segStart) * chunk.length) / totalChars));
      let start = cursor;
      let end = Math.min(segEnd, start + share);
      cursor = end;
      if (durationMs > 0) {
        start = Math.min(start, durationMs);
        end = Math.min(end, durationMs);
      }
      if (end <= start) continue;
      actions.push({
        type: "caption",
        meta: { id: newActionId(), createdAt: Date.now(), source: "ai" },
        clipId,
        start,
        end,
        text: chunk,
        style: { pos: "bottom" },
      });
    }
  }
  return actions;
}
