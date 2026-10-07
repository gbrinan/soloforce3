export type TxType = "expense" | "income" | "transfer";
export type AssetType = "cash" | "bank" | "card" | "savings" | "loan" | "receivable" | "payable";
export type Cycle = "monthly" | "yearly";
export type CatKind = "expense" | "income";

export interface Category {
  id: string;
  kind: CatKind;
  emoji: string;
  name: { ko: string; en: string; ja: string };
  custom?: boolean;
}

export interface Asset {
  id: string;
  name: string;
  type: AssetType;
  initialBalance: number;
  createdAt: string;
}

export interface Tx {
  id: string;
  type: TxType;
  amount: number;
  categoryId: string | null;
  assetId: string | null;
  toAssetId: string | null;
  memo: string;
  date: string; // YYYY-MM-DD
  createdAt: string;
  subscriptionId: string | null;
}

export interface Subscription {
  id: string;
  name: string;
  amount: number;
  cycle: Cycle;
  billingDay: number; // 1-31
  billingMonth: number; // 1-12 (yearly)
  assetId: string | null;
  categoryId: string;
  memo: string;
  active: boolean;
  startedAt: string;
  chargedPeriods: string[];
  createdAt: string;
}

// ── 자산관리 (재무설계) ──
export type HoldingKind = "deposit" | "savings" | "stock" | "etf" | "crypto" | "fx" | "gold" | "loan" | "receivable" | "payable";

export interface Holding {
  id: string;
  kind: HoldingKind;
  name: string;
  memo: string;
  source: "manual" | "kis" | "upbit";
  createdAt: string;
  // deposit / savings
  principal?: number;
  ratePct?: number;
  startDate?: string;
  maturityDate?: string | null;
  monthlyDeposit?: number; // savings
  // stock / etf
  ticker?: string;
  exchange?: string; // KRX(국내, 기본) | NAS | NYS | AMS | HKS | TSE | SHS | SZS
  // crypto
  market?: string; // KRW-BTC
  qty?: number;
  avgPrice?: number;
  // fx
  currency?: string;
  amount?: number;
  avgRate?: number;
  // gold
  grams?: number;
  avgPricePerGram?: number;
  // loan / receivable / payable
  interestRate?: number;
  loanDate?: string;
  lentDate?: string;
  borrowedDate?: string;
}

export interface Snapshot {
  date: string;
  total: number;
  byKind: Record<string, number>;
}

export interface Quotes {
  // 키: 국내 = ticker, 해외 = "EXCD:ticker" (예: "NAS:AAPL"). 해외는 currency 포함(현지통화 가격).
  stocks: Record<string, { price: number; changePct: number; name?: string; currency?: string }>;
  crypto: Record<string, { price: number; changePct: number }>;
  fx: Record<string, number>;
  fxSource?: "KIS" | "ECB" | "KIS+ECB";
  gold: { krwPerGram: number; usdPerOz: number } | null;
  errors: string[];
  fetchedAt: string;
}

export interface DividendEvent {
  payDate: string | null;
  recordDate: string | null;
  perShare: number; // 0 = 미공시(예정)
  amountKrw: number; // 보유수량 기준 추정 지급액 (세전, 원화)
}

export interface Dividends {
  items: {
    holdingId: string; name: string; ticker: string; exchange: string;
    qty: number; currency: string; events: DividendEvent[];
  }[];
  errors: string[];
  fetchedAt: string;
}

export interface LedgerState {
  assets: Asset[];
  categories: Category[];
  transactions: Tx[];
  budgets: Record<string, number>;
  subscriptions: Subscription[];
  holdings: Holding[];
  snapshots: Snapshot[];
}
