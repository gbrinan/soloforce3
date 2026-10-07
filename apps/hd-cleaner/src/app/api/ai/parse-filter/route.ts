// Natural language → scan filter conversion via local Claude CLI (no paid API).
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { runClaude, extractJson, claudeErrorDetail } from "@/lib/claude-cli";
import type { ScanFilter } from "@/lib/scanner/common";

const TIMEOUT_MS = 60_000;

/** Sanitize the parsed filter: keep only known keys with valid value types. */
function sanitizeFilter(raw: unknown): ScanFilter {
  const out: ScanFilter = {};
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  if (typeof r.minSizeMB === "number" && r.minSizeMB > 0) out.minSizeMB = r.minSizeMB;
  if (typeof r.olderThanDays === "number" && r.olderThanDays > 0) {
    out.olderThanDays = Math.round(r.olderThanDays);
  }
  if (Array.isArray(r.extensions)) {
    const exts = r.extensions
      .filter((e): e is string => typeof e === "string" && e.trim().length > 0)
      .map((e) => e.trim().replace(/^\./, "").toLowerCase());
    if (exts.length) out.extensions = exts;
  }
  if (Array.isArray(r.pathIncludes)) {
    const incs = r.pathIncludes.filter(
      (e): e is string => typeof e === "string" && e.trim().length > 0,
    );
    if (incs.length) out.pathIncludes = incs.map((e) => e.trim());
  }
  return out;
}

export async function POST(req: Request) {
  let query = "";
  try {
    const body = await req.json();
    if (typeof body?.query === "string") query = body.query.trim();
  } catch {
    // fall through to validation error
  }
  if (!query) {
    return NextResponse.json({ ok: false, error: "query가 비어 있습니다" }, { status: 400 });
  }
  if (query.length > 500) {
    return NextResponse.json({ ok: false, error: "query가 너무 깁니다 (500자 이하)" }, { status: 400 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const prompt = [
    `You convert a Korean natural-language description of files to clean up into a disk-scan filter.`,
    `Today's date is ${today}.`,
    `Return ONLY a JSON object with these optional keys (omit keys not implied by the description):`,
    `- "minSizeMB": number, minimum file size in MB (e.g. "대용량" alone → 100)`,
    `- "olderThanDays": number, files not used/modified for this many days (e.g. "6개월 안 쓴" → 180; absolute dates → days from today)`,
    `- "extensions": string array of file extensions without dots (e.g. "영상" → ["mp4","mov","avi","mkv","webm"])`,
    `- "pathIncludes": string array of path substrings to match (e.g. "다운로드 폴더" → ["Downloads"])`,
    `No explanations, no code fences. JSON only.`,
    ``,
    `Description: ${query}`,
  ].join("\n");

  try {
    const raw = await runClaude(prompt, TIMEOUT_MS);
    const parsed = extractJson<Record<string, unknown>>(raw);
    if (!parsed) {
      return NextResponse.json(
        { ok: false, error: "AI 응답에서 JSON을 추출하지 못했습니다" },
        { status: 502 },
      );
    }
    const filter = sanitizeFilter(parsed);
    if (Object.keys(filter).length === 0) {
      return NextResponse.json(
        { ok: false, error: "설명에서 필터 조건을 찾지 못했습니다. 크기·기간·확장자 등을 포함해 주세요" },
        { status: 422 },
      );
    }
    return NextResponse.json({ ok: true, filter });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: claudeErrorDetail(err, TIMEOUT_MS) },
      { status: 502 },
    );
  }
}
