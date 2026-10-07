import { NextRequest, NextResponse } from "next/server";
import { getDb, CATEGORY_KINDS, type Category, type CategoryKind } from "@/lib/finance-db";
import { isNonEmptyString, readJson } from "@/lib/validate";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const db = getDb();
  const existing = db.prepare("SELECT * FROM categories WHERE id = ?").get(id) as Category | undefined;
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await readJson(req);
  if (!body) return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  const name = body.name === undefined ? existing.name : body.name;
  const kind = body.kind === undefined ? existing.kind : body.kind;
  if (!isNonEmptyString(name)) {
    return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400 });
  }
  if (!CATEGORY_KINDS.includes(kind as CategoryKind)) {
    return NextResponse.json({ error: "kind must be income|fixed|variable|subscription" }, { status: 400 });
  }
  db.prepare("UPDATE categories SET name = ?, kind = ? WHERE id = ?").run(name.trim(), kind, id);
  return NextResponse.json({ id, name: name.trim(), kind });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const db = getDb();
  const usedTx = db.prepare("SELECT COUNT(*) AS c FROM transactions WHERE category_id = ?").get(id) as { c: number };
  const usedSch = db.prepare("SELECT COUNT(*) AS c FROM schedules WHERE category_id = ?").get(id) as { c: number };
  if (usedTx.c > 0 || usedSch.c > 0) {
    return NextResponse.json({ error: "category in use" }, { status: 409 });
  }
  const info = db.prepare("DELETE FROM categories WHERE id = ?").run(id);
  if (info.changes === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
