import { NextRequest, NextResponse } from "next/server";
import { runClaude, claudeErrorDetail } from "@/lib/claude-cli";

const TIMEOUT_MS = 60_000;

interface SuggestReplyRequest {
  subject: string;
  from: string;
  body?: string;
  text?: string;
  html?: string;
  instruction?: string; // optional tone/style hint from user
}

function buildPrompt(req: SuggestReplyRequest): string {
  const bodyContent = req.body ?? req.text ?? req.html ?? "(본문 없음)";
  const instruction = req.instruction
    ? `\n\n[사용자 지시] ${req.instruction}`
    : "";

  return [
    "아래 원본 이메일에 대한 한국어 답장 초안을 작성해주세요.",
    "- 정중하고 전문적인 어조를 유지하세요.",
    "- 인사말, 본문, 맺음말을 포함하세요.",
    "- 답장 본문 텍스트만 출력하고 다른 설명은 붙이지 마세요.",
    instruction,
    "",
    `[원본 메일]`,
    `발신자: ${req.from}`,
    `제목: ${req.subject}`,
    `본문:`,
    bodyContent,
  ].join("\n");
}

export async function POST(request: NextRequest) {
  let body: SuggestReplyRequest;
  try {
    body = (await request.json()) as SuggestReplyRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.subject || !body.from) {
    return NextResponse.json(
      { error: "Missing required fields: subject, from" },
      { status: 400 },
    );
  }

  const prompt = buildPrompt(body);

  try {
    // 공용 @mycrew/ai-client 경유 — 게이트웨이(설정 시)·비용집계·레이트리밋 편입.
    const reply = (await runClaude(prompt, { timeoutMs: TIMEOUT_MS, feature: "suggest-reply" })).trim();
    if (!reply) {
      return NextResponse.json({ error: "Claude returned empty response" }, { status: 502 });
    }
    return NextResponse.json({ reply });
  } catch (err) {
    const detail = claudeErrorDetail(err, TIMEOUT_MS);
    console.error("[suggest-reply] claude error:", detail);
    return NextResponse.json(
      { error: "Failed to generate reply", detail },
      { status: 500 },
    );
  }
}
