// 반복 규칙(rule) 해석기 — RRULE 라이브러리 없이 3가지 단순 포맷만 지원.
//   "monthly:25"    → 매월 25일 (해당 월에 그 날짜가 없으면 말일로 클램프)
//   "yearly:03-15"  → 매년 3월 15일
//   "weekly:mon"    → 매주 월요일 (mon|tue|wed|thu|fri|sat|sun)

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface ParsedRule {
  freq: "monthly" | "yearly" | "weekly";
  /** monthly: day-of-month (1-31) */
  day?: number;
  /** yearly: month (1-12) + day-of-month */
  month?: number;
  /** weekly: 0(일)~6(토) */
  weekday?: number;
}

function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

/** rule 문자열을 파싱. 형식이 잘못되면 Error를 던진다. */
export function parseRule(rule: string): ParsedRule {
  const [freq, arg] = rule.split(":");
  if (freq === "monthly") {
    const day = Number(arg);
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      throw new Error(`invalid monthly rule: ${rule}`);
    }
    return { freq: "monthly", day };
  }
  if (freq === "yearly") {
    const m = /^(\d{2})-(\d{2})$/.exec(arg ?? "");
    if (!m) throw new Error(`invalid yearly rule: ${rule}`);
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      throw new Error(`invalid yearly rule: ${rule}`);
    }
    return { freq: "yearly", month, day };
  }
  if (freq === "weekly") {
    const idx = WEEKDAYS.indexOf(arg as Weekday);
    if (idx < 0) throw new Error(`invalid weekly rule: ${rule}`);
    return { freq: "weekly", weekday: idx };
  }
  throw new Error(`unknown rule frequency: ${rule}`);
}

/** rule이 유효한 형식인지 검사 (API 입력 검증용). */
export function isValidRule(rule: string): boolean {
  try {
    parseRule(rule);
    return true;
  } catch {
    return false;
  }
}

/**
 * after 이후(엄밀히 after보다 뒤)의 첫 발생일을 로컬 자정 Date로 반환.
 * monthly:31처럼 해당 월에 없는 날짜는 그 월의 말일로 클램프한다.
 */
export function nextOccurrence(rule: string, after: Date): Date {
  const p = parseRule(rule);
  const base = new Date(after.getFullYear(), after.getMonth(), after.getDate());

  if (p.freq === "weekly") {
    const diff = (p.weekday! - base.getDay() + 7) % 7 || 7;
    return new Date(base.getFullYear(), base.getMonth(), base.getDate() + diff);
  }

  if (p.freq === "monthly") {
    for (let i = 0; i < 3; i++) {
      const y = base.getFullYear();
      const m = base.getMonth() + i;
      const yy = y + Math.floor(m / 12);
      const mm = ((m % 12) + 12) % 12;
      const d = Math.min(p.day!, daysInMonth(yy, mm));
      const cand = new Date(yy, mm, d);
      if (cand.getTime() > base.getTime()) return cand;
    }
    throw new Error("unreachable: monthly rule produced no occurrence");
  }

  // yearly
  for (let i = 0; i < 2; i++) {
    const yy = base.getFullYear() + i;
    const mm = p.month! - 1;
    const d = Math.min(p.day!, daysInMonth(yy, mm));
    const cand = new Date(yy, mm, d);
    if (cand.getTime() > base.getTime()) return cand;
  }
  throw new Error("unreachable: yearly rule produced no occurrence");
}

/**
 * 특정 월(YYYY-MM) 안에서 rule의 발생일들을 반환.
 * monthly/yearly는 0~1건, weekly는 4~5건이 나올 수 있다.
 */
export function occurrencesInMonth(rule: string, month: string): Date[] {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new Error(`invalid month: ${month}`);
  const year = Number(m[1]);
  const mon0 = Number(m[2]) - 1;
  const lastDayPrev = new Date(year, mon0, 0); // 전월 말일
  const out: Date[] = [];
  let cursor = lastDayPrev;
  for (let guard = 0; guard < 8; guard++) {
    const next = nextOccurrence(rule, cursor);
    if (next.getFullYear() !== year || next.getMonth() !== mon0) break;
    out.push(next);
    cursor = next;
  }
  return out;
}

/** 로컬 기준 YYYY-MM-DD 문자열. */
export function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
