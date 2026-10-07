// POST /api/director/transcribe
// Body: { jobId: string }
// → 로컬 Whisper 파이프라인으로 트랜스크립트 세그먼트 반환 (자동 자막·컷 제안 공용).
//
// 보안: director/run과 동일 — jobId만 받고 경로는 jobs 레지스트리에서 해석.

import { NextResponse } from "next/server";
import { getJob } from "@/lib/ingest/jobs";
import { transcribe } from "@/lib/director/transcribe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600; // whisper.cpp는 긴 영상에서 수 분 소요 가능

interface TranscribeBody {
  jobId?: string;
}

export async function POST(req: Request) {
  let body: TranscribeBody;
  try {
    body = (await req.json()) as TranscribeBody;
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
    const result = await transcribe(job.proxyPath);
    return NextResponse.json({
      ok: result.ok,
      source: result.source,
      note: result.note,
      segments: result.segments,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
