// memory/schema.ts — MVP 스키마 (sqlite_memory_final_v3 §3-A) + 마이그레이션 v1.
// 불변식: docs/design-invariants.md M1(재생성 가능)·M3(구조형 백업)·M8(보존)·M9(검색≠쓰기).
// 기억 본문의 진실은 마크다운 파일이고, 이 DB는 재생성 가능한 검색/메타 인덱스다.

import type { Database } from "better-sqlite3";

export const SCHEMA_VERSION = 2;

// FTS5 trigram 지원 여부 실측 → 미지원 시 unicode61 폴백 (P1 smoke 규약).
export function detectTokenizer(db: Database): "trigram" | "unicode61" {
  try {
    db.exec("create virtual table __tok_probe using fts5(x, tokenize='trigram')");
    db.exec("drop table __tok_probe");
    return "trigram";
  } catch {
    return "unicode61";
  }
}

// memories.type 어휘 (v3 §3-A)
export const MEMORY_TYPES = [
  "semantic", "episodic_summary", "procedural", "profile", "preference",
  "warning", "decision", "project_state", "feedback", "role",
] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

function migrationV1(tokenizer: "trigram" | "unicode61"): string {
  return `
  create table if not exists memories(
    id text primary key,
    type text not null,
    owner_entity_id text,                       -- MVP: plain agent slug (entities는 P4+에서 backfill)
    scope text,
    title text not null,
    prompt_summary text,                        -- 프롬프트 기본 주입 (≤800자)
    body text,                                  -- 전문(확장용). markdown-backed면 파일이 진실
    keywords text, tags text, context text,
    importance integer default 5,
    confidence real default 1.0,
    status text default 'active',               -- active|superseded|archived
    source_event_id text,                       -- MVP 미사용
    source_path text,                           -- 마크다운 노트 경로(진실)
    content_hash text,
    valid_from text, valid_to text,             -- bi-temporal (valid_to NULL=현재)
    created_at text not null, updated_at text not null
  );
  create index if not exists idx_memories_owner on memories(owner_entity_id);
  create index if not exists idx_memories_type on memories(type);
  create index if not exists idx_memories_status on memories(status) where status = 'active';

  create table if not exists memory_access_stats(
    memory_id text primary key,
    access_count integer default 0, last_access text, updated_at text not null
  );

  create table if not exists memory_edges(
    id text primary key,
    from_memory_id text not null, to_memory_id text not null,
    relation text not null, confidence real default 1.0, created_at text not null
  );
  create index if not exists idx_edges_from on memory_edges(from_memory_id);
  create index if not exists idx_edges_to on memory_edges(to_memory_id);

  create table if not exists retrieval_log(
    id text primary key, search_id text,            -- search_id: 한 검색 요청 묶음(fallback율·no-hit율 집계용)
    requester_entity_id text, query text,
    memory_id text, rank integer, score real,       -- no-hit이면 memory_id/rank/score NULL 1행
    used_in_prompt integer default 0, fallback_used integer default 0,
    created_at text not null
  );
  create index if not exists idx_retrieval_created on retrieval_log(created_at);
  create index if not exists idx_retrieval_search on retrieval_log(search_id);

  create virtual table if not exists memory_fts using fts5(
    title, prompt_summary, body, tags,
    content='memories', content_rowid='rowid', tokenize='${tokenizer}'
  );

  -- external content FTS 동기 트리거 (전체 재빌드: insert into memory_fts(memory_fts) values('rebuild'))
  create trigger if not exists memories_ai after insert on memories begin
    insert into memory_fts(rowid, title, prompt_summary, body, tags)
    values (new.rowid, new.title, new.prompt_summary, new.body, new.tags);
  end;
  create trigger if not exists memories_ad after delete on memories begin
    insert into memory_fts(memory_fts, rowid, title, prompt_summary, body, tags)
    values ('delete', old.rowid, old.title, old.prompt_summary, old.body, old.tags);
  end;
  create trigger if not exists memories_au after update on memories begin
    insert into memory_fts(memory_fts, rowid, title, prompt_summary, body, tags)
    values ('delete', old.rowid, old.title, old.prompt_summary, old.body, old.tags);
    insert into memory_fts(rowid, title, prompt_summary, body, tags)
    values (new.rowid, new.title, new.prompt_summary, new.body, new.tags);
  end;
  `;
}

// v2 — 엔티티 수준 시간적 지식 그래프 (Graphiti 스타일: fact의 시간 유효성 + 모순 무효화).
// M1 준수: kg_facts.source_memory_id로 출처 memories에 연결 → DB 유실 시 재생성 가능.
function migrationV2(): string {
  return `
  create table if not exists kg_entities(
    id text primary key,
    name text not null,
    type text not null default 'generic',   -- person|org|project|concept|generic 등
    aliases text,                            -- JSON array
    summary text,
    created_at text not null, updated_at text not null
  );
  create unique index if not exists idx_kg_entities_name on kg_entities(name, type);

  create table if not exists kg_facts(
    id text primary key,
    subject_id text not null references kg_entities(id),
    predicate text not null,
    object_id text references kg_entities(id),  -- 엔티티 대상 또는
    object_value text,                           -- 리터럴 값 (둘 중 하나)
    source_memory_id text,                       -- 출처 memories.id (M1: 재생성 가능)
    confidence real default 1.0,
    valid_from text not null,
    valid_to text,                               -- NULL = 현재 유효
    invalidated_by text,                         -- 이 fact를 무효화한 kg_facts.id
    created_at text not null
  );
  create index if not exists idx_kg_facts_subject on kg_facts(subject_id, predicate);
  create index if not exists idx_kg_facts_valid on kg_facts(valid_to) where valid_to is null;
  `;
}

export function runMigrations(db: Database): { version: number; tokenizer: "trigram" | "unicode61" } {
  db.exec("create table if not exists schema_migrations(version integer primary key, applied_at text not null)");
  const row = db.prepare("select max(version) as v from schema_migrations").get() as { v: number | null };
  const current = row.v ?? 0;
  let tokenizer: "trigram" | "unicode61" = "trigram";
  if (current < 1) {
    tokenizer = detectTokenizer(db);
    db.exec(migrationV1(tokenizer));
    db.prepare("insert into schema_migrations(version, applied_at) values (1, ?)").run(new Date().toISOString());
  } else {
    // 이미 적용됨 — 기존 FTS의 토크나이저를 sqlite_master에서 추정
    const ftsSql = (db.prepare("select sql from sqlite_master where name='memory_fts'").get() as { sql?: string } | undefined)?.sql ?? "";
    tokenizer = ftsSql.includes("'unicode61'") ? "unicode61" : "trigram";
  }
  if (current < 2) {
    db.exec(migrationV2());
    db.prepare("insert into schema_migrations(version, applied_at) values (2, ?)").run(new Date().toISOString());
  }
  return { version: SCHEMA_VERSION, tokenizer };
}
