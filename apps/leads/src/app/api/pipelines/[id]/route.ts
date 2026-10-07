import { NextRequest, NextResponse } from "next/server";
import { getDb, getPipeline } from "@/lib/leads-db";
import { isNonEmptyString, readJson } from "@/lib/validate";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const pipeline = getPipeline(id);
  if (!pipeline) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(pipeline);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!getPipeline(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await readJson(req);
  if (!body) return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  const d = getDb();
  if (isNonEmptyString(body.name)) {
    d.prepare("UPDATE pipelines SET name = ? WHERE id = ?").run(body.name.trim(), id);
  }
  if (typeof body.product === "string") {
    d.prepare("UPDATE pipelines SET product = ? WHERE id = ?").run(body.product.trim(), id);
  }
  return NextResponse.json(getPipeline(id));
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!getPipeline(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  // ON DELETE CASCADE로 스테이지·리드·이벤트 함께 삭제.
  getDb().prepare("DELETE FROM pipelines WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
