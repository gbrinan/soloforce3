import { NextRequest, NextResponse } from "next/server";
import { getDb, newId, type Transaction } from "@/lib/finance-db";
import { isDateString, isKrwAmount, isMonthString, isNonEmptyString, readJson } from "@/lib/validate";

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get("month");
  const db = getDb();
  if (month !== null) {
    if (!isMonthString(month)) {
      return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
    }
    const rows = db
      .prepare("SELECT * FROM transactions WHERE date LIKE ? ORDER BY date DESC, id")
      .all(`${month}-%`) as Transaction[];
    return NextResponse.json(rows);
  }
  const rows = db.prepare("SELECT * FROM transactions ORDER BY date DESC, id LIMIT 500").all() as Transaction[];
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body) return NextResponse.json({ error: "invalid JSON" }, { status: 400 });

  if (!isDateString(body.date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }
  if (!isKrwAmount(body.amount)) {
    return NextResponse.json({ error: "amount must be an integer (KRW)" }, { status: 400 });
  }
  if (!isNonEmptyString(body.account_id) || !isNonEmptyString(body.category_id)) {
    return NextResponse.json({ error: "account_id and category_id required" }, { status: 400 });
  }
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM accounts WHERE id = ?").get(body.account_id)) {
    return NextResponse.json({ error: "unknown account_id" }, { status: 400 });
  }
  if (!db.prepare("SELECT 1 FROM categories WHERE id = ?").get(body.category_id)) {
    return NextResponse.json({ error: "unknown category_id" }, { status: 400 });
  }
  const scheduleId = body.schedule_id ?? null;
  if (scheduleId !== null) {
    if (typeof scheduleId !== "string" || !db.prepare("SELECT 1 FROM schedules WHERE id = ?").get(scheduleId)) {
      return NextResponse.json({ error: "unknown schedule_id" }, { status: 400 });
    }
  }
  const tx: Transaction = {
    id: newId(),
    date: body.date,
    amount: body.amount,
    account_id: body.account_id,
    category_id: body.category_id,
    payee: typeof body.payee === "string" ? body.payee.trim() : "",
    memo: typeof body.memo === "string" ? body.memo.trim() : "",
    schedule_id: scheduleId as string | null,
  };
  db.prepare(
    `INSERT INTO transactions (id, date, amount, account_id, category_id, payee, memo, schedule_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(tx.id, tx.date, tx.amount, tx.account_id, tx.category_id, tx.payee, tx.memo, tx.schedule_id);
  return NextResponse.json(tx, { status: 201 });
}
