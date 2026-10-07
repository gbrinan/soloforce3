import type { Asset, Subscription, Tx, Category } from "./types";
import type { Locale } from "./i18n";

// ── 금액 포맷 (KRW, 로케일별 표기) ──
const NF: Record<Locale, Intl.NumberFormat> = {
  ko: new Intl.NumberFormat("ko-KR"),
  en: new Intl.NumberFormat("en-US"),
  ja: new Intl.NumberFormat("ja-JP"),
};
export function fmtMoney(n: number, locale: Locale): string {
  return `${NF[locale].format(n)}${locale === "ko" ? "원" : locale === "ja" ? "円" : " KRW"}`;
}
export function fmtMoneyShort(n: number, locale: Locale): string {
  return NF[locale].format(n);
}

// ── 날짜 ──
export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function ymOf(date: string): string {
  return date.slice(0, 7);
}
export function monthLabel(ym: string, locale: Locale): string {
  const [y, m] = [ym.slice(0, 4), Number(ym.slice(5, 7))];
  if (locale === "en") {
    const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${names[m - 1]} ${y}`;
  }
  return locale === "ja" ? `${y}年${m}月` : `${y}년 ${m}월`;
}
export function shiftYm(ym: string, delta: number): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7)) - 1 + delta;
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
export function clampDay(year: number, monthIdx: number, day: number): number {
  const last = new Date(year, monthIdx + 1, 0).getDate();
  return Math.min(day, last);
}

// ── 자산관리: 예금·적금 평가액 (약정 이율 기반 자동 계산) ──
// 예금: 원금 + 단리 경과이자 (만기 이후는 만기일까지만 계산)
export function depositValue(principal: number, ratePct: number, startDate: string, maturityDate?: string | null): number {
  const start = new Date(startDate).getTime();
  const end = Math.min(Date.now(), maturityDate ? new Date(maturityDate).getTime() : Infinity);
  const days = Math.max(0, (end - start) / 86_400_000);
  return Math.round(principal * (1 + (ratePct / 100) * (days / 365)));
}

// 적금: 매월 납입, 납입회차별 경과월 단리 (총이자 = 월납입 × r/12 × n(n+1)/2 방식의 경과분)
export function savingsValue(monthlyDeposit: number, ratePct: number, startDate: string, maturityDate?: string | null): number {
  const start = new Date(startDate);
  const now = new Date(Math.min(Date.now(), maturityDate ? new Date(maturityDate).getTime() : Infinity));
  if (now.getTime() < start.getTime()) return 0;
  // 납입 회차: 시작일부터 매월 같은 날 납입 가정
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() >= start.getDate()) months += 1; // 이번 달 납입 완료
  months = Math.max(0, months);
  const principal = monthlyDeposit * months;
  const monthlyRate = ratePct / 100 / 12;
  // i번째(1-base) 납입금의 경과월 = months - i + 1 (현재 시점 기준 단리)
  let interest = 0;
  for (let i = 1; i <= months; i++) interest += monthlyDeposit * monthlyRate * (months - i + 1);
  return Math.round(principal + interest);
}

// 만기 D-day (만기 없으면 null, 지났으면 음수)
export function daysToMaturity(maturityDate?: string | null): number | null {
  if (!maturityDate) return null;
  return Math.ceil((new Date(maturityDate).getTime() - Date.now()) / 86_400_000);
}

// ── 자산 잔액 계산: 초기잔액 + 수입 - 지출 ± 이체 ──
export function assetBalance(asset: Asset, txs: Tx[]): number {
  let bal = asset.initialBalance;
  for (const t of txs) {
    if (t.type === "income" && t.assetId === asset.id) bal += t.amount;
    else if (t.type === "expense" && t.assetId === asset.id) bal -= t.amount;
    else if (t.type === "transfer") {
      if (t.assetId === asset.id) bal -= t.amount;
      if (t.toAssetId === asset.id) bal += t.amount;
    }
  }
  return bal;
}

// ── 구독: 다음 결제일 계산 ──
// 이미 자동 기입된 기간(chargedPeriods)은 건너뛴다 — 결제일 당일에 기입이 끝났으면
// 다음 결제는 다음 주기다.
export function nextBillingDate(sub: Subscription): string {
  const now = new Date();
  const charged = new Set(sub.chargedPeriods ?? []);
  if (sub.cycle === "monthly") {
    for (let i = 0; i < 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (charged.has(period)) continue;
      const day = clampDay(d.getFullYear(), d.getMonth(), sub.billingDay);
      const cand = `${period}-${String(day).padStart(2, "0")}`;
      if (cand >= todayStr()) return cand;
    }
  } else {
    for (let i = 0; i < 3; i++) {
      const y = now.getFullYear() + i;
      if (charged.has(String(y))) continue;
      const mIdx = sub.billingMonth - 1;
      const day = clampDay(y, mIdx, sub.billingDay);
      const cand = `${y}-${String(mIdx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (cand >= todayStr()) return cand;
    }
  }
  return todayStr();
}

// 월 환산 금액 (연 구독은 /12 반올림)
export function monthlyEquivalent(sub: Subscription): number {
  return sub.cycle === "monthly" ? sub.amount : Math.round(sub.amount / 12);
}

export function catName(c: Category | undefined, locale: Locale): string {
  if (!c) return "—";
  return c.name[locale] ?? c.name.ko;
}

export function dateLabel(date: string, locale: Locale): string {
  const d = new Date(`${date}T00:00:00`);
  const wd = d.toLocaleDateString(locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US", { weekday: "short" });
  const [m, day] = [d.getMonth() + 1, d.getDate()];
  if (locale === "ja") return `${m}月${day}日 (${wd})`;
  if (locale === "en") {
    const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${names[m - 1]} ${day} (${wd})`;
  }
  return `${m}월 ${day}일 (${wd})`;
}
