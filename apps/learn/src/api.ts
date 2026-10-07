import type { BookSource, Deck, DeckSummary, Grade, QueueCard, SourceType, SrsCard, Stats } from "./types";

// 프록시(/api/apps/learn/proxy)와 직접 접속(:13247) 모두에서 동작하도록
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
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  listDecks: () => req<{ items: DeckSummary[] }>(`/api/decks`),
  getDeck: (id: string) => req<{ item: Deck }>(`/api/decks/${id}`),
  renameDeck: (id: string, title: string) =>
    req<{ item: Deck }>(`/api/decks/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  removeDeck: (id: string) => req<{ item: Deck }>(`/api/decks/${id}`, { method: "DELETE" }),
  generateDeck: (text: string, sourceType: SourceType, sourceTitle: string) =>
    req<{ item: Deck }>(`/api/ai/generate-deck`, {
      method: "POST",
      body: JSON.stringify({ text, sourceType, sourceTitle }),
    }),
  bookSources: () => req<{ items: BookSource[] }>(`/api/sources/books`),
  extractUrl: (url: string) =>
    req<{ text: string; title: string }>(`/api/sources/extract-url`, { method: "POST", body: JSON.stringify({ url }) }),
  reviewQueue: (deckId?: string) =>
    req<{ items: QueueCard[]; today: string }>(`/api/review/queue${deckId ? `?deckId=${encodeURIComponent(deckId)}` : ""}`),
  answer: (cardId: string, grade: Grade) =>
    req<{ item: SrsCard }>(`/api/review/answer`, { method: "POST", body: JSON.stringify({ cardId, grade }) }),
  stats: () => req<Stats>(`/api/stats`),
};
