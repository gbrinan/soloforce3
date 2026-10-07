import type { CoverScan, Recommendation, SearchResult, ShelfBook } from "./types";

// 프록시(/api/apps/bookshelf/proxy)와 직접 접속(:13244) 모두에서 동작하도록
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
  search: (q: string) =>
    req<{ items: SearchResult[] }>(`/api/search?q=${encodeURIComponent(q)}`),
  list: () => req<{ items: ShelfBook[] }>(`/api/books`),
  add: (book: SearchResult) =>
    req<{ item: ShelfBook; duplicated?: boolean }>(`/api/books`, {
      method: "POST",
      body: JSON.stringify(book),
    }),
  update: (id: string, patch: Partial<Pick<ShelfBook, "status" | "liked" | "rating" | "memo">>) =>
    req<{ item: ShelfBook }>(`/api/books/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  remove: (id: string) => req<{ item: ShelfBook }>(`/api/books/${id}`, { method: "DELETE" }),
  scanCover: (imageDataUrl: string) =>
    req<{ item: CoverScan }>(`/api/ai/scan-cover`, {
      method: "POST",
      body: JSON.stringify({ image: imageDataUrl }),
    }),
  lookupIsbn: (isbn: string) =>
    req<{ item: CoverScan }>(`/api/ai/lookup-isbn?isbn=${encodeURIComponent(isbn)}`),
  recommend: (lang: string) =>
    req<{ items: Recommendation[] }>(`/api/ai/recommend?lang=${encodeURIComponent(lang)}`),
};
