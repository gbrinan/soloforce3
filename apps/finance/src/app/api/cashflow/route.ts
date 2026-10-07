import { NextRequest, NextResponse } from "next/server";
import { getDb, type CategoryKind, type Schedule } from "@/lib/finance-db";
import { occurrencesInMonth } from "@/lib/rules";

interface MonthFlow {
  month: string; // YYYY-MM
  income: number;
  expense: number;
  net: number;
  projected: boolean;
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// 현금흐름: 과거 N개월 실적(SUM by month) + 향후 3개월 전망(schedules 가상 전개).
export async function GET(req: NextRequest) {
  const monthsParam = req.nextUrl.searchParams.get("months") ?? "6";
  const months = Number(monthsParam);
  if (!Number.isInteger(months) || months < 1 || months > 24) {
    return NextResponse.json({ error: "months must be an integer 1-24" }, { status: 400 });
  }

  const db = getDb();
  const now = new Date();
  const out: MonthFlow[] = [];

  // 실적: 이번 달 포함 과거 months개월
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = monthKey(d);
    const rows = db
      .prepare(
        `SELECT c.kind AS kind, COALESCE(SUM(t.amount), 0) AS total
         FROM transactions t JOIN categories c ON c.id = t.category_id
         WHERE t.date LIKE ? GROUP BY c.kind`,
      )
      .all(`${key}-%`) as Array<{ kind: CategoryKind; total: number }>;
    let income = 0;
    let expense = 0;
    for (const r of rows) {
      if (r.kind === "income") income += r.total;
      else expense += r.total;
    }
    out.push({ month: key, income, expense, net: income - expense, projected: false });
  }

  // 전망: 다음 3개월 — 활성 스케줄을 규칙대로 가상 전개
  const schedules = db
    .prepare(
      `SELECT s.*, c.kind AS kind FROM schedules s JOIN categories c ON c.id = s.category_id
       WHERE s.active = 1`,
    )
    .all() as Array<Schedule & { kind: CategoryKind }>;

  for (let i = 1; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const key = monthKey(d);
    let income = 0;
    let expense = 0;
    for (const s of schedules) {
      const count = occurrencesInMonth(s.rule, key).length;
      if (count === 0) continue;
      if (s.kind === "income") income += s.amount * count;
      else expense += s.amount * count;
    }
    out.push({ month: key, income, expense, net: income - expense, projected: true });
  }

  return NextResponse.json(out);
}
