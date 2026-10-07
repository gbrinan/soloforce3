// 메일 인박스 스캔 훅 — 교육·업무 의뢰 자동 선별 다이제스트 (하루 2회, 09:00/17:00 KST)
//
// 왜 필요한가: 2026-08-06 어느 채용 플랫폼 no-reply 발신의 "[휴넷] B2B 기업교육 AI 강사 모집" 회신
// 기한이 조용히 만료돼 자동 불참 처리됐다. 인박스가 채용알림·뉴스레터·결제안내로 덮여 있어
// 진짜 의뢰가 묻힌 것이다. 무아의 사전 실측(30일)에서도 키워드 매칭 50건 중 실제 검토 대상은
// 5건뿐이었다. 그래서 이 훅의 본질은 "찾기"가 아니라 "걷어내기"다.
//
// Gmail 접근 경로 (중요 — 새 OAuth 배선을 만들지 않았다):
//   이 서버에는 Gmail API 배선이 없다. auth-google.ts의 OAuth는 scope가 "openid email profile"인
//   SSO 로그인 전용이고, refresh token도 저장하지 않는다(실측 2026-08-08). 이 시스템에서 Gmail에
//   닿는 유일한 길은 `claude.ai Gmail` MCP 커넥터이며, 그건 에이전트 세션 안에서만 호출된다
//   (service-policies.ts:51이 readPolicy="auto"로 열어둔 그것. SPF 영업팀 메일 스캔도 이 경로였다).
//   서버 프로세스는 MCP 클라이언트가 아니므로 직접 호출할 수 없다.
//   → 그래서 이미 있는 claude-cli.ts의 runClaude()를 쓴다. `claude -p`를 띄우면 그 세션이 같은
//     커넥터를 들고 있다. 새 인증도, 새 토큰 저장소도 없다. 조회 권한은 전적으로 그 커넥터의 것이다.
//
// 2단계 파이프라인 — 판단을 최대한 늦게, 최소한만 시킨다:
//   ① 기계적 프리필터(이 파일의 순수 함수 prefilterThread) — 봇 발신자·(광고)·프로모션 라벨을
//      설정 파일 기준으로 걷어낸다. LLM을 태우지 않는다. 규칙은 config/mail-scan-filters.json에
//      있고 아난이 재시작 없이 고칠 수 있다(매 스캔마다 다시 읽는다).
//   ② 내용 분류 — ①을 통과한 것만 LLM에 넘긴다. 판정 기준은 발신 도메인이 아니라
//      "본문에 나에게 요구하는 행위가 있는가"다.
//
// 프리필터의 안전장치(이게 없으면 ninehire 사고가 그대로 재발한다):
//   봇 패턴은 배제의 '근거'지 '절대 기준'이 아니다. 발신자가 no-reply여도 제목·본문에
//   기한·마감·회신 요청 신호가 있으면 무조건 통과시킨다(구제). 놓치는 비용이 훨씬 크다.
//
// 멱등: 보고한 threadId를 history/mail-scan/seen.json에 남기고 다음 스캔에서 건너뛴다.
//   예외는 회신기한이 임박한 건(D-3, D-1) — 이때만 재알림하고, 같은 D-n으로 두 번 조르지 않는다.
//   상태 파일이 없거나 깨져 있으면 빈 상태로 안전 복구한다(크래시 금지).
//
// 로그 하드룰: 콘솔에는 건수·분류 결과만 남긴다. 메일 제목·본문·발신자·토큰은 절대 로그하지 않는다.
//   (다이제스트 본문에는 제목이 들어가지만 그건 무아에게 가는 알림이지 로그가 아니다.)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { HISTORY_DIR } from "../config.js";
import { runClaude } from "./claude-cli.js";

const GMAIL_SEARCH_TOOLS = ["mcp__claude_ai_Gmail__search_threads"] as const;
const GMAIL_THREAD_TOOLS = ["mcp__claude_ai_Gmail__get_thread"] as const;

const FILTERS_FILE = resolve(".", "config", "mail-scan-filters.json");
const SEEN_FILE = join(HISTORY_DIR, "mail-scan", "seen.json");

// 하루 2회 — 아난 확정. KST 기준 시각(분 단위 경계에서 발화).
const RUN_HOURS_KST = [9, 17];

// LLM 호출 타임아웃 — 수집은 스레드 수만큼 MCP 왕복이 있어 넉넉히, 분류는 통과분만이라 짧게.
const FETCH_TIMEOUT_MS = 300_000;
const CLASSIFY_TIMEOUT_MS = 240_000;

// 오래된 seen 기록 정리 — 이보다 오래된 건 다시 조회 창에 들어오지 않으므로 지워도 재보고 없음.
const SEEN_RETENTION_DAYS = 180;

// ── 설정 ────────────────────────────────────────────────────────────

export interface MailFilterConfig {
  lookbackDays: number;
  maxThreads: number;
  gmailQuery: string;
  botLocalParts: string[];
  botDomains: string[];
  subjectPrefixes: string[];
  excludeLabels: string[];
  deadlineKeywords: string[];
  remindOnDays: number[];
}

// 기본값 — 무아의 30일 실측에서 실제로 노이즈를 만든 발신자 패턴들이다.
// 하드코딩이 아니라 '없을 때 한 번 깔리는 씨앗'이다. 이후로는 파일이 진실이다.
export const DEFAULT_FILTERS: MailFilterConfig = {
  lookbackDays: 3,
  maxThreads: 60,
  gmailQuery: "in:inbox -in:sent -in:draft -category:promotions",
  botLocalParts: [
    "noreply", "no-reply", "donotreply", "do-not-reply",
    "jobalerts", "jobs-noreply", "invitations", "newsletter",
    "messaging-digest", "messages-noreply", "smartai", "study", "notify",
    "googlealerts-noreply", "googledev-noreply", "calendar-notification",
    "noreply-accounts", "updates", "mailer-daemon", "bounce",
    // 뉴스레터·발송 전용 로컬파트 — 실측 14일치에서 인박스 노이즈의 대부분이 이 형태였다.
    // (hr@·recruit@처럼 사람이 쓰는 업무용 계정은 일부러 넣지 않았다 — 실제 의뢰가 그리로 온다)
    "hello", "welcome", "info", "information", "news", "sales", "marketing",
    "publishing", "docs", "support", "digest", "alert", "alerts", "mailer",
    "billing", "receipt", "order",
  ],
  botDomains: [
    "linkedin.com", "stocktwits.com", "substack.com", "patreon.com",
    "netflix.com", "musinsa.com", "aliexpress.com", "coursera.org",
    "devpost.com", "kaggle.com", "newneek.co",
  ],
  subjectPrefixes: ["(광고)", "[광고]", "(AD)"],
  excludeLabels: ["CATEGORY_PROMOTIONS", "SPAM", "TRASH"],
  // 봇 발신자여도 이 신호가 있으면 구제한다 — ninehire 사고가 정확히 이 케이스였다.
  // 주의: 여기 단어는 '봇 배제를 뒤집는' 힘을 가지므로 광고에도 흔한 말은 넣지 않는다.
  // 예로 "필수"는 광고 문구("차년도 사업계획 수립을 위한 필수 포럼")에 그대로 걸려 광고를 구제해버렸다.
  // 요구 행위를 특정하는 구(句)만 남긴다.
  deadlineKeywords: [
    "기한", "마감", "회신", "답변 요청", "회신 요청", "제출", "마감일", "만료",
    "일정 조율", "일정조율", "확인 요청", "동의 여부", "까지 알려", "참석 여부",
    "deadline", "due date", "rsvp", "respond by", "reply by", "expires",
    // 협업 도구의 '너에게 요구가 있다' 신호 — 노션 페이지 공유·초대가 여기 걸린다.
    "needs your input", "invited you to", "shared a page with you",
    "action required", "requires your",
  ],
  remindOnDays: [3, 1],
};

/** 설정 로드 — 없으면 씨앗을 깔고, 깨졌거나 일부만 있으면 기본값으로 메운다(크래시 금지). */
export function loadFilterConfig(): MailFilterConfig {
  let raw: Partial<MailFilterConfig> = {};
  try {
    if (existsSync(FILTERS_FILE)) {
      const parsed = JSON.parse(readFileSync(FILTERS_FILE, "utf-8"));
      if (parsed && typeof parsed === "object") raw = parsed as Partial<MailFilterConfig>;
    } else {
      mkdirSync(dirname(FILTERS_FILE), { recursive: true });
      writeFileSync(FILTERS_FILE, JSON.stringify(DEFAULT_FILTERS, null, 2) + "\n", "utf-8");
      return { ...DEFAULT_FILTERS };
    }
  } catch { /* 깨진 파일 — 덮어쓰지 않는다(아난이 편집 중일 수 있다). 기본값으로 진행. */ }

  const arr = (v: unknown, d: string[]): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : d;
  const num = (v: unknown, d: number): number =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : d;

  return {
    lookbackDays: num(raw.lookbackDays, DEFAULT_FILTERS.lookbackDays),
    maxThreads: num(raw.maxThreads, DEFAULT_FILTERS.maxThreads),
    gmailQuery: typeof raw.gmailQuery === "string" && raw.gmailQuery.trim()
      ? raw.gmailQuery : DEFAULT_FILTERS.gmailQuery,
    botLocalParts: arr(raw.botLocalParts, DEFAULT_FILTERS.botLocalParts),
    botDomains: arr(raw.botDomains, DEFAULT_FILTERS.botDomains),
    subjectPrefixes: arr(raw.subjectPrefixes, DEFAULT_FILTERS.subjectPrefixes),
    excludeLabels: arr(raw.excludeLabels, DEFAULT_FILTERS.excludeLabels),
    deadlineKeywords: arr(raw.deadlineKeywords, DEFAULT_FILTERS.deadlineKeywords),
    remindOnDays: Array.isArray(raw.remindOnDays)
      ? raw.remindOnDays.filter((n): n is number => typeof n === "number" && n >= 0)
      : DEFAULT_FILTERS.remindOnDays,
  };
}

// ── ① 기계적 프리필터 (순수 함수 — 회귀 테스트 가능) ─────────────────

export interface MailThreadMeta {
  threadId: string;
  sender: string;      // "이름 <addr@domain>" 또는 "addr@domain"
  subject: string;
  snippet: string;
  date: string;
  labelIds: string[];
}

export interface PrefilterVerdict {
  pass: boolean;
  reason: "직접 수신" | "기한신호 구제" | "봇 발신자" | "봇 도메인" | "광고 제목" | "제외 라벨";
}

/** "Anan Kim <a@b.com>" → "a@b.com" (소문자). 주소가 없으면 원문 소문자. */
export function extractAddress(sender: string): string {
  const m = sender.match(/<([^>]+)>/);
  return (m ? m[1] : sender).trim().toLowerCase();
}

function localPartOf(addr: string): string {
  const i = addr.indexOf("@");
  return (i < 0 ? addr : addr.slice(0, i)).toLowerCase();
}

function domainOf(addr: string): string {
  const i = addr.indexOf("@");
  return (i < 0 ? "" : addr.slice(i + 1)).toLowerCase();
}

/** 제목+스니펫에 기한·회신 요구 신호가 있는가 — 봇 배제를 뒤집는 유일한 근거. */
export function hasDeadlineSignal(t: MailThreadMeta, cfg: MailFilterConfig): boolean {
  const hay = `${t.subject}\n${t.snippet}`.toLowerCase();
  return cfg.deadlineKeywords.some((k) => k.trim() && hay.includes(k.toLowerCase()));
}

/**
 * 프리필터 — LLM 호출 전에 도는 유일한 판단. 싸고 확실한 것만 본다.
 * 순서가 곧 정책이다: 배제 근거를 먼저 모으고, 기한 신호가 있으면 그 모두를 뒤집는다.
 */
export function prefilterThread(t: MailThreadMeta, cfg: MailFilterConfig): PrefilterVerdict {
  const addr = extractAddress(t.sender);
  const local = localPartOf(addr);
  const domain = domainOf(addr);

  let excluded: PrefilterVerdict["reason"] | null = null;
  if (cfg.excludeLabels.some((l) => t.labelIds.includes(l))) excluded = "제외 라벨";
  else if (cfg.subjectPrefixes.some((p) => t.subject.trimStart().startsWith(p))) excluded = "광고 제목";
  else if (cfg.botLocalParts.some((p) => local.includes(p.toLowerCase()))) excluded = "봇 발신자";
  else if (cfg.botDomains.some((d) => domain === d.toLowerCase() || domain.endsWith(`.${d.toLowerCase()}`))) excluded = "봇 도메인";

  if (!excluded) return { pass: true, reason: "직접 수신" };
  // 봇이어도 기한·회신 요구가 있으면 통과 — 배제 근거보다 놓칠 위험이 크다.
  if (hasDeadlineSignal(t, cfg)) return { pass: true, reason: "기한신호 구제" };
  return { pass: false, reason: excluded };
}

// ── ② 분류 결과 ─────────────────────────────────────────────────────

export const CATEGORIES = ["교육의뢰", "업무의뢰·제안", "일정조율(회신필요)", "정보성", "기타"] as const;
export type MailCategory = (typeof CATEGORIES)[number];

// 다이제스트 표시 순서 — 아난이 먼저 봐야 하는 것이 위로 온다.
const CATEGORY_ORDER: MailCategory[] = ["교육의뢰", "일정조율(회신필요)", "업무의뢰·제안", "정보성", "기타"];

export interface ClassifiedMail {
  threadId: string;
  category: MailCategory;
  org: string;
  sender: string;
  subject: string;
  summary: string;
  deadline: string | null;   // YYYY-MM-DD
  urgency: "high" | "normal" | "low";
}

// ── 멱등 상태 ───────────────────────────────────────────────────────

interface SeenRecord {
  firstReportedAt: string;
  category: string;
  deadline: string | null;
  remindedOn: number[];  // 이미 재알림한 D-n 값들
}
interface SeenState { version: number; threads: Record<string, SeenRecord> }

export function loadSeenState(): SeenState {
  try {
    const raw = JSON.parse(readFileSync(SEEN_FILE, "utf-8"));
    if (raw && typeof raw === "object" && raw.threads && typeof raw.threads === "object") {
      return { version: 1, threads: raw.threads as Record<string, SeenRecord> };
    }
  } catch { /* 부재·JSON 파손 — 빈 상태로 안전 복구. 최악은 한 번 더 보고하는 것뿐. */ }
  return { version: 1, threads: {} };
}

function saveSeenState(state: SeenState): void {
  mkdirSync(dirname(SEEN_FILE), { recursive: true });
  writeFileSync(SEEN_FILE, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

/** KST(UTC+9, 서머타임 없음) 오늘 YYYY-MM-DD. */
export function kstToday(nowMs = Date.now()): string {
  return new Date(nowMs + 9 * 60 * 60_000).toISOString().slice(0, 10);
}

/** 두 KST 달력 날짜의 일수 차 — 시각이 아니라 날짜로 재야 자정 근처에서 D-n이 밀리지 않는다. */
export function daysUntil(ymd: string, today: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const a = Date.parse(`${ymd}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86_400_000);
}

/**
 * 이 건을 지금 보고할 것인가.
 * - 처음 보는 스레드 → 보고
 * - 이미 보고한 스레드 → 침묵. 단 회신기한이 remindOnDays(D-3, D-1)에 닿았고 그 D-n으로
 *   아직 조르지 않았다면 재알림한다. 같은 D-n으로 두 번 조르지 않는다.
 */
export function shouldReport(
  m: ClassifiedMail, state: SeenState, cfg: MailFilterConfig, today: string,
): { report: boolean; remindDay: number | null } {
  const prev = state.threads[m.threadId];
  if (!prev) return { report: true, remindDay: null };
  if (!m.deadline) return { report: false, remindDay: null };
  const d = daysUntil(m.deadline, today);
  if (d === null || d < 0) return { report: false, remindDay: null };
  if (!cfg.remindOnDays.includes(d)) return { report: false, remindDay: null };
  if ((prev.remindedOn ?? []).includes(d)) return { report: false, remindDay: null };
  return { report: true, remindDay: d };
}

// ── 다이제스트 렌더링 ───────────────────────────────────────────────

function threadLink(threadId: string): string {
  return `https://mail.google.com/mail/u/0/#all/${threadId}`;
}

export function renderDigest(
  items: Array<ClassifiedMail & { remindDay: number | null }>, today: string,
): string {
  const lines: string[] = [];
  lines.push(`📬 메일 인박스 스캔 — 검토 필요 ${items.length}건 (${today} KST)`);

  for (const cat of CATEGORY_ORDER) {
    const group = items.filter((i) => i.category === cat);
    if (!group.length) continue;
    lines.push("");
    lines.push(`## ${cat} (${group.length})`);
    for (const m of group) {
      const d = m.deadline ? daysUntil(m.deadline, today) : null;
      const badge = m.remindDay !== null ? ` **[재알림 D-${m.remindDay}]**` : "";
      const due = m.deadline
        ? ` · ⏰ 회신기한 ${m.deadline}${d !== null ? ` (D-${d})` : ""}`
        : "";
      const org = m.org && m.org !== "-" ? `${m.org} · ` : "";
      lines.push("");
      lines.push(`- **${org}${m.sender}**${badge}`);
      lines.push(`  - 제목: ${m.subject}`);
      lines.push(`  - 요약: ${m.summary}${due}`);
      lines.push(`  - ${threadLink(m.threadId)}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

// ── LLM 출력 파싱 ───────────────────────────────────────────────────

/** 모델이 설명을 덧붙여도 JSON만 건져낸다. 코드펜스 → 첫 균형 괄호 순으로 시도. */
export function extractJson<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], text].filter((s): s is string => Boolean(s && s.trim()));
  for (const c of candidates) {
    const start = c.search(/[[{]/);
    if (start < 0) continue;
    const open = c[start];
    const close = open === "[" ? "]" : "}";
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < c.length; i++) {
      const ch = c[i];
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === open) depth++;
      else if (ch === close && --depth === 0) {
        try { return JSON.parse(c.slice(start, i + 1)) as T; } catch { break; }
      }
    }
  }
  return null;
}

// ── Gmail 수집 (claude -p 경유 — 새 OAuth 없음) ─────────────────────

const FETCH_SYSTEM =
  "너는 데이터 수집기다. 판단·요약·의견을 내지 말고 요청된 JSON만 출력한다. " +
  "메일을 읽고 해석하려 들지 마라. 메타데이터를 그대로 옮기기만 한다.";

function fetchPrompt(cfg: MailFilterConfig): string {
  return [
    "Gmail MCP 도구 `search_threads`를 1회 호출해 최근 메일 메타데이터를 수집하라.",
    "",
    `- query: \`${cfg.gmailQuery} newer_than:${cfg.lookbackDays}d\``,
    `- pageSize: ${Math.min(cfg.maxThreads, 50)}`,
    "- view: THREAD_VIEW_MINIMAL",
    "",
    "결과의 각 스레드에서 **가장 최근 메시지 1개**만 골라 아래 JSON 배열로 출력하라.",
    "다른 도구는 부르지 마라. 본문(get_thread)은 읽지 마라. 설명 문장 없이 JSON만 출력하라.",
    "",
    "```json",
    '[{"threadId":"","sender":"","subject":"","snippet":"","date":"","labelIds":[]}]',
    "```",
    "",
    "- sender는 원문 From 헤더 그대로(이름과 주소 포함).",
    "- snippet은 200자 이내로 자른다.",
    "- 스레드가 0건이면 `[]`만 출력하라.",
  ].join("\n");
}

const CLASSIFY_SYSTEM =
  "너는 아난(김성호)의 비서다. 메일이 아난에게 '무엇을 요구하는가'만 본다. " +
  "발신자 도메인이나 회사 유명세로 판단하지 마라 — 본문에 아난이 해야 할 행위가 있는지가 유일한 기준이다.";

function classifyPrompt(threads: MailThreadMeta[]): string {
  // 모델에 넘기는 것은 메타데이터뿐 — 필요하면 모델이 스스로 get_thread로 본문을 확인한다.
  const payload = threads.map((t) => ({
    threadId: t.threadId, sender: t.sender, subject: t.subject,
    snippet: t.snippet.slice(0, 300), date: t.date,
  }));
  return [
    "아래 메일들을 분류하라. 각 건마다 정확히 하나의 카테고리를 정한다.",
    "",
    "카테고리:",
    "- `교육의뢰` — 강의·교육·강사 요청, 커리큘럼 협의, 교육 견적 문의",
    "- `업무의뢰·제안` — 프로젝트·컨설팅·협업·외주 제안, 사업 문의",
    "- `일정조율(회신필요)` — 면접·미팅·인터뷰 일정 조율, 참석 여부 회신, 기한 있는 확인 요청",
    "- `정보성` — 등록 완료·안내·공지 등 읽기만 하면 되는 것",
    "- `기타` — 위 어디에도 안 맞는 것",
    "",
    "판정 규칙:",
    "1. 발신 주소가 no-reply여도 본문에 회신·제출·동의 요구가 있으면 `일정조율(회신필요)`다.",
    "2. 채용 공고 알림(내가 지원할 자리 추천)은 의뢰가 아니다 → `기타`.",
    "   반대로 '강사로 모십니다', '교육을 맡아주실 수 있는지'는 `교육의뢰`다.",
    "3. 판단이 애매하면 Gmail MCP `get_thread`로 그 스레드 본문을 확인한 뒤 정하라.",
    "4. 회신기한·마감일이 본문에 있으면 deadline에 YYYY-MM-DD로 적고, 없으면 null.",
    "   기한이 이미 지났으면 그대로 적되 urgency를 high로 둔다.",
    "5. urgency: 기한 3일 이내 또는 명시적 독촉이면 high, 기한 있으면 normal, 없으면 low.",
    "",
    "설명 문장 없이 JSON 배열만 출력하라. 입력과 같은 개수여야 한다.",
    "",
    "```json",
    '[{"threadId":"","category":"교육의뢰","org":"","summary":"","deadline":null,"urgency":"low"}]',
    "```",
    "",
    "- org: 발신 조직명(사람 이름 말고 회사·기관). 모르면 \"-\".",
    "- summary: 아난이 무엇을 해야 하는지 한 줄(60자 이내).",
    "",
    "입력:",
    "```json",
    JSON.stringify(payload),
    "```",
  ].join("\n");
}

// ── 스캔 본체 ───────────────────────────────────────────────────────

export interface MailScanResult {
  scanned: number;      // Gmail에서 가져온 스레드 수
  passed: number;       // 프리필터 통과 수
  filtered: number;     // 프리필터가 걷어낸 수
  rescued: number;      // 봇이지만 기한 신호로 구제된 수
  classified: number;   // 분류 완료 수
  reported: number;     // 이번에 다이제스트에 실린 수 (멱등 skip 제외)
  reminded: number;     // 그중 기한 임박 재알림 수
  byCategory: Record<string, number>;
  notified: boolean;    // 무아에게 알림을 보냈는가 (0건이면 false)
  relayed: { telegram: boolean; discord: boolean }; // 외부 채널 전달 성공 여부
}

/**
 * 다이제스트를 외부 채널(텔레그램·디스코드)로도 흘려보낸다.
 *
 * 본문은 무아에게 보낸 것과 **같은 문자열을 그대로** 쓴다 — 채널별로 다시 만들면
 * 두 벌이 되어 반드시 어긋난다. 여기서 하는 일은 배선뿐이다.
 *
 * 실패는 채널별로 격리한다: 텔레그램이 죽어도 디스코드는 가고, 둘 다 죽어도
 * 이미 끝난 스캔과 무아 알림은 영향받지 않는다. 미연동(토큰·페어링 없음)이면
 * 각 send 함수가 조용히 no-op이므로 여기서 따로 분기하지 않는다.
 */
async function relayDigest(digest: string): Promise<{ telegram: boolean; discord: boolean }> {
  const out = { telegram: false, discord: false };
  try {
    const { sendTelegramNotice } = await import("./telegram.js");
    await sendTelegramNotice(digest);
    out.telegram = true;
  } catch (e) {
    console.warn("[MailScan] 텔레그램 전달 실패:", e instanceof Error ? e.message : e);
  }
  try {
    const { sendDiscordNotice } = await import("./discord.js");
    await sendDiscordNotice(digest);
    out.discord = true;
  } catch (e) {
    console.warn("[MailScan] 디스코드 전달 실패:", e instanceof Error ? e.message : e);
  }
  return out;
}

let scanning = false;

/**
 * 인박스를 한 번 스캔해 검토 필요분만 무아에게 넘긴다.
 * @returns Gmail 수집 자체가 실패하면 null (다음 주기에 재시도)
 */
export async function runMailScan(): Promise<MailScanResult | null> {
  if (scanning) {
    console.log("[MailScan] 이전 스캔 진행 중 — 이번 회차 건너뜀");
    return null;
  }
  scanning = true;
  try {
    const cfg = loadFilterConfig();

    // 1) 수집 — 판단 없는 메타데이터만
    const fetched = await runClaude(fetchPrompt(cfg), {
      system: FETCH_SYSTEM,
      timeoutMs: FETCH_TIMEOUT_MS,
      allowedTools: GMAIL_SEARCH_TOOLS,
    });
    if (!fetched.ok) {
      console.warn(`[MailScan] 수집 실패 — ${fetched.error ?? "원인 불명"}`);
      return null;
    }
    const raw = extractJson<unknown[]>(fetched.text ?? "");
    if (!Array.isArray(raw)) {
      console.warn("[MailScan] 수집 결과가 JSON 배열이 아님 — 이번 회차 중단");
      return null;
    }
    const threads: MailThreadMeta[] = raw
      .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object")
      .map((r) => ({
        threadId: String(r.threadId ?? ""),
        sender: String(r.sender ?? ""),
        subject: String(r.subject ?? ""),
        snippet: String(r.snippet ?? ""),
        date: String(r.date ?? ""),
        labelIds: Array.isArray(r.labelIds) ? r.labelIds.map(String) : [],
      }))
      .filter((t) => t.threadId)
      .slice(0, cfg.maxThreads);

    // 2) 프리필터 — 여기까지 LLM 판단 0회
    const passed: MailThreadMeta[] = [];
    let rescued = 0;
    for (const t of threads) {
      const v = prefilterThread(t, cfg);
      if (!v.pass) continue;
      if (v.reason === "기한신호 구제") rescued++;
      passed.push(t);
    }

    const result: MailScanResult = {
      scanned: threads.length, passed: passed.length,
      filtered: threads.length - passed.length, rescued,
      classified: 0, reported: 0, reminded: 0, byCategory: {}, notified: false,
      relayed: { telegram: false, discord: false },
    };

    if (!passed.length) {
      console.log(`[MailScan] 스캔 ${result.scanned} · 통과 0 · 조용히 종료`);
      return result;
    }

    // 3) 분류 — 통과분만 LLM에 태운다
    const classifiedRaw = await runClaude(classifyPrompt(passed), {
      system: CLASSIFY_SYSTEM,
      timeoutMs: CLASSIFY_TIMEOUT_MS,
      allowedTools: GMAIL_THREAD_TOOLS,
    });
    if (!classifiedRaw.ok) {
      console.warn(`[MailScan] 분류 실패 — ${classifiedRaw.error ?? "원인 불명"}`);
      return null;
    }
    const parsed = extractJson<Array<Record<string, unknown>>>(classifiedRaw.text ?? "");
    if (!Array.isArray(parsed)) {
      console.warn("[MailScan] 분류 결과가 JSON 배열이 아님 — 이번 회차 중단");
      return null;
    }

    const byId = new Map(passed.map((t) => [t.threadId, t]));
    const classified: ClassifiedMail[] = [];
    for (const r of parsed) {
      const threadId = String(r.threadId ?? "");
      const src = byId.get(threadId);
      if (!src) continue; // 모델이 지어낸 id는 버린다
      const cat = String(r.category ?? "기타") as MailCategory;
      const deadline = typeof r.deadline === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.deadline)
        ? r.deadline : null;
      const urg = String(r.urgency ?? "low");
      classified.push({
        threadId,
        category: (CATEGORIES as readonly string[]).includes(cat) ? cat : "기타",
        org: String(r.org ?? "-").slice(0, 60),
        sender: src.sender.slice(0, 120),
        subject: src.subject.slice(0, 160),
        summary: String(r.summary ?? "").slice(0, 200),
        deadline,
        urgency: urg === "high" || urg === "normal" ? urg : "low",
      });
    }
    result.classified = classified.length;

    // 4) 멱등 — 이미 보고한 건은 침묵. 기한 임박(D-3/D-1)만 예외.
    const today = kstToday();
    const state = loadSeenState();
    const toReport: Array<ClassifiedMail & { remindDay: number | null }> = [];
    for (const m of classified) {
      const { report, remindDay } = shouldReport(m, state, cfg, today);
      if (!report) continue;
      toReport.push({ ...m, remindDay });
      if (remindDay !== null) result.reminded++;
    }
    result.reported = toReport.length;
    for (const m of classified) {
      result.byCategory[m.category] = (result.byCategory[m.category] ?? 0) + 1;
    }

    // 5) 알림 — 0건이면 보내지 않는다(조용한 게 낫다)
    if (toReport.length) {
      const digest = renderDigest(toReport, today);
      const { addGenieMessage } = await import("./chat.js"); // 순환 참조 방지
      addGenieMessage(digest, { internal: true });
      result.notified = true;
      // 같은 본문을 외부 채널로도 — 아난이 자리에 없어도 기한 임박 건을 놓치지 않게.
      result.relayed = await relayDigest(digest);
    }

    // 6) 상태 갱신 — 보고한 것만 기록한다(보고 안 한 건 다음에 다시 볼 기회를 남긴다)
    for (const m of toReport) {
      const prev = state.threads[m.threadId];
      state.threads[m.threadId] = {
        firstReportedAt: prev?.firstReportedAt ?? new Date().toISOString(),
        category: m.category,
        deadline: m.deadline,
        remindedOn: m.remindDay !== null
          ? [...(prev?.remindedOn ?? []), m.remindDay]
          : (prev?.remindedOn ?? []),
      };
    }
    // 오래된 기록 정리 — 조회 창 밖이라 지워도 재보고되지 않는다.
    const cutoffMs = Date.now() - SEEN_RETENTION_DAYS * 86_400_000;
    for (const [id, rec] of Object.entries(state.threads)) {
      const t = Date.parse(rec.firstReportedAt);
      if (!Number.isNaN(t) && t < cutoffMs) delete state.threads[id];
    }
    saveSeenState(state);

    // 로그는 건수·분류만 — 제목·본문·발신자는 절대 남기지 않는다.
    console.log(
      `[MailScan] 스캔 ${result.scanned} · 통과 ${result.passed}(구제 ${result.rescued}) · ` +
      `분류 ${result.classified} · 보고 ${result.reported}(재알림 ${result.reminded}) · ` +
      `전달 tg=${result.relayed.telegram} dc=${result.relayed.discord} · ` +
      JSON.stringify(result.byCategory),
    );
    return result;
  } finally {
    scanning = false;
  }
}

// ── 스케줄 (09:00 / 17:00 KST) ──────────────────────────────────────

/**
 * 다음 발화까지의 ms. KST 시각으로만 계산한다 — 서버 로컬 타임존이 무엇이든 결과가 같다.
 * 순수 함수로 뺀 이유는 자정·경계 회귀를 테스트로 잡기 위해서다.
 */
export function msUntilNextRun(nowMs: number, hoursKst: number[] = RUN_HOURS_KST): number {
  const KST = 9 * 60 * 60_000;
  const kst = nowMs + KST;
  const dayMs = 86_400_000;
  const sod = kst % dayMs; // KST 자정부터 흐른 ms
  const targets = [...hoursKst].sort((a, b) => a - b).map((h) => h * 60 * 60_000);
  for (const t of targets) if (t > sod) return t - sod;
  return dayMs - sod + targets[0]; // 오늘 몫이 끝났으면 내일 첫 회차
}

let timer: NodeJS.Timeout | null = null;

function scheduleNext(): void {
  const wait = msUntilNextRun(Date.now());
  timer = setTimeout(() => {
    void runMailScan()
      .catch((e) => console.warn("[MailScan] 스캔 예외:", e instanceof Error ? e.message : e))
      .finally(scheduleNext); // 실패해도 다음 회차는 반드시 예약한다
  }, wait);
  timer.unref?.();
}

export function startMailScan(): void {
  if (timer) return;
  loadFilterConfig(); // 설정 파일 씨앗을 미리 깔아 아난이 바로 편집할 수 있게 한다
  scheduleNext();
  const mins = Math.round(msUntilNextRun(Date.now()) / 60_000);
  console.log(`[MailScan] 시작 (매일 ${RUN_HOURS_KST.map((h) => `${h}시`).join("·")} KST, 다음 회차 ${mins}분 후, 수동: POST /api/mail-scan)`);
}

export function stopMailScan(): void {
  if (timer) { clearTimeout(timer); timer = null; }
}
