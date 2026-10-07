import type { LedgerState, Tx, Asset, Category, Subscription, Holding, Quotes, Snapshot, Dividends } from "./types";

// 프록시(/api/apps/ledger/proxy)와 직접 접속(:13245) 모두에서 동작하도록
// 현재 경로 기준 상대 base를 계산한다.
const BASE = (() => {
  const m = window.location.pathname.match(/^(.*\/proxy)(\/|$)/);
  return m ? m[1] : "";
})();

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  state: () => req<LedgerState>("/api/state"),
  addTx: (tx: Partial<Tx>) => req<{ item: Tx }>("/api/transactions", { method: "POST", body: JSON.stringify(tx) }),
  updateTx: (id: string, patch: Partial<Tx>) =>
    req<{ item: Tx }>(`/api/transactions/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  removeTx: (id: string) => req<{ item: Tx }>(`/api/transactions/${id}`, { method: "DELETE" }),
  addAsset: (a: Partial<Asset>) => req<{ item: Asset }>("/api/assets", { method: "POST", body: JSON.stringify(a) }),
  updateAsset: (id: string, patch: Partial<Asset>) =>
    req<{ item: Asset }>(`/api/assets/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  removeAsset: (id: string) => req<{ item: Asset }>(`/api/assets/${id}`, { method: "DELETE" }),
  addCategory: (c: { name: string; kind: string; emoji: string }) =>
    req<{ item: Category }>("/api/categories", { method: "POST", body: JSON.stringify(c) }),
  removeCategory: (id: string) => req<{ item: Category }>(`/api/categories/${id}`, { method: "DELETE" }),
  saveBudgets: (budgets: Record<string, number>) =>
    req<{ budgets: Record<string, number> }>("/api/budgets", { method: "PUT", body: JSON.stringify(budgets) }),
  addSub: (s: Partial<Subscription>) =>
    req<{ item: Subscription }>("/api/subscriptions", { method: "POST", body: JSON.stringify(s) }),
  updateSub: (id: string, patch: Partial<Subscription>) =>
    req<{ item: Subscription }>(`/api/subscriptions/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  removeSub: (id: string) => req<{ item: Subscription }>(`/api/subscriptions/${id}`, { method: "DELETE" }),
  exportUrl: () => `${BASE}/api/export.csv`,
  aiParse: (text: string) =>
    req<{ drafts: TxDraft[] }>("/api/ai-parse", { method: "POST", body: JSON.stringify({ text }) }),
  aiCategorize: (input: { memo: string; amount?: number; kind: "expense" | "income" }) =>
    req<{ categoryId: string }>("/api/ai/categorize", { method: "POST", body: JSON.stringify(input) }),
  aiInsights: (month: string, lang: string) =>
    req<AiInsights>(`/api/ai/insights?month=${month}&lang=${lang}`),
  aiForecast: (month: string, lang: string) =>
    req<AiForecast>("/api/ai/forecast", { method: "POST", body: JSON.stringify({ month, lang }) }),
  aiAnomalies: (lang: string) =>
    req<AiAnomalies>("/api/ai/anomalies", { method: "POST", body: JSON.stringify({ lang }) }),
  aiParseOne: (text: string) =>
    req<{ draft: AiTxDraft }>("/api/ai/parse-transaction", { method: "POST", body: JSON.stringify({ text }) }),
  smsParse: (text: string) =>
    req<{ drafts: TxDraft[] }>("/api/sms-parse", { method: "POST", body: JSON.stringify({ text }) }),
  smsScan: () => req<{ items: TxDraft[] }>("/api/sms-scan"),
  smsDismiss: (guid: string) =>
    req<{ ok: boolean }>("/api/sms-dismiss", { method: "POST", body: JSON.stringify({ guid }) }),
  // ── 자산관리 (재무설계) ──
  addHolding: (h: Partial<Holding>) =>
    req<{ item: Holding }>("/api/holdings", { method: "POST", body: JSON.stringify(h) }),
  updateHolding: (id: string, patch: Partial<Holding>) =>
    req<{ item: Holding }>(`/api/holdings/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  removeHolding: (id: string) => req<{ item: Holding }>(`/api/holdings/${id}`, { method: "DELETE" }),
  quotes: () => req<Quotes>("/api/quotes"),
  dividends: () => req<Dividends>("/api/dividends"),
  syncKis: () => req<{ added: number; updated: number; count: number }>("/api/sync/kis", { method: "POST" }),
  syncUpbit: () => req<{ added: number; updated: number; count: number }>("/api/sync/upbit", { method: "POST" }),
  saveSnapshot: (s: Snapshot) =>
    req<{ item: Snapshot }>("/api/snapshot", { method: "POST", body: JSON.stringify(s) }),
};

// AI 자연어 단건 파싱 결과 (/api/ai/parse-transaction)
export interface AiTxDraft {
  date: string;
  amount: number;
  kind: "expense" | "income";
  categoryId: string;
  memo: string;
}

// AI 월간 인사이트 (/api/ai/insights)
export interface AiInsights {
  month: string;
  lang: string;
  insights: string[];
  generatedAt: string;
}

// AI 현금흐름 예측 (/api/ai/forecast)
export interface AiForecast {
  month: string;
  lang: string;
  predictedSpend: number;
  predictedBalance: number;
  riskLevel: "low" | "medium" | "high";
  warnings: string[];
  byCategory: { category: string; projected: number }[];
  generatedAt: string;
}

// AI 이상거래·중복탐지 (/api/ai/anomalies)
export interface AiAnomaly {
  type: "high_amount" | "new_merchant" | "duplicate";
  description: string;
  amount?: number;
  severity: "low" | "medium" | "high";
}
export interface AiAnomalies {
  lang: string;
  anomalies: AiAnomaly[];
  duplicateSubs: string[];
  generatedAt: string;
}

export interface TxDraft {
  type: "expense" | "income";
  amount: number;
  categoryId: string;
  date: string;
  memo: string;
  guid?: string;
  receivedAt?: string;
  raw?: string;
}
