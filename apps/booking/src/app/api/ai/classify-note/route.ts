import { NextRequest, NextResponse } from "next/server";
import {
  runClaude,
  extractJson,
  claudeErrorDetail,
  DEFAULT_TIMEOUT_MS,
} from "@/lib/claude-cli";

interface ClassifyNoteRequest {
  note: string;
  title?: string;
}

export type NoteType = "consult" | "demo" | "interview" | "onboarding" | "etc";

export interface ClassifiedNote {
  type: NoteType;
  typeLabel: string; // 상담/데모/면접/온보딩/기타
  prep: string[];
}

const TYPE_LABELS: Record<NoteType, string> = {
  consult: "상담",
  demo: "데모",
  interview: "면접",
  onboarding: "온보딩",
  etc: "기타",
};

function buildPrompt(note: string, title?: string): string {
  return [
    "당신은 예약 메모 분류 도우미입니다. 아래 예약 메모를 읽고 미팅 유형과 준비항목을 뽑아내세요.",
    "- type은 다음 중 하나만: consult(상담), demo(데모), interview(면접), onboarding(온보딩), etc(기타).",
    "- typeLabel은 type에 대응하는 한국어 라벨: 상담/데모/면접/온보딩/기타.",
    "- prep는 이 미팅 전에 준비하거나 확인할 항목 2~4개를 한국어 짧은 문구로 작성하세요.",
    "아래 JSON 스키마로만 출력하고 다른 설명은 절대 붙이지 마세요:",
    '{"type": "consult", "typeLabel": "상담", "prep": ["준비항목1", "준비항목2"]}',
    "",
    ...(title ? [`[제목]`, title, ""] : []),
    "[메모]",
    note,
  ].join("\n");
}

export async function POST(request: NextRequest) {
  let body: ClassifyNoteRequest;
  try {
    body = (await request.json()) as ClassifyNoteRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.note?.trim()) {
    return NextResponse.json({ error: "Missing required field: note" }, { status: 400 });
  }

  try {
    const raw = await runClaude(buildPrompt(body.note.trim(), body.title?.trim()), {
      feature: "classify-note",
    });
    const parsed = extractJson<ClassifiedNote>(raw);

    if (
      !parsed ||
      !parsed.type ||
      !(parsed.type in TYPE_LABELS) ||
      !Array.isArray(parsed.prep)
    ) {
      return NextResponse.json(
        { error: "Failed to classify note", raw },
        { status: 502 },
      );
    }

    const type = parsed.type;
    const prep = parsed.prep
      .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
      .map((p) => p.trim())
      .slice(0, 4);

    return NextResponse.json({
      type,
      typeLabel: TYPE_LABELS[type],
      prep,
    });
  } catch (err) {
    const detail = claudeErrorDetail(err, DEFAULT_TIMEOUT_MS);
    console.error("[classify-note] claude exec error:", detail);
    return NextResponse.json(
      { error: "Failed to classify note", detail },
      { status: 500 },
    );
  }
}
