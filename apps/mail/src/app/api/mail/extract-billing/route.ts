import { NextRequest, NextResponse } from "next/server";
import {
  runClaude,
  extractJson,
  claudeErrorDetail,
  stripHtml,
} from "@/lib/claude-cli";

interface ExtractBillingRequest {
  subject: string;
  body: string;
}

// ledger(apps/ledger/server.mjs) DEFAULT_CATEGORIES 의 expense 카테고리 id 와 정합.
// 거래 생성 시 draft.category → ledger transaction.categoryId 로 그대로 매핑된다.
const LEDGER_CATEGORY_IDS = [
  "food", // 식비
  "cafe", // 카페·간식
  "alcohol", // 음주·유흥
  "transport", // 교통
  "shopping", // 쇼핑
  "housing", // 주거·통신
  "health", // 의료·건강
  "leisure", // 문화·여가
  "subscription", // 구독
  "education", // 교육
  "gift", // 경조·선물
  "utilities", // 공과금·세금
  "etc-expense", // 기타
] as const;

export interface BillingDraft {
  amount: number;
  merchant: string;
  date: string; // YYYY-MM-DD
  category: string; // LEDGER_CATEGORY_IDS 중 하나
  memo: string;
}

interface ExtractBillingResult {
  isBilling: boolean;
  draft?: BillingDraft;
}

function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function buildPrompt(req: ExtractBillingRequest, today: string): string {
  return [
    "아래 이메일이 청구서·영수증·결제·구독 청구 등 '지출 거래'로 볼 수 있는지 판단하고, 맞다면 가계부 거래 초안을 JSON으로만 답하세요. 다른 설명은 붙이지 마세요.",
    '청구성 메일이 아니면: {"isBilling": false}',
    '청구성 메일이면: {"isBilling": true, "draft": {"amount": 12000, "merchant": "가맹점/청구처", "date": "YYYY-MM-DD", "category": "카테고리ID", "memo": "간단 메모"}}',
    `- 오늘 날짜는 ${today}입니다. 결제일/청구일이 없거나 상대 날짜면 이 기준으로 절대 날짜(YYYY-MM-DD)로 변환하세요.`,
    "- amount 는 통화기호·콤마 없이 정수 숫자(원)로만. 금액을 못 찾으면 isBilling:false.",
    "- merchant 는 가맹점명 또는 청구 주체(예: 넷플릭스, 쿠팡, 한국전력).",
    `- category 는 반드시 다음 ID 중 하나: ${LEDGER_CATEGORY_IDS.join(", ")}. 애매하면 etc-expense.`,
    "- memo 는 무엇에 대한 청구인지 짧게(없으면 빈 문자열).",
    "",
    `제목: ${req.subject}`,
    `본문: ${stripHtml(req.body).slice(0, 3000)}`,
  ].join("\n");
}

export async function POST(request: NextRequest) {
  let body: ExtractBillingRequest;
  try {
    body = (await request.json()) as ExtractBillingRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.subject || !body.body) {
    return NextResponse.json(
      { error: "Missing required fields: subject, body" },
      { status: 400 },
    );
  }

  try {
    const raw = await runClaude(buildPrompt(body, todayISO()), {
      feature: "extract-billing",
    });
    const parsed = extractJson<Partial<ExtractBillingResult>>(raw);
    if (!parsed || typeof parsed.isBilling !== "boolean") {
      return NextResponse.json(
        { error: "Claude returned unparsable response" },
        { status: 502 },
      );
    }

    if (!parsed.isBilling || !parsed.draft) {
      return NextResponse.json({ isBilling: false } satisfies ExtractBillingResult);
    }

    const d = parsed.draft;
    const amount = Math.abs(Math.round(Number(d.amount)));
    if (!Number.isFinite(amount) || amount === 0) {
      return NextResponse.json({ isBilling: false } satisfies ExtractBillingResult);
    }
    const category =
      typeof d.category === "string" &&
      (LEDGER_CATEGORY_IDS as readonly string[]).includes(d.category)
        ? d.category
        : "etc-expense";
    const date =
      typeof d.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.date)
        ? d.date
        : todayISO();

    const draft: BillingDraft = {
      amount,
      merchant: typeof d.merchant === "string" ? d.merchant : "",
      date,
      category,
      memo: typeof d.memo === "string" ? d.memo : "",
    };
    return NextResponse.json({ isBilling: true, draft } satisfies ExtractBillingResult);
  } catch (err) {
    const detail = claudeErrorDetail(err);
    console.error("[extract-billing] claude exec error:", detail);
    return NextResponse.json(
      { error: "Failed to extract billing", detail },
      { status: 500 },
    );
  }
}
