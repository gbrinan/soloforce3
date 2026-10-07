import { NextResponse } from "next/server";
import { getJob } from "@/lib/ingest/jobs";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ ok: false, error: "job not found" }, { status: 404 });
  }

  // 보안: proxyPath/outputPath 절대경로를 클라이언트에 노출하지 않고, URL로만 제공.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { proxyPath, outputPath, ...safeJob } = job;
  const jobWithUrl = {
    ...safeJob,
    proxyUrl: job.proxyPath ? `/api/ingest/source/${id}` : null,
  };

  return NextResponse.json({ ok: true, job: jobWithUrl });
}
