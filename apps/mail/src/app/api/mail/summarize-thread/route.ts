import { NextRequest, NextResponse } from "next/server";
import { getMail, listMails } from "@/lib/mail-store";
import {
  runClaude,
  extractJson,
  claudeErrorDetail,
  stripHtml,
} from "@/lib/claude-cli";
import type { Mail } from "@/types/mail";

/**
 * POST /api/mail/summarize-thread
 * mailId 기준으로 같은 대화(스레드) 메일을 서버에서 모아
 * 3~5문장 요약 + 액션 아이템 목록을 반환한다.
 * 스레드 = 같은 메일함 + RE:/FW:/회신:/전달: 접두사를 제거한 제목이 같은 메일.
 */

interface SummarizeThreadRequest {
  mailId: string;
}

interface ThreadSummaryResult {
  summary: string[];
  actionItems: string[];
}

const MAX_BODY_CHARS = 2000;
const MAX_THREAD_MESSAGES = 10;
const REPLY_PREFIX = /^(re|fw|fwd|회신|전달|답장)\s*[:：]\s*/i;

function normalizeSubject(subject: string): string {
  let s = subject.trim();
  while (REPLY_PREFIX.test(s)) s = s.replace(REPLY_PREFIX, "");
  return s.toLowerCase();
}

async function collectThread(mail: Mail): Promise<Mail[]> {
  const key = normalizeSubject(mail.subject);
  const all = await listMails(mail.mailboxId);
  const thread = all.filter(
    (m) =>
      m.folder !== "trash" &&
      m.folder !== "spam" &&
      normalizeSubject(m.subject) === key,
  );
  // 오래된 순 정렬 후 최근 N건만 (프롬프트 크기 제한)
  thread.sort((a, b) => a.date.localeCompare(b.date));
  return thread.slice(-MAX_THREAD_MESSAGES);
}

function buildPrompt(subject: string, thread: Mail[]): string {
  const messages = thread
    .map((m, i) => {
      const from = m.from.name ? `${m.from.name} <${m.from.email}>` : m.from.email;
      const body = stripHtml(m.body).slice(0, MAX_BODY_CHARS);
      return [`[메시지 ${i + 1}]`, `발신자: ${from}`, `날짜: ${m.date}`, `본문: ${body}`].join("\n");
    })
    .join("\n\n");

  return [
    "아래 이메일 스레드를 분석해서 JSON으로만 답하세요. 다른 설명은 붙이지 마세요.",
    '형식: {"summary": ["문장1", "문장2", "문장3"], "actionItems": ["할 일1", ...]}',
    "- summary: 스레드 전체 흐름의 한국어 요약 3~5문장 (각 항목 1문장).",
    "- actionItems: 수신자가 해야 할 일 목록 (없으면 빈 배열).",
    "",
    `[제목] ${subject}`,
    "",
    messages,
  ].join("\n");
}

export async function POST(request: NextRequest) {
  let body: SummarizeThreadRequest;
  try {
    body = (await request.json()) as SummarizeThreadRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.mailId) {
    return NextResponse.json({ error: "Missing required field: mailId" }, { status: 400 });
  }

  const mail = await getMail(body.mailId);
  if (!mail) {
    return NextResponse.json({ error: "Mail not found" }, { status: 404 });
  }

  const thread = await collectThread(mail);
  const messages = thread.length > 0 ? thread : [mail];

  try {
    const raw = await runClaude(buildPrompt(mail.subject, messages));
    const parsed = extractJson<ThreadSummaryResult>(raw);
    if (!parsed || !Array.isArray(parsed.summary)) {
      return NextResponse.json(
        { error: "Claude returned unparsable response" },
        { status: 502 },
      );
    }
    return NextResponse.json({
      summary: parsed.summary.map(String),
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems.map(String) : [],
      messageCount: messages.length,
    });
  } catch (err) {
    const detail = claudeErrorDetail(err);
    console.error("[summarize-thread] claude exec error:", detail);
    return NextResponse.json(
      { error: "Failed to summarize thread", detail },
      { status: 500 },
    );
  }
}
