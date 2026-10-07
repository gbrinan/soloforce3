import { NextRequest, NextResponse } from "next/server";
import {
  runClaude,
  extractJson,
  claudeErrorDetail,
} from "@/lib/claude-cli";

interface TriageRequest {
  subject: string;
  from: string;
  text: string;
}

type TriageKind = "bug" | "idea" | "other";
type TriageSeverity = "critical" | "high" | "normal" | "low";

interface TriageResult {
  kind: TriageKind;
  severity: TriageSeverity | null;
  app: string | null;
  confidence: number;
  title: string;
  summary: string;
  source: "rule" | "claude" | "fallback";
}

const MAX_TEXT_LEN = 4000;

// MyCrew app candidates for classification (host = MyCrew core).
const APP_CANDIDATES = [
  "diary", "mail", "store", "ledger", "bookshelf", "learn", "calc", "notes",
  "pdf", "booking", "mymaps", "movie", "design", "sign", "approval",
  "hd-cleaner", "host", "unknown",
];

// Rule pre-filter dictionaries — hints only, never a final verdict.
const BUG_KW = [
  "장애", "오류", "버그", "에러", "안 됨", "안됨", "안 돼", "안돼", "깨짐", "깨져",
  "먹통", "실패", "crash", "error", "bug", "broken", "fail", "not working",
];
const IDEA_KW = [
  "제안", "아이디어", "기능 요청", "기능요청", "있었으면", "추가해", "개선",
  "suggest", "suggestion", "feature", "request", "idea", "would be nice",
];

function containsAny(haystack: string, needles: string[]): boolean {
  const h = haystack.toLowerCase();
  return needles.some((n) => h.includes(n.toLowerCase()));
}

function ruleHint(subject: string, text: string): TriageKind | null {
  const haystack = `${subject}\n${text}`;
  const bugHit = containsAny(haystack, BUG_KW);
  const ideaHit = containsAny(haystack, IDEA_KW);
  if (bugHit && !ideaHit) return "bug";
  if (ideaHit && !bugHit) return "idea";
  if (bugHit && ideaHit) return "bug"; // 버그 신고가 우선
  return null;
}

function buildPrompt(req: TriageRequest, text: string, hint: TriageKind | null): string {
  return [
    "당신은 MyCrew(마이크루) 제품의 수신 메일을 분류하는 어시스턴트입니다.",
    "MyCrew는 여러 서브 앱으로 구성된 개인 AI 크루 시스템입니다.",
    `앱 후보: ${APP_CANDIDATES.join(", ")} (host는 마이크루 본체, 특정 불가 시 unknown)`,
    "",
    "아래 메일을 분석해서 JSON으로만 답하세요. 다른 설명·마크다운은 붙이지 마세요.",
    "형식:",
    '{"kind": "bug"|"idea"|"other", "severity": "critical"|"high"|"normal"|"low"|null, "app": "<앱 후보 중 하나>"|null, "confidence": 0~1 숫자, "title": "한국어 60자 이내 제목", "summary": "한국어 200자 이내 요약(버그면 증상·재현 포함, 아이디어면 요지)"}',
    "- kind: bug=장애·오류·버그 신고, idea=기능 제안·아이디어, other=그 외",
    "- severity: kind가 bug일 때만 판정, 아니면 null",
    "- app: 관련 앱을 후보 중에서 선택, 판단 불가면 unknown 또는 null",
    "- confidence: 분류 확신도 (0~1)",
    hint ? `- 참고: 룰 기반 프리필터는 이 메일을 "${hint}" 후보로 감지했습니다 (힌트일 뿐 최종 판단은 내용 기반).` : "",
    "",
    `발신자: ${req.from}`,
    `제목: ${req.subject}`,
    `본문: ${text}`,
  ].filter((line) => line !== "").join("\n");
}

const KINDS: TriageKind[] = ["bug", "idea", "other"];
const SEVERITIES: TriageSeverity[] = ["critical", "high", "normal", "low"];

function clampConfidence(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

function fallbackResult(req: TriageRequest, hint: TriageKind | null): TriageResult {
  return {
    kind: hint ?? "other",
    severity: hint === "bug" ? "normal" : null,
    app: null,
    confidence: 0.3,
    title: req.subject.slice(0, 60),
    summary: "",
    source: "fallback",
  };
}

export async function POST(request: NextRequest) {
  let body: TriageRequest;
  try {
    body = (await request.json()) as TriageRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.subject || !body.from || typeof body.text !== "string") {
    return NextResponse.json(
      { error: "Missing required fields: subject, from, text" },
      { status: 400 },
    );
  }

  const text = body.text.slice(0, MAX_TEXT_LEN);

  // Rule pre-filter: hint only — always confirmed by Claude CLI.
  const hint = ruleHint(body.subject, text);

  try {
    const raw = await runClaude(buildPrompt(body, text, hint));
    const parsed = extractJson<{
      kind?: string;
      severity?: string | null;
      app?: string | null;
      confidence?: unknown;
      title?: string;
      summary?: string;
    }>(raw);
    if (!parsed) throw new Error("triage: no JSON in claude output");

    const kind = KINDS.includes(parsed.kind as TriageKind)
      ? (parsed.kind as TriageKind)
      : (hint ?? "other");
    const severity =
      kind === "bug" && SEVERITIES.includes(parsed.severity as TriageSeverity)
        ? (parsed.severity as TriageSeverity)
        : null;
    const app =
      typeof parsed.app === "string" && APP_CANDIDATES.includes(parsed.app)
        ? parsed.app
        : null;

    const result: TriageResult = {
      kind,
      severity,
      app,
      confidence: clampConfidence(parsed.confidence),
      title: (parsed.title || body.subject).slice(0, 60),
      summary: (parsed.summary || "").slice(0, 200),
      source: "claude",
    };
    return NextResponse.json(result);
  } catch (err) {
    // Triage is best-effort: degrade to rule hint instead of erroring.
    console.error("[triage] claude exec error:", claudeErrorDetail(err));
    return NextResponse.json(fallbackResult(body, hint));
  }
}
