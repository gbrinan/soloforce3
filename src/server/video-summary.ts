import { spawn } from "node:child_process";
import { CLAUDE_PATH } from "../config.js";
import { safeChildEnv } from "./utils/safeChildEnv.js";
import { safeKill } from "./utils/platform.js";
import { resolveTier } from "./model-tiers.js";

/** YouTube URL에서 video ID(11자) 추출. 없으면 null. */
export function extractYouTubeId(url: string): string | null {
  const m = url.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}

export interface TranscriptResult {
  text: string;
  lang: string;
}

/**
 * youtube-transcript 라이브러리로 자막 추출 (API 키 불필요).
 * 한국어 자막 우선, 없으면 기본 언어로 폴백.
 * 자막 자체가 없으면 transcript_unavailable 에러.
 */
export async function fetchYouTubeTranscript(videoId: string): Promise<TranscriptResult> {
  // ESM 동적 import — 패키지가 CJS/ESM 혼용이라 런타임 로드
  const { YoutubeTranscript } = await import("youtube-transcript") as { YoutubeTranscript: {
    fetchTranscript(id: string, opts?: { lang?: string }): Promise<{ text: string; offset?: number; duration?: number }[]>
  }};

  for (const lang of ["ko", undefined] as (string | undefined)[]) {
    try {
      const items = lang
        ? await YoutubeTranscript.fetchTranscript(videoId, { lang })
        : await YoutubeTranscript.fetchTranscript(videoId);
      if (items?.length) {
        return { text: items.map(t => t.text).join(" "), lang: lang ?? "auto" };
      }
    } catch { /* 다음 언어로 재시도 */ }
  }
  throw new Error("transcript_unavailable");
}

/** claude CLI를 직접 spawn해서 단회 응답 생성. */
function spawnClaude(prompt: string, timeoutMs = 90_000): Promise<string> {
  return new Promise((resolve, reject) => {
    // 저비용 티어 핀 — 자막 요약은 프론티어 모델 불필요
    const cheapModel = resolveTier("cheap");
    const args = cheapModel ? ["-p", prompt, "--model", cheapModel] : ["-p", prompt];
    const proc = spawn(CLAUDE_PATH, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: safeChildEnv(),
    });
    let out = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      safeKill(proc, "SIGTERM");
      reject(new Error("claude timeout"));
    }, timeoutMs);

    proc.stdout!.on("data", (d: Buffer) => { out += d.toString(); });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code === 0 && out.trim()) resolve(out.trim());
      else reject(new Error(`claude exit ${code}`));
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(e);
    });
  });
}

/** 3~5줄 간단 요약 생성. */
export async function generateShortSummary(url: string, transcript: string): Promise<string> {
  const prompt = `다음 YouTube 영상 자막을 3~5줄 한국어로 요약하세요. 요약 내용만 바로 출력하고 안내문·인사·부연 설명은 포함하지 마세요.\n\n자막(${url}):\n${transcript.slice(0, 6000)}`;
  return spawnClaude(prompt);
}

/** 섹션별 상세 마크다운 생성. */
export async function generateDetailedMd(url: string, transcript: string): Promise<string> {
  const prompt = `다음 YouTube 영상(${url})의 자막을 분석하여 아래 형식의 마크다운 문서로 정리해주세요. 마크다운만 출력하세요.

# 영상 요약
> 출처: ${url}

## 📋 개요

## 🔑 주요 포인트

## 📝 상세 내용

## ✅ 결론

자막:
${transcript.slice(0, 12000)}`;
  return spawnClaude(prompt, 150_000);
}
