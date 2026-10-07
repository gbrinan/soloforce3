// Payment backend — subscription / per-seat model.
// TossPayments: real API if TOSS_SECRET_KEY set, else mock.
// Popbill: stub (npm install @popbill/node + TODO comment when integrating real SDK).
// Persistence: history/payment/ JSON files (small data, last-write-wins safe).
// API contract: see history/outputs/linus/b2b-api-contract_linus_2026-06-26.md

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { HISTORY_DIR } from "../config.js";

const PAYMENT_DIR = join(HISTORY_DIR, "payment");

function ensureDir(): void {
  if (!existsSync(PAYMENT_DIR)) mkdirSync(PAYMENT_DIR, { recursive: true });
}

function readJson<T>(file: string, fallback: T): T {
  const p = join(PAYMENT_DIR, file);
  try { if (!existsSync(p)) return fallback; return JSON.parse(readFileSync(p, "utf-8")) as T; } catch { return fallback; }
}

function writeJson(file: string, data: unknown): void {
  ensureDir();
  writeFileSync(join(PAYMENT_DIR, file), JSON.stringify(data, null, 2));
}

// ── Plan definitions ──────────────────────────────────────────────────────────

export type PlanId = "free" | "starter" | "pro" | "enterprise";
export type BillingCycle = "monthly" | "annual";

export interface Plan {
  id: PlanId;
  name: string;
  pricePerSeatMonthly: number;  // KRW, 0 for free/enterprise (custom quote)
  maxSeats: number | null;
  features: string[];
}

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "무료",
    pricePerSeatMonthly: 0,
    maxSeats: 3,
    features: ["AI 에이전트 3명", "미니앱 3개", "5GB 스토리지"],
  },
  {
    id: "starter",
    name: "스타터",
    pricePerSeatMonthly: 9900,
    maxSeats: 10,
    features: ["AI 에이전트 무제한", "미니앱 전체", "알림센터", "30GB 스토리지"],
  },
  {
    id: "pro",
    name: "프로",
    pricePerSeatMonthly: 19900,
    maxSeats: 50,
    features: ["스타터 전체", "결재 워크플로", "감사 로그 90일", "우선 지원", "100GB 스토리지"],
  },
  {
    id: "enterprise",
    name: "엔터프라이즈",
    pricePerSeatMonthly: 0,
    maxSeats: null,
    features: ["프로 전체", "SAML SSO", "전담 지원", "SLA 계약", "무제한 스토리지"],
  },
];

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BillingKey {
  id: string;
  workspaceId: string;
  customerKey: string;
  method: "card" | "bank";
  maskedNumber?: string;
  issuedAt: string;
  tossBillingKey?: string;    // null in mock mode
  mock: boolean;
}

export interface Subscription {
  id: string;
  workspaceId: string;
  planId: PlanId;
  seats: number;
  billingCycle: BillingCycle;
  billingKeyId?: string;
  status: "trialing" | "active" | "past_due" | "cancelled";
  trialEndsAt?: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  createdAt: string;
  updatedAt: string;
}

export interface Invoice {
  id: string;
  workspaceId: string;
  subscriptionId: string;
  amount: number;           // KRW
  seats: number;
  planId: PlanId;
  billingCycle: BillingCycle;
  status: "pending" | "paid" | "failed";
  periodStart: string;
  periodEnd: string;
  paidAt?: string;
  taxInvoiceId?: string;
  createdAt: string;
}

// ── Subscription ──────────────────────────────────────────────────────────────

export function createSubscription(
  workspaceId: string,
  planId: PlanId,
  seats: number,
  billingCycle: BillingCycle,
): Subscription {
  ensureDir();
  const all = readJson<Subscription[]>("subscriptions.json", []);
  const now = new Date();
  const periodEnd = billingCycle === "annual"
    ? new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()).toISOString()
    : new Date(now.getFullYear(), now.getMonth() + 1, now.getDate()).toISOString();
  const sub: Subscription = {
    id: randomUUID(),
    workspaceId,
    planId,
    seats,
    billingCycle,
    status: planId === "free" ? "active" : "trialing",
    ...(planId !== "free" ? { trialEndsAt: new Date(now.getTime() + 14 * 86400000).toISOString() } : {}),
    currentPeriodStart: now.toISOString(),
    currentPeriodEnd: periodEnd,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  all.push(sub);
  writeJson("subscriptions.json", all);
  return sub;
}

export function getSubscription(workspaceId: string): Subscription | null {
  return readJson<Subscription[]>("subscriptions.json", [])
    .find((s) => s.workspaceId === workspaceId && s.status !== "cancelled") ?? null;
}

export function updateSubscription(
  workspaceId: string,
  patch: Partial<Pick<Subscription, "planId" | "seats" | "billingCycle" | "status" | "billingKeyId">>,
): Subscription | null {
  const all = readJson<Subscription[]>("subscriptions.json", []);
  const sub = all.find((s) => s.workspaceId === workspaceId && s.status !== "cancelled");
  if (!sub) return null;
  Object.assign(sub, patch, { updatedAt: new Date().toISOString() });
  writeJson("subscriptions.json", all);
  return sub;
}

// ── Billing Key (TossPayments) ────────────────────────────────────────────────

const TOSS_SECRET = process.env.TOSS_SECRET_KEY ?? "";

export async function issueBillingKey(
  workspaceId: string,
  customerKey: string,
  authCode: string,
): Promise<{ billingKey: BillingKey } | { error: string }> {
  ensureDir();
  const all = readJson<BillingKey[]>("billing-keys.json", []);
  const isMock = !TOSS_SECRET;

  if (!isMock) {
    try {
      const credential = Buffer.from(`${TOSS_SECRET}:`).toString("base64");
      const res = await fetch("https://api.tosspayments.com/v1/billing/authorizations/issue", {
        method: "POST",
        headers: { Authorization: `Basic ${credential}`, "Content-Type": "application/json" },
        body: JSON.stringify({ customerKey, authCode }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string };
        return { error: body.message ?? `TossPayments error ${res.status}` };
      }
      const data = await res.json() as { billingKey?: string; card?: { number?: string } };
      const bk: BillingKey = {
        id: randomUUID(),
        workspaceId,
        customerKey,
        method: "card",
        maskedNumber: data.card?.number,
        issuedAt: new Date().toISOString(),
        tossBillingKey: data.billingKey,
        mock: false,
      };
      all.push(bk);
      writeJson("billing-keys.json", all);
      return { billingKey: bk };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  // Mock mode
  const bk: BillingKey = {
    id: randomUUID(),
    workspaceId,
    customerKey,
    method: "card",
    maskedNumber: "****-****-****-1234",
    issuedAt: new Date().toISOString(),
    mock: true,
  };
  all.push(bk);
  writeJson("billing-keys.json", all);
  return { billingKey: bk };
}

export function getBillingKey(workspaceId: string): BillingKey | null {
  return readJson<BillingKey[]>("billing-keys.json", [])
    .filter((bk) => bk.workspaceId === workspaceId)
    .slice(-1)[0] ?? null;
}

// ── Invoice & Charge ──────────────────────────────────────────────────────────

export function computeAmount(planId: PlanId, seats: number, billingCycle: BillingCycle): number {
  const plan = PLANS.find((p) => p.id === planId);
  if (!plan || plan.pricePerSeatMonthly === 0) return 0;
  const monthly = plan.pricePerSeatMonthly * seats;
  // Annual = 10 months price (2 months free)
  return billingCycle === "annual" ? monthly * 10 : monthly;
}

export async function chargeSubscription(
  workspaceId: string,
): Promise<{ invoice: Invoice } | { error: string }> {
  const sub = getSubscription(workspaceId);
  if (!sub) return { error: "no active subscription" };
  const bk = getBillingKey(workspaceId);
  const amount = computeAmount(sub.planId, sub.seats, sub.billingCycle);
  if (amount > 0 && !bk) return { error: "no billing key on file" };

  const now = new Date().toISOString();
  const invoice: Invoice = {
    id: randomUUID(),
    workspaceId,
    subscriptionId: sub.id,
    amount,
    seats: sub.seats,
    planId: sub.planId,
    billingCycle: sub.billingCycle,
    status: "pending",
    periodStart: sub.currentPeriodStart,
    periodEnd: sub.currentPeriodEnd,
    createdAt: now,
  };

  if (amount === 0 || !bk || bk.mock || !TOSS_SECRET) {
    invoice.status = "paid";
    invoice.paidAt = now;
  } else {
    // Real TossPayments charge
    try {
      const credential = Buffer.from(`${TOSS_SECRET}:`).toString("base64");
      const orderId = `INV-${invoice.id.slice(0, 8)}-${Date.now()}`;
      const res = await fetch(`https://api.tosspayments.com/v1/billing/${bk.tossBillingKey ?? ""}`, {
        method: "POST",
        headers: { Authorization: `Basic ${credential}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          customerKey: bk.customerKey,
          amount,
          orderId,
          orderName: `마이크루 ${sub.planId} ${sub.seats}석 (${sub.billingCycle})`,
        }),
      });
      if (res.ok) {
        invoice.status = "paid";
        invoice.paidAt = new Date().toISOString();
      } else {
        invoice.status = "failed";
      }
    } catch {
      invoice.status = "failed";
    }
  }

  const all = readJson<Invoice[]>("invoices.json", []);
  all.push(invoice);
  writeJson("invoices.json", all);
  return { invoice };
}

export function listInvoices(workspaceId: string): Invoice[] {
  return readJson<Invoice[]>("invoices.json", [])
    .filter((i) => i.workspaceId === workspaceId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getInvoice(id: string): Invoice | null {
  return readJson<Invoice[]>("invoices.json", []).find((i) => i.id === id) ?? null;
}

// ── Popbill Tax Invoice stub ──────────────────────────────────────────────────
// TODO: npm install @popbill/node → replace stub with real SDK call.
// Real integration requires POPBILL_LINK_ID + POPBILL_SECRET_KEY env vars.

export interface TaxInvoiceRequest {
  invoiceId: string;
  supplierBizNum: string;   // 공급자(우리) 사업자번호
  buyerBizNum: string;      // 공급받는자 사업자번호
  buyerCorpName: string;
  buyerEmail: string;
  amount: number;           // 공급가액 (VAT 제외)
}

/** 실 세금계산서 발급이 아직 구현되지 않았음을 알리는 오류. 라우트에서 501로 매핑한다. */
export class TaxInvoiceNotImplementedError extends Error {
  constructor() {
    super("실 세금계산서(Popbill) 발급이 아직 연동되지 않았습니다.");
    this.name = "TaxInvoiceNotImplementedError";
  }
}

export async function issueTaxInvoice(
  req: TaxInvoiceRequest,
): Promise<{ ntsConfirmNum: string; mock: boolean }> {
  const isReal = !!(process.env.POPBILL_LINK_ID && process.env.POPBILL_SECRET_KEY);
  if (isReal) {
    // 자격증명이 설정된 프로덕션 의도인데 실 SDK가 미연동 상태.
    // 가짜 확인번호를 성공처럼 저장하면 국세청 발급이 안 됐는데 발급된 것으로 오인 → 컴플라이언스 리스크.
    // 따라서 목업 번호를 인보이스에 기록하지 않고 명시적으로 미구현을 알린다.
    // TODO: implement with @popbill/node SDK.
    throw new TaxInvoiceNotImplementedError();
  }
  // 자격증명 미설정(개발/모의 환경)에서만 목업 발급 — 응답에 mock:true로 명시.
  const ntsConfirmNum = `MOCK-${Date.now()}-${req.invoiceId.slice(0, 8)}`;
  const all = readJson<Invoice[]>("invoices.json", []);
  const inv = all.find((i) => i.id === req.invoiceId);
  if (inv) { inv.taxInvoiceId = ntsConfirmNum; writeJson("invoices.json", all); }
  return { ntsConfirmNum, mock: true };
}
