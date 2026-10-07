import { NextRequest, NextResponse } from "next/server";
import {
  runClaude,
  extractJson,
  claudeErrorDetail,
  stripHtml,
} from "@/lib/claude-cli";

interface ExtractEventsRequest {
  subject: string;
  body: string;
}

export interface ExtractedEvent {
  title: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:mm
  location?: string;
}

function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function buildPrompt(req: ExtractEventsRequest, today: string): string {
  return [
    "아래 이메일에서 일정(미팅·행사·마감 등)을 추출해서 JSON으로만 답하세요. 다른 설명은 붙이지 마세요.",
    '형식: {"events": [{"title": "일정 제목", "date": "YYYY-MM-DD", "time": "HH:mm", "location": "장소"}]}',
    `- 오늘 날짜는 ${today}입니다. "내일", "다음 주 화요일" 같은 상대 날짜는 이 기준으로 절대 날짜로 변환하세요.`,
    "- time과 location은 본문에 없으면 생략하세요.",
    "- 일정이 없으면 {\"events\": []}를 반환하세요.",
    "",
    `제목: ${req.subject}`,
    `본문: ${stripHtml(req.body).slice(0, 3000)}`,
  ].join("\n");
}

export async function POST(request: NextRequest) {
  let body: ExtractEventsRequest;
  try {
    body = (await request.json()) as ExtractEventsRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.subject || !body.body) {
    return NextResponse.json(
      { error: "Missing required fields: subject, body" },
      { status: 400 },
    );
  }

  try {
    const raw = await runClaude(buildPrompt(body, todayISO()));
    const parsed = extractJson<{ events?: Array<Partial<ExtractedEvent>> }>(raw);
    if (!parsed || !Array.isArray(parsed.events)) {
      return NextResponse.json(
        { error: "Claude returned unparsable response" },
        { status: 502 },
      );
    }
    const events: ExtractedEvent[] = parsed.events
      .filter((e) => typeof e.title === "string" && typeof e.date === "string")
      .map((e) => ({
        title: e.title as string,
        date: e.date as string,
        time: typeof e.time === "string" ? e.time : undefined,
        location: typeof e.location === "string" ? e.location : undefined,
      }));
    return NextResponse.json({ events });
  } catch (err) {
    const detail = claudeErrorDetail(err);
    console.error("[extract-events] claude exec error:", detail);
    return NextResponse.json(
      { error: "Failed to extract events", detail },
      { status: 500 },
    );
  }
}
