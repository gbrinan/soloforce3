import { NextResponse } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createJob, updateJob } from "@/lib/ingest/jobs";
import { transcodeProxy } from "@/lib/ingest/ffmpeg";
import { uploadsDir } from "@/lib/core/paths";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const UPLOADS_DIR = uploadsDir();
const ALLOWED_EXT = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm"]);
const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2GB

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `multipart parse 실패: ${(err as Error).message}` },
      { status: 400 },
    );
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "file 필드가 없습니다" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "파일 크기는 2GB 이하여야 합니다" }, { status: 400 });
  }
  const ext = (file.name.match(/\.[^.]+$/)?.[0] ?? "").toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    return NextResponse.json(
      { ok: false, error: `지원하지 않는 포맷입니다 (허용: ${Array.from(ALLOWED_EXT).join(", ")})` },
      { status: 400 },
    );
  }

  const job = createJob({ kind: "upload", filename: file.name });
  try {
    await mkdir(UPLOADS_DIR, { recursive: true });
  } catch {}
  const savedPath = resolve(UPLOADS_DIR, `${job.id}${ext}`);
  const buf = Buffer.from(await file.arrayBuffer());
  await writeFile(savedPath, buf);
  updateJob(job.id, { stage: "transcoding", progress: 0, outputPath: savedPath });

  // 백그라운드 트랜스코드 진행. 클라이언트는 jobs/[id] 폴링.
  void (async () => {
    const tr = await transcodeProxy(savedPath, (p) => {
      updateJob(job.id, { progress: p.percent });
    });
    if (!tr.ok || !tr.proxyPath) {
      updateJob(job.id, { stage: "error", message: tr.error ?? "ffmpeg 실패" });
      return;
    }
    updateJob(job.id, { stage: "done", progress: 100, proxyPath: tr.proxyPath });
  })().catch((err) => {
    updateJob(job.id, { stage: "error", message: `unexpected: ${(err as Error).message}` });
  });

  return NextResponse.json({ ok: true, jobId: job.id });
}
