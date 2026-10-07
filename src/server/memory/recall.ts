// memory/recall.ts — 선별 회상(Selective Recall) v1.
// 목적: 세션 시작 시 위키 전체를 무조건 주입하던 방식을, "항상 주입(고정 페이지)" + "TOC" +
//       "질의 관련 상위 K개 페이지"로 대체해 토큰 낭비를 줄인다.
// 불변식 M1/M9 계승: 이 모듈은 memories 테이블에 쓰기를 유발하지 않는다(검색만 수행).
//       색인 빌드(buildWikiIndex)는 기존 memory/import.ts의 buildIndex를 그대로 재사용한다
//       (content_hash 기반 증분 — mtime+size가 아니라 더 견고한 해시 비교로 이미 구현되어 있음).
//
// v1 스코프: 세션 시작 시점(session-start) 회상만 지원한다. chat.ts의 메시지별 핫패스(resume 분기)는
// 조직도/태그/위키가 이미 세션 컨텍스트에 존재한다는 전제로 body만 전달하는 구조라, 매 메시지 회상을
// 끼워 넣으려면 리샘플링 로직을 재설계해야 한다 — v1에서는 최소 변경 원칙에 따라 세션 시작만 지원하고,
// 필요하면 후속 SPEC에서 per-message 회상으로 확장한다.
//
// FTS5 토크나이저 한계: schema.ts는 trigram을 우선 시도하고 실패 시 unicode61로 폴백한다(자동 감지).
// unicode61은 공백 기준 토큰화라 한국어 형태소 분석이 없다 — 조사가 붙은 단어(예: "위키가")는
// "위키"와 다른 토큰으로 취급될 수 있다. trigram이 사용 가능하면 부분 문자열 매칭이 가능해 완화되지만,
// 완전한 한국어 형태소 인식은 아니다. v1은 이 한계를 수용하고, 개선은 bge-m3/Ollama 임베딩 도입 시
// 별도로 다룬다(본 작업 범위 아님).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { Database } from "better-sqlite3";
import { HISTORY_DIR } from "../../config.js";
import { openMemoryDb } from "./db.js";
import { buildIndex } from "./import.js";
import { searchMemory, type SearchHit } from "./search.js";

// 기본 예산(문자 수). 환경변수로 조정 가능 — 값이 없거나 비정상이면 기본값 사용.
const DEFAULT_BUDGET_CHARS = 8000;

export function getRecallBudgetChars(): number {
  const raw = process.env.MEMORY_RECALL_BUDGET_CHARS;
  if (!raw) return DEFAULT_BUDGET_CHARS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_BUDGET_CHARS;
}

// 기능 플래그 — 기본 OFF(값 없으면 기존 전체 주입 방식 유지, 동작 무변경).
export function isSelectiveRecallEnabled(): boolean {
  return process.env.MEMORY_SELECTIVE_RECALL === "1";
}

let sharedDb: Database | null = null;

// 프로덕션 경로: memory.db 단일 연결 재사용(서버 프로세스 수명 동안). 테스트는 injectDb로 격리.
function defaultDb(): Database {
  if (!sharedDb) sharedDb = openMemoryDb().db;
  return sharedDb;
}

// 테스트 전용 — 모듈 싱글턴을 우회해 격리된 :memory: 또는 임시 파일 DB를 주입.
export function __setDbForTest(db: Database | null): void {
  sharedDb = db;
}

function ownerWikiDir(agentId: string): string {
  return agentId === "genie"
    ? join(HISTORY_DIR, "genie", "wiki")
    : join(HISTORY_DIR, "agents", agentId, "wiki");
}

// 해당 agent의 위키만 증분 색인 — 실제로는 buildIndex가 전체(모든 agent + genie + guides 등)를
// content_hash 비교로 훑지만, 변경 없는 파일은 훑기만 하고 다시 쓰지 않으므로 비용이 낮다.
// (파일별 재해시 O(파일 크기) — mtime+size 우선 체크로 최적화하는 대신, 기존 buildIndex를 그대로
//  재사용해 색인 로직 이중화를 피한다. 성능 이슈 발생 시 buildIndex에 mtime 캐시를 추가하는 편이
//  recall.ts에 별도 인덱서를 만드는 것보다 낫다 — 진실 소스가 하나로 유지되기 때문.)
export function buildWikiIndex(agentId?: string, db: Database = defaultDb()) {
  void agentId; // 현재 buildIndex는 agent 단위 부분 인덱싱을 지원하지 않음 — 전체 재스캔(증분)으로 대체
  return buildIndex(db, HISTORY_DIR);
}

export interface TocEntry {
  page: string;       // 파일명(확장자 제외)
  filename: string;    // 실제 파일명(.md 포함)
  heading: string;     // 첫 헤딩 또는 첫 줄 요약
}

// 페이지의 첫 heading(# ...) 또는 첫 비어있지 않은 줄을 1줄 요약으로 사용 — 값싼 TOC 생성(FTS 불필요).
function firstHeadingOrLine(content: string): string {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const heading = trimmed.replace(/^#+\s*/, "");
    return heading.slice(0, 80);
  }
  return "";
}

// index.md/daily 를 제외한 위키 개별 페이지 목록으로 TOC 생성(제목 + 첫 줄) — 페이지 본문은 포함하지 않음.
export function buildToc(agentId: string): TocEntry[] {
  const dir = ownerWikiDir(agentId);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "index.md");
  const entries: TocEntry[] = [];
  for (const filename of files) {
    try {
      const full = join(dir, filename);
      if (statSync(full).isDirectory()) continue; // daily/ 등 하위 디렉토리 제외
      const content = readFileSync(full, "utf-8");
      entries.push({
        page: basename(filename, ".md"),
        filename,
        heading: firstHeadingOrLine(content),
      });
    } catch { /* 읽기 실패한 파일은 TOC에서 생략 */ }
  }
  return entries.sort((a, b) => a.page.localeCompare(b.page));
}

export function formatToc(entries: TocEntry[]): string {
  if (!entries.length) return "";
  const lines = entries.map((e) => `- ${e.page}${e.heading ? ` — ${e.heading}` : ""}`);
  return lines.join("\n");
}

export interface RecallResult {
  hits: SearchHit[];
  text: string;        // 프롬프트에 바로 삽입 가능한 포맷된 블록(예산 내로 잘림)
  truncated: boolean;   // 예산 초과로 일부 페이지가 잘렸는지
  usedChars: number;
}

// scope='wiki' + owner=agentId 로 한정한 관련도 상위 페이지를 예산(budgetChars) 내에서 채운다.
// 정렬은 search.ts의 복합 점수(bm25 relevance·recency·importance)를 그대로 사용 — 별도 랭킹 재구현 안 함.
export function recallRelevant(
  agentId: string,
  query: string,
  budgetChars: number = getRecallBudgetChars(),
  db: Database = defaultDb(),
): RecallResult {
  const q = (query ?? "").trim();
  if (!q) return { hits: [], text: "", truncated: false, usedChars: 0 };

  // 후보를 넉넉히 뽑은 뒤 예산에 맞춰 앞에서부터 채움(짧은 예산이라도 최소 1건은 포함되도록 시도).
  const hits = searchMemory(db, q, { owner: agentId, limit: 20, log: true, requester: agentId });

  const parts: string[] = [];
  let used = 0;
  let truncated = false;
  for (const h of hits) {
    const pageName = h.source_path ? basename(h.source_path, ".md") : h.title;
    const block = `--- ${pageName} ---\n${h.prompt_summary}`;
    const blockLen = block.length + 2; // 구분자 개행 포함
    if (used + blockLen > budgetChars) {
      if (parts.length === 0 && budgetChars > 0) {
        // 예산이 첫 항목보다 작아도 최소 1건은 잘라서라도 포함(완전 공백 방지).
        parts.push(block.slice(0, Math.max(0, budgetChars)));
        used = budgetChars;
      }
      truncated = true;
      break;
    }
    parts.push(block);
    used += blockLen;
  }

  return { hits, text: parts.join("\n\n"), truncated, usedChars: used };
}
