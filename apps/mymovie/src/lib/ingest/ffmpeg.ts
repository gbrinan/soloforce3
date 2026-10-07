// ffmpeg 래퍼 — 프록시(편집용 저해상도) 트랜스코드 + 메타데이터 추출.

import { spawn } from "node:child_process";
import { resolve, parse as parsePath } from "node:path";

export interface ProxyResult {
  ok: boolean;
  proxyPath?: string;
  error?: string;
  stderr?: string;
}

export interface FfmpegProgress {
  percent: number; // 0..100 (durationMs 대비 outTimeMs)
  outTimeMs?: number;
}

export interface FfprobeMeta {
  durationMs: number;
  width: number;
  height: number;
  vcodec: string;
}

export async function probe(inputPath: string): Promise<FfprobeMeta | null> {
  return new Promise<FfprobeMeta | null>((resolvePromise) => {
    const proc = spawn(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,codec_name:format=duration",
        "-of",
        "json",
        inputPath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    proc.stdout.on("data", (c: Buffer) => (out += c.toString()));
    proc.on("error", () => resolvePromise(null));
    proc.on("close", (code) => {
      if (code !== 0) return resolvePromise(null);
      try {
        const json = JSON.parse(out) as {
          streams?: Array<{ width?: number; height?: number; codec_name?: string }>;
          format?: { duration?: string };
        };
        const s = json.streams?.[0];
        const durationSec = Number(json.format?.duration ?? "0");
        if (!s || !s.width || !s.height) return resolvePromise(null);
        resolvePromise({
          durationMs: Math.round(durationSec * 1000),
          width: s.width,
          height: s.height,
          vcodec: s.codec_name ?? "unknown",
        });
      } catch {
        resolvePromise(null);
      }
    });
  });
}

export async function transcodeProxy(
  inputPath: string,
  onProgress?: (p: FfmpegProgress) => void,
): Promise<ProxyResult> {
  const meta = await probe(inputPath);
  const totalMs = meta?.durationMs ?? 0;
  const parsed = parsePath(inputPath);
  const proxyPath = resolve(parsed.dir, `${parsed.name}.proxy.mp4`);

  return new Promise<ProxyResult>((resolvePromise) => {
    // 720p H.264, 빠른 프리셋 — 편집 프리뷰용 프록시.
    const args = [
      "-y",
      "-i",
      inputPath,
      "-vf",
      "scale='min(1280,iw)':'-2'",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "26",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      "-progress",
      "pipe:1",
      "-nostats",
      proxyPath,
    ];
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });

    let stderrBuf = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^out_time_ms=(\d+)/);
        if (m && onProgress) {
          const outTimeMs = Math.round(Number(m[1]) / 1000); // -progress 는 microseconds 단위
          if (totalMs > 0 && Number.isFinite(outTimeMs)) {
            const percent = Math.min(100, Math.max(0, (outTimeMs / totalMs) * 100));
            onProgress({ percent, outTimeMs });
          }
        }
      }
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
    });
    proc.on("error", (err) => {
      resolvePromise({ ok: false, error: `ffmpeg spawn 실패: ${err.message}`, stderr: stderrBuf });
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        resolvePromise({ ok: false, error: `ffmpeg exit ${code}`, stderr: stderrBuf });
        return;
      }
      resolvePromise({ ok: true, proxyPath });
    });
  });
}
