// Vendor settlement backend — 벤더별 지급(정산) 규칙.
// 기준일: 해당 건의 강의 종료일(마지막 강의 날짜). 규칙은 종료일의 "일(day)"이 속한
// 구간(band)에 따라 지급일을 산정한다.
//   예) 엑스퍼트컨설팅
//     - 규칙 A: 종료일이 1~15일  → 익월(+1) 20일 지급
//     - 규칙 B: 종료일이 16~말일 → 익익월(+2) 5일 지급
//   예) 스파르타 — 분기 없음, 종료일이 며칠이든 익월(+1) 10일 지급 (구간 1개)
// 규칙은 코드가 아닌 데이터(JSON)로 등록해 벤더별로 다른 규칙을 붙일 수 있게 한다.
// Persistence: history/vendor-settlement/settlement-rules.json (small data, last-write-wins safe).
// 날짜 산정(computePayoutDate)은 순수 함수 — Date/타임존에 의존하지 않고 연/월/일 정수 연산만 한다.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HISTORY_DIR } from "../config.js";

const SETTLEMENT_DIR = join(HISTORY_DIR, "vendor-settlement");
const RULES_FILE = "settlement-rules.json";

function ensureDir(): void {
  if (!existsSync(SETTLEMENT_DIR)) mkdirSync(SETTLEMENT_DIR, { recursive: true });
}

function readJson<T>(file: string, fallback: T): T {
  const p = join(SETTLEMENT_DIR, file);
  try { if (!existsSync(p)) return fallback; return JSON.parse(readFileSync(p, "utf-8")) as T; } catch { return fallback; }
}

function writeJson(file: string, data: unknown): void {
  ensureDir();
  writeFileSync(join(SETTLEMENT_DIR, file), JSON.stringify(data, null, 2));
}

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * 지급일 산정 구간. 강의 종료일의 "일(day)"이 [dayFrom, dayTo] 안에 들면 이 규칙을 적용한다.
 * dayTo=31은 "그 달 말일"의 상한 sentinel — 실제 일자는 해당 월 말일을 넘지 못하므로 안전하다.
 */
export interface SettlementBand {
  id: string;               // 규칙 식별자 (예: "A", "B")
  dayFrom: number;          // 구간 시작일 (1~31)
  dayTo: number;            // 구간 종료일 (1~31; 말일은 31로 표기)
  payoutMonthOffset: number; // 종료일 기준 지급 월 오프셋 (익월=1, 익익월=2)
  payoutDay: number;        // 지급일의 일자 (예: 20, 5)
}

export type SettlementBasis = "lecture_end_date";

export interface VendorSettlementRule {
  vendorId: string;         // 내부 식별자 (예: "expert-consulting")
  vendorName: string;       // 표시 이름 (예: "엑스퍼트컨설팅")
  basis: SettlementBasis;   // 기준일 종류 — 현재는 강의 종료일만 지원
  bands: SettlementBand[];  // 지급일 산정 구간들 (구간은 서로 겹치지 않아야 함)
  updatedAt?: string;
}

type RuleMap = Record<string, VendorSettlementRule>;

// ── 등록/조회 ────────────────────────────────────────────────────────────────

export function listVendorRules(): VendorSettlementRule[] {
  return Object.values(readJson<RuleMap>(RULES_FILE, {}));
}

export function getVendorRule(vendorId: string): VendorSettlementRule | null {
  return readJson<RuleMap>(RULES_FILE, {})[vendorId] ?? null;
}

/** 벤더 규칙을 등록/갱신한다. 등록 전 구간 유효성을 검증한다. */
export function upsertVendorRule(
  rule: Omit<VendorSettlementRule, "updatedAt">,
): VendorSettlementRule {
  validateBands(rule.bands);
  const all = readJson<RuleMap>(RULES_FILE, {});
  const saved: VendorSettlementRule = { ...rule, updatedAt: new Date().toISOString() };
  all[rule.vendorId] = saved;
  writeJson(RULES_FILE, all);
  return saved;
}

/** 구간이 1~31 범위 내이고 dayFrom<=dayTo이며 서로 겹치지 않는지 검증. */
export function validateBands(bands: SettlementBand[]): void {
  if (!Array.isArray(bands) || bands.length === 0) {
    throw new Error("정산 구간(bands)이 비어 있습니다.");
  }
  for (const b of bands) {
    if (b.dayFrom < 1 || b.dayTo > 31 || b.dayFrom > b.dayTo) {
      throw new Error(`구간 '${b.id}'의 일자 범위가 잘못되었습니다 (${b.dayFrom}~${b.dayTo}).`);
    }
    if (!Number.isInteger(b.payoutDay) || b.payoutDay < 1 || b.payoutDay > 31) {
      throw new Error(`구간 '${b.id}'의 지급일(payoutDay=${b.payoutDay})이 잘못되었습니다.`);
    }
    if (!Number.isInteger(b.payoutMonthOffset) || b.payoutMonthOffset < 0) {
      throw new Error(`구간 '${b.id}'의 월 오프셋(payoutMonthOffset=${b.payoutMonthOffset})이 잘못되었습니다.`);
    }
  }
  const sorted = [...bands].sort((a, b) => a.dayFrom - b.dayFrom);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.dayFrom <= sorted[i - 1]!.dayTo) {
      throw new Error(`구간 '${sorted[i - 1]!.id}'와 '${sorted[i]!.id}'가 겹칩니다.`);
    }
  }
}

// ── 날짜 산정 (순수 함수) ─────────────────────────────────────────────────────

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** 연/월(1~12) + 오프셋을 더해 연도 롤오버까지 반영한 연/월을 반환. Date에 의존하지 않음. */
function addMonths(year: number, month1: number, offset: number): { year: number; month1: number } {
  const zeroBased = (month1 - 1) + offset;          // 0~ 기반
  const newYear = year + Math.floor(zeroBased / 12);
  const newMonth0 = ((zeroBased % 12) + 12) % 12;   // 음수 오프셋 방어
  return { year: newYear, month1: newMonth0 + 1 };
}

/** 해당 월의 말일(28~31). payoutDay가 말일을 넘으면 말일로 클램프하는 데 사용. */
function lastDayOfMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/**
 * 강의 종료일(YYYY-MM-DD)과 벤더 규칙을 받아 지급일(YYYY-MM-DD)을 산정한다.
 * - 종료일의 "일(day)"이 속한 구간을 찾아 payoutMonthOffset/payoutDay를 적용.
 * - 연도 롤오버 처리 (예: 12/10 → 익월 익년 1/20).
 * - payoutDay가 대상 월 말일을 넘으면 말일로 클램프(예: 지급일 31이 2월이면 28/29).
 */
export function computePayoutDate(endDate: string, rule: VendorSettlementRule): string {
  const m = DATE_RE.exec(endDate);
  if (!m) throw new Error(`강의 종료일 형식이 잘못되었습니다: '${endDate}' (YYYY-MM-DD 이어야 함)`);
  const year = Number(m[1]);
  const month1 = Number(m[2]);
  const day = Number(m[3]);
  if (month1 < 1 || month1 > 12) throw new Error(`월이 잘못되었습니다: ${endDate}`);
  const maxDay = lastDayOfMonth(year, month1);
  if (day < 1 || day > maxDay) throw new Error(`일자가 잘못되었습니다: ${endDate} (${month1}월 말일=${maxDay})`);

  const band = rule.bands.find((b) => day >= b.dayFrom && day <= b.dayTo);
  if (!band) {
    throw new Error(`종료일 ${endDate}(일=${day})에 해당하는 정산 구간이 벤더 '${rule.vendorId}'에 없습니다.`);
  }

  const { year: py, month1: pm } = addMonths(year, month1, band.payoutMonthOffset);
  const payoutDay = Math.min(band.payoutDay, lastDayOfMonth(py, pm));
  return `${py}-${pad2(pm)}-${pad2(payoutDay)}`;
}

/** 벤더ID + 강의 종료일로 지급일을 산정. 규칙 미등록 시 null. */
export function getPayoutDate(vendorId: string, endDate: string): string | null {
  const rule = getVendorRule(vendorId);
  if (!rule) return null;
  return computePayoutDate(endDate, rule);
}

// ── 기본 규칙 정의 (엑스퍼트컨설팅) ───────────────────────────────────────────

/** 엑스퍼트컨설팅 정산 규칙 — 강의 종료일 기준. */
export const EXPERT_CONSULTING_RULE: Omit<VendorSettlementRule, "updatedAt"> = {
  vendorId: "expert-consulting",
  vendorName: "엑스퍼트컨설팅",
  basis: "lecture_end_date",
  bands: [
    { id: "A", dayFrom: 1, dayTo: 15, payoutMonthOffset: 1, payoutDay: 20 }, // 1~15일 → 익월 20일
    { id: "B", dayFrom: 16, dayTo: 31, payoutMonthOffset: 2, payoutDay: 5 }, // 16~말일 → 익익월 5일
  ],
};

/** 엑스퍼트컨설팅 규칙을 저장소에 등록(멱등). */
export function registerExpertConsultingRule(): VendorSettlementRule {
  return upsertVendorRule(EXPERT_CONSULTING_RULE);
}

// ── 기본 규칙 정의 (스파르타) ─────────────────────────────────────────────────

/**
 * 스파르타 정산 규칙 — 강의 종료일 기준.
 * 엑스퍼트컨설팅과 달리 1~15/16~말일 분기가 없다. 종료일이 며칠이든 무조건 익월(+1) 10일.
 * → 구간(band) 1개로 표현: 1~31일 전부 동일.
 */
export const SPARTA_RULE: Omit<VendorSettlementRule, "updatedAt"> = {
  vendorId: "sparta",
  vendorName: "스파르타",
  basis: "lecture_end_date",
  bands: [
    { id: "A", dayFrom: 1, dayTo: 31, payoutMonthOffset: 1, payoutDay: 10 }, // 며칠이든 → 익월 10일
  ],
};

/** 스파르타 규칙을 저장소에 등록(멱등). */
export function registerSpartaRule(): VendorSettlementRule {
  return upsertVendorRule(SPARTA_RULE);
}
