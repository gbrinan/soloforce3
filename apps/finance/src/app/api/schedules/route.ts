import { NextRequest, NextResponse } from "next/server";
import { getDb, newId, type Schedule } from "@/lib/finance-db";
import { isValidRule, nextOccurrence, toDateString } from "@/lib/rules";
import { isKrwAmount, isNonEmptyString, readJson } from "@/lib/validate";

export async function GET() {
  const rows = getDb().prepare("SELECT * FROM schedules ORDER BY next_date, name").all() as Schedule[];
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body) return NextResponse.json({ error: "invalid JSON" }, { status: 400 });

  if (!isNonEmptyString(body.name)) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  if (!isNonEmptyString(body.rule) || !isValidRule(body.rule)) {
    return NextResponse.json(
      { error: "rule must be monthly:D | yearly:MM-DD | weekly:mon..sun" },
      { status: 400 },
    );
  }
  if (!isKrwAmount(body.amount)) {
    return NextResponse.json({ error: "amount must be an integer (KRW)" }, { status: 400 });
  }
  const db = getDb();
  if (!isNonEmptyString(body.category_id) || !db.prepare("SELECT 1 FROM categories WHERE id = ?").get(body.category_id)) {
    return NextResponse.json({ error: "unknown category_id" }, { status: 400 });
  }

  const schedule: Schedule = {
    id: newId(),
    name: body.name.trim(),
    rule: body.rule,
    amount: body.amount,
    category_id: body.category_id,
    payee: typeof body.payee === "string" ? body.payee.trim() : "",
    next_date: toDateString(nextOccurrence(body.rule, new Date())),
    active: body.active === false ? 0 : 1,
  };
  db.prepare(
    `INSERT INTO schedules (id, name, rule, amount, category_id, payee, next_date, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    schedule.id,
    schedule.name,
    schedule.rule,
    schedule.amount,
    schedule.category_id,
    schedule.payee,
    schedule.next_date,
    schedule.active,
  );
  return NextResponse.json(schedule, { status: 201 });
}
