"use client";

import { useMemo } from "react";
import { Card, Group, NumberInput, Select, Stack, Text, Textarea, TextInput } from "@mantine/core";
import type { Action, KeyframePoint } from "@/lib/core/action-types";
import { type ClipMeta, buildClipOptions } from "@/lib/core/clip-meta";
import { useI18n } from "@/lib/i18n/I18nProvider";
import KeyframesLane, { type KFProp } from "@/components/editor/inspector/KeyframesLane";

interface Props {
  selectedActionId: string | null;
  actions: Action[];
  clips: ClipMeta[];
  onUpdate: (id: string, updated: Action) => void;
  // NLE multi-clip selection. When non-empty, clip-property panel appears.
  selectedClipIds?: string[];
  durationMs?: number;
  playheadMs?: number;
  pxPerMs?: number;
  // Bubble keyframe upserts so the parent can merge into a KeyframeAction.
  onKeyframeUpsert?: (clipId: string, property: KFProp, point: KeyframePoint) => void;
}

export default function Inspector({
  selectedActionId,
  actions,
  clips,
  onUpdate,
  selectedClipIds,
  durationMs,
  playheadMs,
  pxPerMs,
  onKeyframeUpsert,
}: Props) {
  const { t } = useI18n();

  const selectedAction = useMemo(
    () => actions.find((a) => a.meta.id === selectedActionId) ?? null,
    [actions, selectedActionId],
  );

  const selectedClipCount = selectedClipIds?.length ?? 0;
  const singleSelectedClipId =
    selectedClipCount === 1 ? selectedClipIds![0] : null;

  // Per-clip keyframe map derived from existing KeyframeActions.
  const keyframeMap = useMemo(() => {
    if (!singleSelectedClipId) return {} as Partial<Record<KFProp, KeyframePoint[]>>;
    const out: Partial<Record<KFProp, KeyframePoint[]>> = {};
    for (const a of actions) {
      if (a.type !== "keyframe") continue;
      if (a.clipId !== singleSelectedClipId) continue;
      out[a.property] = a.keyframes;
    }
    return out;
  }, [actions, singleSelectedClipId]);

  // ---------- Multi-select banner ----------
  if (selectedClipCount > 1) {
    return (
      <Card
        withBorder
        radius="md"
        padding="md"
        style={{ background: "var(--bg-card)", borderColor: "var(--border-default)" }}
      >
        <Stack gap="xs">
          <Text fw={500}>{t("editor.inspector.multiTitle")}</Text>
          <Text size="sm" c="var(--text-muted)">
            {t("editor.inspector.multiCount").replace("{n}", String(selectedClipCount))}
          </Text>
          <Text size="xs" c="var(--text-muted)">
            {t("editor.inspector.multiHint")}
          </Text>
        </Stack>
      </Card>
    );
  }

  // ---------- Single-clip selection (no action selected) ----------
  if (!selectedAction && singleSelectedClipId) {
    const clip = clips.find((c) => c.jobId === singleSelectedClipId);
    return (
      <Card
        withBorder
        radius="md"
        padding="md"
        style={{ background: "var(--bg-card)", borderColor: "var(--border-default)" }}
      >
        <Stack gap="sm">
          <Group justify="space-between">
            <Text fw={500}>{t("editor.inspector.clipProps")}</Text>
            <Text size="xs" c="var(--text-muted)">
              {clip?.title ?? singleSelectedClipId}
            </Text>
          </Group>
          {onKeyframeUpsert && durationMs != null && playheadMs != null && pxPerMs != null && (
            <KeyframesLane
              clipId={singleSelectedClipId}
              existingKeyframes={keyframeMap}
              durationMs={durationMs}
              playheadMs={playheadMs}
              pxPerMs={pxPerMs}
              onUpsert={onKeyframeUpsert}
            />
          )}
        </Stack>
      </Card>
    );
  }

  if (!selectedAction) {
    return (
      <Card
        withBorder
        radius="md"
        padding="lg"
        style={{
          background: "var(--bg-muted)",
          borderColor: "var(--border-default)",
          borderStyle: "dashed",
          minHeight: 200,
        }}
      >
        <Text size="sm" c="var(--text-muted)" ta="center">
          {t("editor.inspector.placeholder")}
        </Text>
      </Card>
    );
  }

  return (
    <Card
      withBorder
      radius="md"
      padding="md"
      style={{
        background: "var(--bg-card)",
        borderColor: "var(--border-default)",
      }}
    >
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={500}>{t("editor.inspector.title")}</Text>
          <Text size="xs" c="var(--text-muted)">
            {t(`editor.toolbar.${selectedAction.type}`)}
          </Text>
        </Group>
        <InspectorFields action={selectedAction} clips={clips} onUpdate={onUpdate} />
        {/* If the selected action is a keyframe action, surface the lane too. */}
        {selectedAction.type === "keyframe" &&
          onKeyframeUpsert &&
          durationMs != null &&
          playheadMs != null &&
          pxPerMs != null && (
            <KeyframesLane
              clipId={selectedAction.clipId}
              existingKeyframes={{ [selectedAction.property]: selectedAction.keyframes }}
              durationMs={durationMs}
              playheadMs={playheadMs}
              pxPerMs={pxPerMs}
              onUpsert={onKeyframeUpsert}
            />
          )}
      </Stack>
    </Card>
  );
}

interface FieldProps {
  action: Action;
  clips: ClipMeta[];
  onUpdate: (id: string, updated: Action) => void;
}

function InspectorFields({ action, clips, onUpdate }: FieldProps) {
  const { t } = useI18n();
  const options = buildClipOptions(clips, []);

  const update = (partial: Partial<Action>) => {
    onUpdate(action.meta.id, { ...action, ...partial } as Action);
  };

  switch (action.type) {
    case "cut": {
      return (
        <Stack gap="xs">
          <Select
            label={t("editor.action.clipId")}
            value={action.clipId}
            onChange={(v) => update({ clipId: v ?? "" })}
            data={options}
          />
          <NumberInput
            label={t("editor.action.at")}
            value={action.at}
            onChange={(v) => update({ at: Number(v) || 0 })}
            min={0}
          />
        </Stack>
      );
    }

    case "trim": {
      return (
        <Stack gap="xs">
          <Select
            label={t("editor.action.clipId")}
            value={action.clipId}
            onChange={(v) => update({ clipId: v ?? "" })}
            data={options}
          />
          <NumberInput
            label={t("editor.action.start")}
            value={action.start}
            onChange={(v) => update({ start: Number(v) || 0 })}
            min={0}
          />
          <NumberInput
            label={t("editor.action.end")}
            value={action.end}
            onChange={(v) => update({ end: Number(v) || 0 })}
            min={0}
          />
        </Stack>
      );
    }

    case "reframe": {
      return (
        <Stack gap="xs">
          <Select
            label={t("editor.action.clipId")}
            value={action.clipId}
            onChange={(v) => update({ clipId: v ?? "" })}
            data={options}
          />
          <Group grow>
            <NumberInput
              label={t("editor.action.aspectW")}
              value={action.aspect.w}
              onChange={(v) =>
                update({ aspect: { ...action.aspect, w: Number(v) || 1 } })
              }
              min={1}
            />
            <NumberInput
              label={t("editor.action.aspectH")}
              value={action.aspect.h}
              onChange={(v) =>
                update({ aspect: { ...action.aspect, h: Number(v) || 1 } })
              }
              min={1}
            />
          </Group>
          <Group grow>
            <NumberInput
              label={t("editor.action.focalX")}
              value={action.focal?.x ?? 0.5}
              onChange={(v) =>
                update({
                  focal: { x: Number(v) || 0.5, y: action.focal?.y ?? 0.5 },
                })
              }
              min={0}
              max={1}
              step={0.05}
              decimalScale={2}
            />
            <NumberInput
              label={t("editor.action.focalY")}
              value={action.focal?.y ?? 0.5}
              onChange={(v) =>
                update({
                  focal: { x: action.focal?.x ?? 0.5, y: Number(v) || 0.5 },
                })
              }
              min={0}
              max={1}
              step={0.05}
              decimalScale={2}
            />
          </Group>
        </Stack>
      );
    }

    case "caption": {
      return (
        <Stack gap="xs">
          <Select
            label={t("editor.action.clipId")}
            value={action.clipId}
            onChange={(v) => update({ clipId: v ?? "" })}
            data={options}
          />
          <Group grow>
            <NumberInput
              label={t("editor.action.start")}
              value={action.start}
              onChange={(v) => update({ start: Number(v) || 0 })}
              min={0}
            />
            <NumberInput
              label={t("editor.action.end")}
              value={action.end}
              onChange={(v) => update({ end: Number(v) || 0 })}
              min={0}
            />
          </Group>
          <Textarea
            label={t("editor.action.text")}
            value={action.text}
            onChange={(e) => update({ text: e.currentTarget.value })}
            minRows={2}
          />
          <Group grow>
            <Select
              label={t("editor.action.pos")}
              value={action.style?.pos ?? "bottom"}
              onChange={(v) =>
                update({
                  style: {
                    ...action.style,
                    pos: (v as "top" | "bottom" | "center") ?? "bottom",
                  },
                })
              }
              data={[
                { value: "top", label: "top" },
                { value: "center", label: "center" },
                { value: "bottom", label: "bottom" },
              ]}
            />
            <TextInput
              label={t("editor.action.color")}
              value={action.style?.color ?? "white"}
              onChange={(e) =>
                update({ style: { ...action.style, color: e.currentTarget.value } })
              }
            />
            <NumberInput
              label={t("editor.action.size")}
              value={action.style?.size ?? 24}
              onChange={(v) =>
                update({ style: { ...action.style, size: Number(v) || 24 } })
              }
              min={8}
            />
          </Group>
        </Stack>
      );
    }

    case "bgm": {
      return (
        <Stack gap="xs">
          <TextInput
            label={t("editor.action.bgmSource")}
            value={action.source}
            onChange={(e) => update({ source: e.currentTarget.value })}
          />
          <NumberInput
            label={t("editor.action.volume")}
            value={action.volume}
            onChange={(v) => update({ volume: Number(v) || 0 })}
            min={0}
            max={1}
            step={0.05}
            decimalScale={2}
          />
          <Group grow>
            <NumberInput
              label={t("editor.action.start")}
              value={action.start ?? 0}
              onChange={(v) => update({ start: Number(v) || undefined })}
              min={0}
            />
            <NumberInput
              label={t("editor.action.end")}
              value={action.end ?? 0}
              onChange={(v) => update({ end: Number(v) || undefined })}
              min={0}
            />
          </Group>
          <Group grow>
            <NumberInput
              label={t("editor.action.fadeInMs")}
              value={action.fadeInMs ?? 0}
              onChange={(v) => {
                const n = Number(v) || 0;
                update({ fadeInMs: n > 0 ? n : undefined });
              }}
              min={0}
              step={100}
            />
            <NumberInput
              label={t("editor.action.fadeOutMs")}
              value={action.fadeOutMs ?? 0}
              onChange={(v) => {
                const n = Number(v) || 0;
                update({ fadeOutMs: n > 0 ? n : undefined });
              }}
              min={0}
              step={100}
            />
          </Group>
        </Stack>
      );
    }

    case "transition": {
      return (
        <Stack gap="xs">
          <Select
            label={t("editor.action.fromClipId")}
            value={action.fromClipId}
            onChange={(v) => update({ fromClipId: v ?? "" })}
            data={options}
          />
          <Select
            label={t("editor.action.toClipId")}
            value={action.toClipId}
            onChange={(v) => update({ toClipId: v ?? "" })}
            data={options}
          />
          <Select
            label={t("editor.action.kind")}
            value={action.kind}
            onChange={(v) =>
              update({ kind: (v as "fade" | "wipe" | "slide" | "cut") ?? "fade" })
            }
            data={[
              { value: "fade", label: t("editor.transition.fade") },
              { value: "wipe", label: t("editor.transition.wipe") },
              { value: "slide", label: t("editor.transition.slide") },
              { value: "cut", label: t("editor.transition.cut") },
            ]}
          />
          <NumberInput
            label={t("editor.action.durationMs")}
            value={action.durationMs}
            onChange={(v) => update({ durationMs: Number(v) || 1 })}
            min={1}
          />
        </Stack>
      );
    }

    case "speed": {
      return (
        <Stack gap="xs">
          <Select
            label={t("editor.action.clipId")}
            value={action.clipId}
            onChange={(v) => update({ clipId: v ?? "" })}
            data={options}
          />
          <NumberInput
            label={t("editor.action.factor")}
            value={action.factor}
            onChange={(v) => update({ factor: Number(v) || 1.0 })}
            min={0.25}
            max={4.0}
            step={0.25}
            decimalScale={2}
          />
        </Stack>
      );
    }

    case "opacity": {
      return (
        <Stack gap="xs">
          <Select
            label={t("editor.action.clipId")}
            value={action.clipId}
            onChange={(v) => update({ clipId: v ?? "" })}
            data={options}
          />
          <Group grow>
            <NumberInput
              label={t("editor.action.start")}
              value={action.start}
              onChange={(v) => update({ start: Number(v) || 0 })}
              min={0}
            />
            <NumberInput
              label={t("editor.action.end")}
              value={action.end}
              onChange={(v) => update({ end: Number(v) || 0 })}
              min={0}
            />
          </Group>
          <Group grow>
            <NumberInput
              label={t("editor.action.from")}
              value={action.from}
              onChange={(v) => update({ from: Number(v) || 1.0 })}
              min={0}
              max={1}
              step={0.1}
              decimalScale={2}
            />
            <NumberInput
              label={t("editor.action.to")}
              value={action.to}
              onChange={(v) => update({ to: Number(v) || 0.5 })}
              min={0}
              max={1}
              step={0.1}
              decimalScale={2}
            />
          </Group>
        </Stack>
      );
    }

    case "transform": {
      return (
        <Stack gap="xs">
          <Select
            label={t("editor.action.clipId")}
            value={action.clipId}
            onChange={(v) => update({ clipId: v ?? "" })}
            data={options}
          />
          <NumberInput
            label={t("editor.action.scale")}
            value={action.scale ?? 1.0}
            onChange={(v) => update({ scale: Number(v) !== 1.0 ? Number(v) : undefined })}
            min={0.1}
            max={5}
            step={0.1}
            decimalScale={2}
          />
          <NumberInput
            label={t("editor.action.rotateDeg")}
            value={action.rotateDeg ?? 0}
            onChange={(v) => update({ rotateDeg: Number(v) !== 0 ? Number(v) : undefined })}
            min={-360}
            max={360}
          />
          <Group grow>
            <NumberInput
              label={t("editor.action.translateX")}
              value={action.translate?.x ?? 0}
              onChange={(v) => {
                const x = Number(v) || 0;
                const y = action.translate?.y ?? 0;
                update({ translate: x !== 0 || y !== 0 ? { x, y } : undefined });
              }}
            />
            <NumberInput
              label={t("editor.action.translateY")}
              value={action.translate?.y ?? 0}
              onChange={(v) => {
                const y = Number(v) || 0;
                const x = action.translate?.x ?? 0;
                update({ translate: x !== 0 || y !== 0 ? { x, y } : undefined });
              }}
            />
          </Group>
        </Stack>
      );
    }

    case "keyframe": {
      return (
        <Stack gap="xs">
          <Select
            label={t("editor.action.clipId")}
            value={action.clipId}
            onChange={(v) => update({ clipId: v ?? "" })}
            data={options}
          />
          <Text size="xs" c="var(--text-muted)">
            {t("editor.inspector.kfSummary")
              .replace("{prop}", action.property)
              .replace("{n}", String(action.keyframes.length))}
          </Text>
        </Stack>
      );
    }

    case "imageOverlay":
    case "generate":
      return (
        <Text size="xs" c="var(--text-muted)">
          {t("editor.inspector.noForm")}
        </Text>
      );
  }
}
