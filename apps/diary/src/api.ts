import type { DailyRetro, DiaryEntry, DiarySettings, WritingPrompt } from "./types";

// 프록시(/api/apps/diary/proxy)와 직접 접속(:13246) 모두에서 동작하도록
// 현재 경로 기준 상대 base를 계산한다. (bookshelf 컨벤션)
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
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  listEntries: () => req<{ items: DiaryEntry[] }>(`/api/entries`),
  createEntry: (entry: Pick<DiaryEntry, "date" | "content" | "mood" | "template" | "sections">) =>
    req<{ item: DiaryEntry }>(`/api/entries`, { method: "POST", body: JSON.stringify(entry) }),
  updateEntry: (id: string, patch: Partial<Pick<DiaryEntry, "content" | "mood" | "template" | "sections">>) =>
    req<{ item: DiaryEntry }>(`/api/entries/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  removeEntry: (id: string) => req<{ item: DiaryEntry }>(`/api/entries/${id}`, { method: "DELETE" }),
  reflect: (id: string) =>
    req<{ item: DiaryEntry }>(`/api/ai/reflect`, { method: "POST", body: JSON.stringify({ id }) }),
  getPrompt: (date: string) =>
    req<{ item: WritingPrompt | null }>(`/api/prompts?date=${encodeURIComponent(date)}`),
  generatePrompt: (date: string) =>
    req<{ item: WritingPrompt }>(`/api/ai/prompt`, { method: "POST", body: JSON.stringify({ date }) }),
  listRetros: () => req<{ items: DailyRetro[] }>(`/api/retros`),
  generateDailyRetro: (date?: string) =>
    req<{ item: DailyRetro }>(`/api/retro/daily`, { method: "POST", body: JSON.stringify(date ? { date } : {}) }),
  getSettings: () => req<{ item: DiarySettings }>(`/api/settings`),
  saveSettings: (patch: Partial<DiarySettings>) =>
    req<{ item: DiarySettings }>(`/api/settings`, { method: "PUT", body: JSON.stringify(patch) }),
};
