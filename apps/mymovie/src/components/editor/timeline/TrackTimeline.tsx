"use client";

import { useMemo, useRef, useState } from "react";
import { Box, Button, Group, Slider, Stack, Text } from "@mantine/core";
import { IconCut } from "@tabler/icons-react";
import type { Action } from "@/lib/core/action-types";
import type { ClipMeta } from "@/lib/core/clip-meta";
import {
  DEFAULT_PX_PER_MS,
  MAX_PX_PER_MS,
  MIN_PX_PER_MS,
  type TimelineScale,
  clampMs,
  deriveBgmSegments,
  deriveCutMarkers,
  deriveImageSegments,
  deriveTextSegments,
  deriveVideoSegment,
  formatTimecode,
  msToPx,
  pxToMs,
  tickStepMs,
} from "@/lib/core/timeline-model";
import ClipBlock from "./ClipBlock";
import Playhead from "./Playhead";
import { useI18n } from "@/lib/i18n/I18nProvider";

interface Props {
  clips: ClipMeta[];
  actions: Action[];
  durationMs: number;
  playheadMs: number;
  pxPerMs: number;
  onPxPerMsChange: (v: number) => void;
  onSeek: (ms: number) => void;
  onTrim: (clipId: string, startMs: number, endMs: number) => void;
  onCut: (clipId: string, atMs: number) => void;
  // Optional: NLE multi-select wiring. Caller owns selectedClipIds; this
  // component bubbles marquee/click selections back through onSelectChange.
  selectedClipIds?: string[];
  onSelectChange?: (ids: string[]) => void;
  onClipMove?: (clipId: string, deltaMs: number) => void;
  onDuplicateClip?: (clipId: string) => void;
}

const RULER_H = 24;
const TRACK_H = 44;
const TRACK_GAP = 6;

export default function TrackTimeline({
  clips,
  actions,
  durationMs,
  playheadMs,
  pxPerMs,
  onPxPerMsChange,
  onSeek,
  onTrim,
  onCut,
  selectedClipIds,
  onSelectChange,
  onClipMove,
  onDuplicateClip,
}: Props) {
  const { t } = useI18n();
  const areaRef = useRef<HTMLDivElement>(null);
  const primary = clips[0] ?? null;
  const scale: TimelineScale = { pxPerMs };

  const segment = useMemo(
    () =>
      primary
        ? deriveVideoSegment(primary.jobId, primary.title, actions, durationMs)
        : null,
    [primary, actions, durationMs],
  );
  const bgmSegments = useMemo(() => deriveBgmSegments(actions, durationMs), [actions, durationMs]);
  const textSegments = useMemo(() => deriveTextSegments(actions, durationMs), [actions, durationMs]);
  const imageSegments = useMemo(() => deriveImageSegments(actions, durationMs), [actions, durationMs]);
  const cutMarkers = useMemo(
    () => (primary ? deriveCutMarkers(primary.jobId, actions) : []),
    [primary, actions],
  );

  // Marquee box (in content-coordinate px, not viewport).
  const [marquee, setMarquee] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    additive: boolean;
  } | null>(null);

  // Snap candidates for the primary clip. Must be declared before any
  // conditional early return — otherwise the hook count differs between
  // pre-upload (durationMs===0) and post-upload (durationMs>0) renders and
  // React throws #310 "Rendered fewer hooks than expected".
  const snapCandidates = useMemo(() => {
    const out: number[] = [0, playheadMs];
    return out;
  }, [playheadMs]);

  if (!primary || durationMs <= 0) {
    return (
      <Box
        style={{
          border: "1px dashed var(--border-default)",
          borderRadius: 10,
          padding: 24,
          background: "var(--bg-muted)",
        }}
      >
        <Text size="sm" c="var(--text-muted)" ta="center">
          {t("editor.track.empty")}
        </Text>
      </Box>
    );
  }

  const contentWidth = Math.max(320, msToPx(durationMs, scale) + 16);
  const tracksHeight = RULER_H + (TRACK_H + TRACK_GAP) * 4;
  const step = tickStepMs(scale);
  const ticks: number[] = [];
  for (let t = 0; t <= durationMs; t += step) ticks.push(t);

  function seekFromPointer(clientX: number) {
    const el = areaRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left + el.scrollLeft;
    onSeek(clampMs(pxToMs(x, scale), 0, durationMs));
  }

  // Marquee start: pointer-down on empty-area background.
  function beginMarquee(e: React.PointerEvent) {
    const el = areaRef.current;
    if (!el) return;
    // Only react to primary mouse button.
    if (e.button !== 0) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left + el.scrollLeft;
    const y = e.clientY - rect.top + el.scrollTop;
    // Below the ruler only.
    if (y < RULER_H) return;
    const additive = e.shiftKey || e.metaKey;
    const baseSelection = additive && selectedClipIds ? [...selectedClipIds] : [];
    setMarquee({ x0: x, y0: y, x1: x, y1: y, additive });

    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const nx = ev.clientX - r.left + el.scrollLeft;
      const ny = ev.clientY - r.top + el.scrollTop;
      setMarquee((m) => (m ? { ...m, x1: nx, y1: ny } : m));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setMarquee((m) => {
        if (!m || !onSelectChange || !segment) return null;
        const boxL = Math.min(m.x0, m.x1);
        const boxR = Math.max(m.x0, m.x1);
        const boxT = Math.min(m.y0, m.y1);
        const boxB = Math.max(m.y0, m.y1);
        // Test the primary clip block rect on the video track.
        const blockLeft = msToPx(segment.startMs, scale);
        const blockRight = msToPx(segment.endMs, scale);
        const blockTop = RULER_H + 4;
        const blockBottom = RULER_H + TRACK_H - 4;
        const intersects =
          boxL < blockRight && boxR > blockLeft && boxT < blockBottom && boxB > blockTop;
        const hit = intersects ? [segment.clipId] : [];
        const next = m.additive ? Array.from(new Set([...baseSelection, ...hit])) : hit;
        onSelectChange(next);
        return null;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function handleClipSelect(clipId: string, additive: boolean) {
    if (!onSelectChange) return;
    const cur = selectedClipIds ?? [];
    if (additive) {
      onSelectChange(cur.includes(clipId) ? cur.filter((x) => x !== clipId) : [...cur, clipId]);
    } else {
      onSelectChange([clipId]);
    }
  }

  const selectedSet = new Set(selectedClipIds ?? []);

  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Button
          size="xs"
          variant="default"
          leftSection={<IconCut size={14} />}
          onClick={() => onCut(primary.jobId, clampMs(playheadMs, 0, durationMs))}
        >
          {t("editor.track.addCut")}
        </Button>
        <Group gap="xs" style={{ width: 200 }}>
          <Text size="xs" c="var(--text-muted)">
            {t("editor.track.zoom")}
          </Text>
          <Slider
            style={{ flex: 1 }}
            min={MIN_PX_PER_MS}
            max={MAX_PX_PER_MS}
            step={0.005}
            value={pxPerMs}
            onChange={onPxPerMsChange}
            label={null}
          />
        </Group>
      </Group>

      <Box
        ref={areaRef}
        style={{
          position: "relative",
          overflowX: "auto",
          overflowY: "hidden",
          background: "var(--bg-card)",
          border: "1px solid var(--border-default)",
          borderRadius: 10,
        }}
        onPointerDown={(e) => {
          // Background-only marquee: ignore if a child stopped propagation
          // (ruler / ClipBlock / playhead).
          if (e.target === e.currentTarget) beginMarquee(e);
        }}
      >
        <Box
          style={{ position: "relative", width: contentWidth, height: tracksHeight }}
          onPointerDown={(e) => {
            // Container surface — start marquee if click landed on bare background.
            if (e.target === e.currentTarget) beginMarquee(e);
          }}
        >
          {/* Ruler — click anywhere to scrub */}
          <Box
            onPointerDown={(e) => {
              e.stopPropagation();
              seekFromPointer(e.clientX);
            }}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: contentWidth,
              height: RULER_H,
              borderBottom: "1px solid var(--border-default)",
              cursor: "pointer",
            }}
          >
            {ticks.map((t) => (
              <Text
                key={t}
                size="9px"
                c="var(--text-muted)"
                style={{
                  position: "absolute",
                  left: msToPx(t, scale) + 2,
                  top: 4,
                  pointerEvents: "none",
                }}
              >
                {formatTimecode(t)}
              </Text>
            ))}
          </Box>

          {/* Video track */}
          <Box
            style={{
              position: "absolute",
              top: RULER_H,
              left: 0,
              width: contentWidth,
              height: TRACK_H,
            }}
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) beginMarquee(e);
            }}
          >
            {segment && (
              <ClipBlock
                segment={segment}
                durationMs={durationMs}
                scale={scale}
                onTrim={(s, e) => onTrim(primary.jobId, s, e)}
                onMove={onClipMove}
                onSelect={onSelectChange ? handleClipSelect : undefined}
                onDuplicate={onDuplicateClip}
                selected={selectedSet.has(segment.clipId)}
                snapCandidates={snapCandidates}
              />
            )}
            {cutMarkers.map((m) => (
              <div
                key={m.id}
                style={{
                  position: "absolute",
                  left: msToPx(m.atMs, scale),
                  top: 0,
                  bottom: 0,
                  width: 2,
                  background: m.source === "ai" ? "#818CF8" : "#FBBF24",
                  pointerEvents: "none",
                }}
                aria-label="cut-marker"
              />
            ))}
          </Box>

          {/* BGM track */}
          <Box
            style={{
              position: "absolute",
              top: RULER_H + TRACK_H + TRACK_GAP,
              left: 0,
              width: contentWidth,
              height: TRACK_H,
              background: "var(--bg-muted)",
              borderRadius: 4,
            }}
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) beginMarquee(e);
            }}
          >
            {bgmSegments.length === 0 ? (
              <Text size="9px" c="var(--text-muted)" style={{ position: "absolute", left: 6, top: 6 }}>
                {t("editor.track.bgmEmpty")}
              </Text>
            ) : (
              bgmSegments.map((b) => (
                <div
                  key={b.id}
                  style={{
                    position: "absolute",
                    left: msToPx(b.startMs, scale),
                    width: Math.max(2, msToPx(b.endMs - b.startMs, scale)),
                    top: 4,
                    bottom: 4,
                    background: b.source === "ai" ? "#6366F1" : "#34D399",
                    borderRadius: 6,
                    overflow: "hidden",
                    border: b.source === "ai" ? "1px solid #818CF8" : undefined,
                  }}
                >
                  <Text size="9px" c="white" px={6} style={{ paddingTop: 6, whiteSpace: "nowrap" }}>
                    {b.label}
                  </Text>
                </div>
              ))
            )}
          </Box>

          {/* Text (caption) track */}
          <Box
            style={{
              position: "absolute",
              top: RULER_H + (TRACK_H + TRACK_GAP) * 2,
              left: 0,
              width: contentWidth,
              height: TRACK_H,
              background: "var(--bg-muted)",
              borderRadius: 4,
            }}
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) beginMarquee(e);
            }}
          >
            {textSegments.length === 0 ? (
              <Text size="9px" c="var(--text-muted)" style={{ position: "absolute", left: 6, top: 6 }}>
                {t("editor.track.textEmpty")}
              </Text>
            ) : (
              textSegments.map((s) => (
                <div
                  key={s.id}
                  style={{
                    position: "absolute",
                    left: msToPx(s.startMs, scale),
                    width: Math.max(2, msToPx(s.endMs - s.startMs, scale)),
                    top: 4,
                    bottom: 4,
                    background: s.source === "ai" ? "#818CF8" : "#6366F1",
                    borderRadius: 6,
                    overflow: "hidden",
                    border: s.source === "ai" ? "1px solid #818CF8" : undefined,
                  }}
                >
                  <Text size="9px" c="white" px={6} style={{ paddingTop: 6, whiteSpace: "nowrap" }}>
                    {s.label}
                  </Text>
                </div>
              ))
            )}
          </Box>

          {/* Image overlay track */}
          <Box
            style={{
              position: "absolute",
              top: RULER_H + (TRACK_H + TRACK_GAP) * 3,
              left: 0,
              width: contentWidth,
              height: TRACK_H,
              background: "var(--bg-muted)",
              borderRadius: 4,
            }}
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) beginMarquee(e);
            }}
          >
            {imageSegments.length === 0 ? (
              <Text size="9px" c="var(--text-muted)" style={{ position: "absolute", left: 6, top: 6 }}>
                {t("editor.track.imageEmpty")}
              </Text>
            ) : (
              imageSegments.map((s) => (
                <div
                  key={s.id}
                  style={{
                    position: "absolute",
                    left: msToPx(s.startMs, scale),
                    width: Math.max(2, msToPx(s.endMs - s.startMs, scale)),
                    top: 4,
                    bottom: 4,
                    background: s.source === "ai" ? "#e8590c" : "#f76707",
                    borderRadius: 6,
                    overflow: "hidden",
                    border: s.source === "ai" ? "1px solid #fd7e14" : undefined,
                  }}
                >
                  <Text size="9px" c="white" px={6} style={{ paddingTop: 6, whiteSpace: "nowrap" }}>
                    {s.label}
                  </Text>
                </div>
              ))
            )}
          </Box>

          {/* Marquee box overlay */}
          {marquee && (
            <div
              style={{
                position: "absolute",
                left: Math.min(marquee.x0, marquee.x1),
                top: Math.min(marquee.y0, marquee.y1),
                width: Math.abs(marquee.x1 - marquee.x0),
                height: Math.abs(marquee.y1 - marquee.y0),
                background: "rgba(99,102,241,0.12)",
                border: "1px dashed #6366F1",
                pointerEvents: "none",
                zIndex: 5,
              }}
              aria-label="marquee"
            />
          )}

          <Playhead
            playheadMs={playheadMs}
            durationMs={durationMs}
            scale={scale}
            height={tracksHeight}
            onSeek={onSeek}
          />
        </Box>
      </Box>

      <Text size="xs" c="var(--text-muted)">
        {t("editor.track.help")}
      </Text>
    </Stack>
  );
}
