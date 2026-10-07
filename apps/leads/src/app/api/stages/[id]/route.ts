import { NextRequest, NextResponse } from "next/server";
import { getDb, getStage } from "@/lib/leads-db";
import { isNonEmptyString, readJson } from "@/lib/validate";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!getStage(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await readJson(req);
  if (!body) return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  const d = getDb();
  if (isNonEmptyString(body.name)) {
    d.prepare("UPDATE stages SET name = ? WHERE id = ?").run(body.name.trim(), id);
  }
  if (typeof body.sort === "number" && Number.isSafeInteger(body.sort)) {
    d.prepare("UPDATE stages SET sort = ? WHERE id = ?").run(body.sort, id);
  }
  if (body.rottingDays === null) {
    d.prepare("UPDATE stages SET rotting_days = NULL WHERE id = ?").run(id);
  } else if (
    typeof body.rottingDays === "number" &&
    Number.isSafeInteger(body.rottingDays) &&
    body.rottingDays > 0
  ) {
    d.prepare("UPDATE stages SET rotting_days = ? WHERE id = ?").run(body.rottingDays, id);
  }
  return NextResponse.json(getStage(id));
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!getStage(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const d = getDb();
  const leadCount = (
    d.prepare("SELECT COUNT(*) AS c FROM leads WHERE stage_id = ?").get(id) as { c: number }
  ).c;
  if (leadCount > 0) {
    return NextResponse.json({ error: "stage has leads; move them first" }, { status: 409 });
  }
  d.prepare("DELETE FROM stages WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
