// memory/service.ts — 서버 프로세스의 기억 인덱스 서비스 (P3 retrieve.ts의 배관을 계승, 자동주입은 제거).
// 단일 DB 연결 + 부팅 후 최초 사용 시 빌드 + 위키 저장 시 증분 갱신. 검색은 memory.search 도구가 호출.
// 자동 프롬프트 주입 없음 — 지니가 필요할 때 pull 방식으로 검색한다.

import type { Database } from "better-sqlite3";
import { HISTORY_DIR } from "../../config.js";
import { openMemoryDb } from "./db.js";
import { buildIndex } from "./import.js";
import { searchMemory, type SearchHit, type SearchOpts } from "./search.js";

let conn: Database | null = null;

function db(): Database {
  if (!conn) {
    conn = openMemoryDb().db;
    const n = (conn.prepare("select count(*) as c from memories").get() as { c: number }).c;
    if (n === 0) buildIndex(conn, HISTORY_DIR);   // 최초 사용 시 1회 빌드 (마크다운에서)
  }
  return conn;
}

// 위키 저장 시 증분 갱신 (chat.ts 훅에서 fire-and-forget). buildIndex는 동기(실행 시 ~19–100ms 점유).
export function refreshMemoryIndex(): void {
  try { buildIndex(db(), HISTORY_DIR); }
  catch (e) { console.error("[memory] 인덱스 갱신 실패:", e); }
}

// memory.search 도구가 호출하는 검색. 결과는 도구 응답으로 반환(프롬프트 자동주입 아님).
export function searchMemoryService(query: string, opts: SearchOpts = {}): SearchHit[] {
  try { return searchMemory(db(), query, opts); }
  catch (e) { console.error("[memory] 검색 실패:", e); return []; }
}
