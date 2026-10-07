// memory/search.ts — FTS 검색 API. FTS5 bm25 + 복합랭킹(relevance·recency·importance·type) + 단문 키워드 fallback.
// 불변식 M9: 검색은 memories에 쓰기 유발 안 함 — retrieval_log에만 기록(감사).
// P1-a 규약: trigram 질의는 phrase 인용 + 단문(<3음절)은 키워드 정확매치.
// 의미검색(벡터)은 도입 안 함 — 지니가 의미를 해석해 검색어를 확장하고, FTS는 빠른 검색 엔진 역할만.

import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";

export interface SearchOpts { owner?: string; type?: string; limit?: number; requester?: string; log?: boolean }
export interface SearchHit {
  id: string; type: string; owner_entity_id: string; title: string;
  prompt_summary: string; importance: number; updated_at: string; source_path: string | null;
  score: number; relevance: number; recency: number; via: "fts" | "keyword";
}

// relevance 우선(작업 비서 — 관련성이 최근성보다 중요). 최근/중요는 보조.
const W = { rel: 1.5, rec: 0.4, imp: 0.4 };
const TYPE_WEIGHT: Record<string, number> = { warning: 0.15, feedback: 0.1, procedural: 0.05, decision: 0.05 };

export function ftsPhrase(q: string): string { return '"' + q.replace(/"/g, '""') + '"'; }
// trigram 최소 길이 충족 여부(공백 제외 ≥3음절)
export function ftsEligible(q: string): boolean { return q.replace(/\s+/g, "").length >= 3; }

// 유저 문장 → FTS 질의. 전체 phrase는 "정확한 연속 문자열"만 매칭하므로(다단어에 치명적),
// ≥3음절 단어를 각각 phrase로 만들어 OR 결합 → 단어가 흩어져 있어도 회수(bm25가 랭킹).
export function buildFtsQuery(q: string): string {
  const words = q.split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.replace(/[^\p{L}\p{N}]/gu, "").length >= 3);
  if (!words.length) return "";
  return words.map((w) => '"' + w.replace(/"/g, '""') + '"').join(" OR ");
}

interface Row {
  id: string; type: string; owner_entity_id: string; title: string;
  prompt_summary: string; importance: number; updated_at: string; source_path: string | null; bm25: number | null;
}

const SELECT_COLS = "m.id, m.type, m.owner_entity_id, m.title, m.prompt_summary, m.importance, m.updated_at, m.source_path";

export function searchMemory(db: Database, query: string, opts: SearchOpts = {}): SearchHit[] {
  const limit = opts.limit ?? 8;
  const q = query.trim();
  if (!q) return [];
  const filt: string[] = ["m.status = 'active'"];
  const args: unknown[] = [];
  if (opts.owner) { filt.push("m.owner_entity_id = ?"); args.push(opts.owner); }
  if (opts.type) { filt.push("m.type = ?"); args.push(opts.type); }
  const where = filt.join(" and ");

  const byId = new Map<string, Row>();
  let fallbackUsed = 0;

  // 1) FTS — ≥3음절 단어들을 OR 결합한 질의 (다단어 회수)
  const ftsq = ftsEligible(q) ? buildFtsQuery(q) : "";
  if (ftsq) {
    const sql = `select ${SELECT_COLS}, bm25(memory_fts) as bm25
      from memory_fts join memories m on m.rowid = memory_fts.rowid
      where memory_fts match ? and ${where} order by bm25 limit 50`;
    for (const r of db.prepare(sql).all(ftsq, ...args) as Row[]) byId.set(r.id, r);
  }

  // 2) 키워드 fallback (FTS 빈약 < 3건 또는 단문) — title/summary/keywords/tags LIKE
  if (byId.size < 3) {
    fallbackUsed = 1;
    const like = `%${q}%`;
    const sql = `select ${SELECT_COLS}, null as bm25 from memories m
      where ${where} and (m.title like ? or m.prompt_summary like ? or m.keywords like ? or m.tags like ?) limit 50`;
    for (const r of db.prepare(sql).all(...args, like, like, like, like) as Row[])
      if (!byId.has(r.id)) byId.set(r.id, r);
  }

  const cand = [...byId.values()];

  // relevance 정규화 (bm25 작을수록 좋음 → 0~1로 반전). 키워드-only는 0.3 기준.
  const bms = cand.map((c) => c.bm25).filter((v): v is number => v !== null);
  const minB = bms.length ? Math.min(...bms) : 0, maxB = bms.length ? Math.max(...bms) : 0;
  const now = Date.now();
  const hits: SearchHit[] = cand.map((c) => {
    const relevance = c.bm25 === null ? 0.3
      : (maxB === minB ? 1 : (maxB - c.bm25) / (maxB - minB));
    const recency = Math.pow(0.995, Math.max(0, (now - Date.parse(c.updated_at)) / 3.6e6));
    const imp = (c.importance ?? 5) / 10;
    const score = W.rel * relevance + W.rec * recency + W.imp * imp + (TYPE_WEIGHT[c.type] ?? 0);
    return {
      id: c.id, type: c.type, owner_entity_id: c.owner_entity_id, title: c.title,
      prompt_summary: c.prompt_summary, importance: c.importance, updated_at: c.updated_at, source_path: c.source_path,
      score, relevance, recency, via: (c.bm25 === null ? "keyword" : "fts") as "fts" | "keyword",
    };
  }).sort((a, b) => b.score - a.score).slice(0, limit);

  if (opts.log !== false) logRetrieval(db, opts.requester, q, hits, fallbackUsed);
  return hits;
}

// 공통 감사 로그 (M9: memories 미수정). search_id로 검색 묶음 + no-hit 1행 → fallback율·no-hit율 정확 집계.
function logRetrieval(db: Database, requester: string | undefined, query: string, hits: SearchHit[], fallbackUsed: number): void {
  const searchId = randomUUID();
  const ts = new Date().toISOString();
  const ins = db.prepare(`insert into retrieval_log
    (id, search_id, requester_entity_id, query, memory_id, rank, score, used_in_prompt, fallback_used, created_at)
    values (?,?,?,?,?,?,?,?,?,?)`);
  const tx = db.transaction(() => {
    if (!hits.length) ins.run(randomUUID(), searchId, requester ?? null, query, null, null, null, 0, fallbackUsed, ts);
    else hits.forEach((h, i) => ins.run(randomUUID(), searchId, requester ?? null, query, h.id, i + 1, h.score, 0, fallbackUsed, ts));
  });
  tx();
}
