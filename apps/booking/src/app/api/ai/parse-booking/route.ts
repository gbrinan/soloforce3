import { NextRequest, NextResponse } from "next/server";
import {
  runClaude,
  extractJson,
  claudeErrorDetail,
  DEFAULT_TIMEOUT_MS,
} from "@/lib/claude-cli";

interface ParseBookingRequest {
  text: string;
}

export interface ParsedBooking {
  title: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm (24h)
  durationMin: number;
  attendee?: { name?: string; email?: string };
}

const WEEKDAYS_KO = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

// Today in Asia/Seoul with Korean weekday label
function todayInSeoul(): { date: string; weekday: string } {
  const date = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const dayIdx = new Date(`${date}T00:00:00`).getDay();
  return { date, weekday: WEEKDAYS_KO[dayIdx] };
}

function buildPrompt(text: string): string {
  const today = todayInSeoul();
  return [
    "당신은 예약 파싱 도우미입니다. 아래 한국어 자연어 요청을 예약 정보 JSON으로 변환하세요.",
    `오늘은 ${today.date} (${today.weekday})입니다. 상대 날짜(내일, 다음 주 화요일 등)는 반드시 이 날짜 기준으로 해석하세요.`,
    "- '다음 주'는 오늘이 속한 주의 다음 주(월요일 시작)를 의미합니다.",
    "- 시간이 모호하면 오전은 10:00, 오후는 14:00, 저녁은 19:00으로 해석하세요.",
    "- 길이가 명시되지 않으면 durationMin은 30으로 하세요.",
    "- 참석자 이름/이메일이 언급되면 attendee에 넣고, 없으면 attendee를 생략하세요.",
    "아래 JSON 스키마로만 출력하고 다른 설명은 절대 붙이지 마세요:",
    '{"title": "미팅 제목(한국어)", "date": "YYYY-MM-DD", "startTime": "HH:mm", "durationMin": 30, "attendee": {"name": "이름", "email": "이메일"}}',
    "",
    "[요청]",
    text,
  ].join("\n");
}

export async function POST(request: NextRequest) {
  let body: ParseBookingRequest;
  try {
    body = (await request.json()) as ParseBookingRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.text?.trim()) {
    return NextResponse.json({ error: "Missing required field: text" }, { status: 400 });
  }

  try {
    const raw = await runClaude(buildPrompt(body.text.trim()));
    const parsed = extractJson<ParsedBooking>(raw);

    if (
      !parsed ||
      !/^\d{4}-\d{2}-\d{2}$/.test(parsed.date ?? "") ||
      !/^\d{2}:\d{2}$/.test(parsed.startTime ?? "") ||
      typeof parsed.durationMin !== "number" ||
      parsed.durationMin <= 0
    ) {
      return NextResponse.json(
        { error: "Failed to parse booking from text", raw },
        { status: 502 },
      );
    }

    return NextResponse.json({
      title: parsed.title || "미팅",
      date: parsed.date,
      startTime: parsed.startTime,
      durationMin: parsed.durationMin,
      ...(parsed.attendee ? { attendee: parsed.attendee } : {}),
    });
  } catch (err) {
    const detail = claudeErrorDetail(err, DEFAULT_TIMEOUT_MS);
    console.error("[parse-booking] claude exec error:", detail);
    return NextResponse.json(
      { error: "Failed to parse booking", detail },
      { status: 500 },
    );
  }
}
