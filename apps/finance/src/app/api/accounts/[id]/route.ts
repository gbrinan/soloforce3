import { NextRequest, NextResponse } from "next/server";
import { getDb, type Account } from "@/lib/finance-db";
import { isNonEmptyString, readJson } from "@/lib/validate";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const db = getDb();
  const existing = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as Account | undefined;
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await readJson(req);
  if (!body) return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  const name = body.name === undefined ? existing.name : body.name;
  const type = body.type === undefined ? existing.type : body.type;
  if (!isNonEmptyString(name) || !isNonEmptyString(type)) {
    return NextResponse.json({ error: "name and type must be non-empty strings" }, { status: 400 });
  }
  db.prepare("UPDATE accounts SET name = ?, type = ? WHERE id = ?").run(name.trim(), type.trim(), id);
  return NextResponse.json({ ...existing, name: name.trim(), type: type.trim() });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const db = getDb();
  const used = db.prepare("SELECT COUNT(*) AS c FROM transactions WHERE account_id = ?").get(id) as { c: number };
  if (used.c > 0) {
    return NextResponse.json({ error: "account has transactions" }, { status: 409 });
  }
  const info = db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
  if (info.changes === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
