"use client";

import { Button, Card, Stack, Text } from "@mantine/core";
import { IconUpload } from "@tabler/icons-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { Action, TrimAction } from "@/lib/core/action-types";
import {
  activeCaptions,
  activeImageOverlays,
  computeFrameStyle,
  drawCaption,
} from "@/components/editor/preview/compositor";

interface Props {
  videoSrc: string | null;
  // Live WYSIWYG mode: receives the source URL + declarative actions and
  // re-composites every animation frame onto a canvas.
  liveMode?: boolean;
  actions?: Action[];
  sourceUrl?: string | null;
  // Track-timeline sync (optional): report playback position/duration, accept
  // seeks. Signatures match the previous Preview so EditorScreen wiring is
  // unchanged.
  onTimeUpdateMs?: (ms: number) => void;
  onDurationMs?: (ms: number) => void;
  seekToken?: number;
  seekMs?: number;
  // Empty state handler: called when user clicks upload button in empty preview
  onUploadClick?: () => void;
}

// Imperative playback controls exposed to the editor's global keyboard
// shortcuts (Space / J / K / L). The <video> element lives inside Preview,
// so the parent drives it through this handle instead of reaching into refs.
export interface PreviewHandle {
  togglePlay: () => void;
  play: () => void;
  pause: () => void;
  shuttleForward: () => void;
  shuttleBackward: () => void;
}

// Default composition surface — 16:9 720p. Resized only via CSS so callers
// keep getting a responsive element; bitmap stays fixed for perf.
const CANVAS_W = 1280;
const CANVAS_H = 720;

// J/K/L shuttle speeds. HTML <video> cannot play in reverse, so J only
// steps the forward rate down and pauses at 1×.
const SHUTTLE_RATES = [1, 1.5, 2, 4];

const Preview = forwardRef<PreviewHandle, Props>(function Preview({
  videoSrc,
  liveMode,
  actions,
  sourceUrl,
  onTimeUpdateMs,
  onDurationMs,
  seekToken,
  seekMs,
  onUploadClick,
}: Props, ref) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  // Latest props snapshot for the RAF loop (avoids re-binding rAF on every
  // render). Read-only inside the loop.
  const actionsRef = useRef<Action[]>(actions ?? []);
  const imgCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const appliedSeekRef = useRef<number>(-1);
  const [isPlaying, setIsPlaying] = useState(false);

  // Keep the ref in sync without forcing a RAF restart.
  useEffect(() => {
    actionsRef.current = actions ?? [];
  }, [actions]);

  // External seek (track-timeline → Preview). Token-guarded so identical
  // playhead positions still trigger a seek.
  useEffect(() => {
    if (seekToken === undefined) return;
    if (appliedSeekRef.current === seekToken) return;
    appliedSeekRef.current = seekToken;
    const video = videoRef.current;
    if (!video || typeof seekMs !== "number") return;
    try {
      video.currentTime = seekMs / 1000;
    } catch {
      /* readyState 0 — seek will be retried by the user */
    }
  }, [seekToken, seekMs]);

  // Canvas compositor — single RAF loop covering the whole live mode.
  useEffect(() => {
    if (!liveMode) return;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;

    const ensureImage = (src: string): HTMLImageElement | null => {
      const cache = imgCacheRef.current;
      const cached = cache.get(src);
      if (cached) return cached.complete && cached.naturalWidth > 0 ? cached : null;
      // file:// or absolute filesystem paths won't load in browsers — try
      // anyway and silently skip on error. Asset is shown only if URL works.
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = src;
      cache.set(src, img);
      return null;
    };

    const drawFrame = () => {
      const list = actionsRef.current;
      const tMs = video.currentTime * 1000;

      // Trim guard: keep playback inside the first user-defined trim window.
      const trim = list.find((a): a is TrimAction => a.type === "trim");
      if (trim) {
        if (tMs < trim.start) {
          try {
            video.currentTime = trim.start / 1000;
          } catch {
            /* ignore */
          }
        } else if (tMs > trim.end) {
          video.pause();
          try {
            video.currentTime = trim.end / 1000;
          } catch {
            /* ignore */
          }
        }
      }

      // Clear to transparent — the underlying <video> element acts as the
      // baseline visual layer, so the canvas only needs to paint composition
      // deltas (transform/opacity/overlays/captions). This guarantees the
      // user always sees their video even if drawImage fails (mobile codec
      // quirks, CORS taint, slow decode).
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

      // Compute the per-frame transform/opacity once.
      const style = computeFrameStyle(list, tMs, CANVAS_W, CANVAS_H);

      // Composite base video frame with transform+opacity around the center.
      if (video.readyState >= 2 && video.videoWidth > 0) {
        ctx.save();
        ctx.globalAlpha = style.opacity;
        ctx.translate(CANVAS_W / 2 + style.translateX, CANVAS_H / 2 + style.translateY);
        ctx.rotate(style.rotateRad);
        ctx.scale(style.scale, style.scale);
        // Contain fit so any source aspect stays inside the canvas.
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const fit = Math.min(CANVAS_W / vw, CANVAS_H / vh);
        const dw = vw * fit;
        const dh = vh * fit;
        try {
          ctx.drawImage(video, -dw / 2, -dh / 2, dw, dh);
        } catch {
          /* CORS-tainted source — skip frame this tick */
        }
        ctx.restore();
      }

      // Image overlays (start/end gated). Positioned in normalized 0..1
      // canvas coords, scaled by the action's `scale` field.
      const overlays = activeImageOverlays(list, tMs);
      for (const ov of overlays) {
        const img = ensureImage(ov.source);
        if (!img) continue;
        const w = img.naturalWidth * ov.scale;
        const h = img.naturalHeight * ov.scale;
        const cx = ov.position.x * CANVAS_W;
        const cy = ov.position.y * CANVAS_H;
        ctx.save();
        ctx.globalAlpha = Math.min(1, Math.max(0, ov.opacity));
        try {
          ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
        } catch {
          /* image not ready / tainted — skip */
        }
        ctx.restore();
      }

      // Caption burn-in.
      const caps = activeCaptions(list, tMs);
      for (const cap of caps) drawCaption(ctx, cap, CANVAS_W, CANVAS_H);

      rafRef.current = requestAnimationFrame(drawFrame);
    };

    rafRef.current = requestAnimationFrame(drawFrame);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [liveMode]);

  // Time/duration reporting — drives the track timeline playhead.
  useEffect(() => {
    if (!liveMode) return;
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => onTimeUpdateMs?.(video.currentTime * 1000);
    const onMeta = () => {
      const d = video.duration;
      if (Number.isFinite(d)) onDurationMs?.(d * 1000);
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
    };
  }, [liveMode, onTimeUpdateMs, onDurationMs]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => {});
    else video.pause();
  };

  useImperativeHandle(ref, () => ({
    togglePlay,
    play: () => {
      const video = videoRef.current;
      if (!video) return;
      video.playbackRate = 1;
      void video.play().catch(() => {});
    },
    pause: () => {
      const video = videoRef.current;
      if (!video) return;
      video.pause();
      video.playbackRate = 1;
    },
    shuttleForward: () => {
      const video = videoRef.current;
      if (!video) return;
      if (video.paused) {
        video.playbackRate = 1;
        void video.play().catch(() => {});
        return;
      }
      const i = SHUTTLE_RATES.indexOf(video.playbackRate);
      video.playbackRate = SHUTTLE_RATES[Math.min(i + 1, SHUTTLE_RATES.length - 1)] ?? 2;
    },
    shuttleBackward: () => {
      const video = videoRef.current;
      if (!video) return;
      // Reverse playback is unsupported by <video>; ramp the forward rate
      // down and pause once we hit 1×.
      if (video.paused) return;
      const i = SHUTTLE_RATES.indexOf(video.playbackRate);
      if (i <= 0) {
        video.pause();
        video.playbackRate = 1;
      } else {
        video.playbackRate = SHUTTLE_RATES[i - 1];
      }
    },
  }));

  // Hide the native <video> layer when the canvas needs to own composition
  // (transform/opacity/overlay/caption present), so we don't get a "double
  // video" overlap. With no compositing actions, the canvas is transparent
  // and the native video provides the visible preview.
  const hasCompositingAction = (actions ?? []).some(
    (a) =>
      a.type === "transform" ||
      a.type === "opacity" ||
      a.type === "imageOverlay" ||
      a.type === "caption" ||
      a.type === "keyframe" ||
      a.type === "reframe",
  );

  // Rendered-result fallback: when there is no live source we keep the
  // previous simple <video> behaviour so EditorScreen's existing UX (render
  // output preview) stays identical.
  if (!liveMode || !sourceUrl) {
    return (
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
        <Stack gap="xs" style={{ minWidth: 0 }}>
          <Text fw={500}>{t("editor.preview.title")}</Text>
          {videoSrc ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              controls
              preload="metadata"
              src={videoSrc}
              style={{
                width: "100%",
                maxWidth: "100%",
                borderRadius: 10,
                background: "#000",
              }}
              aria-label={t("editor.preview.title")}
            />
          ) : (
            <Card
              withBorder
              radius="md"
              padding="lg"
              style={{
                background: "var(--bg-muted)",
                borderColor: "var(--border-default)",
                borderStyle: "dashed",
                minHeight: 200,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Stack gap="md" align="center">
                <IconUpload size={32} stroke={1.5} color="var(--text-muted)" />
                <Text size="sm" c="var(--text-muted)" ta="center">
                  {t("editor.empty.title")}
                </Text>
                {onUploadClick && (
                  <Button
                    variant="filled"
                    leftSection={<IconUpload size={14} />}
                    onClick={onUploadClick}
                  >
                    {t("editor.empty.cta")}
                  </Button>
                )}
              </Stack>
            </Card>
          )}
        </Stack>
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
        minWidth: 0,
        maxWidth: "100%",
      }}
    >
      <Stack gap="xs" style={{ minWidth: 0 }}>
        <Text fw={500}>{t("editor.preview.live")}</Text>
        <div
          style={{
            position: "relative",
            width: "100%",
            aspectRatio: `${CANVAS_W} / ${CANVAS_H}`,
            background: "#000",
            borderRadius: 10,
            overflow: "hidden",
          }}
        >
          {/* Source video is the visible fallback layer — even if the canvas
              compositor never gets a frame (mobile aggressive offscreen-video
              suppression, hidden 1x1px refusing to decode, CORS taint), the
              user always sees the uploaded video. The canvas overlays on top
              with pointer-events:none so it composites effects without
              blocking the video. crossOrigin removed — source is same-origin
              via the shell proxy. Visible only when there is no compositing
              action active, else the canvas owns the display. */}
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            ref={videoRef}
            src={sourceUrl}
            preload="auto"
            playsInline
            muted
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "contain",
              background: "#000",
              zIndex: 0,
              opacity: hasCompositingAction ? 0 : 1,
              pointerEvents: "none",
            }}
            aria-label={t("editor.preview.live")}
          />
          <canvas
            ref={canvasRef}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              display: "block",
              borderRadius: 10,
              pointerEvents: "none",
              zIndex: 1,
            }}
            aria-hidden="true"
          />
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
          }}
        >
          <button
            type="button"
            onClick={togglePlay}
            style={{
              padding: "4px 12px",
              borderRadius: 6,
              border: "1px solid var(--border-default)",
              background: "var(--bg-muted)",
              color: "var(--text-default)",
              cursor: "pointer",
              fontSize: 12,
            }}
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? "Pause" : "Play"}
          </button>
          <Text size="xs" c="var(--text-muted)">
            {t("editor.preview.liveNote")}
          </Text>
        </div>
      </Stack>
    </Card>
  );
});

export default Preview;
