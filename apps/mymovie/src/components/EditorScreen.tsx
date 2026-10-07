"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  Divider,
  Group,
  Progress,
  Stack,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconPlayerPlay,
  IconPlus,
  IconRobot,
  IconSparkles,
  IconUpload,
} from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { apiUrl } from "@/lib/api-url";
import type { Action, KeyframePoint } from "@/lib/core/action-types";
import type { ClipMeta } from "@/lib/core/clip-meta";
import type { KFProp } from "@/components/editor/inspector/KeyframesLane";
import Timeline from "@/components/editor/Timeline";
import Toolbar from "@/components/editor/Toolbar";
import AiTools from "@/components/editor/AiTools";
import Preview, { type PreviewHandle } from "@/components/editor/Preview";
import AIChatFab from "@/components/editor/AIChatFab";
import AddVideoModal from "@/components/editor/AddVideoModal";
import TrackTimeline from "@/components/editor/timeline/TrackTimeline";
import Inspector from "@/components/editor/Inspector";
import { DEFAULT_PX_PER_MS } from "@/lib/core/timeline-model";

function newActionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `act-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

interface Props {
  onResult: (jobId: string) => void;
  onBack: () => void;
}

interface RenderResponse {
  ok: boolean;
  finalPath?: string;
  sizeBytes?: number;
  appliedActionIds?: string[];
  failedActionIds?: string[];
  warnings?: { actionId: string; reason: string }[];
  error?: string;
}

interface DirectorRunResponse {
  ok: boolean;
  result?: {
    ok?: boolean;
    finalActions?: Action[];
  };
  error?: string;
}

interface ValidateResponse {
  ok: boolean;
  validation?: {
    ok: boolean;
    errors: { actionId?: string; reason: string }[];
  };
  error?: string;
}

type Stage = "queued" | "downloading" | "transcoding" | "done" | "error";

interface JobView {
  id: string;
  stage: Stage;
  progress: number;
  message?: string;
  proxyUrl?: string | null;
}

const POLL_MS = 1000;

// One undone operation, captured so redo can replay it. Mirrors the two undo
// paths: a whole-clips snapshot (duplicate/delete) or a single popped action.
type RedoEntry =
  | { kind: "clips"; clips: ClipMeta[] }
  | { kind: "action"; action: Action };

export default function EditorScreen({ onResult, onBack }: Props) {
  const { t } = useI18n();

  // Multi-clip model. clips[0] is the primary clip — initial render + base jobId
  // resolve off it to keep the render backend (single-jobId) contract intact.
  // Additional clips appear in tool selectors but composite render is follow-up work.
  const [clips, setClips] = useState<ClipMeta[]>([]);
  // Clip-level undo stack. Each entry is a prior clips snapshot pushed before
  // a structural change (duplicate, future delete). Undo pops from here before
  // falling back to the per-action stack.
  const [clipsHistory, setClipsHistory] = useState<ClipMeta[][]>([]);
  // Redo stack — mirrors what undo pops so Cmd+Shift+Z can replay it. Any new
  // forward edit clears it (standard undo/redo invariant).
  const [redoStack, setRedoStack] = useState<RedoEntry[]>([]);
  const previewRef = useRef<PreviewHandle | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [pendingHandoffUrl, setPendingHandoffUrl] = useState<string | undefined>(undefined);
  const [pendingLocalIngest, setPendingLocalIngest] = useState<string | undefined>(undefined);

  useEffect(() => {
    const handler = (e: Event) => {
      const { url, localFile } = (e as CustomEvent<{ url: string; localFile?: boolean }>).detail ?? {};
      if (!url) return;
      if (localFile) {
        setPendingLocalIngest(url);
      } else {
        setPendingHandoffUrl(url);
        setAddOpen(true);
      }
    };
    window.addEventListener("mymovie:asset-load", handler);
    return () => window.removeEventListener("mymovie:asset-load", handler);
  }, []);

  useEffect(() => {
    if (!pendingLocalIngest) return;
    const url = pendingLocalIngest;
    setPendingLocalIngest(undefined);
    const filename = decodeURIComponent(url.split("/").pop() ?? "video.mp4");
    const title = filename.replace(/\.[^.]+$/, "");
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`${t("editor.load.failed")} (HTTP ${r.status}): ${url}`);
        const ct = r.headers.get("content-type") ?? "";
        if (ct && !ct.startsWith("video/") && !ct.startsWith("application/octet-stream")) {
          throw new Error(`${t("editor.load.failed")} — ${t("editor.load.badType")}: ${ct}`);
        }
        return r.blob();
      })
      .then((blob) => {
        if (blob.size === 0) throw new Error(`${t("editor.load.failed")} — ${t("editor.load.empty")}`);
        const fd = new FormData();
        fd.append("file", blob, filename);
        return fetch(apiUrl("/api/ingest/upload"), { method: "POST", body: fd });
      })
      .then((r) => r.json() as Promise<{ ok: boolean; jobId?: string; error?: string }>)
      .then((data) => {
        if (data.ok && data.jobId) onImport(data.jobId, title);
      })
      .catch((err: Error) => {
        notifications.show({ color: "red", title: t("editor.load.failed"), message: err.message });
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingLocalIngest]);

  const primary = clips[0] ?? null;
  const jobId = primary?.jobId ?? null;

  const [job, setJob] = useState<JobView | null>(null);

  const [actions, setActions] = useState<Action[]>([]);
  const [intent, setIntent] = useState("");
  const [rendering, setRendering] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [videoVersion, setVideoVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  // NLE multi-clip selection. Holds ClipMeta.jobId values for the primary
  // track; marquee/ClipBlock click drag bubble updates here.
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);

  // Track-timeline state. playhead/duration come from Preview's <video>; seek is
  // pushed back via an incrementing token so the effect re-runs even on same ms.
  const [playheadMs, setPlayheadMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [seekMs, setSeekMs] = useState(0);
  const [seekToken, setSeekToken] = useState(0);
  const [pxPerMs, setPxPerMs] = useState(DEFAULT_PX_PER_MS);

  const defaultClipId = jobId ?? "";

  // Direct-to-editor: the editor is usable as soon as ingest finishes. The
  // live WYSIWYG Preview composites off the raw proxy (sourceUrl), so no
  // forced AI auto-edit render is needed to enter. AI editing is opt-in via
  // the AIChatFab tool.
  const ready = job?.stage === "done";
  const importing = jobId != null && job?.stage !== "done" && job?.stage !== "error";

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(apiUrl(`/api/ingest/jobs/${jobId}`), { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { ok: boolean; job?: JobView };
        if (cancelled) return;
        if (data.ok && data.job) setJob(data.job);
      } catch {
        /* transient network error — next poll retries */
      }
    };
    void tick();
    const interval = setInterval(() => {
      if (!cancelled) void tick();
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [jobId]);

  useEffect(() => {
    if (!jobId) return;
    if (actions.length === 0) {
      setValidationErrors({});
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(apiUrl("/api/actions/validate"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jobId, actions }),
        });
        const raw = await res.text();
        let data: ValidateResponse | null = null;
        try {
          data = raw ? (JSON.parse(raw) as ValidateResponse) : null;
        } catch {
          data = null;
        }
        if (!data?.validation) {
          setValidationErrors({});
          return;
        }
        const map: Record<string, string> = {};
        for (const e of data.validation.errors) {
          if (e.actionId && !map[e.actionId]) map[e.actionId] = e.reason;
        }
        setValidationErrors(map);
      } catch {
        /* keep previous map until next change */
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [actions, jobId]);

  const videoSrc = useMemo(() => {
    if (!jobId || videoVersion === 0) return null;
    return `${apiUrl(`/api/render/${jobId}`)}?t=${videoVersion}`;
  }, [jobId, videoVersion]);

  let overallPct = 0;
  let overallLabel = t("progress.stage.queued");
  if (job) {
    if (job.stage === "done") {
      overallPct = 100;
      overallLabel = t("progress.stage.done");
    } else if (job.stage === "transcoding" || job.stage === "downloading") {
      overallPct = Math.round(job.progress * 0.5);
      overallLabel = t(`progress.stage.${job.stage}`);
    } else if (job.stage === "queued") {
      overallPct = 0;
      overallLabel = t("progress.stage.queued");
    } else if (job.stage === "error") {
      overallPct = job.progress * 0.5;
      overallLabel = t("progress.stage.error");
    }
  }
  const ingestError = job?.stage === "error";
  const isImportError = ingestError;

  const pushAction = (a: Action) => {
    clearRedo();
    setActions((prev) => [...prev, a]);
  };

  const pushMany = (xs: Action[]) => {
    clearRedo();
    setActions((prev) => [...prev, ...xs]);
  };

  const removeAction = (id: string) => {
    clearRedo();
    setActions((prev) => prev.filter((a) => a.meta.id !== id));
    if (selectedActionId === id) setSelectedActionId(null);
  };

  const updateAction = (id: string, updated: Action) => {
    clearRedo();
    setActions((prev) => prev.map((a) => (a.meta.id === id ? updated : a)));
  };

  const undo = () => {
    // Prefer popping clip-level history first (duplicate, etc.). Actions stack
    // is the secondary undo; this keeps the two stacks decoupled and avoids
    // needing a union-typed event log just for one new op.
    if (clipsHistory.length > 0) {
      const last = clipsHistory[clipsHistory.length - 1];
      const current = clips;
      setClipsHistory((h) => h.slice(0, -1));
      setClips(last);
      setRedoStack((r) => [...r, { kind: "clips", clips: current }]);
      return;
    }
    if (actions.length === 0) return;
    const popped = actions[actions.length - 1];
    setActions((prev) => prev.slice(0, -1));
    setRedoStack((r) => [...r, { kind: "action", action: popped }]);
  };

  const redo = () => {
    if (redoStack.length === 0) return;
    const entry = redoStack[redoStack.length - 1];
    setRedoStack((r) => r.slice(0, -1));
    if (entry.kind === "clips") {
      const current = clips;
      setClipsHistory((h) => [...h, current]);
      setClips(entry.clips);
    } else {
      setActions((prev) => [...prev, entry.action]);
    }
  };

  // Any forward edit invalidates the redo stack.
  const clearRedo = () => setRedoStack((r) => (r.length ? [] : r));

  // Cmd/Ctrl+D + right-click menu duplicate. Operates on ClipMeta; duplicate
  // gets a fresh jobId-keyed entry (jobId reuse is intentional so the proxy
  // file is shared) with a "(복제)" suffix. Pushed to clipsHistory for undo.
  const duplicateClipMeta = (clipId: string) => {
    clearRedo();
    setClips((prev) => {
      const idx = prev.findIndex((c) => c.jobId === clipId);
      if (idx < 0) return prev;
      setClipsHistory((h) => [...h, prev]);
      const src = prev[idx];
      // Tag duplicate title — multiple dupes get "(복제 2)", "(복제 3)" etc.
      const baseTitle = src.title.replace(/\s*\(복제(?:\s\d+)?\)$/, "");
      const dupes = prev.filter((c) =>
        c.title === baseTitle ||
        c.title.startsWith(`${baseTitle} (복제`),
      ).length;
      const suffix = dupes <= 1 ? " (복제)" : ` (복제 ${dupes})`;
      const dup: ClipMeta = { jobId: src.jobId, title: `${baseTitle}${suffix}` };
      return [...prev.slice(0, idx + 1), dup, ...prev.slice(idx + 1)];
    });
  };

  // Timeline edits map onto the same Action model the toolbar/render use.
  // Trim is single-range per clip: drop any prior user trim for this clip, push new.
  const replaceTrim = (clipId: string, start: number, end: number) => {
    clearRedo();
    setActions((prev) => {
      const filtered = prev.filter(
        (a) => !(a.type === "trim" && a.clipId === clipId && a.meta.source === "user"),
      );
      return [
        ...filtered,
        {
          type: "trim",
          meta: { id: newActionId(), createdAt: Date.now(), source: "user" },
          clipId,
          start,
          end,
        },
      ];
    });
  };

  // Highlight suggestion apply — replace any prior trim (user or AI) for the
  // clip with an AI-sourced trim covering the suggested short-form range.
  const applyHighlightRange = (startMs: number, endMs: number) => {
    if (!defaultClipId) return;
    clearRedo();
    setActions((prev) => {
      const filtered = prev.filter(
        (a) => !(a.type === "trim" && a.clipId === defaultClipId),
      );
      return [
        ...filtered,
        {
          type: "trim",
          meta: { id: newActionId(), createdAt: Date.now(), source: "ai" },
          clipId: defaultClipId,
          start: startMs,
          end: endMs,
        },
      ];
    });
  };

  const addCutAt = (clipId: string, atMs: number) => {
    // at is TimeMs (ms). Validator + deriveCutMarkers both consume ms; the
    // earlier `atMs / 1000` mismatched the contract.
    pushAction({
      type: "cut",
      meta: { id: newActionId(), createdAt: Date.now(), source: "user" },
      clipId,
      at: atMs,
    });
  };

  // P0 NLE — clip drag-move. Today the ClipMeta model has no per-clip
  // timelineStartMs, so we surface the intent as a trim shift on the primary
  // clip: pushing the start later by deltaMs (clamped to >=0). The render
  // backend already honors trim, so this is a no-regress wiring.
  const handleClipMove = (clipId: string, deltaMs: number) => {
    if (deltaMs === 0) return;
    const start = Math.max(0, Math.round(deltaMs));
    replaceTrim(clipId, start, Math.max(start + 1, durationMs));
  };

  // P0 NLE — Delete vs Shift+Delete (ripple). Without a Clip[] model, "delete"
  // here means clearing user trims/cuts for the selected clip; ripple variant
  // additionally clears imageOverlay/caption tied to that clip. The action
  // contract stays intact.
  const handleClipDelete = (ripple: boolean) => {
    if (selectedClipIds.length === 0) return;
    clearRedo();
    const ids = new Set(selectedClipIds);
    setActions((prev) =>
      prev.filter((a) => {
        const tied =
          (a.type === "trim" || a.type === "cut" || a.type === "imageOverlay" ||
            a.type === "caption" || a.type === "opacity" || a.type === "transform" ||
            a.type === "speed" || a.type === "reframe" || a.type === "keyframe") &&
          ids.has((a as { clipId: string }).clipId);
        if (!tied) return true;
        if (ripple) return false;
        // Non-ripple: only drop user-source edits (preserve AI suggestions).
        return a.meta.source !== "user";
      }),
    );
  };

  const handleKeyframeUpsert = (
    clipId: string,
    property: KFProp,
    point: KeyframePoint,
  ) => {
    setActions((prev) => {
      const idx = prev.findIndex(
        (a) => a.type === "keyframe" && a.clipId === clipId && a.property === property,
      );
      if (idx < 0) {
        return [
          ...prev,
          {
            type: "keyframe",
            meta: { id: newActionId(), createdAt: Date.now(), source: "user" },
            clipId,
            property,
            keyframes: [point],
          },
        ];
      }
      const existing = prev[idx];
      if (existing.type !== "keyframe") return prev;
      // Merge: replace existing point at the same atMs (within 1ms), else insert.
      const kfs = [...existing.keyframes];
      const hitIdx = kfs.findIndex((k) => Math.abs(k.atMs - point.atMs) < 1);
      if (hitIdx >= 0) kfs[hitIdx] = point;
      else kfs.push(point);
      kfs.sort((a, b) => a.atMs - b.atMs);
      const next = [...prev];
      next[idx] = { ...existing, keyframes: kfs };
      return next;
    });
  };

  const onSeek = (ms: number) => {
    setPlayheadMs(ms);
    setSeekMs(ms);
    setSeekToken((n) => n + 1);
  };

  // Initial import — sets clips[0]. Also resets ingest/render state.
  const onPrimaryImport = (id: string, title: string) => {
    setJob(null);
    setVideoVersion(0);
    setActions([]);
    setClips([{ jobId: id, title }]);
    setClipsHistory([]);
    setRedoStack([]);
  };

  // Subsequent imports — append clip; composite render is follow-up work,
  // primary clip drives render endpoint.
  const onExtraImport = (id: string, title: string) => {
    clearRedo();
    setClips((prev) => {
      if (prev.length === 0) return [{ jobId: id, title }];
      return [...prev, { jobId: id, title }];
    });
    notifications.show({
      color: "green",
      title: t("editor.addVideo.added"),
      message: title,
    });
  };

  // Unified import handler — used by both initial empty-state upload and
  // subsequent "Add Video" button. Delegates to onPrimaryImport (first clip)
  // or onExtraImport (additional clips).
  const onImport = (id: string, title: string) => {
    if (clips.length === 0) {
      onPrimaryImport(id, title);
    } else {
      onExtraImport(id, title);
    }
  };

  const render = async (): Promise<boolean> => {
    if (!jobId || !ready) return false;
    setRendering(true);
    setError(null);
    try {
      const res = await fetch(apiUrl(`/api/render/${jobId}`), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ injectActions: actions, clips }),
      });
      const raw = await res.text();
      let data: RenderResponse | null = null;
      try {
        data = raw ? (JSON.parse(raw) as RenderResponse) : null;
      } catch {
        data = null;
      }
      if (!res.ok || !data || !data.ok) {
        const detail = data?.error ?? (raw ? raw.slice(0, 200) : `HTTP ${res.status}`);
        setError(detail || t("error.render"));
        notifications.show({ color: "red", title: t("error.render"), message: detail });
        return false;
      }
      setVideoVersion(Date.now());
      const failedCount = data.failedActionIds?.length ?? 0;
      const warnCount = data.warnings?.length ?? 0;
      notifications.show({
        color: failedCount > 0 ? "yellow" : "green",
        title: t("editor.render"),
        message:
          failedCount > 0
            ? `applied=${data.appliedActionIds?.length ?? 0} failed=${failedCount} warnings=${warnCount}`
            : t("editor.render.done"),
      });
      return true;
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      notifications.show({ color: "red", title: t("error.render"), message: msg });
      return false;
    } finally {
      setRendering(false);
    }
  };

  // Ensure an exported finals/{id}.mp4 exists before showing the result.
  // Without the old forced auto-render, finishing without an explicit render
  // would 404 in ResultScreen — so render current actions (empty = passthrough)
  // on first finish.
  const finishEditing = async () => {
    if (!jobId) return;
    if (videoVersion === 0) {
      const ok = await render();
      if (!ok) return;
    }
    onResult(jobId);
  };

  const runAi = async (userIntent: string) => {
    if (!jobId || !ready) return;
    setAiLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl(`/api/director/run`), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId, intent: userIntent }),
      });
      const raw = await res.text();
      let data: DirectorRunResponse | null = null;
      try {
        data = raw ? (JSON.parse(raw) as DirectorRunResponse) : null;
      } catch {
        data = null;
      }
      if (!res.ok || !data || !data.ok) {
        const detail = data?.error ?? (raw ? raw.slice(0, 200) : `HTTP ${res.status}`);
        setError(detail || t("error.llm"));
        notifications.show({ color: "red", title: t("error.llm"), message: detail });
        return;
      }
      const finalActions = data.result?.finalActions ?? [];
      const normalized = finalActions.map((a) => {
        if (a.meta?.source) return a;
        return { ...a, meta: { ...a.meta, source: "ai" as const } };
      });
      pushMany(normalized);
      notifications.show({
        color: "green",
        title: t("editor.aiRun"),
        message: `${normalized.length} ${t("editor.aiRun.added")}`,
      });
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      notifications.show({ color: "red", title: t("error.llm"), message: msg });
    } finally {
      setAiLoading(false);
    }
  };

  const controlsDisabled = !ready;

  // P0-4: Keyboard shortcuts (NLE standard)
  useEffect(() => {
    if (!ready) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Ignore shortcuts when typing in input/textarea
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
      const cmdKey = isMac ? e.metaKey : e.ctrlKey;

      // ←/→: 1-frame seek (assume 30fps)
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        const frameMs = 1000 / 30;
        onSeek(Math.max(0, playheadMs - frameMs));
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        const frameMs = 1000 / 30;
        onSeek(Math.min(durationMs, playheadMs + frameMs));
        return;
      }

      // S or Cmd+B: split at playhead
      if ((e.key === "s" || e.key === "S") && !cmdKey) {
        e.preventDefault();
        if (defaultClipId) addCutAt(defaultClipId, playheadMs);
        return;
      }
      if (e.key === "b" && cmdKey) {
        e.preventDefault();
        if (defaultClipId) addCutAt(defaultClipId, playheadMs);
        return;
      }

      // [/]: trim start/end to playhead
      if (e.key === "[") {
        e.preventDefault();
        if (defaultClipId) replaceTrim(defaultClipId, playheadMs, durationMs);
        return;
      }
      if (e.key === "]") {
        e.preventDefault();
        if (defaultClipId) replaceTrim(defaultClipId, 0, playheadMs);
        return;
      }

      // Cmd+Z: undo
      if (e.key === "z" && cmdKey && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      // Cmd/Ctrl+D: duplicate selected clip (falls back to primary if none).
      if ((e.key === "d" || e.key === "D") && cmdKey && !e.shiftKey) {
        e.preventDefault();
        const target = selectedClipIds[0] ?? defaultClipId;
        if (target) duplicateClipMeta(target);
        return;
      }

      // Cmd+Shift+Z: redo
      if (e.key === "z" && cmdKey && e.shiftKey) {
        e.preventDefault();
        redo();
        return;
      }

      // Delete: remove selected action; if no action selected but clips are,
      // Delete = non-ripple, Shift+Delete = ripple.
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedActionId) {
          e.preventDefault();
          removeAction(selectedActionId);
          return;
        }
        if (selectedClipIds.length > 0) {
          e.preventDefault();
          handleClipDelete(e.shiftKey);
          return;
        }
        return;
      }

      // +/-: timeline zoom
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        setPxPerMs((prev) => Math.min(prev * 1.2, 10));
        return;
      }
      if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        setPxPerMs((prev) => Math.max(prev / 1.2, 0.01));
        return;
      }

      // Enter: render
      if (e.key === "Enter") {
        e.preventDefault();
        void render();
        return;
      }

      // Space / K: play-pause. J/L: shuttle (L speeds up, J slows down; <video>
      // has no reverse so J pauses at 1×). No cmd modifier.
      if (!cmdKey && (e.key === " " || e.key === "Spacebar")) {
        e.preventDefault();
        previewRef.current?.togglePlay();
        return;
      }
      if (!cmdKey && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        previewRef.current?.pause();
        return;
      }
      if (!cmdKey && (e.key === "l" || e.key === "L")) {
        e.preventDefault();
        previewRef.current?.shuttleForward();
        return;
      }
      if (!cmdKey && (e.key === "j" || e.key === "J")) {
        e.preventDefault();
        previewRef.current?.shuttleBackward();
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    ready,
    playheadMs,
    durationMs,
    defaultClipId,
    selectedActionId,
    selectedClipIds,
    onSeek,
    addCutAt,
    replaceTrim,
    undo,
    redo,
    removeAction,
    handleClipDelete,
    duplicateClipMeta,
    setPxPerMs,
    render,
  ]);

  return (
    <Stack gap="lg" style={{ padding: "12px", maxWidth: "100vw", boxSizing: "border-box" }}>
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="xs" style={{ minWidth: 0 }}>
        <Title order={1} fz="var(--font-xl)" fw={700} style={{ minWidth: 0 }}>
          {t("editor.title")}
        </Title>
        <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
          <Button
            variant="filled"
            leftSection={clips.length === 0 ? <IconUpload size={14} /> : <IconPlus size={14} />}
            onClick={() => setAddOpen(true)}
          >
            {clips.length === 0 ? t("editor.empty.cta") : t("editor.addVideo")}
          </Button>
          <Button
            variant="subtle"
            leftSection={<IconArrowBackUp size={14} />}
            onClick={onBack}
          >
            {t("editor.back")}
          </Button>
        </Group>
      </Group>

      {error && (
        <Alert color="red" title={t("error.render")}>
          {error}
        </Alert>
      )}

      {/* ✨ Top row — Preview (60%) + Inspector (40%) */}
      <Group align="flex-start" gap="md" wrap="wrap" style={{ minWidth: 0 }}>
        <Box style={{ flex: "3 1 0", minWidth: 0, maxWidth: "100%" }}>
          <Stack gap="md" style={{ minWidth: 0 }}>
            {isImportError && (
              <Alert
                color="red"
                icon={<IconAlertTriangle size={16} />}
                title={t("progress.error.title")}
              >
                {job?.message ?? ""}
              </Alert>
            )}
            {ready ? (
              <Preview
                ref={previewRef}
                videoSrc={videoSrc}
                liveMode={true}
                actions={actions}
                sourceUrl={job?.proxyUrl ? apiUrl(job.proxyUrl) : null}
                onDurationMs={setDurationMs}
                onTimeUpdateMs={setPlayheadMs}
                seekMs={seekMs}
                seekToken={seekToken}
                onUploadClick={() => setAddOpen(true)}
              />
            ) : (
              <Preview
                videoSrc={null}
                liveMode={false}
                actions={[]}
                sourceUrl={null}
                onUploadClick={() => setAddOpen(true)}
              />
            )}

            {clips.length > 1 && (
              <Card
                withBorder
                radius="md"
                padding="sm"
                style={{ background: "var(--bg-muted)", borderColor: "var(--border-default)" }}
              >
                <Stack gap={4}>
                  <Text size="xs" fw={600} c="var(--text-muted)">
                    {t("editor.addVideo.list")} ({clips.length})
                  </Text>
                  {clips.map((c, i) => (
                    <Text key={c.jobId} size="xs">
                      {i + 1}. {c.title}
                      {i === 0 && (
                        <Text component="span" size="xs" c="dimmed" ml={4}>
                          ({t("editor.addVideo.primary")})
                        </Text>
                      )}
                    </Text>
                  ))}
                  <Text size="xs" c="dimmed" mt={4}>
                    {t("editor.addVideo.compositeNote")}
                  </Text>
                </Stack>
              </Card>
            )}

            {importing && (
              <Card
                withBorder
                radius="md"
                padding="lg"
                style={{
                  background: "var(--bg-card)",
                  borderColor: "var(--border-default)",
                  minHeight: 120,
                }}
              >
                <Stack gap="md">
                  <Group justify="space-between">
                    <Text fw={500}>{overallLabel}</Text>
                    <Text size="sm" c="var(--text-muted)">
                      {Math.round(overallPct)}%
                    </Text>
                  </Group>
                  <Progress
                    value={overallPct}
                    color="blue"
                    animated
                    striped
                    size="md"
                    radius="sm"
                    aria-valuenow={Math.round(overallPct)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  />
                  <Text size="xs" c="var(--text-muted)">
                    {t("progress.title")}
                  </Text>
                </Stack>
              </Card>
            )}



            <Divider />
            <Group justify="space-between">
              <Text size="xs" c="var(--text-muted)">
                {t("editor.preview.liveNote")}
              </Text>
              <Group gap="xs">
                <Button variant="filled"
                  size="xs"
                  leftSection={<IconPlayerPlay size={14} />}
                  onClick={() => void render()}
                  loading={rendering}
                  disabled={!ready}
                >
                  {t("editor.render")}
                </Button>
                <Button
                  size="xs"
                  variant="filled"
                  onClick={() => void finishEditing()}
                  disabled={!ready}
                >
                  {t("editor.finish")}
                </Button>
              </Group>
            </Group>
          </Stack>
        </Box>

        <Box style={{ flex: "2 1 0", minWidth: 0, maxWidth: "100%" }}>
          <Inspector
            selectedActionId={selectedActionId}
            actions={actions}
            clips={clips}
            onUpdate={updateAction}
            selectedClipIds={selectedClipIds}
            durationMs={durationMs}
            playheadMs={playheadMs}
            pxPerMs={pxPerMs}
            onKeyframeUpsert={handleKeyframeUpsert}
          />
        </Box>
      </Group>

      {/* ✨ Toolbar + Timeline reference (middle) */}
      <Card
        withBorder
        radius="md"
        padding="md"
        style={{
          background: "var(--bg-card)",
          borderColor: "var(--border-default)",
          minWidth: 0,
          maxWidth: "100%",
        }}
      >
        <Stack gap="sm" style={{ minWidth: 0 }}>
          <Group justify="space-between">
            <Text fw={500}>{t("editor.toolbar.title")}</Text>
              <Group gap="xs">
                <Button
                  variant="default"
                  size="xs"
                  leftSection={<IconArrowBackUp size={14} />}
                  onClick={undo}
                  disabled={actions.length === 0 && clipsHistory.length === 0}
                >
                  {t("editor.undo")}
                </Button>
                <Button
                  variant="default"
                  size="xs"
                  leftSection={<IconArrowForwardUp size={14} />}
                  onClick={redo}
                  disabled={redoStack.length === 0}
                >
                  {t("editor.redo")}
                </Button>
              </Group>
            </Group>
            <Toolbar
              onAdd={pushAction}
              defaultClipId={defaultClipId}
              clips={clips}
              actions={actions}
              onAiEdit={(intent) => runAi(intent)}
              aiEditLoading={aiLoading}
              aiEditDisabled={!ready}
            />
            <AiTools
              jobId={jobId}
              defaultClipId={defaultClipId}
              durationMs={durationMs}
              playheadMs={playheadMs}
              disabled={!ready}
              onAdd={pushAction}
              onAddMany={pushMany}
              onApplyRange={applyHighlightRange}
            />
            <Divider />
            <Text fw={500}>{t("editor.timeline.title")}</Text>
            <Timeline
              actions={actions}
              onRemove={removeAction}
              onSelect={setSelectedActionId}
              errors={validationErrors}
              clips={clips}
              selectedClipIds={selectedClipIds}
            />
          </Stack>
        </Card>

      {/* ✨ Bottom — TrackTimeline (full width) */}
      <TrackTimeline
        clips={clips}
        actions={actions}
        durationMs={durationMs}
        playheadMs={playheadMs}
        pxPerMs={pxPerMs}
        onPxPerMsChange={setPxPerMs}
        onSeek={onSeek}
        onTrim={replaceTrim}
        onCut={addCutAt}
        selectedClipIds={selectedClipIds}
        onSelectChange={setSelectedClipIds}
        onClipMove={handleClipMove}
        onDuplicateClip={duplicateClipMeta}
      />

      <AIChatFab onSend={runAi} loading={aiLoading} disabled={!ready} />
      <AddVideoModal
        opened={addOpen}
        onClose={() => { setAddOpen(false); setPendingHandoffUrl(undefined); }}
        onJobCreated={onImport}
        defaultUrl={pendingHandoffUrl}
      />
    </Stack>
  );
}
