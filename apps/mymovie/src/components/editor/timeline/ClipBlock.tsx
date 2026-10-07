"use client";

import { useRef, useState } from "react";
import { Menu, Text } from "@mantine/core";
import { IconCopy, IconSparkles } from "@tabler/icons-react";
import {
  MIN_SEGMENT_MS,
  clampMs,
  msToPx,
  pxToMs,
  type TimelineScale,
  type VideoSegment,
} from "@/lib/core/timeline-model";
import { snapMs } from "@/lib/core/snap-engine";
import { useI18n } from "@/lib/i18n/I18nProvider";

interface Props {
  segment: VideoSegment;
  durationMs: number;
  scale: TimelineScale;
  // Emitted on drag end with the new trim bounds (left/right edge drag).
  onTrim: (startMs: number, endMs: number) => void;
  // Optional NLE clip-move handlers (body drag). When omitted the block is
  // trim-only (legacy single-track behavior).
  onMove?: (clipId: string, deltaMs: number) => void;
  onSelect?: (clipId: string, additive: boolean) => void;
  // Right-click "복제" / NLE Cmd+D semantics. Caller decides duplicate
  // placement; this block only surfaces the intent.
  onDuplicate?: (clipId: string) => void;
  selected?: boolean;
  snapCandidates?: number[];
}

type DragState = { start: number; end: number } | null;
type MoveState = { delta: number } | null;

export default function ClipBlock({
  segment,
  durationMs,
  scale,
  onTrim,
  onMove,
  onSelect,
  onDuplicate,
  selected,
  snapCandidates,
}: Props) {
  const { t } = useI18n();
  const [drag, setDrag] = useState<DragState>(null);
  const [move, setMove] = useState<MoveState>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const liveRef = useRef<{ start: number; end: number }>({
    start: segment.startMs,
    end: segment.endMs,
  });

  const start = drag ? drag.start : segment.startMs;
  const end = drag ? drag.end : segment.endMs;
  const moveDelta = move?.delta ?? 0;
  const left = msToPx(start + moveDelta, scale);
  const width = Math.max(2, msToPx(end - start, scale));

  function beginTrimDrag(edge: "l" | "r", e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const base = { start: segment.startMs, end: segment.endMs };
    liveRef.current = { ...base };

    const moveFn = (ev: PointerEvent) => {
      const dMs = pxToMs(ev.clientX - startX, scale);
      let next: { start: number; end: number };
      if (edge === "l") {
        next = { start: clampMs(base.start + dMs, 0, base.end - MIN_SEGMENT_MS), end: base.end };
      } else {
        next = {
          start: base.start,
          end: clampMs(base.end + dMs, base.start + MIN_SEGMENT_MS, durationMs),
        };
      }
      liveRef.current = next;
      setDrag(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", moveFn);
      window.removeEventListener("pointerup", up);
      const final = liveRef.current;
      setDrag(null);
      onTrim(final.start, final.end);
    };
    window.addEventListener("pointermove", moveFn);
    window.addEventListener("pointerup", up);
  }

  function beginBodyDrag(e: React.PointerEvent) {
    if (!onMove) {
      // No move handler — just bubble selection.
      if (onSelect) onSelect(segment.clipId, e.shiftKey || e.metaKey);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const additive = e.shiftKey || e.metaKey;
    let didMove = false;
    let lastDelta = 0;

    const moveFn = (ev: PointerEvent) => {
      const rawDelta = pxToMs(ev.clientX - startX, scale);
      if (Math.abs(ev.clientX - startX) > 3) didMove = true;
      // Snap against caller-supplied candidates (relative to current start).
      const targetStart = segment.startMs + rawDelta;
      const snappedStart =
        snapCandidates && snapCandidates.length > 0
          ? snapMs(targetStart, snapCandidates, scale.pxPerMs, 8)
          : targetStart;
      const snappedDelta = snappedStart - segment.startMs;
      lastDelta = snappedDelta;
      setMove({ delta: snappedDelta });
    };
    const up = () => {
      window.removeEventListener("pointermove", moveFn);
      window.removeEventListener("pointerup", up);
      setMove(null);
      if (didMove) {
        onMove(segment.clipId, lastDelta);
      } else if (onSelect) {
        onSelect(segment.clipId, additive);
      }
    };
    window.addEventListener("pointermove", moveFn);
    window.addEventListener("pointerup", up);
  }

  const isAi = segment.source === "ai";
  const bgGradient = isAi
    ? "linear-gradient(180deg, #818CF8 0%, #6366F1 100%)"
    : "linear-gradient(180deg, #4F46E5 0%, #4338CA 100%)";
  const ringColor = isAi ? "#818CF8" : "#6366F1";

  const handleStyle: React.CSSProperties = {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 8,
    cursor: "ew-resize",
    background: `var(--ring, ${ringColor})`,
    touchAction: "none",
  };

  const blockBody = (
    <div
      style={{
        position: "absolute",
        left,
        width,
        top: 4,
        bottom: 4,
        background: bgGradient,
        borderRadius: 6,
        overflow: "hidden",
        userSelect: "none",
        border: selected
          ? "2px solid #FBBF24"
          : isAi
            ? "2px solid #818CF8"
            : undefined,
        boxShadow: selected ? "0 0 0 1px rgba(251,191,36,0.6)" : undefined,
        cursor: onMove ? "grab" : undefined,
      }}
      aria-label={segment.title}
      onPointerDown={beginBodyDrag}
      onContextMenu={(e) => {
        if (!onDuplicate) return;
        e.preventDefault();
        e.stopPropagation();
        if (onSelect) onSelect(segment.clipId, false);
        setMenuOpen(true);
      }}
    >
      <div
        style={{ ...handleStyle, left: 0, borderTopLeftRadius: 6, borderBottomLeftRadius: 6 }}
        onPointerDown={(e) => beginTrimDrag("l", e)}
        aria-label="trim-start"
      />
      <div
        style={{ ...handleStyle, right: 0, borderTopRightRadius: 6, borderBottomRightRadius: 6 }}
        onPointerDown={(e) => beginTrimDrag("r", e)}
        aria-label="trim-end"
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          paddingLeft: 12,
          paddingRight: 12,
          paddingTop: 8,
          pointerEvents: "none",
        }}
      >
        {isAi && <IconSparkles size={12} color="white" />}
        <Text
          size="xs"
          c="white"
          style={{
            lineHeight: "100%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {segment.title}
        </Text>
      </div>
    </div>
  );

  if (!onDuplicate) return blockBody;

  return (
    <Menu
      opened={menuOpen}
      onClose={() => setMenuOpen(false)}
      position="bottom-start"
      withinPortal
      shadow="md"
      width={180}
    >
      <Menu.Target>{blockBody}</Menu.Target>
      <Menu.Dropdown>
        <Menu.Item
          leftSection={<IconCopy size={14} />}
          onClick={() => {
            onDuplicate(segment.clipId);
            setMenuOpen(false);
          }}
        >
          {t("editor.clip.duplicate")}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
