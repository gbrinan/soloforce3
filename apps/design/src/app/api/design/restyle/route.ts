// POST /api/design/restyle — 참조 이미지(무드보드) 기반 리스타일 엔드포인트.
// 참조 이미지를 임시 파일로 저장 → claude CLI(Read 도구)로 그 톤(색/폰트/간격 리듬)을
// 분석하고, 현재 페이지 shapes에 그 톤을 이식하는 "update" ops JSON을 생성한다.
// clone/route.ts의 이미지 Read 패턴 + critique/route.ts의 update-only ops 검증을 재사용.
import { NextResponse } from "next/server";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { runClaude } from "../../../../lib/director/claude-cli";
import { OPS_SCHEMA_SPEC } from "../../../../lib/director/prompt";
import { extractJsonObject } from "../../../../lib/director/extract-json";
import type { DesignOp, DesignRunResponse, Shape } from "../../../../lib/design/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB
const RESTYLE_TIMEOUT_MS = 240_000; // 이미지 분석 + ops 생성에 시간 소요
const RESTYLE_MAX_TURNS = 8; // Read 도구 사용이 턴을 소모

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const SYSTEM = `너는 벡터 디자인 리스타일 어시스턴트다. Read 도구로 사용자 메시지에 주어진 "참조 이미지"(무드보드/레퍼런스) 파일을 읽고, 그 이미지의 시각 톤 — 색 팔레트, 명도/채도 분위기, 타이포 느낌(굵기·계열), 간격 리듬 — 을 파악한다. 그런 다음 사용자 메시지에 주어진 "현재 shapes"의 레이아웃 구조는 유지한 채 그 톤을 이식하는 "update" ops를 생성한다. 출력은 반드시 {"ops":[...],"message":"..."} 형식의 순수 JSON. 색은 반드시 #RRGGBB 또는 "none"이다.

${OPS_SCHEMA_SPEC}

규칙:
- op은 "update"만 사용한다. 대상 id는 반드시 현재 shapes에 존재하는 id여야 한다. add/delete 금지.
- update의 shape에는 변경할 필드만 부분적으로 담는다(예: {"fill":"#1B2A4A"} 또는 {"color":"#EAF0FF","fontWeight":600}).
- 리스타일 대상 필드: fill, stroke, strokeWidth(테두리 굵기), radius(모서리 반경), text의 color/fontFamily/fontWeight, opacity. 톤에 필요하면 x/y/width/height를 소폭 조정해 간격 리듬을 맞출 수 있으나, 전체 레이아웃 구조를 바꾸지 않는다.
- 참조 이미지의 색을 #RRGGBB로 근사해 배경/표면/강조/텍스트 역할별로 일관되게 적용한다. 대비(가독성)를 해치지 않는다.
- locked=true 또는 visible=false 요소는 수정하지 않는다.
- 텍스트 내용(text)은 바꾸지 않는다. 톤과 무관한 요소는 건드리지 않는다.
- 변경이 불필요하면 {"ops":[],"message":"<사유>"}.
- 출력은 JSON 단일 객체만. 설명 문장·코드펜스 금지.`;

interface RestyleInput {
  shapes: Shape[];
  instruction: string;
  width: number;
  height: number;
  // 아래 셋 중 하나로 참조 이미지가 온다.
  file?: File;
  imageDataUrl?: string;
  imagePath?: string;
}

function json(body: DesignRunResponse, status: number): Response {
  return NextResponse.json(body, { status });
}

function parseShapes(value: unknown): Shape[] | null {
  if (Array.isArray(value)) return value as Shape[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as Shape[]) : null;
    } catch {
      return null;
    }
  }
  return null;
}

// multipart(image 파일 + shapes JSON 문자열) 또는 JSON(imageDataUrl/imagePath + currentShapes)
// 두 형식을 모두 받아 공통 입력으로 정규화. 실패 시 사유 문자열.
async function readInput(request: Request): Promise<RestyleInput | string> {
  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return "multipart form 파싱 실패";
    }
    const file = form.get("image");
    if (!(file instanceof File)) return "image 파일 필드 누락";
    const shapes = parseShapes(form.get("shapes"));
    if (!shapes) return "shapes(JSON 배열 문자열) 누락 또는 파싱 실패";
    return {
      shapes,
      instruction: String(form.get("instruction") ?? ""),
      width: Math.max(1, Math.round(Number(form.get("width")) || 1440)),
      height: Math.max(1, Math.round(Number(form.get("height")) || 1024)),
      file,
    };
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return "요청 본문 JSON 파싱 실패";
  }
  if (typeof body !== "object" || body === null) return "body가 객체가 아님";
  const b = body as Record<string, unknown>;
  const shapes = parseShapes(b.currentShapes ?? b.shapes);
  if (!shapes) return "currentShapes(배열) 누락 또는 파싱 실패";
  const imageDataUrl = typeof b.imageDataUrl === "string" ? b.imageDataUrl : undefined;
  const imagePath = typeof b.imagePath === "string" ? b.imagePath : undefined;
  if (!imageDataUrl && !imagePath) return "imageDataUrl 또는 imagePath 필요";
  return {
    shapes,
    instruction: typeof b.instruction === "string" ? b.instruction : "",
    width: Math.max(1, Math.round(Number(b.width) || 1440)),
    height: Math.max(1, Math.round(Number(b.height) || 1024)),
    imageDataUrl,
    imagePath,
  };
}

// dataUrl(data:image/png;base64,...) → 임시 파일 경로. 실패 시 null.
async function decodeDataUrl(dataUrl: string, dir: string): Promise<{ path: string } | { error: string }> {
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(dataUrl);
  if (!m) return { error: "imageDataUrl 형식이 올바르지 않습니다 (data:image/*;base64,...)" };
  const ext = EXT_BY_MIME[m[1]];
  if (!ext) return { error: `지원하지 않는 이미지 형식: ${m[1]}` };
  const buf = Buffer.from(m[2], "base64");
  if (buf.length <= 0 || buf.length > MAX_IMAGE_BYTES) {
    return { error: "이미지 크기는 10MB 이하여야 합니다" };
  }
  const path = join(dir, `ref-${randomUUID()}.${ext}`);
  await writeFile(path, buf);
  return { path };
}

export async function POST(request: Request): Promise<Response> {
  const input = await readInput(request);
  if (typeof input === "string") return json({ ops: [], message: `요청 검증 실패: ${input}` }, 400);

  const dir = join(tmpdir(), "mydesign-restyle");
  let imagePath = "";
  let cleanup = false; // 우리가 만든 임시 파일만 삭제 (외부 imagePath는 보존).
  try {
    await mkdir(dir, { recursive: true });
    if (input.file) {
      const ext = EXT_BY_MIME[input.file.type];
      if (!ext) return json({ ops: [], message: `지원하지 않는 이미지 형식: ${input.file.type || "(unknown)"}` }, 400);
      if (input.file.size <= 0 || input.file.size > MAX_IMAGE_BYTES) {
        return json({ ops: [], message: "이미지 크기는 10MB 이하여야 합니다" }, 400);
      }
      imagePath = join(dir, `ref-${randomUUID()}.${ext}`);
      await writeFile(imagePath, Buffer.from(await input.file.arrayBuffer()));
      cleanup = true;
    } else if (input.imageDataUrl) {
      const decoded = await decodeDataUrl(input.imageDataUrl, dir);
      if ("error" in decoded) return json({ ops: [], message: decoded.error }, 400);
      imagePath = decoded.path;
      cleanup = true;
    } else if (input.imagePath) {
      const ext = extname(input.imagePath).slice(1).toLowerCase();
      if (!Object.values(EXT_BY_MIME).includes(ext === "jpeg" ? "jpg" : ext)) {
        return json({ ops: [], message: `지원하지 않는 이미지 경로 확장자: .${ext || "(none)"}` }, 400);
      }
      imagePath = input.imagePath;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ ops: [], message: `임시 이미지 준비 실패: ${message}` }, 500);
  }

  try {
    const user = [
      "# 캔버스 크기",
      `width=${input.width}, height=${input.height}`,
      "",
      "# 참조 이미지 (무드보드/레퍼런스)",
      `Read 도구로 다음 로컬 이미지 파일을 읽어라: ${imagePath}`,
      "",
      "# 현재 shapes (이 요소들의 레이아웃 구조는 유지하고 톤만 이식한다)",
      JSON.stringify(input.shapes, null, 2),
      "",
      "# 사용자 지시 (instruction)",
      input.instruction || "(참조 이미지의 색감·분위기를 현재 디자인에 이식해줘)",
      "",
      '참조 이미지를 읽은 뒤, 위 shapes에 그 톤을 이식하는 "update" ops 배열을 {"ops":[...],"message":"..."} 형식의 순수 JSON으로만 출력하라.',
    ].join("\n");

    const raw = await runClaude(SYSTEM, user, {
      allowRead: true,
      timeoutMs: RESTYLE_TIMEOUT_MS,
      maxTurns: RESTYLE_MAX_TURNS,
      feature: "restyle",
    });

    const parsed = extractJsonObject<{ ops?: unknown; message?: unknown }>(raw);
    if (!parsed) {
      return json({ ops: [], message: `AI 응답 파싱 실패: ${raw.slice(0, 200)}` }, 200);
    }

    // Sanitize: update-only, 현재 shapes의 unlocked/visible id만 대상 (critique 라우트와 동일 정책).
    const editable = new Set(
      input.shapes.filter((sh) => !sh.locked && sh.visible).map((sh) => sh.id),
    );
    const ops = (Array.isArray(parsed.ops) ? (parsed.ops as DesignOp[]) : []).filter(
      (op) => op.op === "update" && !!op.id && editable.has(op.id) && !!op.shape,
    );
    const message =
      typeof parsed.message === "string"
        ? parsed.message
        : `참조 이미지 톤을 ${ops.length}개 요소에 이식했습니다`;
    return json({ ops, message }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ ops: [], message: `AI 호출 실패: ${message}` }, 500);
  } finally {
    if (cleanup && imagePath) await unlink(imagePath).catch(() => {});
  }
}
