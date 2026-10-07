import { NextRequest, NextResponse } from "next/server";
import { getDb, type Transaction } from "@/lib/finance-db";
import { isDateString, isKrwAmount, isNonEmptyString, readJson } from "@/lib/validate";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const db = getDb();
  const existing = db.prepare("SELECT * FROM transactions WHERE id = ?").get(id) as Transaction | undefined;
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await readJson(req);
  if (!body) return NextResponse.json({ error: "invalid JSON" }, { status: 400 });

  const next: Transaction = { ...existing };
  if (body.date !== undefined) {
    if (!isDateString(body.date)) return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
    next.date = body.date;
  }
  if (body.amount !== undefined) {
    if (!isKrwAmount(body.amount)) return NextResponse.json({ error: "amount must be an integer (KRW)" }, { status: 400 });
    next.amount = body.amount;
  }
  if (body.account_id !== undefined) {
    if (!isNonEmptyString(body.account_id) || !db.prepare("SELECT 1 FROM accounts WHERE id = ?").get(body.account_id)) {
      return NextResponse.json({ error: "unknown account_id" }, { status: 400 });
    }
    next.account_id = body.account_id;
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
  if (body.memo !== undefined) {
    if (typeof body.memo !== "string") return NextResponse.json({ error: "memo must be a string" }, { status: 400 });
    next.memo = body.memo.trim();
  }
  if (body.schedule_id !== undefined) {
    if (body.schedule_id === null) {
      next.schedule_id = null;
    } else if (
      typeof body.schedule_id !== "string" ||
      !db.prepare("SELECT 1 FROM schedules WHERE id = ?").get(body.schedule_id)
    ) {
      return NextResponse.json({ error: "unknown schedule_id" }, { status: 400 });
    } else {
      next.schedule_id = body.schedule_id;
    }
  }

  db.prepare(
    `UPDATE transactions SET date = ?, amount = ?, account_id = ?, category_id = ?, payee = ?, memo = ?, schedule_id = ?
     WHERE id = ?`,
  ).run(next.date, next.amount, next.account_id, next.category_id, next.payee, next.memo, next.schedule_id, id);
  return NextResponse.json(next);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const info = getDb().prepare("DELETE FROM transactions WHERE id = ?").run(id);
  if (info.changes === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
