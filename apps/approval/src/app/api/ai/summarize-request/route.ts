import { NextRequest, NextResponse } from "next/server";
import { runClaude, extractJson, claudeErrorDetail } from "@/lib/claude-cli";

interface SummarizeBody {
  type?: string;
  title?: string;
  description?: string;
  data?: Record<string, unknown>;
  requesterId?: string;
}

interface SummaryResult {
  summary?: unknown;
  risk?: unknown;
}

const TYPE_LABELS: Record<string, string> = {
  vacation: "휴가 신청",
  expense: "지출 결재",
  purchase: "품의 상신",
};

function buildPrompt(body: SummarizeBody): string {
  const typeLabel = TYPE_LABELS[body.type ?? ""] ?? (body.type || "결재");
  return [
    "당신은 결재 승인자를 돕는 비서입니다.",
    "아래 결재 문서를 검토할 승인자를 위해 한국어 3줄 브리핑을 작성하세요.",
    "",
    "[결재 문서]",
    `유형: ${typeLabel}`,
    `제목: ${body.title ?? "(제목 없음)"}`,
    `신청자: ${body.requesterId ?? "(미상)"}`,
    `사유: ${body.description || "(사유 없음)"}`,
    `상세 데이터: ${JSON.stringify(body.data ?? {})}`,
    "",
    "출력 규칙: 아래 JSON 형식만 출력하세요. 코드펜스나 다른 설명을 붙이지 마세요.",
    '{"summary":["핵심 요약 1줄","핵심 요약 1줄","핵심 요약 1줄"],"risk":"승인 전 주의할 점 한 문장 (없으면 이 키 생략)"}',
    "- summary는 정확히 3줄, 각 줄 60자 이내로 작성하세요.",
    "- risk는 금액 과다, 기간 이상, 정보 부족 등 실제 우려가 있을 때만 포함하세요.",
  ].join("\n");
}

export async function POST(request: NextRequest) {
  let body: SummarizeBody;
  try {
    body = (await request.json()) as SummarizeBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.title && !body.description && !body.data) {
    return NextResponse.json(
      { error: "Missing document content: title, description or data required" },
      { status: 400 },
    );
  }

  try {
    const raw = await runClaude(buildPrompt(body));
    const parsed = extractJson<SummaryResult>(raw);
    const lines = Array.isArray(parsed?.summary)
      ? parsed.summary.filter((l): l is string => typeof l === "string" && l.trim().length > 0).map((l) => l.trim()).slice(0, 3)
      : [];
    if (lines.length === 0) {
      return NextResponse.json({ error: "Claude returned no usable summary" }, { status: 502 });
    }
    const risk = typeof parsed?.risk === "string" && parsed.risk.trim() ? parsed.risk.trim() : undefined;
    return NextResponse.json({ summary: lines, ...(risk ? { risk } : {}) });
  } catch (err) {
    const detail = claudeErrorDetail(err);
    console.error("[ai/summarize-request] claude exec error:", detail);
    return NextResponse.json({ error: "Failed to summarize request", detail }, { status: 500 });
  }
}
