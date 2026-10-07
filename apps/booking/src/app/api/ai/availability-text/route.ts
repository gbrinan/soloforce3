import { NextRequest, NextResponse } from "next/server";
import { runClaude, claudeErrorDetail, DEFAULT_TIMEOUT_MS } from "@/lib/claude-cli";

interface Slot {
  date: string; // YYYY-MM-DD
  start: string; // HH:mm
  end: string; // HH:mm
}

interface AvailabilityTextRequest {
  slots: Slot[];
}

const MAX_SLOTS_IN_PROMPT = 10;

function isSlot(s: unknown): s is Slot {
  if (typeof s !== "object" || s === null) return false;
  const v = s as Record<string, unknown>;
  return (
    typeof v.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(v.date) &&
    typeof v.start === "string" &&
    typeof v.end === "string"
  );
}

function buildPrompt(slots: Slot[]): string {
  const lines = slots
    .slice(0, MAX_SLOTS_IN_PROMPT)
    .map((s) => `- ${s.date} ${s.start}~${s.end}`);
  return [
    "아래 가용 시간 슬롯을 바탕으로, 이메일이나 메시지에 그대로 붙여넣을 수 있는 한국어 미팅 시간 제안 문구를 작성하세요.",
    '- "다음 시간 중 편하신 때를 알려주시면 감사하겠습니다" 형식의 정중한 제안 문구여야 합니다.',
    "- 슬롯은 3~5개만 골라 날짜(요일 포함)와 시간으로 보기 좋게 나열하세요.",
    "- 문구 본문 텍스트만 출력하고 다른 설명은 붙이지 마세요.",
    "",
    "[가용 슬롯]",
    ...lines,
  ].join("\n");
}

export async function POST(request: NextRequest) {
  let body: AvailabilityTextRequest;
  try {
    body = (await request.json()) as AvailabilityTextRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(body.slots) || body.slots.length === 0 || !body.slots.every(isSlot)) {
    return NextResponse.json(
      { error: "Missing or invalid field: slots (non-empty array of {date, start, end})" },
      { status: 400 },
    );
  }

  try {
    const text = await runClaude(buildPrompt(body.slots));
    if (!text) {
      return NextResponse.json({ error: "Claude returned empty response" }, { status: 502 });
    }
    return NextResponse.json({ text });
  } catch (err) {
    const detail = claudeErrorDetail(err, DEFAULT_TIMEOUT_MS);
    console.error("[availability-text] claude exec error:", detail);
    return NextResponse.json(
      { error: "Failed to generate availability text", detail },
      { status: 500 },
    );
  }
}
