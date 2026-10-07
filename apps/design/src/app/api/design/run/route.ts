// POST /api/design/run — 디자인 AI 편집 엔드포인트.
// body(DesignRunRequest) → 프롬프트 빌드 → claude CLI 호출 → ops JSON 추출 → DesignRunResponse.
import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildDesignPrompt } from "../../../../lib/director/prompt";
import { runClaude } from "../../../../lib/director/claude-cli";
import type {
  DesignRunRequest,
  DesignRunResponse,
  DesignOp,
  ImageShape,
  Shape,
} from "../../../../lib/design/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1";
const IMAGE_TIMEOUT_MS = 120_000;
const DEFAULT_IMAGE_SIZE = "1024x1024";
const CODEX_AUTH = join(homedir(), ".codex", "auth.json");

// 가벼운 런타임 검증 (zod 없이). 실패 시 사유 문자열 반환, 성공 시 null.
function validate(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return "body가 객체가 아님";
  const b = body as Record<string, unknown>;
  if (typeof b.doc !== "object" || b.doc === null) return "doc 누락 또는 비객체";
  const doc = b.doc as Record<string, unknown>;
  if (!Array.isArray(doc.pages)) return "doc.pages가 배열이 아님";
  if (typeof b.pageId !== "string" || b.pageId.length === 0)
    return "pageId 누락";
  if (!Array.isArray(b.selectedIds)) return "selectedIds가 배열이 아님";
  if (typeof b.intent !== "string") return "intent가 문자열이 아님";
  return null;
}

// 응답 텍스트에서 JSON 객체 추출.
// ```json 코드펜스 제거 후 맨 처음 '{'부터 매칭되는 '}'까지 잘라 파싱.
function extractJson(text: string): DesignRunResponse | null {
  let s = text.trim();
  // 코드펜스 제거.
  s = s.replace(/```(?:json)?/gi, "").trim();
  const start = s.indexOf("{");
  if (start === -1) return null;
  // 중괄호 균형 매칭 (문자열 리터럴 내부 무시).
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) {
        esc = false;
      } else if (ch === "\\") {
        esc = true;
      } else if (ch === '"') {
        inStr = false;
      }
      continue;
    }
    if (ch === '"') {
      inStr = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return null;
  const slice = s.slice(start, end + 1);
  try {
    const parsed = JSON.parse(slice) as {
      ops?: unknown;
      message?: unknown;
      warnings?: unknown;
    };
    const ops = Array.isArray(parsed.ops) ? (parsed.ops as DesignOp[]) : [];
    const message =
      typeof parsed.message === "string" ? parsed.message : undefined;
    const warnings = Array.isArray(parsed.warnings)
      ? parsed.warnings.filter((w: unknown): w is string => typeof w === "string")
      : undefined;
    return { ops, message, warnings };
  } catch {
    return null;
  }
}

function isImageIntent(intent: string, selectedShapes: Shape[]): boolean {
  const s = intent.toLowerCase();
  if (
    /(이미지|사진|그림|일러스트|그래픽|비주얼|썸네일|배경).*(만들|생성|그려|추가|바꿔|변경|편집|수정|재생성)/.test(s) ||
    /(make|create|generate|draw|add|edit|replace|regenerate).*(image|photo|picture|illustration|graphic|visual)/.test(s) ||
    /(image|photo|picture|illustration|graphic|visual).*(make|create|generate|draw|add|edit|replace|regenerate)/.test(s)
  ) {
    return true;
  }
  return selectedShapes.some((shape) => shape.type === "image") &&
    /(바꿔|변경|편집|수정|재생성|replace|edit|regenerate|change)/.test(s);
}

function imagePromptFromIntent(intent: string): string {
  const cleaned = intent
    .replace(/(이미지|사진|그림|일러스트|그래픽|비주얼|썸네일|배경)(을|를)?/g, " ")
    .replace(/(만들어줘|생성해줘|그려줘|추가해줘|바꿔줘|수정해줘|편집해줘|재생성해줘)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || intent.trim();
}

function findStringDeep(value: unknown, keys: Set<string>): string | null {
  if (typeof value === "string") return null;
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStringDeep(item, keys);
      if (found) return found;
    }
    return null;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (keys.has(key) && typeof nested === "string" && nested.length > 0) {
      return nested;
    }
    const found = findStringDeep(nested, keys);
    if (found) return found;
  }
  return null;
}

function getOpenAIAuthHeader(): { header?: string; error?: string } {
  const envKey = process.env.OPENAI_API_KEY;
  if (envKey) return { header: `Bearer ${envKey}` };

  if (!existsSync(CODEX_AUTH)) {
    return {
      error:
        "Codex/OpenAI 인증 필요. 사장님이 터미널에서 `codex login` 실행 필요합니다.",
    };
  }

  try {
    const parsed = JSON.parse(readFileSync(CODEX_AUTH, "utf-8")) as unknown;
    const apiKey = findStringDeep(
      parsed,
      new Set(["OPENAI_API_KEY", "openai_api_key", "api_key", "apiKey"]),
    );
    if (apiKey) return { header: `Bearer ${apiKey}` };
    const accessToken = findStringDeep(
      parsed,
      new Set(["access_token", "accessToken", "id_token", "idToken"]),
    );
    if (accessToken) return { header: `Bearer ${accessToken}` };
  } catch {
    return { error: "Codex 인증 파일을 읽을 수 없습니다. `codex login` 재실행이 필요합니다." };
  }

  return {
    error:
      "Codex 인증 파일에서 이미지 API 토큰을 찾지 못했습니다. `codex login` 재실행 또는 OPENAI_API_KEY 설정이 필요합니다.",
  };
}

function findGeneratedImage(value: unknown): { b64?: string; url?: string } | null {
  const b64 = findStringDeep(value, new Set(["b64_json", "base64", "image_base64"]));
  if (b64) return { b64 };
  const url = findStringDeep(value, new Set(["url", "href"]));
  if (url) return { url };
  return null;
}

async function generateImageDataUrl(prompt: string): Promise<{ href?: string; warning?: string; error?: string }> {
  const auth = getOpenAIAuthHeader();
  if (!auth.header) return { error: auth.error ?? "OpenAI 인증 정보를 찾지 못했습니다." };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  try {
    const res = await fetch(process.env.OPENAI_IMAGE_API_URL ?? "https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: auth.header,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        prompt,
        size: DEFAULT_IMAGE_SIZE,
        n: 1,
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const apiMessage = findStringDeep(json, new Set(["message", "error", "detail"]));
      return {
        error: `이미지 생성 API 실패(${res.status}): ${apiMessage ?? text.slice(0, 200)}`,
      };
    }
    const image = findGeneratedImage(json);
    if (!image) return { error: "이미지 생성 API 응답에서 이미지 데이터를 찾지 못했습니다." };
    if (image.b64) return { href: `data:image/png;base64,${image.b64}` };
    return { href: image.url, warning: "API가 base64 대신 URL을 반환해 href에 URL을 사용했습니다." };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `이미지 생성 호출 실패: ${message}` };
  } finally {
    clearTimeout(timer);
  }
}

function buildImageShape(req: DesignRunRequest, href: string, prompt: string, target?: Shape): ImageShape {
  const width = target?.width ?? Math.min(512, Math.max(240, req.doc.width - 96));
  const height = target?.height ?? Math.min(512, Math.max(240, req.doc.height - 96));
  const x = target?.x ?? Math.round((req.doc.width - width) / 2);
  const y = target?.y ?? Math.round((req.doc.height - height) / 2);
  return {
    id: target?.id ?? `img-${randomUUID()}`,
    type: "image",
    name: target?.name ?? "Generated image",
    x,
    y,
    width,
    height,
    rotation: target?.rotation ?? 0,
    opacity: target?.opacity ?? 1,
    fill: "none",
    stroke: "none",
    strokeWidth: 0,
    radius: target?.radius ?? 0,
    visible: true,
    locked: false,
    parentId: target?.parentId ?? null,
    href,
    alt: prompt,
    sourcePrompt: prompt,
    generatedAt: new Date().toISOString(),
  };
}

function sanitizeOps(req: DesignRunRequest, result: DesignRunResponse): DesignRunResponse {
  const page = req.doc.pages.find((p) => p.id === req.pageId);
  const existing = new Set((page?.shapes ?? []).map((shape) => shape.id));
  const selected = new Set(req.selectedIds ?? []);
  const warnings = [...(result.warnings ?? [])];
  const ops: DesignOp[] = [];

  for (const op of result.ops ?? []) {
    if (op.op === "add") {
      if (op.shape && typeof op.shape.type === "string") ops.push(op);
      else warnings.push("shape가 없는 add op를 제거했습니다.");
      continue;
    }
    if (!op.id || !existing.has(op.id)) {
      warnings.push(`${op.op} op의 대상이 현재 페이지에 없어 제거했습니다.`);
      continue;
    }
    if (selected.size > 0 && !selected.has(op.id)) {
      warnings.push(`selectedIds 밖 대상(${op.id}) ${op.op} op를 제거했습니다.`);
      continue;
    }
    ops.push(op);
  }

  return { ops, message: result.message, warnings: warnings.length ? warnings : undefined };
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ops: [], message: "요청 본문 JSON 파싱 실패" } satisfies DesignRunResponse,
      { status: 400 },
    );
  }

  const invalid = validate(body);
  if (invalid) {
    return NextResponse.json(
      { ops: [], message: `요청 검증 실패: ${invalid}` } satisfies DesignRunResponse,
      { status: 400 },
    );
  }

  const req = body as DesignRunRequest;
  const page = req.doc.pages.find((p) => p.id === req.pageId);
  const shapes = page?.shapes ?? [];
  const selected = new Set(req.selectedIds ?? []);
  const selectedShapes = shapes.filter((shape) => selected.has(shape.id));
  if (isImageIntent(req.intent, selectedShapes)) {
    const prompt = imagePromptFromIntent(req.intent);
    const image = await generateImageDataUrl(prompt);
    if (!image.href) {
      return NextResponse.json(
        { ops: [], message: image.error ?? "이미지 생성 실패" } satisfies DesignRunResponse,
        { status: 200 },
      );
    }
    const target = selectedShapes.find((shape) => shape.type === "image") ?? selectedShapes[0];
    const shape = buildImageShape(req, image.href, prompt, target);
    const shapePatch: Partial<ImageShape> = { ...shape };
    delete shapePatch.id;
    const response: DesignRunResponse = target
      ? {
          ops: [{ op: "update", id: target.id, shape: shapePatch }],
          message:
            target.type === "image"
              ? "선택한 이미지 요소를 재생성했습니다."
              : "선택한 요소를 생성 이미지로 교체했습니다.",
        }
      : {
          ops: [{ op: "add", shape }],
          message: "이미지를 생성해 캔버스에 추가했습니다.",
        };
    if (image.warning) response.warnings = [image.warning];
    return NextResponse.json(response, { status: 200 });
  }

  const { system, user } = buildDesignPrompt(req);

  let raw: string;
  try {
    raw = await runClaude(system, user);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ops: [], message: `AI 호출 실패: ${message}` } satisfies DesignRunResponse,
      { status: 500 },
    );
  }

  const result = extractJson(raw);
  if (!result) {
    return NextResponse.json(
      {
        ops: [],
        message: `AI 응답 파싱 실패: ${raw.slice(0, 200)}`,
      } satisfies DesignRunResponse,
      { status: 200 },
    );
  }

  return NextResponse.json(sanitizeOps(req, result) satisfies DesignRunResponse, { status: 200 });
}
