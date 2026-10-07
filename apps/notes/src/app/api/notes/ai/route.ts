import { NextResponse } from "next/server";
import {
  runClaude,
  extractJson,
  claudeErrorDetail,
  stripHtml,
  DEFAULT_TIMEOUT_MS,
} from "@/lib/claude-cli";

type AiMode = "summarize" | "title" | "tags" | "all";

interface AiRequest {
  html?: string;
  text?: string;
  mode?: AiMode;
}

interface AiResult {
  summary?: string;
  title?: string;
  tags?: string[];
}

const MODES: AiMode[] = ["summarize", "title", "tags", "all"];

function buildPrompt(text: string, mode: AiMode): string {
  const want = {
    summary: mode === "all" || mode === "summarize",
    title: mode === "all" || mode === "title",
    tags: mode === "all" || mode === "tags",
  };

  const fields: string[] = [];
  const schema: string[] = [];
  if (want.summary) {
    fields.push("- summary: 노트 핵심을 2~3문장 한국어로 요약.");
    schema.push('"summary": "..."');
  }
  if (want.title) {
    fields.push("- title: 내용을 대표하는 20자 이내 한국어 제목 한 줄.");
    schema.push('"title": "..."');
  }
  if (want.tags) {
    fields.push("- tags: 주제를 나타내는 한국어 태그 2~5개 (각 태그는 짧은 단어).");
    schema.push('"tags": ["태그1", "태그2"]');
  }

  return [
    "당신은 노트 정리 도우미입니다. 아래 노트를 읽고 요청한 항목만 뽑아내세요.",
    ...fields,
    "아래 JSON 스키마로만 출력하고 다른 설명은 절대 붙이지 마세요:",
    `{${schema.join(", ")}}`,
    "",
    "[노트]",
    text,
  ].join("\n");
}

export async function POST(req: Request) {
  let body: AiRequest;
  try {
    body = (await req.json()) as AiRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const mode: AiMode = body.mode && MODES.includes(body.mode) ? body.mode : "all";
  const raw = body.text ?? (body.html ? stripHtml(body.html) : "");
  const text = raw.trim();
  if (!text) {
    return NextResponse.json(
      { error: "Missing required field: html or text" },
      { status: 400 },
    );
  }

  try {
    const out = await runClaude(buildPrompt(text, mode), { feature: "notes-ai" });
    const parsed = extractJson<AiResult>(out);
    if (!parsed) {
      return NextResponse.json(
        { error: "Failed to parse AI response", raw: out },
        { status: 502 },
      );
    }

    const result: AiResult = {};
    if (typeof parsed.summary === "string" && parsed.summary.trim()) {
      result.summary = parsed.summary.trim();
    }
    if (typeof parsed.title === "string" && parsed.title.trim()) {
      result.title = parsed.title.trim();
    }
    if (Array.isArray(parsed.tags)) {
      result.tags = parsed.tags
        .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
        .map((t) => t.trim())
        .slice(0, 5);
    }

    return NextResponse.json(result);
  } catch (err) {
    const detail = claudeErrorDetail(err, DEFAULT_TIMEOUT_MS);
    console.error("[notes-ai] claude exec error:", detail);
    return NextResponse.json(
      { error: "Failed to run AI", detail },
      { status: 500 },
    );
  }
}
