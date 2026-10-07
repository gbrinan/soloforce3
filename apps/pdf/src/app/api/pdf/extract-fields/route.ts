import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runClaude, extractJson, claudeErrorDetail } from "@/lib/claude-cli";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const TIMEOUT_MS = 180_000;

export interface ExtractedFields {
  docType: string;
  amounts: string[];
  dates: string[];
  parties: string[];
}

// Scanned-document field extraction: same temp-image + Claude CLI Read pattern
// as extract-table.
export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected_multipart" }, { status: 400 });
  }

  const image = form.get("image");
  if (!(image instanceof File)) {
    return NextResponse.json({ error: "missing_image" }, { status: 400 });
  }

  const tmpPath = path.join(os.tmpdir(), `pdf-fields-${randomUUID()}.png`);
  try {
    await writeFile(tmpPath, Buffer.from(await image.arrayBuffer()));

    const prompt = [
      `Read 툴로 이미지 파일 ${tmpPath} 를 읽은 뒤, 문서에서 핵심 필드를 JSON으로 추출해주세요.`,
      '형식: {"docType": "문서 종류 (예: 영수증, 계약서, 청구서)", "amounts": ["금액 문자열"], "dates": ["날짜 문자열"], "parties": ["관련 인물/기관명"]}',
      "- 해당 없는 항목은 빈 배열로.",
      "- 금액은 통화 기호 포함 원문 표기 그대로.",
      "- JSON 외 다른 텍스트 출력 금지.",
    ].join("\n");

    const raw = await runClaude(prompt, TIMEOUT_MS);
    const parsed = extractJson<ExtractedFields>(raw);
    if (
      !parsed ||
      typeof parsed.docType !== "string" ||
      !Array.isArray(parsed.amounts) ||
      !Array.isArray(parsed.dates) ||
      !Array.isArray(parsed.parties)
    ) {
      console.error("[pdf/extract-fields] unparsable response:", raw.slice(0, 500));
      return NextResponse.json({ error: "invalid_response" }, { status: 502 });
    }
    return NextResponse.json(parsed);
  } catch (err) {
    const detail = claudeErrorDetail(err, TIMEOUT_MS);
    console.error("[pdf/extract-fields] error:", detail);
    return NextResponse.json({ error: "claude_failed", detail }, { status: 500 });
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}
