import { NextRequest, NextResponse } from "next/server";
import { runClaude, extractJson, claudeErrorDetail } from "@/lib/claude-cli";

type DraftType = "휴가" | "경비" | "기타";

interface DraftBody {
  type?: string;
  hints?: string;
}

interface DraftFields {
  leaveType?: string;
  startDate?: string;
  endDate?: string;
  days?: number;
  vendor?: string;
  amount?: number;
  category?: string;
  reason?: string;
}

const LEAVE_TYPES = ["연차", "반차(오전)", "반차(오후)", "병가", "특별휴가"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Accept both the spec's Korean labels and the app's internal workflow types.
function normalizeType(raw?: string): DraftType | null {
  if (raw === "휴가" || raw === "vacation") return "휴가";
  if (raw === "경비" || raw === "expense") return "경비";
  if (raw === "기타" || raw === "purchase") return "기타";
  return null;
}

function buildPrompt(type: DraftType, hints: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const common = [
    "당신은 사내 전자결재 문서 작성 도우미입니다.",
    "아래 메모를 바탕으로 한국어 결재 문서 초안을 작성하세요.",
    `오늘 날짜: ${today}`,
    "[메모]",
    hints || "(없음 — 일반적인 초안을 작성)",
    "",
    "출력 규칙: 아래 JSON 형식만 출력하세요. 코드펜스나 다른 설명을 붙이지 마세요.",
  ];
  if (type === "휴가") {
    return [
      ...common,
      `{"leaveType":"${LEAVE_TYPES.join(" | ")} 중 하나","startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD","days":신청일수(숫자),"reason":"정중한 신청 사유 2~3문장"}`,
    ].join("\n");
  }
  const label = type === "경비" ? "지출 결재" : "품의(구매·계약·도입)";
  const categoryHint = type === "경비" ? "식대, 교통비, 운영비" : "장비 구매, 계약, SaaS 도입";
  return [
    ...common,
    `문서 유형: ${label}`,
    `{"vendor":"거래처 또는 사용처","category":"구분(예: ${categoryHint})","amount":금액(숫자, 원 단위),"reason":"정중한 결재 사유 2~3문장"}`,
  ].join("\n");
}

// Keep only fields that match the form schema; drop anything malformed.
function sanitize(type: DraftType, raw: DraftFields): DraftFields {
  const out: DraftFields = {};
  if (typeof raw.reason === "string" && raw.reason.trim()) out.reason = raw.reason.trim();
  if (type === "휴가") {
    if (typeof raw.leaveType === "string" && LEAVE_TYPES.includes(raw.leaveType)) out.leaveType = raw.leaveType;
    if (typeof raw.startDate === "string" && DATE_RE.test(raw.startDate)) out.startDate = raw.startDate;
    if (typeof raw.endDate === "string" && DATE_RE.test(raw.endDate)) out.endDate = raw.endDate;
    const days = Number(raw.days);
    if (Number.isFinite(days) && days > 0) out.days = days;
  } else {
    if (typeof raw.vendor === "string" && raw.vendor.trim()) out.vendor = raw.vendor.trim();
    if (typeof raw.category === "string" && raw.category.trim()) out.category = raw.category.trim();
    const amount = Number(raw.amount);
    if (Number.isFinite(amount) && amount >= 0) out.amount = amount;
  }
  return out;
}

export async function POST(request: NextRequest) {
  let body: DraftBody;
  try {
    body = (await request.json()) as DraftBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const type = normalizeType(body.type);
  if (!type) {
    return NextResponse.json(
      { error: "type must be one of: 휴가, 경비, 기타" },
      { status: 400 },
    );
  }
  const hints = typeof body.hints === "string" ? body.hints.trim() : "";

  try {
    const raw = await runClaude(buildPrompt(type, hints));
    const parsed = extractJson<DraftFields>(raw);
    if (!parsed) {
      return NextResponse.json({ error: "Claude returned non-JSON response" }, { status: 502 });
    }
    const fields = sanitize(type, parsed);
    if (Object.keys(fields).length === 0) {
      return NextResponse.json({ error: "Claude returned no usable fields" }, { status: 502 });
    }
    return NextResponse.json(fields);
  } catch (err) {
    const detail = claudeErrorDetail(err);
    console.error("[ai/draft] claude exec error:", detail);
    return NextResponse.json({ error: "Failed to generate draft", detail }, { status: 500 });
  }
}
