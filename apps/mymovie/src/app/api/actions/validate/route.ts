// POST /api/actions/validate
// 액션 스키마·범위 검증 헬퍼 — ffmpeg 실행 없이 검증만 수행.
// UI undo/타임라인 편집 시 즉각 피드백용. 렌더 트리거 없음.
//
// 보안: 입력은 jobId + actions 만 받음(임의 경로 주입 차단). inputPath는 jobs 레지스트리의 proxyPath/outputPath만 사용.

import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { getJob } from "@/lib/ingest/jobs";
import { validateActions } from "@/lib/core/action-validator";
import type { Action, Footage } from "@/lib/core/action-types";
import { probe } from "@/lib/ingest/ffmpeg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ValidateBody {
  jobId?: unknown;
  actions?: unknown;
}

export async function POST(req: Request) {
  let body: ValidateBody = {};
  try {
    body = (await req.json()) as ValidateBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON body" },
      { status: 400 },
    );
  }

  if (typeof body.jobId !== "string" || body.jobId.length === 0) {
    return NextResponse.json(
      { ok: false, error: "jobId required (string)" },
      { status: 400 },
    );
  }
  if (!Array.isArray(body.actions)) {
    return NextResponse.json(
      { ok: false, error: "actions must be an array" },
      { status: 400 },
    );
  }

  const job = getJob(body.jobId);
  if (!job) {
    return NextResponse.json(
      { ok: false, error: "job not found" },
      { status: 404 },
    );
  }
  const inputPath = job.proxyPath ?? job.outputPath;
  if (!inputPath || !existsSync(inputPath)) {
    return NextResponse.json(
      { ok: false, error: "job has no usable inputPath" },
      { status: 409 },
    );
  }

  const meta = await probe(inputPath);
  const footage: Footage = {
    id: body.jobId,
    path: inputPath,
    durationMs: meta?.durationMs ?? 0,
    width: meta?.width ?? 0,
    height: meta?.height ?? 0,
  };

  const validation = validateActions(body.actions as Action[], footage);
  return NextResponse.json({ ok: validation.ok, validation });
}
