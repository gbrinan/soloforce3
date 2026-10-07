import { NextRequest, NextResponse } from "next/server";
import { getDb, getPipeline, listStages, newId, type Stage } from "@/lib/leads-db";
import { isNonEmptyString, readJson } from "@/lib/validate";

export async function GET(req: NextRequest) {
  const pipelineId = req.nextUrl.searchParams.get("pipeline") ?? undefined;
  return NextResponse.json(listStages(pipelineId));
}

export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body) return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  if (!isNonEmptyString(body.pipelineId) || !isNonEmptyString(body.name)) {
    return NextResponse.json({ error: "pipelineId and name required" }, { status: 400 });
  }
  if (!getPipeline(body.pipelineId)) {
    return NextResponse.json({ error: "pipeline not found" }, { status: 404 });
  }
  const sort =
    typeof body.sort === "number" && Number.isSafeInteger(body.sort)
      ? body.sort
      : ((getDb()
          .prepare("SELECT COALESCE(MAX(sort), 0) AS m FROM stages WHERE pipeline_id = ?")
          .get(body.pipelineId) as { m: number }).m + 1);
  const rottingDays =
    typeof body.rottingDays === "number" && Number.isSafeInteger(body.rottingDays) && body.rottingDays > 0
      ? body.rottingDays
      : null;
  const stage: Stage = {
    id: newId(),
    pipeline_id: body.pipelineId,
    name: body.name.trim(),
    sort,
    rotting_days: rottingDays,
  };
  getDb()
    .prepare("INSERT INTO stages (id, pipeline_id, name, sort, rotting_days) VALUES (?, ?, ?, ?, ?)")
    .run(stage.id, stage.pipeline_id, stage.name, stage.sort, stage.rotting_days);
  return NextResponse.json(stage, { status: 201 });
}
