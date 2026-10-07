// P0 foundation — magnetic snap engine. Pure, stateless, React-free.
//
// Given a target time (ms) and a list of candidate snap points (e.g. other
// clip boundaries, playhead, marker positions), return the nearest candidate
// within `thresholdPx` pixels at the given pxPerMs scale. If no candidate is
// in range, return targetMs unchanged.
//
// Sticky-2.5x behavior: once a drag has "captured" a snap point, the snap
// radius should expand to ~2.5× to avoid jittery release on small mouse
// movements. This function is intentionally stateless — the caller is
// responsible for tracking sticky state and passing an inflated thresholdPx
// (typically `thresholdPx * 2.5`) while a snap is active.

export function snapMs(
  targetMs: number,
  candidates: number[],
  pxPerMs: number,
  thresholdPx: number = 8,
): number {
  if (!Number.isFinite(targetMs) || candidates.length === 0 || pxPerMs <= 0) {
    return targetMs;
  }
  let bestC = targetMs;
  let bestDistPx = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    if (!Number.isFinite(c)) continue;
    const distPx = Math.abs(targetMs - c) * pxPerMs;
    if (distPx <= thresholdPx && distPx < bestDistPx) {
      bestDistPx = distPx;
      bestC = c;
    }
  }
  return bestC;
}
