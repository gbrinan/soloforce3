// GET /api/projects        → 저장된 프로젝트 목록 요약
// GET /api/projects?id=... → 단일 프로젝트 전체 (job + actions + clips)

import { NextResponse } from "next/server";
import { listProjects, loadProject } from "@/lib/core/project-store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (id) {
    const project = loadProject(id);
    if (!project) {
      return NextResponse.json({ ok: false, error: "project not found" }, { status: 404 });
    }
    // 보안: 디스크 절대경로를 노출하지 않는다.
    const { proxyPath: _p, outputPath: _o, ...safeJob } = project.job as unknown as Record<
      string,
      unknown
    >;
    void _p;
    void _o;
    return NextResponse.json({
      ok: true,
      project: {
        job: { ...safeJob, proxyUrl: project.job.proxyPath ? `/api/ingest/source/${id}` : null },
        actions: project.actions,
        clips: project.clips,
        updatedAt: project.updatedAt,
      },
    });
  }

  return NextResponse.json({ ok: true, projects: listProjects() });
}
