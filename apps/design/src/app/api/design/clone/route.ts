// POST /api/design/clone — screenshot → design replication endpoint.
// multipart form (image, width, height) → temp image file → claude CLI with
// the Read tool enabled ("claude -p" can inspect local images via Read) →
// "add"-only ops JSON reusing the existing DesignOp pipeline.
import { NextResponse } from "next/server";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runClaude } from "../../../../lib/director/claude-cli";
import { OPS_SCHEMA_SPEC } from "../../../../lib/director/prompt";
import { extractJsonObject } from "../../../../lib/director/extract-json";
import type { DesignOp, DesignRunResponse } from "../../../../lib/design/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB
const CLONE_TIMEOUT_MS = 240_000; // image analysis + many ops takes longer
const CLONE_MAX_TURNS = 8; // Read tool use consumes turns

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const SYSTEM = `너는 스크린샷을 벡터 디자인으로 재구성하는 어시스턴트다. Read 도구로 사용자 메시지에 주어진 이미지 파일을 읽고, 그 스크린샷의 레이아웃을 아래 ops 스키마의 "add" 연산 배열로 재구성한다. 출력은 반드시 {"ops":[...],"message":"..."} 형식의 순수 JSON. 좌표는 캔버스 픽셀(좌상단 0,0), 색은 반드시 #RRGGBB 또는 "none"이다.

${OPS_SCHEMA_SPEC}

규칙:
- op은 "add"만 사용한다. shape의 id는 생략한다(클라이언트가 부여).
- 캔버스 크기는 사용자 메시지의 width×height. 스크린샷 비율을 유지하며 이 영역 안에 맞게 좌표를 환산한다.
- 배경(큰 rect/frame) → 카드·버튼(rect) → 구분선(line) → 텍스트(text) 순서, 즉 뒤→앞 z순서대로 나열한다.
- 사진·일러스트 영역은 image가 아니라 관찰한 평균색 fill의 rect placeholder로 표현한다 (href 생성 불가).
- 텍스트는 스크린샷의 실제 문구를 읽어 사용하고, 판독이 어려우면 유사한 placeholder를 쓴다.
- 색은 스크린샷에서 관찰한 색을 #RRGGBB로 근사한다.
- add shape는 BaseShape 공통 필드를 모두 채운다: type, name, x, y, width, height, rotation, opacity, fill, stroke, strokeWidth, radius, visible, locked, parentId.
- 요소는 60개 이하로 핵심 구조 위주로 재구성한다.
- 출력은 JSON 단일 객체만. 설명 문장·코드펜스 금지.`;

export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { ops: [], message: "multipart form 파싱 실패" } satisfies DesignRunResponse,
      { status: 400 },
    );
  }

  const file = form.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { ops: [], message: "image 파일 필드 누락" } satisfies DesignRunResponse,
      { status: 400 },
    );
  }
  const ext = EXT_BY_MIME[file.type];
  if (!ext) {
    return NextResponse.json(
      {
        ops: [],
        message: `지원하지 않는 이미지 형식: ${file.type || "(unknown)"}`,
      } satisfies DesignRunResponse,
      { status: 400 },
    );
  }
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { ops: [], message: "이미지 크기는 10MB 이하여야 합니다" } satisfies DesignRunResponse,
      { status: 400 },
    );
  }

  const width = Math.max(1, Math.round(Number(form.get("width")) || 1440));
  const height = Math.max(1, Math.round(Number(form.get("height")) || 1024));

  // Save to a temp file so the claude CLI Read tool can open it by path.
  const dir = join(tmpdir(), "mydesign-clone");
  const imagePath = join(dir, `shot-${randomUUID()}.${ext}`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(imagePath, Buffer.from(await file.arrayBuffer()));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ops: [], message: `임시 이미지 저장 실패: ${message}` } satisfies DesignRunResponse,
      { status: 500 },
    );
  }

  try {
    const user = [
      `# 캔버스 크기`,
      `width=${width}, height=${height}`,
      "",
      "# 스크린샷 이미지",
      `Read 도구로 다음 로컬 이미지 파일을 읽어라: ${imagePath}`,
      "",
      '이미지를 읽은 뒤, 이 스크린샷 레이아웃을 위 캔버스 크기에 맞춰 재구성하는 "add" ops 배열을 {"ops":[...],"message":"..."} 형식의 순수 JSON으로만 출력하라.',
    ].join("\n");

    const raw = await runClaude(SYSTEM, user, {
      allowRead: true,
      timeoutMs: CLONE_TIMEOUT_MS,
      maxTurns: CLONE_MAX_TURNS,
    });

    const parsed = extractJsonObject<{ ops?: unknown; message?: unknown }>(raw);
    if (!parsed) {
      return NextResponse.json(
        {
          ops: [],
          message: `AI 응답 파싱 실패: ${raw.slice(0, 200)}`,
        } satisfies DesignRunResponse,
        { status: 200 },
      );
    }
    // Clone is add-only: drop anything targeting existing shapes.
    const ops = (Array.isArray(parsed.ops) ? (parsed.ops as DesignOp[]) : []).filter(
      (op) => op.op === "add" && op.shape && typeof op.shape.type === "string",
    );
    const message =
      typeof parsed.message === "string"
        ? parsed.message
        : `스크린샷을 ${ops.length}개 요소로 재구성했습니다`;
    return NextResponse.json({ ops, message } satisfies DesignRunResponse, {
      status: 200,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ops: [], message: `AI 호출 실패: ${message}` } satisfies DesignRunResponse,
      { status: 500 },
    );
  } finally {
    // Best-effort temp cleanup.
    await unlink(imagePath).catch(() => {});
  }
}
