import { NextRequest, NextResponse } from "next/server";
import { runClaude, extractJson, claudeErrorDetail } from "@/lib/claude-cli";

const TIMEOUT_MS = 60_000;

interface PrecheckRequest {
  subject: string;
  body: string;
  to?: string; // 수신자 (콤마 구분 가능)
  hasAttachment?: boolean;
}

type Severity = "high" | "low";

interface PrecheckWarning {
  severity: Severity;
  message: string;
}

interface PrecheckResult {
  warnings: PrecheckWarning[];
  ok: boolean;
}

function buildPrompt(req: PrecheckRequest): string {
  return [
    "당신은 이메일 발송 전 실수를 잡아내는 검사기입니다.",
    "아래 이메일을 검사해 흔한 실수만 지적하고 JSON으로만 답하세요. 다른 설명은 붙이지 마세요.",
    "",
    "다음 4가지만 점검하세요:",
    `1. 첨부 불일치: 본문이 첨부파일을 언급("첨부합니다", "첨부드립니다", "첨부 파일", "attached" 등)하는데 실제 첨부가 없거나(hasAttachment=false), 반대로 첨부가 있는데 본문에 언급이 없는 경우.`,
    "2. 수신자 도메인 오탈자: 수신자 이메일 도메인이 흔한 오타로 의심되는 경우(예: gmial.com, naver.co, gmai.com, hanmail.ne).",
    "3. 본문 자기모순: 본문 내 날짜나 금액이 서로 모순되는 경우(예: 두 곳의 날짜/금액이 불일치).",
    "4. 과격한 어조: 본문에 공격적·모욕적·과격한 표현이 있어 발송 전 재검토가 필요한 경우.",
    "",
    "규칙:",
    "- 위 4가지 외의 항목(맞춤법·문체·마케팅 조언 등)은 절대 지적하지 마세요.",
    "- 확실한 문제만 지적하세요. 애매하면 지적하지 마세요.",
    "- severity: 첨부 불일치·도메인 오탈자·자기모순은 보통 \"high\", 어조 등 경미한 것은 \"low\".",
    "- message는 한국어 한 문장으로 구체적으로 작성하세요.",
    "- 문제가 없으면 warnings는 빈 배열, ok는 true.",
    "",
    '형식: {"warnings": [{"severity": "high"|"low", "message": "..."}], "ok": true|false}',
    "",
    `[첨부 존재 여부] hasAttachment=${req.hasAttachment === true}`,
    `[수신자] ${req.to?.trim() || "(없음)"}`,
    `[제목] ${req.subject}`,
    `[본문]`,
    req.body.slice(0, 4000),
  ].join("\n");
}

export async function POST(request: NextRequest) {
  let body: PrecheckRequest;
  try {
    body = (await request.json()) as PrecheckRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.subject?.trim() || !body.body?.trim()) {
    return NextResponse.json(
      { error: "Missing required fields: subject, body" },
      { status: 400 },
    );
  }

  try {
    // 공용 @mycrew/ai-client 경유 — 게이트웨이(설정 시)·비용집계·레이트리밋 편입.
    const raw = await runClaude(buildPrompt(body), {
      timeoutMs: TIMEOUT_MS,
      feature: "precheck",
    });
    const parsed = extractJson<{ warnings?: unknown; ok?: unknown }>(raw);

    const rawWarnings = Array.isArray(parsed?.warnings) ? parsed!.warnings : [];
    const warnings: PrecheckWarning[] = rawWarnings
      .map((w): PrecheckWarning | null => {
        const item = w as { severity?: unknown; message?: unknown };
        const message = typeof item?.message === "string" ? item.message.trim() : "";
        if (!message) return null;
        const severity: Severity = item?.severity === "high" ? "high" : "low";
        return { severity, message };
      })
      .filter((w): w is PrecheckWarning => w !== null);

    const result: PrecheckResult = { warnings, ok: warnings.length === 0 };
    return NextResponse.json(result);
  } catch (err) {
    const detail = claudeErrorDetail(err, TIMEOUT_MS);
    console.error("[precheck] claude error:", detail);
    return NextResponse.json(
      { error: "Failed to run precheck", detail },
      { status: 500 },
    );
  }
}
