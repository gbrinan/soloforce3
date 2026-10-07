import { NextRequest, NextResponse } from "next/server";
import {
  runClaude,
  extractJson,
  claudeErrorDetail,
  stripHtml,
} from "@/lib/claude-cli";
import type { MailImportance, MailLabel } from "@/types/mail";

interface ClassifyRequest {
  subject: string;
  from: string;
  body?: string;
  // Optional raw header hint (e.g. from an inbound worker); UI callers omit it.
  listUnsubscribe?: boolean;
}

interface ClassifyResult {
  label: MailLabel;
  importance: MailImportance;
  source: "rule" | "claude" | "fallback";
}

// Rule dictionaries — Korean first, English secondary
// (pattern style referenced from server external-classifier, no import).
const NEWSLETTER_FROM = /(no-?reply|newsletter|news|mailer|marketing|notify|notifications?|updates?|info|digest)@/i;
const NEWSLETTER_KW = [
  "unsubscribe", "구독 취소", "구독취소", "수신거부", "수신 거부", "뉴스레터", "newsletter",
];
const BILLING_KW = [
  "결제", "청구", "인보이스", "영수증", "구독료", "요금", "납부", "청구서", "결제 내역",
  "invoice", "billing", "payment", "receipt", "subscription renew",
];
const DEADLINE_KW = [
  "기한", "마감", "까지 회신", "까지 답변", "회신 부탁", "회신 요청", "답변 부탁", "답장 부탁",
  "확인 부탁", "회신 바랍니다", "deadline", "please reply", "please respond", "respond by",
  "reply by", "rsvp", "asap",
];
const QUESTION_KW = [
  "가능한가요", "가능할까요", "되나요", "있나요", "어떻게", "언제", "어떤가요",
  "할까요", "괜찮으신가요", "괜찮을까요", "문의드립니다",
];

function containsAny(haystack: string, needles: string[]): boolean {
  const h = haystack.toLowerCase();
  return needles.some((n) => h.includes(n.toLowerCase()));
}

function classifyByRules(req: ClassifyRequest, text: string): ClassifyResult | null {
  const haystack = `${req.subject}\n${text}`;

  // Billing wins over newsletter: receipts often come from noreply@ senders.
  if (containsAny(haystack, BILLING_KW)) {
    return { label: "billing", importance: "high", source: "rule" };
  }

  if (
    req.listUnsubscribe === true ||
    NEWSLETTER_FROM.test(req.from) ||
    containsAny(haystack, NEWSLETTER_KW)
  ) {
    return { label: "newsletter", importance: "low", source: "rule" };
  }

  const hasQuestion = /[?？]/.test(haystack) && containsAny(haystack, QUESTION_KW);
  if (hasQuestion || containsAny(haystack, DEADLINE_KW)) {
    return { label: "reply-needed", importance: "high", source: "rule" };
  }

  return null;
}

function buildPrompt(req: ClassifyRequest, text: string): string {
  return [
    "아래 이메일을 분류해서 JSON으로만 답하세요. 다른 설명은 붙이지 마세요.",
    '형식: {"label": "newsletter"|"billing"|"reply-needed"|"normal", "importance": "high"|"normal"|"low"}',
    "- newsletter: 뉴스레터·홍보·자동 발송 메일",
    "- billing: 결제·청구·영수증 관련",
    "- reply-needed: 수신자의 답장이 필요한 메일",
    "- normal: 그 외",
    "",
    `발신자: ${req.from}`,
    `제목: ${req.subject}`,
    `본문: ${text.slice(0, 2000)}`,
  ].join("\n");
}

const LABELS: MailLabel[] = ["newsletter", "billing", "reply-needed", "normal"];
const IMPORTANCES: MailImportance[] = ["high", "normal", "low"];

export async function POST(request: NextRequest) {
  let body: ClassifyRequest;
  try {
    body = (await request.json()) as ClassifyRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.subject || !body.from) {
    return NextResponse.json(
      { error: "Missing required fields: subject, from" },
      { status: 400 },
    );
  }

  const text = stripHtml(body.body ?? "");

  // Pass 1: rule-based (no LLM call)
  const ruled = classifyByRules(body, text);
  if (ruled) return NextResponse.json(ruled);

  // Pass 2: Claude CLI fallback
  try {
    const raw = await runClaude(buildPrompt(body, text));
    const parsed = extractJson<{ label?: string; importance?: string }>(raw);
    const label = LABELS.includes(parsed?.label as MailLabel)
      ? (parsed?.label as MailLabel)
      : "normal";
    const importance = IMPORTANCES.includes(parsed?.importance as MailImportance)
      ? (parsed?.importance as MailImportance)
      : "normal";
    const result: ClassifyResult = { label, importance, source: "claude" };
    return NextResponse.json(result);
  } catch (err) {
    // Classification is best-effort: degrade to normal instead of erroring.
    console.error("[classify] claude exec error:", claudeErrorDetail(err));
    const result: ClassifyResult = { label: "normal", importance: "normal", source: "fallback" };
    return NextResponse.json(result);
  }
}
