// yt-dlp 래퍼 — YouTube URL → MP4 파일.
// ToS: 사용자 본인 콘텐츠/권리 보유분만 허용. UI에서 약관 고지 동의 필수.

import { spawn } from "node:child_process";
import { mkdir, access } from "node:fs/promises";
import { resolve } from "node:path";
import { uploadsDir } from "../core/paths";

const UPLOADS_DIR = uploadsDir();

export interface YtDlpProgress {
  percent: number;
  speed?: string;
  eta?: string;
}

export interface YtDlpResult {
  ok: boolean;
  outputPath?: string;
  error?: string;
  stderr?: string;
}

function isYoutubeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      /(^|\.)youtube\.com$/.test(u.hostname) ||
      /(^|\.)youtu\.be$/.test(u.hostname) ||
      /(^|\.)youtube-nocookie\.com$/.test(u.hostname)
    );
  } catch {
    return false;
  }
}

async function ensureBinary(): Promise<void> {
  // PATH 의존 — Homebrew/시스템 설치 가정. 부재 시 spawn 단계에서 ENOENT 발생.
  // 운영 가이드: brew install yt-dlp
}

export async function downloadYoutube(
  url: string,
  jobId: string,
  onProgress?: (p: YtDlpProgress) => void,
): Promise<YtDlpResult> {
  if (!isYoutubeUrl(url)) {
    return { ok: false, error: "올바른 YouTube URL이 아닙니다" };
  }
  await ensureBinary();
  try {
    await mkdir(UPLOADS_DIR, { recursive: true });
  } catch {}
  const outTemplate = resolve(UPLOADS_DIR, `${jobId}.%(ext)s`);

  return new Promise<YtDlpResult>((resolvePromise) => {
    const args = [
      url,
      "-f",
      "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
      "--merge-output-format",
      "mp4",
      "-o",
      outTemplate,
      "--no-playlist",
      "--newline",
      "--progress",
      "--no-warnings",
    ];
    const proc = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });

    let stderrBuf = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      const lines = chunk.toString().split(/\r?\n/);
      for (const line of lines) {
        // 예: [download]  42.3% of 12.34MiB at 1.23MiB/s ETA 00:07
        const m = line.match(/\[download\]\s+(\d+(?:\.\d+)?)% of/);
        if (m && onProgress) {
          const percent = Number(m[1]);
          if (Number.isFinite(percent)) onProgress({ percent });
        }
      }
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
    });
    proc.on("error", (err) => {
      resolvePromise({ ok: false, error: `yt-dlp spawn 실패: ${err.message}`, stderr: stderrBuf });
    });
    proc.on("close", async (code) => {
      if (code !== 0) {
        resolvePromise({ ok: false, error: `yt-dlp exit ${code}`, stderr: stderrBuf });
        return;
      }
      // 확장자 추정 — merge-output-format mp4 사용했으므로 .mp4 우선.
      const candidate = resolve(UPLOADS_DIR, `${jobId}.mp4`);
      try {
        await access(candidate);
        resolvePromise({ ok: true, outputPath: candidate });
      } catch {
        resolvePromise({ ok: false, error: "yt-dlp 완료했으나 출력 파일을 찾지 못함", stderr: stderrBuf });
      }
    });
  });
}
