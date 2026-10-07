// POST /api/design/palette — brand palette + font pairing suggestion.
// {keywords} → claude CLI → {name, colors:[{role,hex}], fonts:{heading,body}}.
// Note: no shared "jarvis" palette token spec exists in the codebase (jarvis
// is a Mantine color name only), so the fallback contract above is used.
import { NextResponse } from "next/server";
import { runClaude } from "../../../../lib/director/claude-cli";
import { extractJsonObject } from "../../../../lib/director/extract-json";
import type {
  PaletteColor,
  PaletteResponse,
  PaletteSuggestion,
} from "../../../../lib/design/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_COLORS = 8;

const SYSTEM = `너는 브랜드 디자인 어시스턴트다. 주어진 키워드에 어울리는 브랜드 컬러 팔레트와 폰트 페어링을 제안한다. 출력은 반드시 아래 형식의 순수 JSON 단일 객체만:
{"palette":{"name":"<팔레트 이름>","colors":[{"role":"<역할>","hex":"#RRGGBB"}],"fonts":{"heading":"<제목 폰트>","body":"<본문 폰트>"}},"message":"<한 줄 설명>"}

규칙:
- colors는 5~6개. role은 "primary","secondary","accent","background","surface","text" 중에서 사용하고 중복하지 않는다.
- hex는 #RRGGBB 6자리만. 명도 대비를 고려해 background/text는 가독성이 확보되게 고른다.
- 폰트는 한국어를 지원하는 웹폰트 위주로 제안한다 (예: Pretendard, Noto Sans KR, Nanum Gothic, Gowun Dodum 등).
- 출력은 JSON 단일 객체만. 설명 문장·코드펜스 금지.`;

function sanitizePalette(value: unknown): PaletteSuggestion | null {
  if (typeof value !== "object" || value === null) return null;
  const p = value as Record<string, unknown>;
  const name = typeof p.name === "string" && p.name.trim() ? p.name.trim() : "제안 팔레트";
  const rawColors = Array.isArray(p.colors) ? p.colors : [];
  const colors: PaletteColor[] = [];
  for (const c of rawColors) {
    if (typeof c !== "object" || c === null) continue;
    const role = (c as Record<string, unknown>).role;
    const hex = (c as Record<string, unknown>).hex;
    if (typeof role !== "string" || typeof hex !== "string") continue;
    if (!HEX_RE.test(hex.trim())) continue;
    colors.push({ role: role.trim(), hex: hex.trim().toUpperCase() });
    if (colors.length >= MAX_COLORS) break;
  }
  if (colors.length === 0) return null;
  const rawFonts =
    typeof p.fonts === "object" && p.fonts !== null
      ? (p.fonts as Record<string, unknown>)
      : {};
  const fonts = {
    heading: typeof rawFonts.heading === "string" && rawFonts.heading.trim() ? rawFonts.heading.trim() : "Pretendard",
    body: typeof rawFonts.body === "string" && rawFonts.body.trim() ? rawFonts.body.trim() : "Pretendard",
  };
  return { name, colors, fonts };
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { palette: null, message: "요청 본문 JSON 파싱 실패" } satisfies PaletteResponse,
      { status: 400 },
    );
  }
  const keywords =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).keywords
      : undefined;
  if (typeof keywords !== "string" || keywords.trim().length === 0) {
    return NextResponse.json(
      { palette: null, message: "keywords 누락" } satisfies PaletteResponse,
      { status: 400 },
    );
  }

  const user = [
    "# 브랜드 키워드",
    keywords.trim(),
    "",
    "위 키워드에 어울리는 팔레트를 지정된 JSON 형식으로만 출력하라.",
  ].join("\n");

  let raw: string;
  try {
    raw = await runClaude(SYSTEM, user);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { palette: null, message: `AI 호출 실패: ${message}` } satisfies PaletteResponse,
      { status: 500 },
    );
  }

  const parsed = extractJsonObject<{ palette?: unknown; message?: unknown }>(raw);
  // The model may also emit the palette object at the top level.
  const palette = sanitizePalette(parsed?.palette) ?? sanitizePalette(parsed);
  if (!palette) {
    return NextResponse.json(
      {
        palette: null,
        message: `AI 응답 파싱 실패: ${raw.slice(0, 200)}`,
      } satisfies PaletteResponse,
      { status: 200 },
    );
  }
  const message =
    parsed && typeof parsed.message === "string" ? parsed.message : undefined;
  return NextResponse.json({ palette, message } satisfies PaletteResponse, {
    status: 200,
  });
}
