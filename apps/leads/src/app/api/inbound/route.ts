import { NextRequest, NextResponse } from "next/server";
import { captureInbound } from "@/lib/leads-db";
import { isLeadSource, isNonEmptyString, readJson } from "@/lib/validate";

// POST /api/inbound — 공개 캡처 웹훅 (Krayin/EspoCRM 패턴).
// {title, contactName?, contactChannel?, source, pipelineId?, memo?}
// 파이프라인 미지정 시 기본 파이프라인의 첫 스테이지로 리드 생성 + inbound 이벤트.
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body) return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  if (!isNonEmptyString(body.title)) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }
  if (!isLeadSource(body.source)) {
    return NextResponse.json({ error: "source must be website|sns|email|manual|agent" }, { status: 400 });
  }
  try {
    const lead = captureInbound({
      title: body.title.trim(),
      contactName: typeof body.contactName === "string" ? body.contactName.trim() : undefined,
      contactChannel: typeof body.contactChannel === "string" ? body.contactChannel.trim() : undefined,
      source: body.source,
      pipelineId: isNonEmptyString(body.pipelineId) ? body.pipelineId : undefined,
      memo: typeof body.memo === "string" ? body.memo : undefined,
    });
    return NextResponse.json(lead, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "capture failed";
    const status = msg === "pipeline not found" ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
