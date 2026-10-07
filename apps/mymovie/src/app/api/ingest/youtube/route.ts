import { NextResponse } from "next/server";
import { createJob, updateJob } from "@/lib/ingest/jobs";
import { downloadYoutube } from "@/lib/ingest/ytdlp";
import { transcodeProxy } from "@/lib/ingest/ffmpeg";

export const dynamic = "force-dynamic";
export const maxDuration = 600; // 10분 — yt-dlp 큰 영상 대비

interface Body {
  url?: string;
  acknowledgeRights?: boolean;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  const url = (body.url ?? "").trim();
  if (!url) {
    return NextResponse.json({ ok: false, error: "url 필수" }, { status: 400 });
  }
  if (!body.acknowledgeRights) {
    return NextResponse.json(
      { ok: false, error: "사용자 본인 콘텐츠/권리 보유분 확인이 필요합니다 (acknowledgeRights)" },
      { status: 400 },
    );
  }

  const job = createJob({ kind: "youtube", url });

  // fire-and-forget — 백그라운드 다운로드+트랜스코드. 클라이언트는 jobs/[id] 폴링.
  void (async () => {
    updateJob(job.id, { stage: "downloading", progress: 0 });
    const dl = await downloadYoutube(url, job.id, (p) => {
      updateJob(job.id, { progress: Math.min(50, p.percent / 2) }); // 0..50: 다운로드
    });
    if (!dl.ok || !dl.outputPath) {
      updateJob(job.id, { stage: "error", message: dl.error ?? "yt-dlp 실패" });
      return;
    }
    updateJob(job.id, {
      stage: "transcoding",
      progress: 50,
      outputPath: dl.outputPath,
    });
    const tr = await transcodeProxy(dl.outputPath, (p) => {
      updateJob(job.id, { progress: 50 + p.percent / 2 }); // 50..100: 트랜스코드
    });
    if (!tr.ok || !tr.proxyPath) {
      updateJob(job.id, { stage: "error", message: tr.error ?? "ffmpeg 실패" });
      return;
    }
    updateJob(job.id, {
      stage: "done",
      progress: 100,
      proxyPath: tr.proxyPath,
    });
  })().catch((err) => {
    updateJob(job.id, { stage: "error", message: `unexpected: ${(err as Error).message}` });
  });

  return NextResponse.json({ ok: true, jobId: job.id });
}
