import { NextRequest, NextResponse } from "next/server";
import { getDb, type CategoryKind, type Schedule } from "@/lib/finance-db";
import { occurrencesInMonth, toDateString } from "@/lib/rules";
import { isMonthString } from "@/lib/validate";

interface UnconfirmedSubscription {
  schedule_id: string;
  name: string;
  payee: string;
  amount: number;
  expected_date: string;
}

// 월간 정산 요약 + 구독 트래커 (Firefly Bill 패턴: 예상 결제일이 지났는데
// 해당 월에 연결 거래가 없으면 "미확인" 구독으로 표시).
export async function GET(req: NextRequest) {
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const month = req.nextUrl.searchParams.get("month") ?? defaultMonth;
  if (!isMonthString(month)) {
    return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  }

  const db = getDb();
  const sums = db
    .prepare(
      `SELECT c.kind AS kind, COALESCE(SUM(t.amount), 0) AS total
       FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE t.date LIKE ? GROUP BY c.kind`,
    )
    .all(`${month}-%`) as Array<{ kind: CategoryKind; total: number }>;

  const byKind: Record<CategoryKind, number> = { income: 0, fixed: 0, variable: 0, subscription: 0 };
  for (const row of sums) byKind[row.kind] = row.total;

  // 미확인 구독: subscription kind의 활성 스케줄 중, 이 달의 예상일이 오늘 이전인데
  // 연결(schedule_id) 거래가 이 달에 없는 것.
  const today = toDateString(now);
  const schedules = db
    .prepare(
      `SELECT s.* FROM schedules s JOIN categories c ON c.id = s.category_id
       WHERE s.active = 1 AND c.kind = 'subscription'`,
    )
    .all() as Schedule[];

  const unconfirmed: UnconfirmedSubscription[] = [];
  for (const s of schedules) {
    const occurrences = occurrencesInMonth(s.rule, month);
    for (const occ of occurrences) {
      const expected = toDateString(occ);
      if (expected > today) continue; // 아직 예정일이 안 지남
      const linked = db
        .prepare("SELECT 1 FROM transactions WHERE schedule_id = ? AND date LIKE ? LIMIT 1")
        .get(s.id, `${month}-%`);
      if (!linked) {
        unconfirmed.push({
          schedule_id: s.id,
          name: s.name,
          payee: s.payee,
          amount: s.amount,
          expected_date: expected,
        });
        break; // 스케줄당 1건만 보고
      }
    }
  }

  return NextResponse.json({
    month,
    income: byKind.income,
    fixed: byKind.fixed,
    variable: byKind.variable,
    subscription: byKind.subscription,
    net: byKind.income - byKind.fixed - byKind.variable - byKind.subscription,
    unconfirmedSubscriptions: unconfirmed,
  });
}
