import { NextRequest, NextResponse } from "next/server";
import { createLead, getPipeline, getStage, addEvent, listLeads } from "@/lib/leads-db";
import { isKrwAmount, isDateString, isLeadSource, isNonEmptyString, readJson } from "@/lib/validate";

// GET /api/leads?pipeline=id — rotting 계산 포함.
export async function GET(req: NextRequest) {
  const pipelineId = req.nextUrl.searchParams.get("pipeline") ?? undefined;
  return NextResponse.json(listLeads(pipelineId));
}

export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body) return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  if (!isNonEmptyString(body.title)) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }
  if (!isLeadSource(body.source)) {
    return NextResponse.json({ error: "source must be website|sns|email|manual|agent" }, { status: 400 });
  }
  if (!isNonEmptyString(body.pipelineId) || !isNonEmptyString(body.stageId)) {
    return NextResponse.json({ error: "pipelineId and stageId required" }, { status: 400 });
  }
  if (!getPipeline(body.pipelineId)) {
    return NextResponse.json({ error: "pipeline not found" }, { status: 404 });
  }
  const stage = getStage(body.stageId);
  if (!stage || stage.pipeline_id !== body.pipelineId) {
    return NextResponse.json({ error: "stage not found in pipeline" }, { status: 400 });
  }
  if (body.value_krw !== undefined && !isKrwAmount(body.value_krw)) {
    return NextResponse.json({ error: "value_krw must be a non-negative integer" }, { status: 400 });
  }
  if (body.next_action_date !== undefined && body.next_action_date !== null && !isDateString(body.next_action_date)) {
    return NextResponse.json({ error: "next_action_date must be YYYY-MM-DD" }, { status: 400 });
  }
  const lead = createLead({
    pipeline_id: body.pipelineId,
    stage_id: body.stageId,
    title: body.title.trim(),
    contact_name: typeof body.contact_name === "string" ? body.contact_name.trim() : undefined,
    contact_channel: typeof body.contact_channel === "string" ? body.contact_channel.trim() : undefined,
    source: body.source,
    value_krw: typeof body.value_krw === "number" ? body.value_krw : undefined,
    memo: typeof body.memo === "string" ? body.memo : undefined,
    next_action: typeof body.next_action === "string" ? body.next_action.trim() : undefined,
    next_action_date: typeof body.next_action_date === "string" ? body.next_action_date : null,
  });
  addEvent(lead.id, "created", `리드 생성 (source: ${lead.source})`);
  return NextResponse.json(lead, { status: 201 });
}
