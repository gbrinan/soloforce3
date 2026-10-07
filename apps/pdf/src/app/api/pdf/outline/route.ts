import { NextResponse, type NextRequest } from "next/server";
import { runClaude, extractJson, claudeErrorDetail, clipMiddle } from "@/lib/claude-cli";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const TIMEOUT_MS = 120_000;

interface OutlineRequest {
  documentText?: string;
}

interface OutlineResult {
  summary: string;
  toc: { title: string; page?: number }[];
}

// Document summary + table of contents from client-extracted text.
export async function POST(req: NextRequest) {
  let body: OutlineRequest;
  try {
    body = (await req.json()) as OutlineRequest;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const documentText = body.documentText?.trim();
  if (!documentText) {
    return NextResponse.json({ error: "missing_document" }, { status: 400 });
  }

  const prompt = [
    "아래 PDF 문서 내용을 분석해 JSON만 출력해주세요.",
    '형식: {"summary": "3줄 요약 (줄바꿈 \\n 으로 구분)", "toc": [{"title": "섹션 제목", "page": 1}]}',
    "- summary는 정확히 3줄, 각 줄은 한 문장의 한국어.",
    "- toc는 문서의 주요 섹션 목록 (최대 15개). \"--- 페이지 N ---\" 마커로 페이지를 추정하고, 알 수 없으면 page를 생략.",
    "- JSON 외 다른 텍스트 출력 금지.",
    "",
    "[문서 내용]",
    clipMiddle(documentText),
  ].join("\n");

  try {
    const raw = await runClaude(prompt, TIMEOUT_MS);
    const parsed = extractJson<OutlineResult>(raw);
    if (!parsed || typeof parsed.summary !== "string" || !Array.isArray(parsed.toc)) {
      console.error("[pdf/outline] unparsable response:", raw.slice(0, 500));
      return NextResponse.json({ error: "invalid_response" }, { status: 502 });
    }
    return NextResponse.json(parsed);
  } catch (err) {
    const detail = claudeErrorDetail(err, TIMEOUT_MS);
    console.error("[pdf/outline] claude exec error:", detail);
    return NextResponse.json({ error: "claude_failed", detail }, { status: 500 });
  }
}
