import { NextRequest, NextResponse } from "next/server";
import { getLead, getStage, moveLeadStage } from "@/lib/leads-db";
import { isNonEmptyString, readJson } from "@/lib/validate";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/leads/[id]/stage {stageId} — stage_changed_at 갱신 + stage_change 이벤트.
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const lead = getLead(id);
  if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await readJson(req);
  if (!body || !isNonEmptyString(body.stageId)) {
    return NextResponse.json({ error: "stageId required" }, { status: 400 });
  }
  const stage = getStage(body.stageId);
  if (!stage) return NextResponse.json({ error: "stage not found" }, { status: 404 });
  if (stage.pipeline_id !== lead.pipeline_id) {
    return NextResponse.json({ error: "stage belongs to another pipeline" }, { status: 400 });
  }
  return NextResponse.json(moveLeadStage(id, body.stageId));
}
