"use client";

// P0 — KeyframesLane: 6-property per-clip keyframe editor.
// Renders one row per animated property with diamond markers at each
// existing keyframe and an "add" affordance that creates a keyframe at the
// current playhead. Interp mode is shared across new keyframes of this lane.
// Pure presentation: all mutations bubble out via onUpsert. The parent owns
// the KeyframeAction list.

import { useState } from "react";
import { ActionIcon, Group, Stack, Text, Tooltip } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import type { KeyframePoint, KeyframeValue } from "@/lib/core/action-types";
import { useI18n } from "@/lib/i18n/I18nProvider";

export type KFProp = "opacity" | "position" | "scale" | "rotation" | "crop" | "volume";
export type KFInterp = "linear" | "smooth" | "hold";

const PROPS: { id: KFProp; label: string; defaultValue: KeyframeValue }[] = [
  { id: "opacity", label: "Opacity", defaultValue: 1 },
  { id: "position", label: "Position", defaultValue: { x: 0, y: 0 } },
  { id: "scale", label: "Scale", defaultValue: 1 },
  { id: "rotation", label: "Rotation", defaultValue: 0 },
  { id: "crop", label: "Crop", defaultValue: { w: 1, h: 1 } },
  { id: "volume", label: "Volume", defaultValue: 1 },
];

interface Props {
  clipId: string;
  // Per-property existing keyframes; missing entries treated as [].
  existingKeyframes: Partial<Record<KFProp, KeyframePoint[]>>;
  durationMs: number;
  playheadMs: number;
  pxPerMs: number;
  onUpsert: (clipId: string, property: KFProp, point: KeyframePoint) => void;
}

const LANE_H = 22;
const LANE_GAP = 4;
const LABEL_W = 84;

export default function KeyframesLane({
  clipId,
  existingKeyframes,
  durationMs,
  playheadMs,
  pxPerMs,
  onUpsert,
}: Props) {
  const { t } = useI18n();
  const [interp, setInterp] = useState<KFInterp>("linear");

  const trackWidth = Math.max(160, durationMs * pxPerMs);

  function addAtPlayhead(prop: KFProp, defaultValue: KeyframeValue) {
    const atMs = Math.max(0, Math.min(durationMs, playheadMs));
    onUpsert(clipId, prop, { atMs, value: defaultValue, interp });
  }

  return (
    <Stack gap={6}>
      <Group gap="xs" align="center">
        <Text size="xs" fw={600} c="var(--text-muted)">
          {t("editor.kf.title")}
        </Text>
        <Group gap={4} role="radiogroup" aria-label="interp">
          {(["linear", "smooth", "hold"] as KFInterp[]).map((m) => (
            <label
              key={m}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 12,
                cursor: "pointer",
                color: "var(--text-muted)",
              }}
            >
              <input
                type="radio"
                name={`kf-interp-${clipId}`}
                value={m}
                checked={interp === m}
                onChange={() => setInterp(m)}
                style={{ accentColor: "var(--ring, #6366F1)" }}
              />
              {m}
            </label>
          ))}
        </Group>
      </Group>

      <div style={{ position: "relative", overflowX: "auto" }}>
        <Stack gap={LANE_GAP}>
          {PROPS.map((row) => {
            const points = existingKeyframes[row.id] ?? [];
            return (
              <Group key={row.id} gap={6} wrap="nowrap" align="center">
                <div
                  style={{
                    width: LABEL_W,
                    flex: "0 0 auto",
                    fontSize: 12,
                    color: "var(--text-muted)",
                  }}
                >
                  {row.label}
                </div>
                <div
                  style={{
                    position: "relative",
                    height: LANE_H,
                    width: trackWidth,
                    background: "var(--bg-muted)",
                    borderRadius: 4,
                    border: "1px solid var(--border-default)",
                  }}
                  aria-label={`kf-lane-${row.id}`}
                  onDoubleClick={() => addAtPlayhead(row.id, row.defaultValue)}
                >
                  {points.map((p, i) => (
                    <Tooltip
                      key={`${row.id}-${i}-${p.atMs}`}
                      label={`${row.label} @ ${Math.round(p.atMs)}ms · ${p.interp}`}
                      withinPortal
                    >
                      <div
                        style={{
                          position: "absolute",
                          left: Math.max(0, p.atMs * pxPerMs) - 5,
                          top: (LANE_H - 10) / 2,
                          width: 10,
                          height: 10,
                          background:
                            p.interp === "smooth"
                              ? "#818CF8"
                              : p.interp === "hold"
                                ? "#FBBF24"
                                : "#6366F1",
                          transform: "rotate(45deg)",
                          borderRadius: 1,
                          border: "1px solid #fff",
                          cursor: "pointer",
                        }}
                        aria-label={`kf-marker-${row.id}-${i}`}
                      />
                    </Tooltip>
                  ))}
                </div>
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  onClick={() => addAtPlayhead(row.id, row.defaultValue)}
                  aria-label={`add-kf-${row.id}`}
                >
                  <IconPlus size={12} />
                </ActionIcon>
              </Group>
            );
          })}
        </Stack>
      </div>
      <Text size="9px" c="var(--text-muted)">
        {t("editor.kf.help")}
      </Text>
    </Stack>
  );
}
