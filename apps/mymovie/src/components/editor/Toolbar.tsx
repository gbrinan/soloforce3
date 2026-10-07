"use client";

import { useState } from "react";
import {
  Button,
  Group,
  Modal,
  NumberInput,
  Paper,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { Dropzone, type FileWithPath } from "@mantine/dropzone";
import {
  IconCut,
  IconCrop,
  IconArrowsHorizontal,
  IconTypography,
  IconMusic,
  IconArrowRight,
  IconUpload,
  IconX,
  IconPlayerPlay,
  IconShadow,
  IconTransform,
  IconRobot,
} from "@tabler/icons-react";
import type { Action, ActionType } from "@/lib/core/action-types";
import { type ClipMeta, buildClipOptions, resolveClipId } from "@/lib/core/clip-meta";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { apiUrl } from "@/lib/api-url";

// Tool description + usage example panel shown at the top of every tool modal.
function ToolHelp({ tool }: { tool: ActionType }) {
  const { t } = useI18n();
  return (
    <Paper withBorder p="sm" radius="md" bg="var(--mantine-color-blue-light)">
      <Text size="sm" fw={600} mb={4}>
        {t(`editor.help.${tool}.desc`)}
      </Text>
      <Text size="xs" c="dimmed">
        {t(`editor.help.${tool}.usage`)}
      </Text>
    </Paper>
  );
}

interface Props {
  onAdd: (a: Action) => void;
  defaultClipId: string;
  clips: ClipMeta[];
  actions: Action[];
  // P0 — Toolbar-level AI 편집 진입점. 사용자가 자연어로 편집 지시를 적으면 부모(EditorScreen)가
  // runAi(intent)을 호출해 director에 위임한다. director는 Claude CLI 인증을 재사용하므로
  // 별도 API 키가 필요 없다 → AI 생성(MYMOVIE_GENERATE_*_KEY)과 달리 키 게이트를 걸지 않는다.
  onAiEdit?: (intent: string) => void | Promise<void>;
  aiEditLoading?: boolean;
  aiEditDisabled?: boolean;
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `act-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

function makeMeta() {
  return { id: newId(), createdAt: Date.now(), source: "user" as const };
}

export default function Toolbar({
  onAdd,
  defaultClipId,
  clips,
  actions,
  onAiEdit,
  aiEditLoading,
  aiEditDisabled,
}: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState<ActionType | null>(null);
  const [aiEditOpen, setAiEditOpen] = useState(false);

  const options = buildClipOptions(clips, actions);

  return (
    <>
      <Group gap="xs" wrap="wrap">
        <Button variant="default" leftSection={<IconCut size={14} />} onClick={() => setOpen("cut")}>
          {t("editor.toolbar.cut")}
        </Button>
        <Button variant="default" leftSection={<IconArrowsHorizontal size={14} />} onClick={() => setOpen("trim")}>
          {t("editor.toolbar.trim")}
        </Button>
        <Button variant="default" leftSection={<IconCrop size={14} />} onClick={() => setOpen("reframe")}>
          {t("editor.toolbar.reframe")}
        </Button>
        <Button variant="default" leftSection={<IconTypography size={14} />} onClick={() => setOpen("caption")}>
          {t("editor.toolbar.caption")}
        </Button>
        <Button variant="default" leftSection={<IconMusic size={14} />} onClick={() => setOpen("bgm")}>
          {t("editor.toolbar.bgm")}
        </Button>
        <Button variant="default" leftSection={<IconArrowRight size={14} />} onClick={() => setOpen("transition")}>
          {t("editor.toolbar.transition")}
        </Button>
        <Button variant="default" leftSection={<IconPlayerPlay size={14} />} onClick={() => setOpen("speed")}>
          {t("editor.toolbar.speed")}
        </Button>
        <Button variant="default" leftSection={<IconShadow size={14} />} onClick={() => setOpen("opacity")}>
          {t("editor.toolbar.opacity")}
        </Button>
        <Button variant="default" leftSection={<IconTransform size={14} />} onClick={() => setOpen("transform")}>
          {t("editor.toolbar.transform")}
        </Button>
        {onAiEdit && (
          <Button
            variant="default"
            leftSection={<IconRobot size={14} />}
            disabled={aiEditDisabled}
            onClick={() => setAiEditOpen(true)}
          >
            {t("editor.toolbar.aiEdit")}
          </Button>
        )}
      </Group>

      {open === "cut" && (
        <CutForm
          defaultClipId={defaultClipId}
          options={options}
          onClose={() => setOpen(null)}
          onSubmit={(a) => { onAdd(a); setOpen(null); }}
        />
      )}
      {open === "trim" && (
        <TrimForm
          defaultClipId={defaultClipId}
          options={options}
          onClose={() => setOpen(null)}
          onSubmit={(a) => { onAdd(a); setOpen(null); }}
        />
      )}
      {open === "reframe" && (
        <ReframeForm
          defaultClipId={defaultClipId}
          options={options}
          onClose={() => setOpen(null)}
          onSubmit={(a) => { onAdd(a); setOpen(null); }}
        />
      )}
      {open === "caption" && (
        <CaptionForm
          defaultClipId={defaultClipId}
          options={options}
          onClose={() => setOpen(null)}
          onSubmit={(a) => { onAdd(a); setOpen(null); }}
        />
      )}
      {open === "bgm" && (
        <BgmForm
          onClose={() => setOpen(null)}
          onSubmit={(a) => { onAdd(a); setOpen(null); }}
        />
      )}
      {open === "transition" && (
        <TransitionForm
          defaultClipId={defaultClipId}
          options={options}
          onClose={() => setOpen(null)}
          onSubmit={(a) => { onAdd(a); setOpen(null); }}
        />
      )}
      {open === "speed" && (
        <SpeedForm
          defaultClipId={defaultClipId}
          options={options}
          onClose={() => setOpen(null)}
          onSubmit={(a) => { onAdd(a); setOpen(null); }}
        />
      )}
      {open === "opacity" && (
        <OpacityForm
          defaultClipId={defaultClipId}
          options={options}
          onClose={() => setOpen(null)}
          onSubmit={(a) => { onAdd(a); setOpen(null); }}
        />
      )}
      {open === "transform" && (
        <TransformForm
          defaultClipId={defaultClipId}
          options={options}
          onClose={() => setOpen(null)}
          onSubmit={(a) => { onAdd(a); setOpen(null); }}
        />
      )}
      {aiEditOpen && onAiEdit && (
        <AiEditForm
          loading={!!aiEditLoading}
          onClose={() => setAiEditOpen(false)}
          onSubmit={async (intent) => {
            await onAiEdit(intent);
            setAiEditOpen(false);
          }}
        />
      )}
    </>
  );
}

// ─── AI Edit (toolbar entry-point) ───────────────────────────────────────────
function AiEditForm({
  loading,
  onClose,
  onSubmit,
}: {
  loading: boolean;
  onClose: () => void;
  onSubmit: (intent: string) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [intent, setIntent] = useState("");
  const valid = intent.trim().length > 0;
  return (
    <Modal opened onClose={onClose} title={t("editor.toolbar.aiEdit.title")} centered>
      <Stack>
        <Paper withBorder p="sm" radius="md" bg="var(--mantine-color-blue-light)">
          <Text size="xs" c="dimmed">
            {t("editor.toolbar.aiEdit.hint")}
          </Text>
        </Paper>
        <Textarea
          value={intent}
          onChange={(e) => setIntent(e.currentTarget.value)}
          minRows={4}
          autosize
          placeholder={t("editor.toolbar.aiEdit.placeholder")}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={loading}>
            {t("editor.cancel")}
          </Button>
          <Button variant="filled"
            loading={loading}
            disabled={!valid}
            onClick={() => void onSubmit(intent.trim())}
          >
            {t("editor.toolbar.aiEdit.submit")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

type ClipOpt = { value: string; label: string };

function ClipSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: ClipOpt[];
  onChange: (next: string) => void;
}) {
  const { t } = useI18n();
  return (
    <Select
      label={label}
      value={value}
      onChange={(v) => onChange(v ?? "")}
      data={options}
      placeholder={t("editor.clip.placeholder")}
      searchable
      nothingFoundMessage={t("editor.clip.empty")}
    />
  );
}

// ─── Cut ────────────────────────────────────────────────────────────────────
function CutForm({
  defaultClipId, options, onClose, onSubmit,
}: { defaultClipId: string; options: ClipOpt[]; onClose: () => void; onSubmit: (a: Action) => void }) {
  const { t } = useI18n();
  const [clipId, setClipId] = useState(defaultClipId);
  const [at, setAt] = useState<number | string>(0);
  return (
    <Modal opened onClose={onClose} title={t("editor.toolbar.cut")} centered>
      <Stack>
        <ToolHelp tool="cut" />
        <ClipSelect label={t("editor.action.clipId")} value={clipId} options={options} onChange={setClipId} />
        <NumberInput label={t("editor.action.at")} value={at} onChange={setAt} min={0} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>{t("editor.cancel")}</Button>
          <Button variant="filled"
            onClick={() =>
              onSubmit({
                type: "cut",
                meta: makeMeta(),
                clipId: resolveClipId(clipId || defaultClipId),
                at: Number(at) || 0,
              })
            }
          >
            {t("editor.add")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ─── Trim ───────────────────────────────────────────────────────────────────
function TrimForm({
  defaultClipId, options, onClose, onSubmit,
}: { defaultClipId: string; options: ClipOpt[]; onClose: () => void; onSubmit: (a: Action) => void }) {
  const { t } = useI18n();
  const [clipId, setClipId] = useState(defaultClipId);
  const [start, setStart] = useState<number | string>(0);
  const [end, setEnd] = useState<number | string>(1000);
  const valid = Number(end) > Number(start);
  return (
    <Modal opened onClose={onClose} title={t("editor.toolbar.trim")} centered>
      <Stack>
        <ToolHelp tool="trim" />
        <ClipSelect label={t("editor.action.clipId")} value={clipId} options={options} onChange={setClipId} />
        <NumberInput label={t("editor.action.start")} value={start} onChange={setStart} min={0} />
        <NumberInput
          label={t("editor.action.end")}
          value={end}
          onChange={setEnd}
          min={0}
          error={valid ? undefined : t("editor.action.errEndAfterStart")}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>{t("editor.cancel")}</Button>
          <Button variant="filled"
            disabled={!valid}
            onClick={() =>
              onSubmit({
                type: "trim",
                meta: makeMeta(),
                clipId: resolveClipId(clipId || defaultClipId),
                start: Number(start) || 0,
                end: Number(end) || 0,
              })
            }
          >
            {t("editor.add")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ─── Reframe ────────────────────────────────────────────────────────────────
function ReframeForm({
  defaultClipId, options, onClose, onSubmit,
}: { defaultClipId: string; options: ClipOpt[]; onClose: () => void; onSubmit: (a: Action) => void }) {
  const { t } = useI18n();
  const [clipId, setClipId] = useState(defaultClipId);
  const [w, setW] = useState<number | string>(9);
  const [h, setH] = useState<number | string>(16);
  const [fx, setFx] = useState<number | string>(0.5);
  const [fy, setFy] = useState<number | string>(0.5);
  return (
    <Modal opened onClose={onClose} title={t("editor.toolbar.reframe")} centered>
      <Stack>
        <ToolHelp tool="reframe" />
        <ClipSelect label={t("editor.action.clipId")} value={clipId} options={options} onChange={setClipId} />
        <Group grow>
          <NumberInput label={t("editor.action.aspectW")} value={w} onChange={setW} min={1} />
          <NumberInput label={t("editor.action.aspectH")} value={h} onChange={setH} min={1} />
        </Group>
        <Group grow>
          <NumberInput label={t("editor.action.focalX")} value={fx} onChange={setFx} min={0} max={1} step={0.05} decimalScale={2} />
          <NumberInput label={t("editor.action.focalY")} value={fy} onChange={setFy} min={0} max={1} step={0.05} decimalScale={2} />
        </Group>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>{t("editor.cancel")}</Button>
          <Button variant="filled"
            onClick={() =>
              onSubmit({
                type: "reframe",
                meta: makeMeta(),
                clipId: resolveClipId(clipId || defaultClipId),
                aspect: { w: Number(w) || 1, h: Number(h) || 1 },
                focal: { x: Number(fx) || 0.5, y: Number(fy) || 0.5 },
              })
            }
          >
            {t("editor.add")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ─── Caption ────────────────────────────────────────────────────────────────
function CaptionForm({
  defaultClipId, options, onClose, onSubmit,
}: { defaultClipId: string; options: ClipOpt[]; onClose: () => void; onSubmit: (a: Action) => void }) {
  const { t } = useI18n();
  const [clipId, setClipId] = useState(defaultClipId);
  const [start, setStart] = useState<number | string>(0);
  const [end, setEnd] = useState<number | string>(2000);
  const [text, setText] = useState("");
  const [pos, setPos] = useState<"top" | "bottom" | "center">("bottom");
  const [color, setColor] = useState("white");
  const [size, setSize] = useState<number | string>(24);
  const valid = Number(end) > Number(start) && text.trim().length > 0;
  return (
    <Modal opened onClose={onClose} title={t("editor.toolbar.caption")} centered>
      <Stack>
        <ToolHelp tool="caption" />
        <ClipSelect label={t("editor.action.clipId")} value={clipId} options={options} onChange={setClipId} />
        <Group grow>
          <NumberInput label={t("editor.action.start")} value={start} onChange={setStart} min={0} />
          <NumberInput label={t("editor.action.end")} value={end} onChange={setEnd} min={0} />
        </Group>
        <Textarea label={t("editor.action.text")} value={text} onChange={(e) => setText(e.currentTarget.value)} minRows={2} />
        <Group grow>
          <Select
            label={t("editor.action.pos")}
            value={pos}
            onChange={(v) => setPos((v as "top" | "bottom" | "center") ?? "bottom")}
            data={[
              { value: "top", label: "top" },
              { value: "center", label: "center" },
              { value: "bottom", label: "bottom" },
            ]}
          />
          <TextInput label={t("editor.action.color")} value={color} onChange={(e) => setColor(e.currentTarget.value)} />
          <NumberInput label={t("editor.action.size")} value={size} onChange={setSize} min={8} />
        </Group>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>{t("editor.cancel")}</Button>
          <Button variant="filled"
            disabled={!valid}
            onClick={() =>
              onSubmit({
                type: "caption",
                meta: makeMeta(),
                clipId: resolveClipId(clipId || defaultClipId),
                start: Number(start) || 0,
                end: Number(end) || 0,
                text: text.trim(),
                style: { color, size: Number(size) || 24, pos },
              })
            }
          >
            {t("editor.add")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ─── BGM ────────────────────────────────────────────────────────────────────
function BgmForm({
  onClose, onSubmit,
}: { onClose: () => void; onSubmit: (a: Action) => void }) {
  const { t } = useI18n();
  const [source, setSource] = useState("");
  const [uploadName, setUploadName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [volume, setVolume] = useState<number | string>(0.5);
  const [start, setStart] = useState<number | string>(0);
  const [end, setEnd] = useState<number | string>(0);
  const valid = source.trim().length > 0;

  async function uploadBgm(files: FileWithPath[]) {
    const file = files[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(apiUrl("/api/ingest/bgm"), { method: "POST", body: fd });
      const data = (await res.json()) as { ok: boolean; path?: string; name?: string; error?: string };
      if (!res.ok || !data.ok || !data.path) {
        setUploadError(data.error ?? `${t("editor.action.bgmUploadFailed")} (${res.status})`);
        return;
      }
      setSource(data.path);
      setUploadName(data.name ?? file.name);
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <Modal opened onClose={onClose} title={t("editor.toolbar.bgm")} centered>
      <Stack>
        <ToolHelp tool="bgm" />
        <Dropzone
          onDrop={uploadBgm}
          loading={uploading}
          maxSize={100 * 1024 * 1024}
          accept={["audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/aac", "audio/ogg", "audio/flac"]}
          multiple={false}
        >
          <Group justify="center" gap="sm" mih={80} style={{ pointerEvents: "none" }}>
            <Dropzone.Accept><IconUpload size={28} /></Dropzone.Accept>
            <Dropzone.Reject><IconX size={28} /></Dropzone.Reject>
            <Dropzone.Idle><IconMusic size={28} /></Dropzone.Idle>
            <Stack gap={2}>
              <Text size="sm">{t("editor.action.bgmUpload")}</Text>
              {uploadName ? (
                <Text size="xs" c="green">{uploadName}</Text>
              ) : (
                <Text size="xs" c="dimmed">{t("editor.action.bgmUploadHint")}</Text>
              )}
            </Stack>
          </Group>
        </Dropzone>
        {uploadError && <Text size="xs" c="red">{uploadError}</Text>}
        <TextInput
          label={t("editor.action.bgmSource")}
          value={source}
          onChange={(e) => setSource(e.currentTarget.value)}
          placeholder="bgm.mp3"
        />
        <NumberInput label={t("editor.action.volume")} value={volume} onChange={setVolume} min={0} max={1} step={0.05} decimalScale={2} />
        <Group grow>
          <NumberInput label={t("editor.action.start")} value={start} onChange={setStart} min={0} />
          <NumberInput label={t("editor.action.end")} value={end} onChange={setEnd} min={0} />
        </Group>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>{t("editor.cancel")}</Button>
          <Button variant="filled"
            disabled={!valid}
            onClick={() => {
              const s = Number(start);
              const e = Number(end);
              onSubmit({
                type: "bgm",
                meta: makeMeta(),
                source: source.trim(),
                volume: Math.max(0, Math.min(1, Number(volume) || 0)),
                start: s > 0 ? s : undefined,
                end: e > 0 ? e : undefined,
              });
            }}
          >
            {t("editor.add")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ─── Transition ─────────────────────────────────────────────────────────────
function TransitionForm({
  defaultClipId, options, onClose, onSubmit,
}: { defaultClipId: string; options: ClipOpt[]; onClose: () => void; onSubmit: (a: Action) => void }) {
  const { t } = useI18n();
  const [fromClipId, setFromClipId] = useState(defaultClipId);
  const [toClipId, setToClipId] = useState(defaultClipId);
  const [kind, setKind] = useState<"fade" | "wipe" | "slide" | "cut">("fade");
  const [durationMs, setDurationMs] = useState<number | string>(500);
  const valid = Number(durationMs) > 0;
  return (
    <Modal opened onClose={onClose} title={t("editor.toolbar.transition")} centered>
      <Stack>
        <ToolHelp tool="transition" />
        <ClipSelect label={t("editor.action.fromClipId")} value={fromClipId} options={options} onChange={setFromClipId} />
        <ClipSelect label={t("editor.action.toClipId")} value={toClipId} options={options} onChange={setToClipId} />
        <Select
          label={t("editor.action.kind")}
          value={kind}
          onChange={(v) => setKind((v as "fade" | "wipe" | "slide" | "cut") ?? "fade")}
          data={[
            { value: "fade", label: t("editor.transition.fade") },
            { value: "wipe", label: t("editor.transition.wipe") },
            { value: "slide", label: t("editor.transition.slide") },
            { value: "cut", label: t("editor.transition.cut") },
          ]}
        />
        <NumberInput label={t("editor.action.durationMs")} value={durationMs} onChange={setDurationMs} min={1} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>{t("editor.cancel")}</Button>
          <Button variant="filled"
            disabled={!valid}
            onClick={() =>
              onSubmit({
                type: "transition",
                meta: makeMeta(),
                fromClipId: resolveClipId(fromClipId || defaultClipId),
                toClipId: resolveClipId(toClipId || defaultClipId),
                kind,
                durationMs: Number(durationMs) || 1,
              })
            }
          >
            {t("editor.add")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ─── Speed ──────────────────────────────────────────────────────────────────
function SpeedForm({
  defaultClipId, options, onClose, onSubmit,
}: { defaultClipId: string; options: ClipOpt[]; onClose: () => void; onSubmit: (a: Action) => void }) {
  const { t } = useI18n();
  const [clipId, setClipId] = useState(defaultClipId);
  const [factor, setFactor] = useState<number | string>(1.0);
  const valid = Number(factor) >= 0.25 && Number(factor) <= 4.0;
  return (
    <Modal opened onClose={onClose} title={t("editor.toolbar.speed")} centered>
      <Stack>
        <ToolHelp tool="speed" />
        <ClipSelect label={t("editor.action.clipId")} value={clipId} options={options} onChange={setClipId} />
        <NumberInput
          label={t("editor.action.factor")}
          value={factor}
          onChange={setFactor}
          min={0.25}
          max={4.0}
          step={0.25}
          decimalScale={2}
          error={valid ? undefined : t("editor.action.errFactorRange")}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>{t("editor.cancel")}</Button>
          <Button variant="filled"
            disabled={!valid}
            onClick={() =>
              onSubmit({
                type: "speed",
                meta: makeMeta(),
                clipId: resolveClipId(clipId || defaultClipId),
                factor: Number(factor) || 1.0,
              })
            }
          >
            {t("editor.add")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ─── Opacity ────────────────────────────────────────────────────────────────
function OpacityForm({
  defaultClipId, options, onClose, onSubmit,
}: { defaultClipId: string; options: ClipOpt[]; onClose: () => void; onSubmit: (a: Action) => void }) {
  const { t } = useI18n();
  const [clipId, setClipId] = useState(defaultClipId);
  const [start, setStart] = useState<number | string>(0);
  const [end, setEnd] = useState<number | string>(2000);
  const [from, setFrom] = useState<number | string>(1.0);
  const [to, setTo] = useState<number | string>(0.5);
  const valid = Number(end) > Number(start) && Number(from) >= 0 && Number(from) <= 1 && Number(to) >= 0 && Number(to) <= 1;
  return (
    <Modal opened onClose={onClose} title={t("editor.toolbar.opacity")} centered>
      <Stack>
        <ToolHelp tool="opacity" />
        <ClipSelect label={t("editor.action.clipId")} value={clipId} options={options} onChange={setClipId} />
        <Group grow>
          <NumberInput label={t("editor.action.start")} value={start} onChange={setStart} min={0} />
          <NumberInput label={t("editor.action.end")} value={end} onChange={setEnd} min={0} />
        </Group>
        <Group grow>
          <NumberInput label={t("editor.action.from")} value={from} onChange={setFrom} min={0} max={1} step={0.1} decimalScale={2} />
          <NumberInput label={t("editor.action.to")} value={to} onChange={setTo} min={0} max={1} step={0.1} decimalScale={2} />
        </Group>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>{t("editor.cancel")}</Button>
          <Button variant="filled"
            disabled={!valid}
            onClick={() =>
              onSubmit({
                type: "opacity",
                meta: makeMeta(),
                clipId: resolveClipId(clipId || defaultClipId),
                start: Number(start) || 0,
                end: Number(end) || 0,
                from: Number(from) || 1.0,
                to: Number(to) || 0.5,
              })
            }
          >
            {t("editor.add")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ─── Transform ──────────────────────────────────────────────────────────────
function TransformForm({
  defaultClipId, options, onClose, onSubmit,
}: { defaultClipId: string; options: ClipOpt[]; onClose: () => void; onSubmit: (a: Action) => void }) {
  const { t } = useI18n();
  const [clipId, setClipId] = useState(defaultClipId);
  const [scale, setScale] = useState<number | string>(1.0);
  const [rotateDeg, setRotateDeg] = useState<number | string>(0);
  const [translateX, setTranslateX] = useState<number | string>(0);
  const [translateY, setTranslateY] = useState<number | string>(0);
  const valid = Number(scale) > 0 && Number(rotateDeg) >= -360 && Number(rotateDeg) <= 360;
  return (
    <Modal opened onClose={onClose} title={t("editor.toolbar.transform")} centered>
      <Stack>
        <ToolHelp tool="transform" />
        <ClipSelect label={t("editor.action.clipId")} value={clipId} options={options} onChange={setClipId} />
        <NumberInput label={t("editor.action.scale")} value={scale} onChange={setScale} min={0.1} max={5} step={0.1} decimalScale={2} />
        <NumberInput label={t("editor.action.rotateDeg")} value={rotateDeg} onChange={setRotateDeg} min={-360} max={360} />
        <Group grow>
          <NumberInput label={t("editor.action.translateX")} value={translateX} onChange={setTranslateX} />
          <NumberInput label={t("editor.action.translateY")} value={translateY} onChange={setTranslateY} />
        </Group>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>{t("editor.cancel")}</Button>
          <Button variant="filled"
            disabled={!valid}
            onClick={() => {
              const s = Number(scale);
              const r = Number(rotateDeg);
              const tx = Number(translateX);
              const ty = Number(translateY);
              onSubmit({
                type: "transform",
                meta: makeMeta(),
                clipId: resolveClipId(clipId || defaultClipId),
                scale: s !== 1.0 ? s : undefined,
                rotateDeg: r !== 0 ? r : undefined,
                translate: tx !== 0 || ty !== 0 ? { x: tx, y: ty } : undefined,
              });
            }}
          >
            {t("editor.add")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}


