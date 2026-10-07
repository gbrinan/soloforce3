import { runClaude, extractJson, stripHtml } from "@/lib/claude-cli";
import type { Mail, MailCategory, MailImportance } from "@/types/mail";

/**
 * 수신함 자동 분류 헬퍼 (categorize / categorize/batch 라우트 공용).
 * 메일 N건(≤10)을 Claude CLI 1회 호출로 분류한다
 * (프롬프트 패턴은 server external-classifier의 카테고리/사유 스타일 참고, import 없음).
 */

export interface CategorizeResult {
  category: MailCategory;
  priority: MailImportance;
  reason: string;
}

export const MAX_BATCH_SIZE = 10;
const MAX_BODY_CHARS = 2000;

const CATEGORIES: MailCategory[] = ["work", "personal", "newsletter", "notification", "spam"];
const PRIORITIES: MailImportance[] = ["high", "normal", "low"];

function buildPrompt(mails: Mail[]): string {
  const items = mails
    .map((m, i) => {
      const from = m.from.name ? `${m.from.name} <${m.from.email}>` : m.from.email;
      const body = stripHtml(m.body).slice(0, MAX_BODY_CHARS);
      return [`[메일 ${i + 1}]`, `발신자: ${from}`, `제목: ${m.subject}`, `본문: ${body}`].join("\n");
    })
    .join("\n\n");

  return [
    `아래 이메일 ${mails.length}건을 각각 분류해서 JSON 배열로만 답하세요. 다른 설명은 붙이지 마세요.`,
    '형식: [{"category": "work"|"personal"|"newsletter"|"notification"|"spam", "priority": "high"|"normal"|"low", "reason": "한 줄 사유"}, ...]',
    "- 배열 순서는 입력 메일 순서와 동일해야 하며, 메일 수와 배열 길이가 같아야 합니다.",
    "- category 기준:",
    "  - work: 업무 관련 (동료·거래처·프로젝트·회의 등)",
    "  - personal: 개인적인 메일 (지인·가족·개인 계정 알림 아님)",
    "  - newsletter: 뉴스레터·홍보·구독 메일",
    "  - notification: 서비스 자동 알림 (가입·보안·배송·결제 알림 등)",
    "  - spam: 스팸성·피싱 의심 메일",
    "- priority 기준: high(빠른 확인/회신 필요), normal(일반), low(무시해도 무방)",
    "- reason: 판단 근거 한국어 한 문장.",
    "",
    items,
  ].join("\n");
}

function validateOne(raw: unknown): CategorizeResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { category?: string; priority?: string; reason?: string };
  if (!CATEGORIES.includes(r.category as MailCategory)) return null;
  return {
    category: r.category as MailCategory,
    priority: PRIORITIES.includes(r.priority as MailImportance)
      ? (r.priority as MailImportance)
      : "normal",
    reason: typeof r.reason === "string" ? r.reason : "",
  };
}

/**
 * 메일 목록(≤10건)을 분류한다. 반환 배열은 입력 순서와 1:1 대응이며
 * 항목별 파싱 실패는 null (호출측에서 배지 미표시로 graceful 처리).
 * Claude 실행 자체가 실패하면 throw (호출측에서 claudeErrorDetail 처리).
 */
export async function categorizeMails(mails: Mail[]): Promise<(CategorizeResult | null)[]> {
  if (mails.length === 0) return [];
  const raw = await runClaude(buildPrompt(mails));
  const parsed = extractJson<unknown[]>(raw);
  if (!Array.isArray(parsed)) return mails.map(() => null);
  return mails.map((_, i) => validateOne(parsed[i]));
}
