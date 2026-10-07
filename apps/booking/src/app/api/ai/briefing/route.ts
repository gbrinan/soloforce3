import { NextRequest, NextResponse } from "next/server";
import { runClaude, claudeErrorDetail, DEFAULT_TIMEOUT_MS } from "@/lib/claude-cli";

// Cross-app data (contacts/mail history) is not directly accessible from this
// app, so any extra attendee context must be provided in the request payload.
interface BriefingRequest {
  attendeeName: string;
  attendeeEmail: string;
  meetingTitle: string;
  notes?: string;
  context?: string; // optional extra context supplied by the caller
}

function buildPrompt(req: BriefingRequest): string {
  return [
    "아래 미팅 정보를 바탕으로 미팅 전에 훑어볼 한국어 브리핑을 정확히 3줄로 작성하세요.",
    "- 1줄: 참석자가 누구인지 요약",
    "- 2줄: 미팅 목적/안건 요약",
    "- 3줄: 준비하거나 확인할 포인트 1가지",
    "- 각 줄은 한 문장으로 짧게. 3줄 텍스트만 출력하고 다른 설명은 붙이지 마세요.",
    "",
    "[미팅 정보]",
    `참석자: ${req.attendeeName} (${req.attendeeEmail})`,
    `미팅 제목: ${req.meetingTitle}`,
    ...(req.notes ? [`메모: ${req.notes}`] : []),
    ...(req.context ? [`추가 컨텍스트: ${req.context}`] : []),
  ].join("\n");
}

export async function POST(request: NextRequest) {
  let body: BriefingRequest;
  try {
    body = (await request.json()) as BriefingRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.attendeeName || !body.attendeeEmail || !body.meetingTitle) {
    return NextResponse.json(
      { error: "Missing required fields: attendeeName, attendeeEmail, meetingTitle" },
      { status: 400 },
    );
  }

  try {
    const briefing = await runClaude(buildPrompt(body));
    if (!briefing) {
      return NextResponse.json({ error: "Claude returned empty response" }, { status: 502 });
    }
    return NextResponse.json({ briefing });
  } catch (err) {
    const detail = claudeErrorDetail(err, DEFAULT_TIMEOUT_MS);
    console.error("[briefing] claude exec error:", detail);
    return NextResponse.json(
      { error: "Failed to generate briefing", detail },
      { status: 500 },
    );
  }
}
