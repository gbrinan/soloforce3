// POST /api/director/highlights
// Body: { jobId: string }
// → Whisper 트랜스크립트 전문을 Claude CLI에 전달해 숏폼용 핵심 구간(15~60초)
//   [{ startMs, endMs, title, reason }] 을 추출한다. 유료 API 미사용 — 로컬 CLI 인증 재사용.

import { NextResponse } from "next/server";
import { getJob } from "@/lib/ingest/jobs";
import { transcribe } from "@/lib/director/transcribe";
import { detectMeta } from "@/lib/director/analyze";
import { runClaude, extractJson, claudeErrorDetail } from "@/lib/claude-cli";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600; // whisper + Claude CLI 직렬 실행 대비

const CLAUDE_TIMEOUT_MS = 120_000;
const MAX_TRANSCRIPT_CHARS = 24_000;
const MIN_CLIP_SEC = 15;
const MAX_CLIP_SEC = 60;

interface HighlightsBody {
  jobId?: string;
}

interface RawHighlight {
  start?: number;
  end?: number;
  title?: string;
  reason?: string;
}

export interface HighlightItem {
  startMs: number;
  endMs: number;
  title: string;
  reason: string;
}

function buildPrompt(transcriptText: string, durationSec: number): string {
  return [
    "다음은 영상의 타임스탬프 트랜스크립트다. 숏폼 클립으로 잘라낼 핵심 하이라이트 구간을 최대 5개 추출하라.",
    `규칙: 각 구간은 ${MIN_CLIP_SEC}~${MAX_CLIP_SEC}초 길이. start/end는 초 단위 숫자이며 0 이상 ${Math.floor(durationSec)} 이하. title은 한국어 한 줄, reason은 선정 이유 한 문장(한국어).`,
    '출력은 JSON 배열만: [{"start": 12.5, "end": 42.0, "title": "...", "reason": "..."}]',
    "",
    "트랜스크립트:",
    transcriptText,
  ].join("\n");
}

export async function POST(req: Request) {
  let body: HighlightsBody;
  try {
    body = (await req.json()) as HighlightsBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.jobId || typeof body.jobId !== "string") {
    return NextResponse.json({ ok: false, error: "jobId required" }, { status: 400 });
  }
  const job = getJob(body.jobId);
  if (!job) {
    return NextResponse.json({ ok: false, error: "job not found" }, { status: 404 });
  }
  if (job.stage !== "done" || !job.proxyPath) {
    return NextResponse.json(
      { ok: false, error: `job not ready (stage=${job.stage})` },
      { status: 409 },
    );
  }

  try {
    const [meta, stt] = await Promise.all([
      detectMeta(job.proxyPath),
      transcribe(job.proxyPath),
    ]);
    if (stt.segments.length === 0) {
      return NextResponse.json(
        { ok: false, error: stt.note ?? "트랜스크립트가 비어 있습니다 (Whisper 미가용 또는 무음)" },
        { status: 422 },
      );
    }
    const durationMs = meta?.durationMs ?? Math.max(...stt.segments.map((s) => s.endMs));
    const transcriptText = stt.segments
      .map((s) => `[${(s.startMs / 1000).toFixed(1)}s-${(s.endMs / 1000).toFixed(1)}s] ${s.text}`)
      .join("\n")
      .slice(0, MAX_TRANSCRIPT_CHARS);

    let raw: string;
    try {
      raw = await runClaude(buildPrompt(transcriptText, durationMs / 1000), CLAUDE_TIMEOUT_MS);
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: claudeErrorDetail(e, CLAUDE_TIMEOUT_MS) },
        { status: 502 },
      );
    }
    const parsed = extractJson<RawHighlight[]>(raw);
    if (!Array.isArray(parsed)) {
      return NextResponse.json(
        { ok: false, error: "Claude 응답에서 JSON 배열을 추출하지 못했습니다" },
        { status: 502 },
      );
    }

    // Clamp/validate: numeric start<end within duration, clip length 15~60s.
    const highlights: HighlightItem[] = [];
    for (const h of parsed) {
      if (typeof h?.start !== "number" || typeof h?.end !== "number") continue;
      const startMs = Math.max(0, Math.round(h.start * 1000));
      let endMs = Math.min(durationMs, Math.round(h.end * 1000));
      if (endMs <= startMs) continue;
      const lenMs = endMs - startMs;
      if (lenMs < MIN_CLIP_SEC * 1000) {
        endMs = Math.min(durationMs, startMs + MIN_CLIP_SEC * 1000);
      } else if (lenMs > MAX_CLIP_SEC * 1000) {
        endMs = startMs + MAX_CLIP_SEC * 1000;
      }
      if (endMs <= startMs) continue;
      highlights.push({
        startMs,
        endMs,
        title: typeof h.title === "string" && h.title.trim() ? h.title.trim() : "하이라이트",
        reason: typeof h.reason === "string" ? h.reason.trim() : "",
      });
    }
    return NextResponse.json({ ok: true, highlights });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
