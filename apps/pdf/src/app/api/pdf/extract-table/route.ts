import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runClaude, extractJson, claudeErrorDetail } from "@/lib/claude-cli";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const TIMEOUT_MS = 180_000;

export interface ExtractedTable {
  title: string | null;
  headers: string[];
  rows: string[][];
}

// Table extraction: client renders the current page to PNG and posts it here.
// The image is written to a temp file so Claude CLI can Read it locally.
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

  const tmpPath = path.join(os.tmpdir(), `pdf-table-${randomUUID()}.png`);
  try {
    await writeFile(tmpPath, Buffer.from(await image.arrayBuffer()));

    const prompt = [
      `Read 툴로 이미지 파일 ${tmpPath} 를 읽은 뒤, 이미지에 보이는 모든 표를 JSON으로 추출해주세요.`,
      '형식: {"tables": [{"title": "표 제목 (없으면 null)", "headers": ["열 이름"], "rows": [["셀 값"]]}]}',
      '- 표가 없으면 {"tables": []} 출력.',
      "- 모든 셀 값은 문자열로. 병합 셀은 각 행에 반복 기입.",
      "- JSON 외 다른 텍스트 출력 금지.",
    ].join("\n");

    const raw = await runClaude(prompt, TIMEOUT_MS);
    const parsed = extractJson<{ tables: ExtractedTable[] }>(raw);
    if (!parsed || !Array.isArray(parsed.tables)) {
      console.error("[pdf/extract-table] unparsable response:", raw.slice(0, 500));
      return NextResponse.json({ error: "invalid_response" }, { status: 502 });
    }
    return NextResponse.json(parsed);
  } catch (err) {
    const detail = claudeErrorDetail(err, TIMEOUT_MS);
    console.error("[pdf/extract-table] error:", detail);
    return NextResponse.json({ error: "claude_failed", detail }, { status: 500 });
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}
