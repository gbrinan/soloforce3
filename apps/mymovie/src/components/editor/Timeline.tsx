"use client";

import { ActionIcon, Badge, Card, Group, Stack, Text } from "@mantine/core";
import { IconRobot, IconTrash, IconUser } from "@tabler/icons-react";
import type { Action } from "@/lib/core/action-types";
import { type ClipMeta, clipLabel } from "@/lib/core/clip-meta";
import { useI18n } from "@/lib/i18n/I18nProvider";

interface Props {
  actions: Action[];
  onRemove: (id: string) => void;
  onSelect?: (id: string) => void;
  // actionId → first error reason. Inline validate feedback.
  errors?: Record<string, string>;
  clips?: ClipMeta[];
  // NLE multi-select: when >=1 clip is selected, show a status banner so the
  // action list reflects what shortcuts will affect.
  selectedClipIds?: string[];
}

function actionTime(a: Action): number {
  switch (a.type) {
    case "cut":
      return a.at;
    case "trim":
      return a.start;
    case "caption":
      return a.start;
    case "bgm":
      return a.start ?? 0;
    case "opacity":
      return a.start;
    case "imageOverlay":
      return a.start;
    case "generate":
      return a.insertAtMs;
    case "keyframe":
      return a.keyframes[0]?.atMs ?? 0;
    case "reframe":
    case "transition":
    case "speed":
    case "transform":
      return 0;
    default: {
      const _exhaustive: never = a;
      return _exhaustive;
    }
  }
}

function actionSummary(a: Action, clips: ClipMeta[]): string {
  switch (a.type) {
    case "cut":
      return `${clipLabel(a.clipId, clips)} @ ${a.at}ms`;
    case "trim":
      return `${clipLabel(a.clipId, clips)} ${a.start}→${a.end}ms`;
    case "reframe":
      return `${clipLabel(a.clipId, clips)} ${a.aspect.w}:${a.aspect.h}${
        a.focal ? ` focal(${a.focal.x.toFixed(2)},${a.focal.y.toFixed(2)})` : ""
      }`;
    case "caption":
      return `${clipLabel(a.clipId, clips)} ${a.start}→${a.end}ms "${a.text.slice(0, 40)}"`;
    case "bgm":
      return `src=${a.source} vol=${a.volume}`;
    case "transition":
      return `${clipLabel(a.fromClipId, clips)}→${clipLabel(a.toClipId, clips)} ${a.kind} ${a.durationMs}ms`;
    case "speed":
      return `${clipLabel(a.clipId, clips)} ×${a.factor}`;
    case "opacity":
      return `${clipLabel(a.clipId, clips)} ${a.start}→${a.end}ms ${a.from}→${a.to}`;
    case "transform":
      return `${clipLabel(a.clipId, clips)}${a.scale != null ? ` scale=${a.scale}` : ""}${
        a.rotateDeg != null ? ` rot=${a.rotateDeg}°` : ""
      }${a.translate ? ` t(${a.translate.x},${a.translate.y})` : ""}`;
    case "imageOverlay":
      return `${clipLabel(a.clipId, clips)} ${a.start}→${a.end}ms scale=${a.scale} op=${a.opacity}`;
    case "generate":
      return `generate(${a.kind}) @${a.insertAtMs}ms "${a.prompt.slice(0, 40)}"${
        a.model ? ` model=${a.model}` : ""
      }`;
    case "keyframe":
      return `${clipLabel(a.clipId, clips)} ${a.property} ×${a.keyframes.length} kf`;
    default: {
      const _exhaustive: never = a;
      return _exhaustive;
    }
  }
}

export default function Timeline({
  actions,
  onRemove,
  onSelect,
  errors,
  clips,
  selectedClipIds,
}: Props) {
  const { t } = useI18n();
  const clipList = clips ?? [];
  const selectionBanner =
    selectedClipIds && selectedClipIds.length > 0 ? (
      <Text size="xs" c="var(--text-muted)">
        {t("editor.timeline.selection").replace("{n}", String(selectedClipIds.length))}
      </Text>
    ) : null;
  if (actions.length === 0) {
    return (
      <Stack gap="xs">
        {selectionBanner}
        <Card
          withBorder
          radius="md"
          padding="lg"
          style={{
            background: "var(--bg-muted)",
            borderColor: "var(--border-default)",
            borderStyle: "dashed",
          }}
        >
          <Text size="sm" c="var(--text-muted)" ta="center">
            {t("editor.empty")}
          </Text>
        </Card>
      </Stack>
    );
  }

  const sorted = [...actions].sort((a, b) => {
    const da = actionTime(a) - actionTime(b);
    if (da !== 0) return da;
    return a.meta.createdAt - b.meta.createdAt;
  });

  return (
    <Stack gap="xs">
      {selectionBanner}
      {sorted.map((a) => {
        const isAi = a.meta.source === "ai";
        const err = errors?.[a.meta.id];
        return (
          <Card
            key={a.meta.id}
            withBorder
            radius="md"
            padding="sm"
            onClick={() => onSelect?.(a.meta.id)}
            style={{
              background: isAi ? "var(--bg-muted)" : "var(--bg-card)",
              borderColor: err
                ? "var(--mantine-color-red-6)"
                : isAi
                  ? "var(--ring)"
                  : "var(--border-default)",
              borderWidth: err ? 2 : undefined,
              cursor: onSelect ? "pointer" : undefined,
            }}
          >
            <Group justify="space-between" wrap="nowrap">
              <Group gap="xs" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
                <Badge
                  size="sm"
                  color={isAi ? "jarvis" : "blue"}
                  leftSection={isAi ? <IconRobot size={12} /> : <IconUser size={12} />}
                >
                  {t(`editor.toolbar.${a.type}`)}
                </Badge>
                <Text
                  size="xs"
                  c="var(--text-muted)"
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {actionSummary(a, clipList)}
                </Text>
              </Group>
              <ActionIcon
                variant="subtle"
                color="red"
                onClick={() => onRemove(a.meta.id)}
                aria-label={t("editor.action.delete")}
              >
                <IconTrash size={14} />
              </ActionIcon>
            </Group>
            {err && (
              <Text size="xs" c="red" mt={6}>
                {t("editor.action.validateError")}: {err}
              </Text>
            )}
          </Card>
        );
      })}
    </Stack>
  );
}
