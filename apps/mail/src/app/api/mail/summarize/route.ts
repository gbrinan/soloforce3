import { NextRequest, NextResponse } from "next/server";
import {
  runClaude,
  extractJson,
  claudeErrorDetail,
  stripHtml,
} from "@/lib/claude-cli";

interface SummarizeMessage {
  from: string;
  date: string;
  body: string;
}

interface SummarizeRequest {
  subject: string;
  messages: SummarizeMessage[];
}

interface SummarizeResult {
  summary: string[];
  actionItems: string[];
}

const MAX_BODY_CHARS = 3000;

function buildPrompt(req: SummarizeRequest): string {
  const thread = req.messages
    .map((m, i) => {
      const body = stripHtml(m.body).slice(0, MAX_BODY_CHARS);
      return [`[메시지 ${i + 1}]`, `발신자: ${m.from}`, `날짜: ${m.date}`, `본문: ${body}`].join("\n");
    })
    .join("\n\n");

  return [
    "아래 이메일 스레드를 분석해서 JSON으로만 답하세요. 다른 설명은 붙이지 마세요.",
    '형식: {"summary": ["한 줄 요약1", "한 줄 요약2", "한 줄 요약3"], "actionItems": ["할 일1", ...]}',
    "- summary: 한국어 3줄 요약 (각 항목 1문장).",
    "- actionItems: 수신자가 해야 할 일 목록 (없으면 빈 배열).",
    "",
    `[제목] ${req.subject}`,
    "",
    thread,
  ].join("\n");
}

export async function POST(request: NextRequest) {
  let body: SummarizeRequest;
  try {
    body = (await request.json()) as SummarizeRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.subject || !Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json(
      { error: "Missing required fields: subject, messages" },
      { status: 400 },
    );
  }

  const prompt = buildPrompt(body);

  try {
    const raw = await runClaude(prompt);
    const parsed = extractJson<SummarizeResult>(raw);
    if (!parsed || !Array.isArray(parsed.summary)) {
      return NextResponse.json(
        { error: "Claude returned unparsable response" },
        { status: 502 },
      );
    }
    return NextResponse.json({
      summary: parsed.summary.map(String),
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems.map(String) : [],
    });
  } catch (err) {
    const detail = claudeErrorDetail(err);
    console.error("[summarize] claude exec error:", detail);
    return NextResponse.json(
      { error: "Failed to summarize thread", detail },
      { status: 500 },
    );
  }
}
