// 스캔 결과 + 삭제 안전도를 종합해 자연어 "정리 플랜"을 생성한다 (로컬 Claude CLI, 유료 API 미사용).
// 실제 삭제 로직은 건드리지 않으며, 사용자에게 실행 순서·회수 용량·배치 제안만 제공한다.
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { runClaude, extractJson, claudeErrorDetail } from "@/lib/claude-cli";
import type { SafetyRating } from "@/lib/ai/safety-rules";

const TIMEOUT_MS = 90_000;
const MAX_ITEMS = 200;

interface PlanItemInput {
  path: string;
  size: number;
  category?: string;
  safety?: SafetyRating;
}

interface PlanBatch {
  title: string;
  paths: string[];
  reclaimMb: number;
  note: string;
}

interface CleanupPlan {
  summary: string;
  totalReclaimMb: number;
  batches: PlanBatch[];
}

const VALID_SAFETY = new Set<string>(["safe", "caution", "danger"]);

/** 입력 items를 정제: path/size 필수, category/safety는 있으면 유지. */
function sanitizeItems(raw: unknown): PlanItemInput[] {
  if (!Array.isArray(raw)) return [];
  const out: PlanItemInput[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.path !== "string" || e.path.length === 0) continue;
    if (typeof e.size !== "number" || !Number.isFinite(e.size) || e.size < 0) continue;
    const item: PlanItemInput = { path: e.path, size: e.size };
    if (typeof e.category === "string" && e.category.length > 0) item.category = e.category;
    if (typeof e.safety === "string" && VALID_SAFETY.has(e.safety)) item.safety = e.safety as SafetyRating;
    out.push(item);
  }
  return out;
}

function bytesToMb(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

export async function POST(req: Request) {
  let items: PlanItemInput[] = [];
  let targetMb: number | undefined;
  try {
    const body = await req.json();
    items = sanitizeItems(body?.items);
    if (typeof body?.targetMb === "number" && body.targetMb > 0) targetMb = Math.round(body.targetMb);
  } catch {
    // fall through to validation error
  }
  if (items.length === 0) {
    return NextResponse.json({ ok: false, error: "items가 비어 있습니다" }, { status: 400 });
  }

  // 용량 큰 순으로 정렬 후 상한 적용 (프롬프트 크기·비용 제어).
  const sorted = [...items].sort((a, b) => b.size - a.size).slice(0, MAX_ITEMS);
  const totalReclaimMb = bytesToMb(sorted.reduce((s, i) => s + i.size, 0));

  const lines = sorted.map((i) => {
    const safety = i.safety ?? "unknown";
    const cat = i.category ? ` [${i.category}]` : "";
    return `- ${i.path}${cat} | ${bytesToMb(i.size)} MB | 안전도: ${safety}`;
  });

  const prompt = [
    `당신은 디스크 정리 도우미입니다. 아래 스캔된 파일/폴더 목록을 바탕으로 이번 주 정리 플랜을 한국어로 제안하세요.`,
    ``,
    `규칙:`,
    `- 안전도가 "safe"인 항목을 가장 먼저, 그 다음 "caution", 마지막에 "danger" 순서로 배치합니다.`,
    `- 안전도가 "unknown"인 항목은 안전도 정보가 없으므로 보수적으로 위험(danger)에 준해 취급하고, 사용자가 직접 확인하도록 안내합니다.`,
    `- 각 단계(배치) 안에서는 용량이 큰 항목을 우선합니다.`,
    `- 배치는 3~5개로 나누고, 안전한 것부터 실행하도록 구성합니다.`,
    `- 각 배치의 reclaimMb는 그 배치에 포함된 paths의 용량 합(MB)입니다.`,
    `- note에는 해당 배치를 왜 그 순서에 두었는지, 주의할 점을 한 문장으로 씁니다.`,
    `- summary는 "이번 주 약 N MB 확보 플랜" 형태로, 총 회수 용량과 전체 흐름을 2~3문장으로 요약합니다.`,
    targetMb
      ? `- 목표 회수량은 약 ${targetMb} MB입니다. 안전한 항목부터 이 목표에 도달하도록 우선순위를 잡되, 목표 초과 시에도 나머지는 후순위 배치로 포함하세요.`
      : `- 별도 목표 회수량은 없습니다. 확보 가능한 전체 용량을 안전 순서로 회수하는 플랜을 제안하세요.`,
    ``,
    `아래 JSON 스키마로만 응답하세요. 코드펜스·설명 없이 JSON 객체만 출력합니다.`,
    `{ "summary": string, "totalReclaimMb": number, "batches": [ { "title": string, "paths": string[], "reclaimMb": number, "note": string } ] }`,
    `- paths에는 반드시 아래 목록에 존재하는 경로만 사용합니다.`,
    ``,
    `스캔 목록 (총 ${sorted.length}개, 합계 ${totalReclaimMb} MB):`,
    ...lines,
  ].join("\n");

  try {
    const raw = await runClaude(prompt, { timeoutMs: TIMEOUT_MS, feature: "cleanup-plan" });
    const parsed = extractJson<CleanupPlan>(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.batches)) {
      return NextResponse.json(
        { ok: false, error: "AI 응답에서 플랜 JSON을 추출하지 못했습니다" },
        { status: 500 },
      );
    }
    // 응답 정제: 존재하지 않는 경로 제거, 필드 타입 보정.
    const known = new Set(sorted.map((i) => i.path));
    const batches: PlanBatch[] = parsed.batches
      .filter((b): b is PlanBatch => !!b && typeof b === "object")
      .map((b) => {
        const paths = Array.isArray(b.paths)
          ? b.paths.filter((p): p is string => typeof p === "string" && known.has(p))
          : [];
        return {
          title: typeof b.title === "string" ? b.title : "",
          paths,
          reclaimMb: typeof b.reclaimMb === "number" ? b.reclaimMb : 0,
          note: typeof b.note === "string" ? b.note : "",
        };
      });

    const plan: CleanupPlan = {
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      totalReclaimMb: typeof parsed.totalReclaimMb === "number" ? parsed.totalReclaimMb : totalReclaimMb,
      batches,
    };
    return NextResponse.json({ ok: true, plan });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: claudeErrorDetail(err, TIMEOUT_MS) },
      { status: 500 },
    );
  }
}
