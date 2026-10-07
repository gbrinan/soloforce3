import { NextRequest, NextResponse } from "next/server";
import { getDb, type Schedule } from "@/lib/finance-db";
import { isValidRule, nextOccurrence, toDateString } from "@/lib/rules";
import { isKrwAmount, isNonEmptyString, readJson } from "@/lib/validate";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const db = getDb();
  const existing = db.prepare("SELECT * FROM schedules WHERE id = ?").get(id) as Schedule | undefined;
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await readJson(req);
  if (!body) return NextResponse.json({ error: "invalid JSON" }, { status: 400 });

  const next: Schedule = { ...existing };
  if (body.name !== undefined) {
    if (!isNonEmptyString(body.name)) return NextResponse.json({ error: "name must be non-empty" }, { status: 400 });
    next.name = body.name.trim();
  }
  if (body.rule !== undefined) {
    if (!isNonEmptyString(body.rule) || !isValidRule(body.rule)) {
      return NextResponse.json({ error: "rule must be monthly:D | yearly:MM-DD | weekly:mon..sun" }, { status: 400 });
    }
    next.rule = body.rule;
    next.next_date = toDateString(nextOccurrence(body.rule, new Date()));
  }
  if (body.amount !== undefined) {
    if (!isKrwAmount(body.amount)) return NextResponse.json({ error: "amount must be an integer (KRW)" }, { status: 400 });
    next.amount = body.amount;
  }
  if (body.category_id !== undefined) {
    if (!isNonEmptyString(body.category_id) || !db.prepare("SELECT 1 FROM categories WHERE id = ?").get(body.category_id)) {
      return NextResponse.json({ error: "unknown category_id" }, { status: 400 });
    }
    next.category_id = body.category_id;
  }
  if (body.payee !== undefined) {
    if (typeof body.payee !== "string") return NextResponse.json({ error: "payee must be a string" }, { status: 400 });
    next.payee = body.payee.trim();
  }
  if (body.active !== undefined) {
    if (typeof body.active !== "boolean" && body.active !== 0 && body.active !== 1) {
      return NextResponse.json({ error: "active must be boolean" }, { status: 400 });
    }
    next.active = body.active === true || body.active === 1 ? 1 : 0;
  }

  db.prepare(
    `UPDATE schedules SET name = ?, rule = ?, amount = ?, category_id = ?, payee = ?, next_date = ?, active = ?
     WHERE id = ?`,
  ).run(next.name, next.rule, next.amount, next.category_id, next.payee, next.next_date, next.active, id);
  return NextResponse.json(next);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const db = getDb();
  // 연결된 거래의 schedule_id는 남기지 않고 해제 후 삭제.
  db.prepare("UPDATE transactions SET schedule_id = NULL WHERE schedule_id = ?").run(id);
  const info = db.prepare("DELETE FROM schedules WHERE id = ?").run(id);
  if (info.changes === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
