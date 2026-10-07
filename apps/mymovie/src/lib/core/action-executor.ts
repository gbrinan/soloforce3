// OpenReel core — Action[] 실 영상 적용 (Step 4 실구현).
// ffmpeg subprocess 직접 호출. 각 액션 타입을 dispatch 하여 출력 파일을 만들고
// 다음 액션은 직전 출력 파일을 입력으로 받아 체이닝한다.

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, existsSync, statSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

import type {
  Action,
  CaptionAction,
  CutAction,
  BgmAction,
  ExecuteResult,
  Footage,
  GenerateAction,
  ImageOverlayAction,
  KeyframeAction,
  KeyframePoint,
  KeyframeValue,
  ReframeAction,
  TransitionAction,
  TrimAction,
  SpeedAction,
  OpacityAction,
  TransformAction,
} from "./action-types";
import { probe } from "../ingest/ffmpeg";
import { rendersDir } from "./paths";
import { renderCaptionPng } from "./caption-png";

const FFMPEG_BIN = process.env.FFMPEG_BIN || "ffmpeg";
const STEP_TIMEOUT_MS = 60_000;

export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotImplementedError";
  }
}

export interface ExecuteOutput {
  actionId: string;
  path: string;
}

export interface ExtendedExecuteResult extends ExecuteResult {
  outputs: ExecuteOutput[];
  lastOutput?: string;
  warnings?: { actionId: string; reason: string }[];
}

function runFfmpeg(args: string[]): Promise<{ ok: boolean; stderr: string; code: number | null }> {
  return new Promise((resolveP) => {
    const proc = spawn(FFMPEG_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        /* noop */
      }
    }, STEP_TIMEOUT_MS);
    proc.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      resolveP({ ok: false, stderr: `${stderr}\nspawn error: ${err.message}`, code: null });
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolveP({ ok: code === 0, stderr, code });
    });
  });
}

function jobDirFor(actions: Action[]): string {
  const seed = actions[0]?.meta.id?.slice(0, 8) ?? String(Date.now());
  const dir = resolvePath(rendersDir(), seed);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function pickKoreanFont(): string {
  const candidates = [
    "/System/Library/Fonts/AppleSDGothicNeo.ttc",
    "/Library/Fonts/Arial Unicode.ttf",
    "/System/Library/Fonts/Supplemental/AppleGothic.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
  ];
  for (const p of candidates) {
    try {
      if (statSync(p).isFile()) return p;
    } catch {
      /* skip */
    }
  }
  return candidates[candidates.length - 1];
}

function escapeDrawText(s: string): string {
  // ffmpeg drawtext: single-quote / colon / backslash escape.
  return s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

// 정확한 시점 cut/trim을 위해 비디오는 re-encode (libx264 veryfast). `-c copy` 출력 seeking은
// 입력의 keyframe 간격에 따라 비디오 stream이 누락되는 회귀를 만든다(테스트로 실증).
const REENCODE_VIDEO_ARGS = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p"];
const REENCODE_AUDIO_ARGS = ["-c:a", "aac", "-b:a", "128k", "-ac", "2"];

async function execCut(
  action: CutAction,
  input: string,
  outDir: string,
): Promise<{ outputs: ExecuteOutput[]; lastOutput?: string; error?: string }> {
  const atSec = Math.max(0, action.at / 1000);
  const aPath = resolvePath(outDir, `cut_${action.meta.id}_A.mp4`);
  const bPath = resolvePath(outDir, `cut_${action.meta.id}_B.mp4`);
  const aRes = await runFfmpeg([
    "-y", "-i", input,
    "-ss", "0", "-to", String(atSec),
    ...REENCODE_VIDEO_ARGS, ...REENCODE_AUDIO_ARGS,
    "-avoid_negative_ts", "make_zero",
    aPath,
  ]);
  if (!aRes.ok) return { outputs: [], error: `cut A failed: code=${aRes.code} ${aRes.stderr.slice(-400)}` };
  const bRes = await runFfmpeg([
    "-y", "-i", input,
    "-ss", String(atSec),
    ...REENCODE_VIDEO_ARGS, ...REENCODE_AUDIO_ARGS,
    "-avoid_negative_ts", "make_zero",
    bPath,
  ]);
  if (!bRes.ok) return { outputs: [], error: `cut B failed: code=${bRes.code} ${bRes.stderr.slice(-400)}` };
  return {
    outputs: [
      { actionId: action.meta.id, path: aPath },
      { actionId: action.meta.id, path: bPath },
    ],
    lastOutput: aPath,
  };
}

async function execTrim(
  action: TrimAction,
  input: string,
  outDir: string,
): Promise<{ outputs: ExecuteOutput[]; lastOutput?: string; error?: string }> {
  const startSec = Math.max(0, action.start / 1000);
  const endSec = Math.max(startSec + 0.001, action.end / 1000);
  const out = resolvePath(outDir, `trim_${action.meta.id}.mp4`);
  const r = await runFfmpeg([
    "-y", "-i", input,
    "-ss", String(startSec), "-to", String(endSec),
    ...REENCODE_VIDEO_ARGS, ...REENCODE_AUDIO_ARGS,
    "-avoid_negative_ts", "make_zero",
    out,
  ]);
  if (!r.ok) return { outputs: [], error: `trim failed: code=${r.code} ${r.stderr.slice(-400)}` };
  return { outputs: [{ actionId: action.meta.id, path: out }], lastOutput: out };
}

async function execReframe(
  action: ReframeAction,
  input: string,
  outDir: string,
): Promise<{ outputs: ExecuteOutput[]; lastOutput?: string; error?: string }> {
  const meta = await probe(input);
  if (!meta) return { outputs: [], error: "reframe: ffprobe failed on input" };
  const srcW = meta.width;
  const srcH = meta.height;
  const targetRatio = action.aspect.w / action.aspect.h;
  const srcRatio = srcW / srcH;
  let cropW = srcW;
  let cropH = srcH;
  if (srcRatio > targetRatio) {
    // 입력이 더 wide — 폭을 좁힌다.
    cropW = Math.round(srcH * targetRatio);
  } else {
    cropH = Math.round(srcW / targetRatio);
  }
  // even 보장
  cropW = cropW - (cropW % 2);
  cropH = cropH - (cropH % 2);
  const fx = action.focal?.x ?? 0.5;
  const fy = action.focal?.y ?? 0.5;
  let cx = Math.round(srcW * fx - cropW / 2);
  let cy = Math.round(srcH * fy - cropH / 2);
  cx = Math.max(0, Math.min(srcW - cropW, cx));
  cy = Math.max(0, Math.min(srcH - cropH, cy));
  // 타겟 출력 해상도 — 짧은 쪽 기준 720
  let outH = 720;
  let outW = Math.round(outH * targetRatio);
  outW = outW - (outW % 2);
  outH = outH - (outH % 2);
  const vf = `crop=${cropW}:${cropH}:${cx}:${cy},scale=${outW}:${outH}`;
  const out = resolvePath(outDir, `reframe_${action.meta.id}.mp4`);
  const r = await runFfmpeg([
    "-y",
    "-i",
    input,
    "-vf",
    vf,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-c:a",
    "copy",
    out,
  ]);
  if (!r.ok) return { outputs: [], error: `reframe failed: code=${r.code} ${r.stderr.slice(-400)}` };
  return { outputs: [{ actionId: action.meta.id, path: out }], lastOutput: out };
}

// 메모이즈된 ffmpeg drawtext 필터 가용성. Homebrew ffmpeg는 freetype 미링크 빌드가 있어
// drawtext 가 없는 경우가 흔하다. 그 환경에선 caption을 graphic 레이어로만 합성한다.
let _drawtextAvailable: boolean | null = null;
function hasDrawtextFilterSync(): boolean {
  if (_drawtextAvailable !== null) return _drawtextAvailable;
  try {
    const r = spawnSync(FFMPEG_BIN, ["-hide_banner", "-filters"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out = (r.stdout?.toString() ?? "") as string;
    _drawtextAvailable = out.split("\n").some((l) => l.includes(" drawtext "));
  } catch {
    _drawtextAvailable = false;
  }
  return _drawtextAvailable;
}

async function execCaption(
  action: CaptionAction,
  input: string,
  outDir: string,
): Promise<{ outputs: ExecuteOutput[]; lastOutput?: string; error?: string; warning?: string }> {
  const fontSize = action.style?.size ?? 36;
  const fontColor = action.style?.color ?? "white";
  const pos = action.style?.pos ?? "bottom";
  const startSec = Math.max(0, action.start / 1000);
  const endSec = Math.max(startSec + 0.001, action.end / 1000);

  if (hasDrawtextFilterSync()) {
    const fontFile = pickKoreanFont();
    const ypos =
      pos === "top" ? "h*0.08" : pos === "center" ? "(h-text_h)/2" : "h-text_h-h*0.08";
    const text = escapeDrawText(action.text);
    const drawtext = `drawtext=fontfile='${fontFile}':text='${text}':enable='between(t,${startSec},${endSec})':fontcolor=${fontColor}:fontsize=${fontSize}:x=(w-text_w)/2:y=${ypos}:box=1:boxcolor=black@0.4:boxborderw=8`;
    const out = resolvePath(outDir, `caption_${action.meta.id}.mp4`);
    const r = await runFfmpeg([
      "-y",
      "-i", input,
      "-vf", drawtext,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
      "-c:a", "copy",
      out,
    ]);
    if (!r.ok) return { outputs: [], error: `caption(drawtext) failed: code=${r.code} ${r.stderr.slice(-400)}` };
    return { outputs: [{ actionId: action.meta.id, path: out }], lastOutput: out };
  }

  // drawtext 미지원 환경 — overlay PNG 경로.
  const meta = await probe(input);
  if (!meta) return { outputs: [], error: "caption(overlay): ffprobe failed on input" };
  let pngPath: string;
  try {
    pngPath = await renderCaptionPng({
      text: action.text,
      outDir,
      width: meta.width,
      height: meta.height,
      pos,
      fontSize,
      fontColor,
      id: action.meta.id,
    });
  } catch (e) {
    return { outputs: [], error: `caption(overlay) PNG render failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  const out = resolvePath(outDir, `caption_${action.meta.id}.mp4`);
  const overlayFilter = `[0:v][1:v]overlay=0:0:enable='between(t,${startSec},${endSec})'[v]`;
  const r = await runFfmpeg([
    "-y",
    "-i", input,
    "-i", pngPath,
    "-filter_complex", overlayFilter,
    "-map", "[v]",
    "-map", "0:a?",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
    "-c:a", "copy",
    out,
  ]);
  if (!r.ok) return { outputs: [], error: `caption(overlay) ffmpeg failed: code=${r.code} ${r.stderr.slice(-400)}` };
  return { outputs: [{ actionId: action.meta.id, path: out }], lastOutput: out };
}

async function execBgm(
  action: BgmAction,
  input: string,
  outDir: string,
): Promise<{ outputs: ExecuteOutput[]; lastOutput?: string; error?: string; warning?: string }> {
  if (!action.source || !existsSync(action.source)) {
    return { outputs: [], warning: `bgm skipped: source not found (${action.source})` };
  }
  const out = resolvePath(outDir, `bgm_${action.meta.id}.mp4`);
  const vol = Math.max(0, Math.min(1, action.volume));

  // Audio fade. Probe BGM source for duration so the fade-out start time is
  // anchored to the actual track length. Fades are applied to the BGM stream
  // before amix so the main audio remains untouched.
  const fadeInSec = Math.max(0, (action.fadeInMs ?? 0) / 1000);
  const fadeOutSec = Math.max(0, (action.fadeOutMs ?? 0) / 1000);
  const bgmChain: string[] = [`volume=${vol}`];
  if (fadeInSec > 0) {
    bgmChain.push(`afade=t=in:st=0:d=${fadeInSec}`);
  }
  if (fadeOutSec > 0) {
    const bgmMeta = await probe(action.source);
    if (!bgmMeta) {
      return { outputs: [], error: `bgm: ffprobe failed on source ${action.source}` };
    }
    const bgmDurSec = Math.max(0.001, bgmMeta.durationMs / 1000);
    const fadeStart = Math.max(0, bgmDurSec - fadeOutSec);
    bgmChain.push(`afade=t=out:st=${fadeStart}:d=${fadeOutSec}`);
  }
  const filter = `[1:a]${bgmChain.join(",")}[bgm];[0:a][bgm]amix=inputs=2:duration=first[a]`;

  const r = await runFfmpeg([
    "-y",
    "-i", input,
    "-i", action.source,
    "-filter_complex", filter,
    // optional map — 입력에 비디오 stream이 없어도 audio-only로 진행 가능.
    "-map", "0:v:0?",
    "-map", "[a]",
    "-c:v", "copy",
    "-c:a", "aac", "-b:a", "128k",
    "-shortest",
    out,
  ]);
  if (!r.ok) return { outputs: [], error: `bgm failed: code=${r.code} ${r.stderr.slice(-400)}` };
  return { outputs: [{ actionId: action.meta.id, path: out }], lastOutput: out };
}

function mapXfadeKind(kind: TransitionAction["kind"]): string | null {
  // ffmpeg xfade transition 매핑. "cut"은 xfade 없이 단순 concat이므로 null.
  switch (kind) {
    case "fade":
      return "fade";
    case "wipe":
      return "wipeleft";
    case "slide":
      return "slideleft";
    case "cut":
      return null;
    default: {
      const _exhaustive: never = kind;
      void _exhaustive;
      return null;
    }
  }
}

async function execTransition(
  action: TransitionAction,
  prevOutputs: ExecuteOutput[],
  outDir: string,
): Promise<{ outputs: ExecuteOutput[]; lastOutput?: string; error?: string; warning?: string }> {
  if (prevOutputs.length < 2) {
    return {
      outputs: [],
      warning: `transition(${action.meta.id}) skipped — needs >=2 prior outputs, got ${prevOutputs.length}`,
    };
  }
  const aPath = prevOutputs[prevOutputs.length - 2].path;
  const bPath = prevOutputs[prevOutputs.length - 1].path;
  const metaA = await probe(aPath);
  const metaB = await probe(bPath);
  if (!metaA || !metaB) {
    return { outputs: [], error: `transition(${action.meta.id}): ffprobe failed (a=${!!metaA}, b=${!!metaB})` };
  }
  const aDurSec = metaA.durationMs / 1000;
  const bDurSec = metaB.durationMs / 1000;
  const requestedOverlap = Math.max(0.1, action.durationMs / 1000);
  // overlap은 두 클립의 짧은 쪽 - epsilon 보다 작아야 한다.
  const maxOverlap = Math.max(0.1, Math.min(aDurSec, bDurSec) - 0.1);
  const overlapSec = Math.min(requestedOverlap, maxOverlap);
  const offsetSec = Math.max(0, aDurSec - overlapSec);

  const out = resolvePath(outDir, `transition_${action.meta.id}.mp4`);
  const xfadeKind = mapXfadeKind(action.kind);

  if (xfadeKind === null) {
    // cut: 단순 concat (xfade 없음).
    const filter =
      `[0:v][1:v]concat=n=2:v=1:a=0[v];` +
      `[0:a][1:a]concat=n=2:v=0:a=1[a]`;
    const r = await runFfmpeg([
      "-y",
      "-i", aPath,
      "-i", bPath,
      "-filter_complex", filter,
      "-map", "[v]",
      "-map", "[a]",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
      "-c:a", "aac", "-b:a", "128k",
      out,
    ]);
    if (!r.ok) return { outputs: [], error: `transition(cut/concat) failed: code=${r.code} ${r.stderr.slice(-400)}` };
    return { outputs: [{ actionId: action.meta.id, path: out }], lastOutput: out };
  }

  // xfade: 비디오 cross-fade + audio acrossfade.
  const filter =
    `[0:v][1:v]xfade=transition=${xfadeKind}:duration=${overlapSec}:offset=${offsetSec}[v];` +
    `[0:a][1:a]acrossfade=d=${overlapSec}[a]`;
  const r = await runFfmpeg([
    "-y",
    "-i", aPath,
    "-i", bPath,
    "-filter_complex", filter,
    "-map", "[v]",
    "-map", "[a]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
    "-c:a", "aac", "-b:a", "128k",
    out,
  ]);
  if (!r.ok) return { outputs: [], error: `transition(${action.kind}/xfade) failed: code=${r.code} ${r.stderr.slice(-400)}` };
  return { outputs: [{ actionId: action.meta.id, path: out }], lastOutput: out };
}

async function execSpeed(
  action: SpeedAction,
  input: string,
  outDir: string,
): Promise<{ outputs: ExecuteOutput[]; lastOutput?: string; error?: string; warning?: string }> {
  // ffmpeg atempo supports 0.5~2.0 only. For factors outside this range, chain multiple atempo.
  // Example: 0.25 = 0.5 * 0.5, 4.0 = 2.0 * 2.0.
  // Video: setpts=PTS/{factor}. Audio: atempo={factor} (or chained).
  const factor = Math.max(0.25, Math.min(4.0, action.factor));
  const setptsFilter = `setpts=PTS/${factor}`;
  
  // Build atempo chain for audio. atempo must be in [0.5, 2.0].
  let audioFilter = "";
  let currentFactor = factor;
  const atempoSteps: number[] = [];
  
  if (factor < 0.5) {
    // Chain 0.5 steps until we reach the target.
    while (currentFactor < 0.5) {
      atempoSteps.push(0.5);
      currentFactor *= 2.0;
    }
    atempoSteps.push(currentFactor);
  } else if (factor > 2.0) {
    // Chain 2.0 steps until we reach the target.
    while (currentFactor > 2.0) {
      atempoSteps.push(2.0);
      currentFactor /= 2.0;
    }
    atempoSteps.push(currentFactor);
  } else {
    atempoSteps.push(factor);
  }
  
  audioFilter = atempoSteps.map((f) => `atempo=${f}`).join(",");
  
  const out = resolvePath(outDir, `speed_${action.meta.id}.mp4`);
  const r = await runFfmpeg([
    "-y",
    "-i", input,
    "-filter:v", setptsFilter,
    "-filter:a", audioFilter,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
    "-c:a", "aac", "-b:a", "128k",
    out,
  ]);
  if (!r.ok) return { outputs: [], error: `speed failed: code=${r.code} ${r.stderr.slice(-400)}` };
  
  // Warning: Speed changes may desync caption timings. Captions should be applied after speed adjustment.
  const warning = factor !== 1.0 
    ? "speed change may desync caption timings — apply captions after speed adjustments"
    : undefined;
  
  return { outputs: [{ actionId: action.meta.id, path: out }], lastOutput: out, warning };
}

async function execOpacity(
  action: OpacityAction,
  input: string,
  outDir: string,
): Promise<{ outputs: ExecuteOutput[]; lastOutput?: string; error?: string; warning?: string }> {
  // Simple opacity implementation using colorchannelmixer.
  // For now, apply uniform opacity (average of from/to) across the entire clip.
  // Full interpolation (from→to over time) requires geq expression, which is complex.
  const startSec = Math.max(0, action.start / 1000);
  const endSec = Math.max(startSec + 0.001, action.end / 1000);
  const avgOpacity = (action.from + action.to) / 2;
  
  // format=yuva420p enables alpha channel, then colorchannelmixer adjusts alpha.
  const filter = `format=yuva420p,colorchannelmixer=aa=${avgOpacity}`;
  
  const out = resolvePath(outDir, `opacity_${action.meta.id}.mp4`);
  const r = await runFfmpeg([
    "-y",
    "-i", input,
    "-vf", filter,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    out,
  ]);
  if (!r.ok) return { outputs: [], error: `opacity failed: code=${r.code} ${r.stderr.slice(-400)}` };
  
  const warning = action.from !== action.to 
    ? "opacity interpolation (from→to) not implemented — uniform average applied"
    : undefined;
  
  return { outputs: [{ actionId: action.meta.id, path: out }], lastOutput: out, warning };
}

async function execTransform(
  action: TransformAction,
  input: string,
  outDir: string,
): Promise<{ outputs: ExecuteOutput[]; lastOutput?: string; error?: string; warning?: string }> {
  const meta = await probe(input);
  if (!meta) return { outputs: [], error: "transform: ffprobe failed on input" };
  
  const filters: string[] = [];
  
  // Scale: scale={w}:{h}
  if (action.scale !== undefined && action.scale !== 1.0) {
    const w = Math.round(meta.width * action.scale);
    const h = Math.round(meta.height * action.scale);
    filters.push(`scale=${w - (w % 2)}:${h - (h % 2)}`);
  }
  
  // Rotate: convert degrees to radians, rotate with black background.
  if (action.rotateDeg !== undefined && action.rotateDeg !== 0) {
    const rad = (action.rotateDeg * Math.PI) / 180;
    filters.push(`rotate=${rad}:c=black`);
  }
  
  // Translate: pad + crop to shift. For simplicity, interpret x/y as pixel offsets.
  if (action.translate !== undefined && (action.translate.x !== 0 || action.translate.y !== 0)) {
    const x = Math.round(action.translate.x);
    const y = Math.round(action.translate.y);
    // Pad to shift, then crop back to original size.
    // This is a simplified approach; proper implementation needs overlay or complex padding.
    filters.push(`pad=iw+${Math.abs(x)}:ih+${Math.abs(y)}:${x > 0 ? x : 0}:${y > 0 ? y : 0}:black`);
    filters.push(`crop=iw-${Math.abs(x)}:ih-${Math.abs(y)}:0:0`);
  }
  
  if (filters.length === 0) {
    // No transform applied, copy input.
    const out = resolvePath(outDir, `transform_${action.meta.id}.mp4`);
    const r = await runFfmpeg(["-y", "-i", input, "-c", "copy", out]);
    if (!r.ok) return { outputs: [], error: `transform(copy) failed: code=${r.code} ${r.stderr.slice(-400)}` };
    return { outputs: [{ actionId: action.meta.id, path: out }], lastOutput: out };
  }
  
  const vf = filters.join(",");
  const out = resolvePath(outDir, `transform_${action.meta.id}.mp4`);
  const r = await runFfmpeg([
    "-y",
    "-i", input,
    "-vf", vf,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
    "-c:a", "copy",
    out,
  ]);
  if (!r.ok) return { outputs: [], error: `transform failed: code=${r.code} ${r.stderr.slice(-400)}` };
  
  return { outputs: [{ actionId: action.meta.id, path: out }], lastOutput: out };
}

async function execImageOverlay(
  action: ImageOverlayAction,
  input: string,
  outDir: string,
): Promise<{ outputs: ExecuteOutput[]; lastOutput?: string; error?: string; warning?: string }> {
  if (!action.source || !existsSync(action.source)) {
    return { outputs: [], warning: `imageOverlay skipped: source not found (${action.source})` };
  }
  const startSec = Math.max(0, action.start / 1000);
  const endSec = Math.max(startSec + 0.001, action.end / 1000);
  const meta = await probe(input);
  if (!meta) return { outputs: [], error: "imageOverlay: ffprobe failed on input" };

  // Normalized position → absolute pixel coords (top-left of overlay).
  const px = Math.max(0, Math.min(1, action.position.x));
  const py = Math.max(0, Math.min(1, action.position.y));
  const xExpr = `(W-w)*${px}`;
  const yExpr = `(H-h)*${py}`;
  const opacity = Math.max(0, Math.min(1, action.opacity));
  const scale = Math.max(0.01, action.scale);

  // Scale overlay asset → adjust alpha (uniform) → overlay over base video for the time window.
  // format=rgba ensures alpha channel exists; colorchannelmixer=aa applies opacity.
  const overlayFilter =
    `[1:v]scale=iw*${scale}:ih*${scale},format=rgba,colorchannelmixer=aa=${opacity}[ov];` +
    `[0:v][ov]overlay=${xExpr}:${yExpr}:enable='between(t,${startSec},${endSec})'[v]`;

  const out = resolvePath(outDir, `imageOverlay_${action.meta.id}.mp4`);
  const r = await runFfmpeg([
    "-y",
    "-i", input,
    "-i", action.source,
    "-filter_complex", overlayFilter,
    "-map", "[v]",
    "-map", "0:a?",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    out,
  ]);
  if (!r.ok) return { outputs: [], error: `imageOverlay failed: code=${r.code} ${r.stderr.slice(-400)}` };
  return { outputs: [{ actionId: action.meta.id, path: out }], lastOutput: out };
}

// P2-1 scaffold — AI 미디어 생성. 비용 발생 가능 → env 키 미설정 시 항상 warning + skip.
// 실제 호출 어댑터(gemini/veo/elevenlabs)는 본 PR 범위 외. 현재는 키 가드만 구현.
async function execGenerate(
  action: GenerateAction,
): Promise<{ outputs: ExecuteOutput[]; lastOutput?: string; error?: string; warning?: string }> {
  const keyByKind: Record<GenerateAction["kind"], string> = {
    image: process.env.MYMOVIE_GENERATE_IMAGE_KEY ?? "",
    video: process.env.MYMOVIE_GENERATE_VIDEO_KEY ?? "",
    audio: process.env.MYMOVIE_GENERATE_AUDIO_KEY ?? "",
  };
  const key = keyByKind[action.kind];
  if (!key) {
    return {
      outputs: [],
      warning:
        `generate(${action.kind}) skipped: provider key missing ` +
        `(set MYMOVIE_GENERATE_${action.kind.toUpperCase()}_KEY to enable)`,
    };
  }
  // 키가 있어도 본 패치에서는 실제 외부 호출을 수행하지 않는다(비용 게이트).
  // 후속 PR에서 provider adapter 연결 시 여기로 갈음.
  return {
    outputs: [],
    warning: `generate(${action.kind}) scaffold: provider adapter not wired yet (key detected, call deferred)`,
  };
}

// Build a piecewise-linear time expression for ffmpeg filter parameters.
// kfs must be sorted ascending by atMs. `timeVar` is the variable name used in
// the consuming filter ("t" for rotate/overlay, "T" for geq, "(on/<fps>)" when
// targeting zoompan which lacks a direct time variable).
// `extract(v)` projects KeyframeValue → scalar number.
// `interp="hold"` segments emit a constant; "smooth" falls back to linear so
// the executor stays conservative.
function buildPiecewiseLinearExpr(
  kfs: KeyframePoint[],
  timeVar: string,
  extract: (v: KeyframeValue) => number,
): string {
  if (kfs.length === 0) return "0";
  if (kfs.length === 1) return String(extract(kfs[0].value));
  // Build from the tail: value after the last keyframe = last value (held).
  const lastVal = extract(kfs[kfs.length - 1].value);
  let expr = String(lastVal);
  for (let i = kfs.length - 2; i >= 0; i--) {
    const t0 = kfs[i].atMs / 1000;
    const t1 = kfs[i + 1].atMs / 1000;
    const v0 = extract(kfs[i].value);
    const v1 = extract(kfs[i + 1].value);
    const dt = t1 - t0;
    let segExpr: string;
    if (kfs[i].interp === "hold" || dt <= 0) {
      segExpr = String(v0);
    } else {
      // Linear ramp v0 → v1 within [t0, t1].
      segExpr = `(${v0}+(${v1}-${v0})*(${timeVar}-${t0})/${dt})`;
    }
    expr = `if(lt(${timeVar},${t1}),${segExpr},${expr})`;
  }
  // Value before the first keyframe stays at the first value.
  const t0First = kfs[0].atMs / 1000;
  const v0First = extract(kfs[0].value);
  expr = `if(lt(${timeVar},${t0First}),${v0First},${expr})`;
  return expr;
}

// Probe a video stream's average frame rate. Falls back to 30 when probe
// fails or returns a non-finite ratio.
async function probeFps(inputPath: string): Promise<number> {
  return new Promise<number>((resolveP) => {
    const proc = spawn(
      "ffprobe",
      [
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=avg_frame_rate",
        "-of", "default=nokey=1:noprint_wrappers=1",
        inputPath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    proc.stdout.on("data", (c: Buffer) => { out += c.toString(); });
    proc.on("error", () => resolveP(30));
    proc.on("close", () => {
      const raw = out.trim();
      const m = raw.match(/^(\d+)\s*\/\s*(\d+)/);
      if (m) {
        const num = Number(m[1]);
        const den = Number(m[2]);
        if (den > 0 && Number.isFinite(num / den) && num / den > 0) {
          return resolveP(num / den);
        }
      }
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) return resolveP(n);
      resolveP(30);
    });
  });
}

// Render one keyframe property. Each property maps to one ffmpeg pass with a
// time-varying filter parameter. Conservative: only linear/hold interp; smooth
// reuses linear. Unsupported properties (volume/crop) return a warning and no
// output so the executor's chain skips them gracefully.
async function execKeyframe(
  action: KeyframeAction,
  input: string,
  outDir: string,
): Promise<{ outputs: ExecuteOutput[]; lastOutput?: string; error?: string; warning?: string }> {
  const sorted = [...action.keyframes].sort((a, b) => a.atMs - b.atMs);
  if (sorted.length === 0) {
    return { outputs: [], warning: `keyframe(${action.property}) skipped: empty keyframe list` };
  }

  const meta = await probe(input);
  if (!meta) return { outputs: [], error: `keyframe(${action.property}): ffprobe failed on input` };
  const W = meta.width;
  const H = meta.height;

  const out = resolvePath(outDir, `keyframe_${action.property}_${action.meta.id}.mp4`);

  switch (action.property) {
    case "opacity": {
      // alpha plane via geq (variable T = time in seconds). Multiply RGB by the
      // same expression so opacity<1 fades visibly to black under yuv420p flatten.
      const expr = buildPiecewiseLinearExpr(sorted, "T", (v) => (typeof v === "number" ? v : 1));
      const clipped = `clip((${expr}),0,1)`;
      const vf = `format=yuva420p,geq=r='r(X,Y)*(${clipped})':g='g(X,Y)*(${clipped})':b='b(X,Y)*(${clipped})':a='(${clipped})*255',format=yuv420p`;
      const r = await runFfmpeg([
        "-y", "-i", input,
        "-vf", vf,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
        "-c:a", "copy",
        out,
      ]);
      if (!r.ok) return { outputs: [], error: `keyframe(opacity) failed: code=${r.code} ${r.stderr.slice(-400)}` };
      return { outputs: [{ actionId: action.meta.id, path: out }], lastOutput: out };
    }
    case "scale": {
      // zoompan lacks a direct time variable across versions — derive seconds
      // from output frame index `on` and the input's avg fps.
      const fps = await probeFps(input);
      const expr = buildPiecewiseLinearExpr(sorted, `(on/${fps})`, (v) => (typeof v === "number" ? v : 1));
      // Guard against z<=0 which zoompan rejects.
      const safeExpr = `max(0.01,(${expr}))`;
      const vf = `zoompan=z='${safeExpr}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${fps}`;
      const r = await runFfmpeg([
        "-y", "-i", input,
        "-vf", vf,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
        "-c:a", "copy",
        out,
      ]);
      if (!r.ok) return { outputs: [], error: `keyframe(scale) failed: code=${r.code} ${r.stderr.slice(-400)}` };
      return { outputs: [{ actionId: action.meta.id, path: out }], lastOutput: out };
    }
    case "rotation": {
      // rotate filter's angle accepts `t`. Convert degrees → radians inline.
      const expr = buildPiecewiseLinearExpr(sorted, "t", (v) => (typeof v === "number" ? v : 0));
      const vf = `rotate='((${expr})*PI/180)':c=black:ow=iw:oh=ih`;
      const r = await runFfmpeg([
        "-y", "-i", input,
        "-vf", vf,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
        "-c:a", "copy",
        out,
      ]);
      if (!r.ok) return { outputs: [], error: `keyframe(rotation) failed: code=${r.code} ${r.stderr.slice(-400)}` };
      return { outputs: [{ actionId: action.meta.id, path: out }], lastOutput: out };
    }
    case "position": {
      // Match compositor.ts: |x|,|y|<=1 → normalized fraction of canvas;
      // otherwise raw pixels. Resolve to px at extraction time so the emitted
      // expression contains only constants and the time variable.
      const isNormalized = (v: KeyframeValue): boolean =>
        typeof v === "object" && v !== null && "x" in v && "y" in v &&
        Math.abs((v as { x: number }).x) <= 1 && Math.abs((v as { y: number }).y) <= 1;
      const xExpr = buildPiecewiseLinearExpr(sorted, "t", (v) => {
        if (typeof v === "object" && v !== null && "x" in v) {
          const x = (v as { x: number }).x;
          return isNormalized(v) ? x * W : x;
        }
        return 0;
      });
      const yExpr = buildPiecewiseLinearExpr(sorted, "t", (v) => {
        if (typeof v === "object" && v !== null && "y" in v) {
          const y = (v as { y: number }).y;
          return isNormalized(v) ? y * H : y;
        }
        return 0;
      });
      const durSec = Math.max(0.001, meta.durationMs / 1000);
      // color background of the same dimension + overlay shifted by (xExpr,yExpr).
      const filterComplex =
        `color=c=black:s=${W}x${H}:d=${durSec}[bg];` +
        `[bg][0:v]overlay=x='(${xExpr})':y='(${yExpr})':shortest=1[v]`;
      const r = await runFfmpeg([
        "-y", "-i", input,
        "-filter_complex", filterComplex,
        "-map", "[v]",
        "-map", "0:a?",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
        "-c:a", "copy",
        out,
      ]);
      if (!r.ok) return { outputs: [], error: `keyframe(position) failed: code=${r.code} ${r.stderr.slice(-400)}` };
      return { outputs: [{ actionId: action.meta.id, path: out }], lastOutput: out };
    }
    case "volume":
    case "crop":
      return {
        outputs: [],
        warning: `keyframe(${action.property}) not yet implemented — only opacity/scale/rotation/position render`,
      };
  }
}

export async function executeOne(action: Action, footage: Footage): Promise<ExtendedExecuteResult> {
  return executeMany([action], footage);
}

// P2-2 — sequential xfade chain across N pre-rendered clips. Each pair walks through
// execTransition, reusing existing xfade/concat logic. Transition kind/duration is
// taken from a matching TransitionAction (by fromClipId/toClipId), otherwise the
// pair falls back to a hard cut (kind="cut", durationMs=1).
export interface ClipSegmentInput {
  clipId: string;
  path: string;
}

export interface ConcatChainResult {
  lastOutput?: string;
  outputs: ExecuteOutput[];
  warnings: { actionId: string; reason: string }[];
  errors: { actionId: string; reason: string }[];
  appliedTransitionIds: string[];
}

export async function concatClipsWithTransitions(
  segments: ClipSegmentInput[],
  transitions: TransitionAction[],
  outDir: string,
): Promise<ConcatChainResult> {
  const outputs: ExecuteOutput[] = [];
  const warnings: { actionId: string; reason: string }[] = [];
  const errors: { actionId: string; reason: string }[] = [];
  const appliedTransitionIds: string[] = [];

  if (segments.length === 0) {
    return { outputs, warnings, errors, appliedTransitionIds };
  }
  if (segments.length === 1) {
    return { lastOutput: segments[0].path, outputs, warnings, errors, appliedTransitionIds };
  }

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  let currentPath = segments[0].path;
  let currentClipId = segments[0].clipId;

  for (let i = 1; i < segments.length; i++) {
    const next = segments[i];
    const matched = transitions.find(
      (t) => t.fromClipId === currentClipId && t.toClipId === next.clipId,
    );
    const trAction: TransitionAction =
      matched ?? {
        type: "transition",
        meta: {
          id: `_implicit_${currentClipId}_${next.clipId}_${i}`,
          createdAt: Date.now(),
          source: "system",
        },
        fromClipId: currentClipId,
        toClipId: next.clipId,
        kind: "cut",
        durationMs: 1,
      };

    const stubPrev: ExecuteOutput[] = [
      { actionId: `_seg_${i - 1}`, path: currentPath },
      { actionId: `_seg_${i}`, path: next.path },
    ];

    const r = await execTransition(trAction, stubPrev, outDir);
    if (r.error || !r.lastOutput) {
      errors.push({
        actionId: trAction.meta.id,
        reason: r.error ?? "transition produced no output",
      });
      return { lastOutput: currentPath, outputs, warnings, errors, appliedTransitionIds };
    }
    if (r.warning) {
      warnings.push({ actionId: trAction.meta.id, reason: r.warning });
    }
    outputs.push(...r.outputs);
    appliedTransitionIds.push(trAction.meta.id);
    currentPath = r.lastOutput;
    // The merged clip is treated as if it now "ends at" next.clipId so the
    // next transition lookup sees the right-hand identity.
    currentClipId = next.clipId;
  }

  return { lastOutput: currentPath, outputs, warnings, errors, appliedTransitionIds };
}

export async function executeMany(actions: Action[], footage: Footage): Promise<ExtendedExecuteResult> {
  const outputs: ExecuteOutput[] = [];
  const applied: string[] = [];
  const failed: string[] = [];
  const errors: { actionId: string; reason: string }[] = [];
  const warnings: { actionId: string; reason: string }[] = [];

  if (!footage.path) {
    return {
      ok: false,
      appliedActionIds: [],
      failedActionIds: actions.map((a) => a.meta.id),
      errors: actions.map((a) => ({ actionId: a.meta.id, reason: "footage.path missing" })),
      outputs: [],
      warnings: [],
    };
  }

  if (actions.length === 0) {
    return {
      ok: true,
      appliedActionIds: [],
      failedActionIds: [],
      outputs: [],
      warnings: [],
    };
  }

  const outDir = jobDirFor(actions);
  let currentInput = footage.path;

  for (const a of actions) {
    try {
      let res:
        | { outputs: ExecuteOutput[]; lastOutput?: string; error?: string; warning?: string }
        | undefined;
      switch (a.type) {
        case "cut":
          res = await execCut(a, currentInput, outDir);
          break;
        case "trim":
          res = await execTrim(a, currentInput, outDir);
          break;
        case "reframe":
          res = await execReframe(a, currentInput, outDir);
          break;
        case "caption":
          res = await execCaption(a, currentInput, outDir);
          break;
        case "bgm":
          res = await execBgm(a, currentInput, outDir);
          break;
        case "transition":
          res = await execTransition(a, outputs, outDir);
          break;
        case "speed":
          res = await execSpeed(a, currentInput, outDir);
          break;
        case "opacity":
          res = await execOpacity(a, currentInput, outDir);
          break;
        case "transform":
          res = await execTransform(a, currentInput, outDir);
          break;
        case "imageOverlay":
          res = await execImageOverlay(a, currentInput, outDir);
          break;
        case "generate":
          res = await execGenerate(a);
          break;
        case "keyframe":
          res = await execKeyframe(a, currentInput, outDir);
          break;
        default: {
          const _exhaustive: never = a;
          void _exhaustive;
          res = { outputs: [], error: "unknown action type" };
        }
      }
      if (res.error) {
        failed.push(a.meta.id);
        errors.push({ actionId: a.meta.id, reason: res.error });
        continue;
      }
      if (res.warning) {
        warnings.push({ actionId: a.meta.id, reason: res.warning });
      }
      outputs.push(...res.outputs);
      if (res.lastOutput) currentInput = res.lastOutput;
      applied.push(a.meta.id);
    } catch (e) {
      failed.push(a.meta.id);
      errors.push({
        actionId: a.meta.id,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return {
    ok: failed.length === 0,
    appliedActionIds: applied,
    failedActionIds: failed,
    errors: errors.length > 0 ? errors : undefined,
    outputs,
    lastOutput: currentInput !== footage.path ? currentInput : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
