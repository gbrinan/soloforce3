import { NextResponse, type NextRequest } from "next/server";
import { runClaude, extractJson, claudeErrorDetail, clipMiddle } from "@/lib/claude-cli";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const TIMEOUT_MS = 120_000;
// Total context budget sent to Claude (chunk selection target).
const CONTEXT_MAX_CHARS = 8_000;
// Individual chunk size (page-marker aligned, long pages hard-wrapped).
const CHUNK_MAX_CHARS = 1_500;

interface AskRequest {
  question?: string;
  documentText?: string;
}

export interface AskResult {
  answer: string;
  sourceSnippets: string[];
}

/** Split document text into chunks aligned to "--- 페이지 N ---" markers. */
function splitChunks(text: string): string[] {
  const pages = text.split(/(?=--- 페이지 \d+ ---)/);
  const chunks: string[] = [];
  for (const page of pages) {
    const p = page.trim();
    if (!p) continue;
    if (p.length <= CHUNK_MAX_CHARS) {
      chunks.push(p);
      continue;
    }
    for (let i = 0; i < p.length; i += CHUNK_MAX_CHARS) {
      chunks.push(p.slice(i, i + CHUNK_MAX_CHARS));
    }
  }
  return chunks;
}

/**
 * Pick the most question-relevant chunks (simple keyword frequency score)
 * within CONTEXT_MAX_CHARS, preserving document order. Falls back to
 * head/tail clipping when no keyword matches anything.
 */
function selectContext(documentText: string, question: string): string {
  if (documentText.length <= CONTEXT_MAX_CHARS) return documentText;

  const terms = question
    .toLowerCase()
    .split(/[\s.,?!:;"'()[\]{}·、。]+/)
    .filter((w) => w.length >= 2);

  const chunks = splitChunks(documentText);
  const scored = chunks.map((chunk, index) => {
    const lower = chunk.toLowerCase();
    let score = 0;
    for (const term of terms) {
      let pos = lower.indexOf(term);
      while (pos >= 0) {
        score += 1;
        pos = lower.indexOf(term, pos + term.length);
      }
    }
    return { chunk, index, score };
  });

  if (!scored.some((s) => s.score > 0)) {
    return clipMiddle(documentText, CONTEXT_MAX_CHARS);
  }

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  const picked: { chunk: string; index: number }[] = [];
  let total = 0;
  for (const s of scored) {
    if (s.score === 0 && picked.length > 0) break;
    if (total + s.chunk.length > CONTEXT_MAX_CHARS) continue;
    picked.push(s);
    total += s.chunk.length;
  }
  picked.sort((a, b) => a.index - b.index);
  return picked.map((p) => p.chunk).join("\n\n");
}

// PDF Q&A: answers a question grounded in client-extracted document text.
// Long documents are chunked and keyword-filtered before hitting Claude.
export async function POST(req: NextRequest) {
  let body: AskRequest;
  try {
    body = (await req.json()) as AskRequest;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const question = body.question?.trim();
  const documentText = body.documentText?.trim();
  if (!question) {
    return NextResponse.json({ error: "missing_question" }, { status: 400 });
  }
  if (!documentText) {
    return NextResponse.json({ error: "missing_document" }, { status: 400 });
  }

  const context = selectContext(documentText, question);

  const prompt = [
    "아래 PDF 문서 발췌 내용을 근거로 질문에 답하고 JSON만 출력해주세요.",
    '형식: {"answer": "한국어 답변", "sourceSnippets": ["근거가 된 문서 원문 인용 1", "인용 2"]}',
    "- answer는 문서 내용을 근거로 한 한국어 답변. 문서에 없는 내용은 추측하지 말고 \"문서에서 찾을 수 없습니다\"라고 답하세요.",
    "- sourceSnippets는 답변의 근거가 된 문서 원문 문장을 그대로 인용 (최대 3개, 각 200자 이내). 근거가 없으면 빈 배열.",
    "- JSON 외 다른 텍스트 출력 금지.",
    "",
    "[질문]",
    question,
    "",
    "[문서 내용]",
    context,
  ].join("\n");

  try {
    const raw = await runClaude(prompt, TIMEOUT_MS);
    if (!raw) {
      return NextResponse.json({ error: "empty_response" }, { status: 502 });
    }
    const parsed = extractJson<AskResult>(raw);
    if (parsed && typeof parsed.answer === "string") {
      return NextResponse.json({
        answer: parsed.answer,
        sourceSnippets: Array.isArray(parsed.sourceSnippets)
          ? parsed.sourceSnippets.filter((s): s is string => typeof s === "string")
          : [],
      } satisfies AskResult);
    }
    // Graceful fallback: treat the raw response as a plain-text answer.
    return NextResponse.json({ answer: raw, sourceSnippets: [] } satisfies AskResult);
  } catch (err) {
    const detail = claudeErrorDetail(err, TIMEOUT_MS);
    console.error("[pdf/ask] claude exec error:", detail);
    return NextResponse.json({ error: "claude_failed", detail }, { status: 500 });
  }
}
