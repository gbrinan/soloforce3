// POST /api/director/run
// Body: { jobId: string, intent?: string, prefer?: "auto"|"claude-cli"|"local-oss", skipTranscribe?: boolean }
// → Director 파이프라인 1회 실행 → Action[] + 디스패치 결과 반환.
//
// 보안: 입력은 ingest 단계에서 생성된 jobId만 받음. inputPath/proxyPath는 jobs 레지스트리에서만 읽음
// (임의 경로 주입 차단).

import { NextResponse } from "next/server";
import { getJob } from "@/lib/ingest/jobs";
import { runDirector } from "@/lib/director/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600; // 10분 — 긴 영상 요약 생성(LLM 디렉터) 대비

interface RunBody {
  jobId?: string;
  intent?: string;
  prefer?: "auto" | "claude-cli" | "local-oss";
  skipTranscribe?: boolean;
}

export async function POST(req: Request) {
  let body: RunBody;
  try {
    body = (await req.json()) as RunBody;
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
  const inputPath = job.proxyPath; // 프록시 우선 — 편집은 저해상도로.

  try {
    const result = await runDirector({
      inputPath,
      intent: body.intent,
      prefer: body.prefer ?? "auto",
      skipTranscribe: body.skipTranscribe ?? true, // 기본 true: 유료 STT 차단 안전 기본값.
    });
    return NextResponse.json({ ok: result.ok, result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
