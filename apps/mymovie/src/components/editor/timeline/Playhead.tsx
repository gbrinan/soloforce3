"use client";

import { clampMs, msToPx, pxToMs, type TimelineScale } from "@/lib/core/timeline-model";

interface Props {
  playheadMs: number;
  durationMs: number;
  scale: TimelineScale;
  height: number;
  onSeek: (ms: number) => void;
}

export default function Playhead({ playheadMs, durationMs, scale, height, onSeek }: Props) {
  const left = msToPx(clampMs(playheadMs, 0, durationMs), scale);

  function beginDrag(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const baseMs = clampMs(playheadMs, 0, durationMs);
    const move = (ev: PointerEvent) => {
      const next = clampMs(baseMs + pxToMs(ev.clientX - startX, scale), 0, durationMs);
      onSeek(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div
      style={{
        position: "absolute",
        left,
        top: 0,
        height,
        width: 2,
        background: "#F87171",
        pointerEvents: "none",
        zIndex: 5,
      }}
    >
      <div
        onPointerDown={beginDrag}
        style={{
          position: "absolute",
          top: -2,
          left: -6,
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: "#F87171",
          cursor: "ew-resize",
          pointerEvents: "auto",
          touchAction: "none",
        }}
        aria-label="playhead"
      />
    </div>
  );
}
