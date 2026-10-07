// Silence/filler cut suggestions — pure local analysis over transcript segments.
// No LLM, no network: gap heuristics + filler-word regex only.

import type { TranscriptSegment } from "./signals";

export interface CutSuggestion {
  id: string;
  kind: "silence" | "filler";
  startMs: number;
  endMs: number;
  /** Human-readable summary (gap length or matched filler text). */
  label: string;
}

/** A gap between speech segments of at least this length counts as silence. */
export const SILENCE_GAP_MS = 1500;

// Standalone filler tokens (Korean + English). Boundary chars around the token
// prevent false hits inside words like "어디" or "음악".
const FILLER_RE =
  /(?:^|[\s,.!?~…])(음+…?|어+…?|그니까|그러니까|uh+m*|um+|hmm+|erm+)(?=$|[\s,.!?~…])/giu;

function suggestionId(kind: string, startMs: number, endMs: number): string {
  return `${kind}-${Math.round(startMs)}-${Math.round(endMs)}`;
}

/**
 * Detect silences (inter-segment gaps >= gapMs, including leading/trailing
 * gaps when durationMs is known) and filler-word segments. Returns
 * suggestions sorted by startMs.
 */
export function suggestCuts(
  segments: TranscriptSegment[],
  durationMs = 0,
  gapMs: number = SILENCE_GAP_MS,
): CutSuggestion[] {
  const out: CutSuggestion[] = [];
  const sorted = [...segments]
    .filter((s) => s.endMs > s.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  // Silence: leading gap, inter-segment gaps, trailing gap.
  if (sorted.length > 0 && sorted[0].startMs >= gapMs) {
    out.push(makeSilence(0, sorted[0].startMs));
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const gapStart = sorted[i].endMs;
    const gapEnd = sorted[i + 1].startMs;
    if (gapEnd - gapStart >= gapMs) out.push(makeSilence(gapStart, gapEnd));
  }
  if (sorted.length > 0 && durationMs > 0) {
    const last = sorted[sorted.length - 1];
    if (durationMs - last.endMs >= gapMs) out.push(makeSilence(last.endMs, durationMs));
  }

  // Filler: any segment whose text contains a standalone filler token.
  for (const seg of sorted) {
    FILLER_RE.lastIndex = 0;
    const matches: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = FILLER_RE.exec(seg.text)) !== null) {
      matches.push(m[1]);
    }
    if (matches.length === 0) continue;
    out.push({
      id: suggestionId("filler", seg.startMs, seg.endMs),
      kind: "filler",
      startMs: Math.round(seg.startMs),
      endMs: Math.round(seg.endMs),
      label: `"${matches.join(", ")}" — ${seg.text.trim().slice(0, 40)}`,
    });
  }

  return out.sort((a, b) => a.startMs - b.startMs);
}

function makeSilence(startMs: number, endMs: number): CutSuggestion {
  return {
    id: suggestionId("silence", startMs, endMs),
    kind: "silence",
    startMs: Math.round(startMs),
    endMs: Math.round(endMs),
    label: `${((endMs - startMs) / 1000).toFixed(1)}s`,
  };
}

/**
 * Cut points for one-click apply: split at both range boundaries, dropping
 * out-of-range values (0 and beyond clip duration need no cut).
 */
export function suggestionCutTimes(s: CutSuggestion, durationMs = 0): number[] {
  return [s.startMs, s.endMs].filter(
    (at) => at > 0 && (durationMs <= 0 || at < durationMs),
  );
}
