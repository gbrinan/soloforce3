import { NextRequest, NextResponse } from "next/server";
import { getDb, getLead, getStage, isRotting, listEvents } from "@/lib/leads-db";
import { isKrwAmount, isDateString, isNonEmptyString, readJson } from "@/lib/validate";

type Params = { params: Promise<{ id: string }> };

// GET /api/leads/[id] — 상세 (rotting + 타임라인 포함).
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const lead = getLead(id);
  if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });
  const stage = getStage(lead.stage_id);
  return NextResponse.json({ ...lead, rotting: isRotting(lead, stage), events: listEvents(id) });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!getLead(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await readJson(req);
  if (!body) return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  const d = getDb();
  if (isNonEmptyString(body.title)) {
    d.prepare("UPDATE leads SET title = ? WHERE id = ?").run(body.title.trim(), id);
  }
  if (typeof body.contact_name === "string") {
    d.prepare("UPDATE leads SET contact_name = ? WHERE id = ?").run(body.contact_name.trim(), id);
  }
  if (typeof body.contact_channel === "string") {
    d.prepare("UPDATE leads SET contact_channel = ? WHERE id = ?").run(body.contact_channel.trim(), id);
  }
  if (isKrwAmount(body.value_krw)) {
    d.prepare("UPDATE leads SET value_krw = ? WHERE id = ?").run(body.value_krw, id);
  }
  if (typeof body.memo === "string") {
    d.prepare("UPDATE leads SET memo = ? WHERE id = ?").run(body.memo, id);
  }
  if (typeof body.next_action === "string") {
    d.prepare("UPDATE leads SET next_action = ? WHERE id = ?").run(body.next_action.trim(), id);
  }
  if (body.next_action_date === null) {
    d.prepare("UPDATE leads SET next_action_date = NULL WHERE id = ?").run(id);
  } else if (isDateString(body.next_action_date)) {
    d.prepare("UPDATE leads SET next_action_date = ? WHERE id = ?").run(body.next_action_date, id);
  }
  return NextResponse.json(getLead(id));
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!getLead(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  getDb().prepare("DELETE FROM leads WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
