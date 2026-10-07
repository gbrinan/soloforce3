// POST /api/design/critique — layout alignment/spacing critique endpoint.
// Sends the current page shapes JSON to the claude CLI, gets back a critique
// plus suggested fix ops (update-only). Ops are NOT applied here — the client
// applies them through the existing DesignOp pipeline when the user confirms.
import { NextResponse } from "next/server";
import { runClaude } from "../../../../lib/director/claude-cli";
import { OPS_SCHEMA_SPEC } from "../../../../lib/director/prompt";
import { extractJsonObject } from "../../../../lib/director/extract-json";
import type {
  CritiqueResponse,
  DesignOp,
  DesignRunRequest,
} from "../../../../lib/design/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SYSTEM = `너는 벡터 디자인 레이아웃 감사관이다. 현재 페이지의 shapes JSON을 검토해 정렬·간격 문제를 비평하고, 이를 고치는 ops를 제안한다. 출력은 반드시 {"critique":"<비평 요약>","ops":[...],"message":"..."} 형식의 순수 JSON. 좌표는 캔버스 픽셀(좌상단 0,0), 색은 #RRGGBB 또는 "none"이다.

${OPS_SCHEMA_SPEC}

규칙:
- 점검 항목: 좌우/상하 정렬 어긋남(수 px 오차), 불균일한 간격, 의도치 않은 겹침, 캔버스 이탈, 유사 요소 간 비일관 크기.
- critique는 발견한 문제를 한국어로 3~6줄 요약한다.
- ops는 "update"만 사용하고 기존 요소 id만 대상으로 한다. 위치(x,y)·크기(width,height) 보정 위주로 최소 변경한다.
- locked=true 또는 visible=false 요소는 수정하지 않는다.
- 문제가 없으면 ops는 빈 배열로 두고 critique에 문제 없음 요지를 적는다.
- 출력은 JSON 단일 객체만. 설명 문장·코드펜스 금지.`;

function validate(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return "body가 객체가 아님";
  const b = body as Record<string, unknown>;
  if (typeof b.doc !== "object" || b.doc === null) return "doc 누락 또는 비객체";
  const doc = b.doc as Record<string, unknown>;
  if (!Array.isArray(doc.pages)) return "doc.pages가 배열이 아님";
  if (typeof b.pageId !== "string" || b.pageId.length === 0) return "pageId 누락";
  return null;
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { critique: "", ops: [], message: "요청 본문 JSON 파싱 실패" } satisfies CritiqueResponse,
      { status: 400 },
    );
  }
  const invalid = validate(body);
  if (invalid) {
    return NextResponse.json(
      { critique: "", ops: [], message: `요청 검증 실패: ${invalid}` } satisfies CritiqueResponse,
      { status: 400 },
    );
  }

  const req = body as Pick<DesignRunRequest, "doc" | "pageId">;
  const page = req.doc.pages.find((p) => p.id === req.pageId);
  const shapes = page?.shapes ?? [];
  if (shapes.length === 0) {
    return NextResponse.json(
      { critique: "점검할 요소가 없습니다.", ops: [] } satisfies CritiqueResponse,
      { status: 200 },
    );
  }

  const user = [
    "# 캔버스 크기",
    `width=${req.doc.width}, height=${req.doc.height}`,
    "",
    `# 현재 페이지(${page?.name ?? ""})의 요소들 (shapes)`,
    JSON.stringify(shapes, null, 2),
    "",
    '위 레이아웃의 정렬·간격 문제를 비평하고 수정 ops를 {"critique":"...","ops":[...],"message":"..."} 형식의 순수 JSON으로만 출력하라.',
  ].join("\n");

  let raw: string;
  try {
    raw = await runClaude(SYSTEM, user);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { critique: "", ops: [], message: `AI 호출 실패: ${message}` } satisfies CritiqueResponse,
      { status: 500 },
    );
  }

  const parsed = extractJsonObject<{
    critique?: unknown;
    ops?: unknown;
    message?: unknown;
  }>(raw);
  if (!parsed) {
    return NextResponse.json(
      {
        critique: "",
        ops: [],
        message: `AI 응답 파싱 실패: ${raw.slice(0, 200)}`,
      } satisfies CritiqueResponse,
      { status: 200 },
    );
  }

  // Sanitize: update-only, existing unlocked/visible targets only.
  const editable = new Set(
    shapes.filter((sh) => !sh.locked && sh.visible).map((sh) => sh.id),
  );
  const ops = (Array.isArray(parsed.ops) ? (parsed.ops as DesignOp[]) : []).filter(
    (op) => op.op === "update" && !!op.id && editable.has(op.id) && !!op.shape,
  );
  const critique =
    typeof parsed.critique === "string" && parsed.critique.trim()
      ? parsed.critique.trim()
      : "비평 내용을 생성하지 못했습니다.";
  const message = typeof parsed.message === "string" ? parsed.message : undefined;
  return NextResponse.json(
    { critique, ops, message } satisfies CritiqueResponse,
    { status: 200 },
  );
}
