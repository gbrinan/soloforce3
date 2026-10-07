/**
 * 상류(Anthropic) 세션/사용 한도 감지 — 잡을 `failed`로 떨어뜨리지 않고 지연 재개시키기 위한 단일 판정 지점.
 *
 * [배경 — 2026-08-17 실사고]
 *   잡 c61e450f: 마이크루 계획 검토 응답이 "You've hit your session limit · resets 9pm (Asia/Seoul)" 였다.
 *   jobs.ts의 계획 게이트는 이걸 "형식 오류"로 읽고 3회 반려 → status=failed 로 종결했다.
 *   잡 cfdb89e6: 같은 원인인데 워커 결과가 그 문장 55자뿐이라 outputs_missing 으로 갈렸다.
 *   → 같은 원인이 서로 다른 '실패'로 기록되어, 후속 직원이 "GitHub가 안 되는 줄 알고" 재현 잡을 도는 낭비가 났다.
 *   한도 소진은 작업 결함이 아니라 **재시도 대상**이다.
 *
 * [설계 — 왜 새 JobStatus를 만들지 않았나]
 *   `deferred` 신설은 UI 필터·i18n·terminal 판정(TERMINAL_JOB_STATUSES)·지표를 동시에 흔든다.
 *   기존 `queued` 로 되돌리고 재개 시각(`deferredUntilMs`)만 얹는 편이 판정 체계를 건드리지 않는다.
 *
 * 관련: procedure_monthly-cap-is-a-permanent-killswitch (자동 해제 없는 정지가 어떻게 조용히 굶기는가)
 */

/** 한도 문구. "You've hit your session limit" / "you have hit your usage limit" 계열. */
const UPSTREAM_LIMIT_RE = /(?:you'?ve|you\s+have)\s+hit\s+your\s+(?:session|usage)\s+limit/i;

/** "resets 9pm" / "resets 7:10pm" / "resets 21:00" 에서 재개 시각을 뽑는다. */
const RESET_AT_RE = /resets?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;

/**
 * ★ 오탐 차단선. 이 두 상수가 음성 대조의 핵심이다.
 * 한도 통지는 짧은 문장 하나로 온다. 반면 **이 문구를 인용한 보고서**(예: QA 재현 검증 보고서)는 수천 자다.
 * 길이·위치 제한이 없으면 "한도를 논한 정상 산출물"이 통째로 지연 처리되어 잡이 영원히 안 끝난다.
 */
const MAX_SENTINEL_LEN = 300;
const MAX_MATCH_INDEX = 200;

/** 재개 시각을 못 읽었을 때의 기본 대기. */
export const DEFAULT_DEFER_MS = 30 * 60 * 1000;
/**
 * 시계 오독·악의적 문자열로 무한 대기가 되지 않도록 상한을 건다.
 * 24시간인 이유: 한도 재개 시각은 "오늘/내일 몇 시"로 오므로 최대 하루 미만이다.
 * (12시간으로 뒀더니 08:20에 받은 "resets 9pm"(12h40m 뒤)이 잘려 20:20에 깨어나 한도를 다시 맞았다 — 실측 후 교정)
 */
const MAX_DEFER_MS = 24 * 60 * 60 * 1000;
const MIN_DEFER_MS = 60 * 1000;
/** 지연 재개 상한. 초과하면 기존대로 failed — 상류 장애가 무한 순환하지 않게. */
export const MAX_DEFERRALS = 3;

export interface UpstreamLimitHit {
  /** 감지된 원문 (로그·에러 필드용) */
  message: string;
  /** 이 시각 이후에 큐가 다시 집는다 (epoch ms) */
  resumeAtMs: number;
}

/**
 * 한도 통지 문구인지 판정한다.
 * @param nowMs 테스트 주입용 현재 시각
 * @returns 한도면 재개 시각 포함 객체, 아니면 null
 */
export function detectUpstreamLimit(text: string | undefined | null, nowMs: number = Date.now()): UpstreamLimitHit | null {
  if (!text) return null;
  const t = String(text).trim();
  if (!t || t.length > MAX_SENTINEL_LEN) return null; // 인용된 장문 보고서 배제
  const m = UPSTREAM_LIMIT_RE.exec(t);
  if (!m || m.index > MAX_MATCH_INDEX) return null;
  return { message: t.slice(0, MAX_SENTINEL_LEN), resumeAtMs: parseResetAt(t, nowMs) };
}

/** Error/문자열 어느 쪽이 와도 같은 판정을 하도록 감싼다 (호출부에서 분기하지 않게). */
export function detectUpstreamLimitFrom(err: unknown, nowMs: number = Date.now()): UpstreamLimitHit | null {
  if (err instanceof UpstreamLimitError) return { message: err.message, resumeAtMs: err.resumeAtMs };
  const text = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return detectUpstreamLimit(text, nowMs);
}

/**
 * 문구에서 재개 시각을 계산한다.
 * 한도 통지의 시각은 (Asia/Seoul) 로 오고 이 서버도 같은 로컬 타임존에서 돈다 — 로컬 시각으로 계산한다.
 * 타임존이 다른 호스트에서는 이 계산이 어긋날 수 있으나, 상한/하한 클램프가 있어 최악이라도 12시간 내에 재개된다.
 */
export function parseResetAt(text: string, nowMs: number): number {
  const m = RESET_AT_RE.exec(text);
  if (!m) return nowMs + DEFAULT_DEFER_MS;

  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const ampm = m[3]?.toLowerCase();
  if (Number.isNaN(hour) || hour > 23 || minute > 59) return nowMs + DEFAULT_DEFER_MS;
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;

  const d = new Date(nowMs);
  d.setHours(hour, minute, 0, 0);
  let at = d.getTime();
  if (at <= nowMs) at += 24 * 60 * 60 * 1000; // 이미 지난 시각이면 내일 같은 시각

  return Math.min(Math.max(at, nowMs + MIN_DEFER_MS), nowMs + MAX_DEFER_MS);
}

/** 계획 게이트에서 반려 횟수를 소모하지 않고 즉시 이탈하기 위한 전용 에러. */
export class UpstreamLimitError extends Error {
  readonly resumeAtMs: number;
  constructor(hit: UpstreamLimitHit) {
    super(hit.message);
    this.name = "UpstreamLimitError";
    this.resumeAtMs = hit.resumeAtMs;
  }
}

/** 로그·UI 표기용 시각 문자열 (HH:MM). */
export function formatResumeAt(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
