// 분석 시그널 수집기 — ffmpeg로 scene-cut / silence-detect만 로컬 수행.
// STT는 transcribe.ts에 분리. 모두 무료/로컬.

import { spawn } from "node:child_process";
import { probe } from "../ingest/ffmpeg";
import type {
  SceneCut,
  SilenceRange,
  VideoMeta,
  HighlightCandidate,
  TranscriptSegment,
} from "./signals";

const FFMPEG_TIMEOUT_MS = 5 * 60 * 1000;

/** scene 점수 임계: 0.4 이상 변화만 컷 후보로 인정. */
const SCENE_THRESHOLD = 0.4;

/** 무음 감지: -30dB 이하 0.4초 이상 구간을 무음으로 판단. */
const SILENCE_NOISE_DB = -30;
const SILENCE_MIN_DURATION_SEC = 0.4;

export async function detectMeta(inputPath: string): Promise<VideoMeta | null> {
  const meta = await probe(inputPath);
  if (!meta) return null;
  return { durationMs: meta.durationMs, width: meta.width, height: meta.height };
}

export async function detectSceneCuts(inputPath: string): Promise<SceneCut[]> {
  // ffmpeg -i in -vf "select='gt(scene,T)',showinfo" -f null - 2>&1
  // scene 점수는 showinfo의 pts_time과 함께 stderr에 'select' 라인으로 나옴.
  // 실패는 빈 배열 (best-effort).
  const args = [
    "-i",
    inputPath,
    "-vf",
    `select='gt(scene,${SCENE_THRESHOLD})',metadata=print`,
    "-an",
    "-f",
    "null",
    "-",
  ];
  const stderr = await collectStderr("ffmpeg", args, FFMPEG_TIMEOUT_MS).catch(() => "");
  if (!stderr) return [];
  const cuts: SceneCut[] = [];
  // metadata=print 출력: "lavfi.scene_score=0.512" + 직전 라인의 "pts_time:NNN"
  // 일부 ffmpeg 빌드는 'frame:N  pts:NN  pts_time:NN.NN' 포맷 사용.
  const lines = stderr.split(/\r?\n/);
  let pendingPtsMs: number | null = null;
  for (const line of lines) {
    const ptsMatch = line.match(/pts_time:([0-9.]+)/);
    if (ptsMatch) {
      pendingPtsMs = Math.round(Number(ptsMatch[1]) * 1000);
    }
    const scoreMatch = line.match(/scene_score=([0-9.]+)/);
    if (scoreMatch && pendingPtsMs !== null) {
      cuts.push({ atMs: pendingPtsMs, score: Number(scoreMatch[1]) });
      pendingPtsMs = null;
    }
  }
  return cuts;
}

export async function detectSilences(inputPath: string): Promise<SilenceRange[]> {
  const args = [
    "-i",
    inputPath,
    "-af",
    `silencedetect=noise=${SILENCE_NOISE_DB}dB:d=${SILENCE_MIN_DURATION_SEC}`,
    "-f",
    "null",
    "-",
  ];
  const stderr = await collectStderr("ffmpeg", args, FFMPEG_TIMEOUT_MS).catch(() => "");
  if (!stderr) return [];
  const ranges: SilenceRange[] = [];
  let pendingStart: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const startMatch = line.match(/silence_start:\s*([0-9.]+)/);
    if (startMatch) {
      pendingStart = Math.round(Number(startMatch[1]) * 1000);
      continue;
    }
    const endMatch = line.match(/silence_end:\s*([0-9.]+)/);
    if (endMatch && pendingStart !== null) {
      const endMs = Math.round(Number(endMatch[1]) * 1000);
      if (endMs > pendingStart) {
        ranges.push({
          startMs: pendingStart,
          endMs,
          thresholdDb: SILENCE_NOISE_DB,
        });
      }
      pendingStart = null;
    }
  }
  return ranges;
}

/** 컷·발화 점수 합성으로 하이라이트 구간 휴리스틱 추출. 외부 LLM 없이 동작. */
export function deriveHighlights(
  meta: VideoMeta,
  sceneCuts: SceneCut[],
  transcript: TranscriptSegment[],
  maxCandidates = 5,
): HighlightCandidate[] {
  if (meta.durationMs <= 0) return [];
  // 발화 밀도가 높은 30초 윈도우 + 씬 변화가 많은 구간을 가산.
  const windowMs = 30_000;
  const stepMs = 10_000;
  const cands: HighlightCandidate[] = [];
  for (let start = 0; start + windowMs <= meta.durationMs; start += stepMs) {
    const end = start + windowMs;
    const sceneScore = sceneCuts
      .filter((c) => c.atMs >= start && c.atMs < end)
      .reduce((acc, c) => acc + c.score, 0);
    const speechMs = transcript
      .filter((s) => s.endMs > start && s.startMs < end)
      .reduce(
        (acc, s) => acc + Math.max(0, Math.min(end, s.endMs) - Math.max(start, s.startMs)),
        0,
      );
    const speechDensity = speechMs / windowMs;
    const score = Math.min(1, sceneScore * 0.4 + speechDensity * 0.6);
    if (score > 0.15) {
      cands.push({
        startMs: start,
        endMs: end,
        score,
        reason: `scene=${sceneScore.toFixed(2)} speech=${speechDensity.toFixed(2)}`,
      });
    }
  }
  return cands.sort((a, b) => b.score - a.score).slice(0, maxCandidates);
}

function collectStderr(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let settled = false;
    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        proc.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      reject(new Error(`${cmd} timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    const out: Buffer[] = [];
    proc.stderr.on("data", (b: Buffer) => out.push(b));
    proc.stdout.on("data", () => {
      /* discard */
    });
    proc.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      reject(e);
    });
    proc.on("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      // ffmpeg는 분석용 호출에서 exit code 1을 반환할 수 있어 종료코드 무시하고 stderr 활용.
      resolve(Buffer.concat(out).toString("utf-8"));
    });
  });
}
