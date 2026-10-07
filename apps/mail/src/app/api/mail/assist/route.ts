import { NextRequest, NextResponse } from "next/server";
import { runClaude, claudeErrorDetail } from "@/lib/claude-cli";

export type AssistMode = "lengthen" | "shorten" | "formal" | "casual";

interface AssistRequest {
  text: string;
  mode: AssistMode;
}

const MODE_INSTRUCTIONS: Record<AssistMode, string> = {
  lengthen: "아래 이메일 본문을 내용과 의도를 유지하면서 더 상세하고 풍부하게 늘려주세요.",
  shorten: "아래 이메일 본문을 핵심만 남기고 간결하게 줄여주세요.",
  formal: "아래 이메일 본문을 정중하고 격식 있는 비즈니스 어조로 바꿔주세요.",
  casual: "아래 이메일 본문을 친근하고 편안한 어조로 바꿔주세요.",
};

function buildPrompt(req: AssistRequest): string {
  return [
    MODE_INSTRUCTIONS[req.mode],
    "- 원문의 언어를 유지하세요.",
    "- 변환된 본문 텍스트만 출력하고 다른 설명은 붙이지 마세요.",
    "",
    "[원문]",
    req.text,
  ].join("\n");
}

export async function POST(request: NextRequest) {
  let body: AssistRequest;
  try {
    body = (await request.json()) as AssistRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.text?.trim() || !(body.mode in MODE_INSTRUCTIONS)) {
    return NextResponse.json(
      { error: "Missing or invalid fields: text, mode" },
      { status: 400 },
    );
  }

  try {
    const text = await runClaude(buildPrompt(body));
    if (!text) {
      return NextResponse.json({ error: "Claude returned empty response" }, { status: 502 });
    }
    return NextResponse.json({ text });
  } catch (err) {
    const detail = claudeErrorDetail(err);
    console.error("[assist] claude exec error:", detail);
    return NextResponse.json(
      { error: "Failed to transform text", detail },
      { status: 500 },
    );
  }
}
