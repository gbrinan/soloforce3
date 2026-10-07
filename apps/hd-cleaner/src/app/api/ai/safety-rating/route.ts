// Hybrid deletion-safety rating: rule engine first, Claude CLI batch for the rest.
// Display-only labels — actual deletion logic is untouched.
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { runClaude, extractJson } from "@/lib/claude-cli";
import { ruleBasedRating, type SafetyRating, type SafetyResult } from "@/lib/ai/safety-rules";

const MAX_PATHS = 500;
const AI_BATCH_MAX = 50;
const TIMEOUT_MS = 90_000;

const VALID_RATINGS = new Set<string>(["safe", "caution", "danger"]);

/** One-shot batch judgement for paths the rule engine could not classify. */
async function aiBatchRating(paths: string[]): Promise<Map<string, SafetyRating>> {
  const prompt = [
    `You rate how safe it is to delete each file/folder path on a personal computer.`,
    `Ratings: "safe" (caches, temp, regenerable), "danger" (user documents, project source, irreplaceable), "caution" (uncertain or mixed).`,
    `Return ONLY a JSON array like [{"path":"...","rating":"safe"}] covering every input path. No explanations, no code fences.`,
    ``,
    `Paths:`,
    ...paths.map((p) => `- ${p}`),
  ].join("\n");

  const map = new Map<string, SafetyRating>();
  try {
    const raw = await runClaude(prompt, TIMEOUT_MS);
    const arr = extractJson<Array<{ path?: unknown; rating?: unknown }>>(raw);
    if (Array.isArray(arr)) {
      for (const entry of arr) {
        if (
          typeof entry?.path === "string" &&
          typeof entry?.rating === "string" &&
          VALID_RATINGS.has(entry.rating)
        ) {
          map.set(entry.path, entry.rating as SafetyRating);
        }
      }
    }
  } catch (err) {
    // AI failure is non-fatal — callers fall back to "caution".
    console.warn("[safety-rating] Claude CLI batch failed:", err instanceof Error ? err.message : err);
  }
  return map;
}

export async function POST(req: Request) {
  let paths: string[] = [];
  try {
    const body = await req.json();
    if (Array.isArray(body?.paths)) {
      paths = body.paths.filter((p: unknown): p is string => typeof p === "string" && p.length > 0);
    }
  } catch {
    // fall through to validation error
  }
  if (paths.length === 0) {
    return NextResponse.json({ ok: false, error: "paths가 비어 있습니다" }, { status: 400 });
  }
  paths = [...new Set(paths)].slice(0, MAX_PATHS);

  // 1st pass: rule engine.
  const results: SafetyResult[] = [];
  const unresolved: string[] = [];
  const ruleMap = new Map<string, SafetyRating>();
  for (const p of paths) {
    const rating = ruleBasedRating(p);
    if (rating) ruleMap.set(p, rating);
    else unresolved.push(p);
  }

  // 2nd pass: single Claude CLI batch for unresolved paths (capped at AI_BATCH_MAX).
  const aiTargets = unresolved.slice(0, AI_BATCH_MAX);
  const aiMap = aiTargets.length > 0 ? await aiBatchRating(aiTargets) : new Map<string, SafetyRating>();

  for (const p of paths) {
    const rule = ruleMap.get(p);
    if (rule) {
      results.push({ path: p, rating: rule, source: "rule" });
      continue;
    }
    const ai = aiMap.get(p);
    if (ai) {
      results.push({ path: p, rating: ai, source: "ai" });
      continue;
    }
    // AI failed, path malformed in response, or beyond batch cap → conservative default.
    results.push({ path: p, rating: "caution", source: "fallback" });
  }

  return NextResponse.json({ ok: true, ratings: results });
}
