// ai-search.ts — 통합 하이브리드 검색 (P0-①, AI 연동 로드맵).
// 자료실 md(history/outputs, history/external-reports)를 FTS5(trigram)로 색인하고
// 메모리 위키(searchMemoryService)와 연합해 하나의 랭킹으로 반환한다.
// 불변식: ai-index.db는 재생성 가능한 인덱스 — 진실은 파일시스템.
import Database from "better-sqlite3";
import { readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import { join, relative } from "node:path";
import { HISTORY_DIR } from "../config.js";
import { searchMemoryService } from "./memory/service.js";
import { corpusSourceAllowed, getCorpusService } from './corpus/runtime.js';
import { searchCorpus } from './corpus/search.js';

const INDEX_DB_PATH = join(HISTORY_DIR, "ai-index.db");
const SOURCES: Array<{ base: string; root: string }> = [
  { base: "outputs", root: join(HISTORY_DIR, "outputs") },
  { base: "reports", root: join(HISTORY_DIR, "external-reports") },
];
const INDEXABLE_EXTS = new Set([".md", ".txt"]);
const MAX_DOC_BYTES = 512 * 1024; // 초대형 파일은 앞부분만 색인

let conn: Database.Database | null = null;

function db(): Database.Database {
  if (conn) return conn;
  conn = new Database(INDEX_DB_PATH);
  conn.pragma("journal_mode = WAL");
  conn.pragma("busy_timeout = 5000");
  conn.exec(`
    create table if not exists docs (
      id integer primary key,
      base text not null,
      relpath text not null,
      title text not null,
      mtime integer not null,
      unique(base, relpath)
    );
    create virtual table if not exists docs_fts using fts5(
      title, content, tokenize='trigram'
    );
  `);
  return conn;
}

function firstHeading(md: string, fallback: string): string {
  const m = /^#{1,3}\s+(.+)$/m.exec(md);
  if (m) return m[1].trim().slice(0, 120);
  const fm = /^---\r?\n[\s\S]*?title:\s*(.+?)\r?\n[\s\S]*?---/m.exec(md);
  if (fm) return fm[1].trim().slice(0, 120);
  return fallback;
}

function walkFiles(root: string, out: Array<{ path: string; mtimeMs: number }>): void {
  let entries: Dirent[];
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(root, e.name);
    if (e.isDirectory()) { walkFiles(p, out); continue; }
    if (!e.isFile()) continue;
    const dot = e.name.lastIndexOf(".");
    if (dot < 0 || !INDEXABLE_EXTS.has(e.name.slice(dot).toLowerCase())) continue;
    try { out.push({ path: p, mtimeMs: statSync(p).mtimeMs }); } catch { /* 삭제 경합 무시 */ }
  }
}

// 증분 색인 — mtime 변경/신규만 재색인, 사라진 파일은 제거. 동기(초기 전체 ~수백 ms).
export function refreshSearchIndex(): { indexed: number; removed: number } {
  const d = db();
  let indexed = 0;
  let removed = 0;
  const seen = new Set<string>();
  const getDoc = d.prepare("select id, mtime from docs where base = ? and relpath = ?");
  const insDoc = d.prepare("insert into docs (base, relpath, title, mtime) values (?, ?, ?, ?)");
  const updDoc = d.prepare("update docs set title = ?, mtime = ? where id = ?");
  const insFts = d.prepare("insert into docs_fts (rowid, title, content) values (?, ?, ?)");
  const delFts = d.prepare("delete from docs_fts where rowid = ?");

  for (const src of SOURCES) {
    const files: Array<{ path: string; mtimeMs: number }> = [];
    walkFiles(src.root, files);
    for (const f of files) {
      const relpath = relative(src.root, f.path);
      seen.add(`${src.base}\0${relpath}`);
      const existing = getDoc.get(src.base, relpath) as { id: number; mtime: number } | undefined;
      const mtime = Math.floor(f.mtimeMs);
      if (existing && existing.mtime === mtime) continue;
      let content: string;
      try { content = readFileSync(f.path, "utf-8").slice(0, MAX_DOC_BYTES); } catch { continue; }
      const title = firstHeading(content, relpath.split("/").pop() ?? relpath);
      if (existing) {
        try { delFts.run(existing.id); } catch { /* 미존재 무시 */ }
        updDoc.run(title, mtime, existing.id);
        insFts.run(existing.id, title, content);
      } else {
        const id = Number(insDoc.run(src.base, relpath, title, mtime).lastInsertRowid);
        insFts.run(id, title, content);
      }
      indexed++;
    }
  }

  const all = d.prepare("select id, base, relpath from docs").all() as Array<{ id: number; base: string; relpath: string }>;
  for (const row of all) {
    if (seen.has(`${row.base}\0${row.relpath}`)) continue;
    try { delFts.run(row.id); } catch { /* */ }
    d.prepare("delete from docs where id = ?").run(row.id);
    removed++;
  }
  return { indexed, removed };
}

export interface UnifiedHit {
  source: "library" | "wiki" | "corpus";
  title: string;
  snippet: string;
  score: number; // 0~1 정규화
  base?: string;    // library: outputs|reports
  relpath?: string; // library: 파일 경로
  wikiPath?: string | null; // wiki: source_path
  sourceId?: string;
  revision?: string;
  locator?: string;
  context?: import('../shared/corpus.js').CorpusHit['context'];
}

// trigram FTS는 한국어 부분일치에 강함. 긴 질문(문장)은 통짜 phrase가 어떤 문서와도
// 일치하지 않으므로, 어절 단위로 쪼개 phrase OR 질의를 만든다 (조사·1글자 어절 제외).
function buildLibraryQuery(q: string): string {
  const terms = q.split(/[\s,.?!·:;()[\]{}]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .slice(0, 6);
  if (terms.length === 0) return '"' + q.replace(/"/g, '""') + '"';
  return terms.map((t) => '"' + t.replace(/"/g, '""') + '"').join(" OR ");
}

function searchLibrary(q: string, limit: number): UnifiedHit[] {
  const d = db();
  const phrase = buildLibraryQuery(q);
  try {
    const rows = d.prepare(`
      select d.base, d.relpath, d.title,
             snippet(docs_fts, 1, '[', ']', '…', 18) as snip,
             bm25(docs_fts) as rank
      from docs_fts join docs d on d.id = docs_fts.rowid
      where docs_fts match ?
      order by rank limit ?
    `).all(phrase, limit) as Array<{ base: string; relpath: string; title: string; snip: string; rank: number }>;
    // bm25는 낮을수록 관련 — 0~1로 뒤집어 정규화
    return rows.map((r) => ({
      source: "library" as const,
      title: r.title,
      snippet: r.snip,
      score: -r.rank / (1 - r.rank),
      base: r.base,
      relpath: r.relpath,
    }));
  } catch {
    return []; // 질의가 trigram 최소 길이(3바이트) 미만 등 — 빈 결과
  }
}

export function searchAll(q: string, limit = 8): UnifiedHit[] {
  const query = q.trim();
  if (!query) return [];
  refreshSearchIndex();
  const lib = searchLibrary(query, limit);
  const wiki = searchMemoryService(query, { limit }).map((h) => ({
    source: "wiki" as const,
    title: h.title,
    snippet: h.prompt_summary?.slice(0, 200) ?? "",
    score: Math.min(1, Math.max(0, h.score)),
    wikiPath: h.source_path,
  }));
  // 서로 다른 검색기의 원점수를 비교하지 않고 각 순위를 같은 RRF 척도로 합친다.
  return [...lib.map((hit, rank) => ({ ...hit, score: 1 / (61 + rank) })),
    ...wiki.map((hit, rank) => ({ ...hit, score: 1 / (61 + rank) }))]
    .sort((a, b) => b.score - a.score).slice(0, limit);
}

/** corpus 접근 여부는 HTTP 소유자 인증 후 호출부에서 결정한다. */
export async function searchWorkspace(q: string, limit: number, includeCorpus: boolean): Promise<{ results: UnifiedHit[]; warnings: string[] }> {
  const legacy = searchAll(q, limit);
  if (!includeCorpus) return { results: legacy, warnings: [] };
  const service = getCorpusService();
  const result = await searchCorpus(service.store, q, { limit, embedder: service.embedder, allowed: corpusSourceAllowed });
  const corpus: UnifiedHit[] = result.hits.map((hit, rank) => ({ source: 'corpus', title: hit.title, snippet: hit.text,
    sourceId: hit.sourceId, revision: hit.revision, locator: hit.locator, context: hit.context, score: 1 / (61 + rank) }));
  return { results: [...legacy, ...corpus].sort((a, b) => b.score - a.score).slice(0, limit), warnings: result.warnings };
}

export async function buildWorkspaceAskContext(q: string, includeCorpus: boolean): Promise<{ context: string; sources: UnifiedHit[]; warnings: string[] }> {
  const { results, warnings } = await searchWorkspace(q, 6, includeCorpus);
  const parts: string[] = []; const included: UnifiedHit[] = []; const seen = new Set<string>(); let length = 0;
  for (const hit of results) {
    let body = hit.context?.text ?? hit.snippet;
    if (hit.source === 'corpus') {
      if (!hit.context?.complete) { warnings.push(`${hit.title}: 구조 문맥을 확인하지 못해 답변 입력에서 보류했습니다.`); continue; }
      const key = `${hit.sourceId}:${hit.revision}:${hit.context.unitId}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    if (hit.source === 'library' && hit.base && hit.relpath) {
      try { body = readFileSync(join(hit.base === 'outputs' ? SOURCES[0].root : SOURCES[1].root, hit.relpath), 'utf8').slice(0, 4000); } catch { /* 발췌 유지 */ }
    }
    const part = `[${hit.source === 'corpus' ? '등록 자료' : hit.source === 'library' ? '자료실' : '위키'}] ${hit.title}${hit.context?.locator || hit.locator ? ` (${hit.context?.locator ?? hit.locator})` : ''}\n${body}`;
    if (length + part.length + 7 > 23_000) { warnings.push(`${hit.title}: 전체 문맥 예산 때문에 보류했습니다. 해당 범위를 따로 조회하세요.`); continue; }
    parts.push(part); included.push(hit); length += part.length + 7;
  }
  const coverage = warnings.length ? '[읽기 범위] 일부 자료는 문맥 미확인 또는 예산 초과로 보류됐습니다. 전달된 범위 밖의 조건·예외가 없다고 단정하지 마세요.\n\n' : '';
  return { context: coverage + parts.join('\n\n---\n\n'), sources: included, warnings };
}

// Ask MyCrew용 컨텍스트 — 상위 히트의 본문 발췌를 합쳐 RAG 프롬프트 재료로 반환.
export function buildAskContext(q: string, topK = 5): { context: string; sources: UnifiedHit[] } {
  const hits = searchAll(q, topK);
  const parts: string[] = [];
  for (const h of hits) {
    let body = h.snippet;
    if (h.source === "library" && h.base && h.relpath) {
      const root = h.base === "outputs" ? SOURCES[0].root : SOURCES[1].root;
      try { body = readFileSync(join(root, h.relpath), "utf-8").slice(0, 4000); } catch { /* snippet 유지 */ }
    }
    parts.push(`[${h.source === "library" ? "자료실" : "위키"}] ${h.title}\n${body}`);
  }
  return { context: parts.join("\n\n---\n\n").slice(0, 24_000), sources: hits };
}
