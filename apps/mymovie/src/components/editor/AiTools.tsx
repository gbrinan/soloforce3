"use client";

// AI tools row — auto caption, highlight extraction, silence/filler cut
// suggestions, local TTS narration. All backed by free/local pipelines
// (Whisper, Claude CLI auth reuse, macOS say). No paid APIs.

import { useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  NumberInput,
  Paper,
  Stack,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconMessage2,
  IconMicrophone,
  IconScissors,
  IconSparkles,
} from "@tabler/icons-react";
import type { Action } from "@/lib/core/action-types";
import type { TranscriptSegment } from "@/lib/director/signals";
import { segmentsToCaptionActions } from "@/lib/director/captions";
import {
  suggestCuts,
  suggestionCutTimes,
  type CutSuggestion,
} from "@/lib/director/cut-suggestions";
import { formatTimecode } from "@/lib/core/timeline-model";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { apiUrl } from "@/lib/api-url";

interface Props {
  jobId: string | null;
  defaultClipId: string;
  durationMs: number;
  playheadMs: number;
  disabled?: boolean;
  onAdd: (a: Action) => void;
  onAddMany: (xs: Action[]) => void;
  // Highlight ranges replace any prior trim for the clip (parent owns that rule).
  onApplyRange: (startMs: number, endMs: number) => void;
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `act-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

function aiMeta() {
  return { id: newId(), createdAt: Date.now(), source: "ai" as const };
}

async function fetchTranscript(jobId: string): Promise<{ segments: TranscriptSegment[]; note?: string }> {
  const res = await fetch(apiUrl("/api/director/transcribe"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobId }),
  });
  const data = (await res.json()) as {
    ok: boolean;
    segments?: TranscriptSegment[];
    note?: string;
    error?: string;
  };
  if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return { segments: data.segments ?? [], note: data.note };
}

export default function AiTools({
  jobId,
  defaultClipId,
  durationMs,
  playheadMs,
  disabled,
  onAdd,
  onAddMany,
  onApplyRange,
}: Props) {
  const { t } = useI18n();
  const [captionLoading, setCaptionLoading] = useState(false);
  const [highlightsOpen, setHighlightsOpen] = useState(false);
  const [cutsOpen, setCutsOpen] = useState(false);
  const [narrationOpen, setNarrationOpen] = useState(false);

  const runAutoCaption = async () => {
    if (!jobId || !defaultClipId) return;
    setCaptionLoading(true);
    try {
      const { segments, note } = await fetchTranscript(jobId);
      const captions = segmentsToCaptionActions(segments, defaultClipId, durationMs);
      if (captions.length === 0) {
        notifications.show({
          color: "yellow",
          title: t("editor.toolbar.autoCaption"),
          message: note ?? t("editor.autoCaption.empty"),
        });
        return;
      }
      onAddMany(captions);
      notifications.show({
        color: "green",
        title: t("editor.toolbar.autoCaption"),
        message: `${captions.length}${t("editor.autoCaption.added")}`,
      });
    } catch (e) {
      notifications.show({
        color: "red",
        title: t("editor.autoCaption.error"),
        message: (e as Error).message,
      });
    } finally {
      setCaptionLoading(false);
    }
  };

  return (
    <>
      <Group gap="xs" wrap="wrap">
        <Button
          variant="default"
          leftSection={<IconMessage2 size={14} />}
          loading={captionLoading}
          disabled={disabled}
          onClick={() => void runAutoCaption()}
        >
          {t("editor.toolbar.autoCaption")}
        </Button>
        <Button
          variant="default"
          leftSection={<IconSparkles size={14} />}
          disabled={disabled}
          onClick={() => setHighlightsOpen(true)}
        >
          {t("editor.toolbar.highlights")}
        </Button>
        <Button
          variant="default"
          leftSection={<IconScissors size={14} />}
          disabled={disabled}
          onClick={() => setCutsOpen(true)}
        >
          {t("editor.toolbar.cutSuggest")}
        </Button>
        <Button
          variant="default"
          leftSection={<IconMicrophone size={14} />}
          disabled={disabled}
          onClick={() => setNarrationOpen(true)}
        >
          {t("editor.toolbar.narration")}
        </Button>
      </Group>

      {highlightsOpen && jobId && (
        <HighlightsModal
          jobId={jobId}
          onClose={() => setHighlightsOpen(false)}
          onApplyRange={onApplyRange}
        />
      )}
      {cutsOpen && jobId && (
        <CutSuggestModal
          jobId={jobId}
          defaultClipId={defaultClipId}
          durationMs={durationMs}
          onClose={() => setCutsOpen(false)}
          onAddMany={onAddMany}
        />
      )}
      {narrationOpen && (
        <NarrationModal
          playheadMs={playheadMs}
          onClose={() => setNarrationOpen(false)}
          onAdd={onAdd}
        />
      )}
    </>
  );
}

// ─── Highlights (Claude CLI) ─────────────────────────────────────────────────
interface HighlightItem {
  startMs: number;
  endMs: number;
  title: string;
  reason: string;
}

function HighlightsModal({
  jobId,
  onClose,
  onApplyRange,
}: {
  jobId: string;
  onClose: () => void;
  onApplyRange: (startMs: number, endMs: number) => void;
}) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<HighlightItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiUrl("/api/director/highlights"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jobId }),
        });
        const data = (await res.json()) as {
          ok: boolean;
          highlights?: HighlightItem[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !data.ok) {
          setError(data.error ?? `HTTP ${res.status}`);
          return;
        }
        setItems(data.highlights ?? []);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  return (
    <Modal opened onClose={onClose} title={t("editor.highlights.title")} centered size="lg">
      <Stack>
        <Paper withBorder p="sm" radius="md" bg="var(--mantine-color-blue-light)">
          <Text size="xs" c="dimmed">
            {t("editor.highlights.hint")}
          </Text>
        </Paper>
        {loading && (
          <Group justify="center" py="md">
            <Loader size="sm" />
          </Group>
        )}
        {error && <Alert color="red">{error}</Alert>}
        {!loading && !error && items.length === 0 && (
          <Text size="sm" c="dimmed">
            {t("editor.highlights.empty")}
          </Text>
        )}
        {items.map((h, i) => (
          <Paper key={`${h.startMs}-${i}`} withBorder p="sm" radius="md">
            <Group justify="space-between" wrap="nowrap">
              <Stack gap={2} style={{ minWidth: 0 }}>
                <Text size="sm" fw={600}>
                  {h.title}
                </Text>
                <Text size="xs" c="dimmed">
                  {formatTimecode(h.startMs)} – {formatTimecode(h.endMs)}
                  {h.reason ? ` · ${h.reason}` : ""}
                </Text>
              </Stack>
              <Button
                size="xs"
                variant="filled"
                onClick={() => {
                  onApplyRange(h.startMs, h.endMs);
                  notifications.show({
                    color: "green",
                    title: t("editor.highlights.title"),
                    message: t("editor.highlights.applied"),
                  });
                  onClose();
                }}
              >
                {t("editor.highlights.apply")}
              </Button>
            </Group>
          </Paper>
        ))}
      </Stack>
    </Modal>
  );
}

// ─── Silence/filler cut suggestions (pure local) ─────────────────────────────
function CutSuggestModal({
  jobId,
  defaultClipId,
  durationMs,
  onClose,
  onAddMany,
}: {
  jobId: string;
  defaultClipId: string;
  durationMs: number;
  onClose: () => void;
  onAddMany: (xs: Action[]) => void;
}) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<CutSuggestion[]>([]);
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { segments, note } = await fetchTranscript(jobId);
        if (cancelled) return;
        if (segments.length === 0) {
          setError(note ?? t("editor.autoCaption.empty"));
          return;
        }
        setItems(suggestCuts(segments, durationMs));
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, durationMs]);

  const cutActionsFor = (list: CutSuggestion[]): Action[] =>
    list.flatMap((s) =>
      suggestionCutTimes(s, durationMs).map((at) => ({
        type: "cut" as const,
        meta: aiMeta(),
        clipId: defaultClipId,
        at,
      })),
    );

  const apply = (targets: CutSuggestion[]) => {
    const pending = targets.filter((s) => !appliedIds.has(s.id));
    const actions = cutActionsFor(pending);
    if (actions.length === 0) return;
    onAddMany(actions);
    setAppliedIds((prev) => {
      const next = new Set(prev);
      for (const s of pending) next.add(s.id);
      return next;
    });
    notifications.show({
      color: "green",
      title: t("editor.cutSuggest.title"),
      message: `${actions.length} ${t("editor.cutSuggest.applied")}`,
    });
  };

  return (
    <Modal opened onClose={onClose} title={t("editor.cutSuggest.title")} centered size="lg">
      <Stack>
        <Paper withBorder p="sm" radius="md" bg="var(--mantine-color-blue-light)">
          <Text size="xs" c="dimmed">
            {t("editor.cutSuggest.hint")}
          </Text>
        </Paper>
        {loading && (
          <Group justify="center" py="md">
            <Loader size="sm" />
          </Group>
        )}
        {error && <Alert color="red">{error}</Alert>}
        {!loading && !error && items.length === 0 && (
          <Text size="sm" c="dimmed">
            {t("editor.cutSuggest.empty")}
          </Text>
        )}
        {items.map((s) => (
          <Paper key={s.id} withBorder p="sm" radius="md">
            <Group justify="space-between" wrap="nowrap">
              <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                <Badge color={s.kind === "silence" ? "gray" : "orange"} variant="light">
                  {t(`editor.cutSuggest.${s.kind}`)}
                </Badge>
                <Text size="xs" c="dimmed" truncate>
                  {formatTimecode(s.startMs)} – {formatTimecode(s.endMs)} · {s.label}
                </Text>
              </Group>
              <Button
                size="xs"
                variant="filled"
                disabled={appliedIds.has(s.id)}
                onClick={() => apply([s])}
              >
                {t("editor.cutSuggest.apply")}
              </Button>
            </Group>
          </Paper>
        ))}
        {items.length > 0 && (
          <Group justify="flex-end">
            <Button
              variant="default"
              disabled={items.every((s) => appliedIds.has(s.id))}
              onClick={() => apply(items)}
            >
              {t("editor.cutSuggest.applyAll")}
            </Button>
          </Group>
        )}
      </Stack>
    </Modal>
  );
}

// ─── Narration (macOS say, local TTS) ────────────────────────────────────────
function NarrationModal({
  playheadMs,
  onClose,
  onAdd,
}: {
  playheadMs: number;
  onClose: () => void;
  onAdd: (a: Action) => void;
}) {
  const { t } = useI18n();
  const [script, setScript] = useState("");
  const [voice, setVoice] = useState("Yuna");
  const [startMs, setStartMs] = useState<number | string>(Math.round(playheadMs));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = script.trim().length > 0;

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl("/api/tts"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: script.trim(), voice: voice.trim() || "Yuna" }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        path?: string;
        durationMs?: number;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.path) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const s = Math.max(0, Number(startMs) || 0);
      onAdd({
        type: "bgm",
        meta: aiMeta(),
        source: data.path,
        volume: 1.0,
        start: s > 0 ? s : undefined,
        end: data.durationMs && data.durationMs > 0 ? s + data.durationMs : undefined,
      });
      notifications.show({
        color: "green",
        title: t("editor.narration.title"),
        message: t("editor.narration.done"),
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal opened onClose={onClose} title={t("editor.narration.title")} centered>
      <Stack>
        <Paper withBorder p="sm" radius="md" bg="var(--mantine-color-blue-light)">
          <Text size="xs" c="dimmed">
            {t("editor.narration.hint")}
          </Text>
        </Paper>
        <Textarea
          label={t("editor.narration.script")}
          value={script}
          onChange={(e) => setScript(e.currentTarget.value)}
          minRows={4}
          autosize
          maxLength={5000}
        />
        <Group grow>
          <TextInput
            label={t("editor.narration.voice")}
            value={voice}
            onChange={(e) => setVoice(e.currentTarget.value)}
            placeholder="Yuna"
          />
          <NumberInput
            label={t("editor.narration.start")}
            value={startMs}
            onChange={setStartMs}
            min={0}
          />
        </Group>
        {error && <Alert color="red">{error}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={loading}>
            {t("editor.cancel")}
          </Button>
          <Button variant="filled" loading={loading} disabled={!valid} onClick={() => void generate()}>
            {t("editor.narration.submit")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
