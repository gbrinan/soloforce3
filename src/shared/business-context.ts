// 업무 맥락 블록 — 모든 스킬·레인이 같은 사실(국가·통화·회계연도·사업 단위·출력 선호)을 읽는 한 곳.
// 형식(이 스키마·예시·검사기)은 리포에, 실제 값은 `history/business-context.yaml`(gitignore)에 둔다 —
// 리포가 공개 저장소라 사업 정보를 커밋하지 않는다(2026-10-13 아난 결정).
// 출처: knowledge-work-plugins small-business `## Business context` 블록(고정 필드, 사람 확인 후 저장, 바뀐 필드만 갱신).
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const ISO_COUNTRY = /^[A-Z]{2}$/;     // ISO 3166-1 alpha-2
const ISO_CURRENCY = /^[A-Z]{3}$/;    // ISO 4217
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 연결 도구 범주 — 스킬은 도구 이름이 아니라 범주로 말한다(knowledge-work-plugins `~~category`). */
export const TOOL_CATEGORIES = [
  "messenger", "email", "calendar", "docs", "storage", "accounting", "crm", "tax", "commerce", "ads",
] as const;

export const OUTPUT_PREFERENCES = ["telegram", "notion", "chat", "docx", "md"] as const;

const isTimezone = (tz: string): boolean => {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
};
const isMonthDay = (s: string): boolean => {
  const m = /^(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(2001, Number(m[1]) - 1, Number(m[2]))); // 윤년 아닌 해 — 02-29 거부
  return d.getUTCMonth() === Number(m[1]) - 1 && d.getUTCDate() === Number(m[2]);
};

const BusinessLine = z.object({
  id: z.string().regex(SLUG, "소문자·숫자·하이픈"),
  name: z.string().min(1),
  description: z.string().optional(),
  currencies: z.array(z.string().regex(ISO_CURRENCY, "ISO 4217 대문자 3자")).optional(),
  countries: z.array(z.string().regex(ISO_COUNTRY, "ISO 3166-1 대문자 2자")).optional(),
}).strict();

export const BusinessContextSchema = z.object({
  version: z.literal(1),
  owner: z.object({ name: z.string().min(1), title: z.string().optional() }).strict(),
  country: z.string().regex(ISO_COUNTRY, "ISO 3166-1 대문자 2자"),
  currency: z.string().regex(ISO_CURRENCY, "ISO 4217 대문자 3자"),
  timezone: z.string().refine(isTimezone, "IANA 시간대(예: Asia/Seoul)"),
  fiscalYearEnd: z.string().refine(isMonthDay, "MM-DD (예: 12-31)"),
  businessLines: z.array(BusinessLine).min(1).refine(
    (lines) => new Set(lines.map((l) => l.id)).size === lines.length, "businessLines id 중복",
  ),
  connectedTools: z.partialRecord(z.enum(TOOL_CATEGORIES), z.array(z.string().min(1))).optional(),
  outputPreference: z.enum(OUTPUT_PREFERENCES),
  weeklyCadence: z.string().optional(),
  updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
}).strict();

export type BusinessContext = z.infer<typeof BusinessContextSchema>;

export type BusinessContextResult =
  | { ok: true; data: BusinessContext }
  | { ok: false; errors: string[] };

/** YAML 텍스트를 검사한다. 오류는 «필드 경로: 이유»로 — 값은 싣지 않는다(사업 정보가 로그에 남지 않게). */
export function parseBusinessContext(text: string): BusinessContextResult {
  let raw: unknown;
  try { raw = parseYaml(text); } catch (e) {
    return { ok: false, errors: [`YAML 파싱 실패: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`] };
  }
  const r = BusinessContextSchema.safeParse(raw);
  if (r.success) return { ok: true, data: r.data };
  return { ok: false, errors: r.error.issues.map((i) => `${i.path.join(".") || "(최상위)"}: ${i.message}`) };
}
