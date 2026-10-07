import { NextRequest, NextResponse } from "next/server";
import { addEvent, getLead, listEvents } from "@/lib/leads-db";
import { isNonEmptyString, readJson } from "@/lib/validate";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!getLead(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(listEvents(id));
}

// POST /api/leads/[id]/events {body, type?} — 메모 추가 (기본 type: memo).
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!getLead(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const payload = await readJson(req);
  if (!payload || !isNonEmptyString(payload.body)) {
    return NextResponse.json({ error: "body required" }, { status: 400 });
  }
  const type = isNonEmptyString(payload.type) ? payload.type.trim() : "memo";
  return NextResponse.json(addEvent(id, type, payload.body.trim()), { status: 201 });
}
