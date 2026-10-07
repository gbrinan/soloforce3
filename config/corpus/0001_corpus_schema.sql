-- ingest-crab 코퍼스 스키마 (MyCrew 지식관리팀 전용, anandara와 스키마 격리)
-- 적용 대상: Supabase jarvis 프로젝트 (jditahiwwhrugzyamecl)
-- 적용법: Supabase 대시보드 SQL Editor에 붙여넣기 실행, 또는 ingest-crab 최초 supabase 적재 시 자동 적용
create schema if not exists corpus;
create extension if not exists pg_trgm;

create table if not exists corpus.documents (
  id uuid primary key default gen_random_uuid(),
  source_path text not null,
  title text not null,
  format text not null default 'md',
  meta jsonb not null default '{}',
  content_md text not null,
  content_hash text not null,
  ingested_by text not null default 'ingest-crab',
  created_at timestamptz not null default now(),
  unique (content_hash)
);

create table if not exists corpus.chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references corpus.documents(id) on delete cascade,
  ord int not null,
  content text not null,
  tsv tsvector generated always as (to_tsvector('simple', content)) stored,
  created_at timestamptz not null default now(),
  unique (document_id, ord)
);

create index if not exists chunks_tsv_idx on corpus.chunks using gin (tsv);
create index if not exists chunks_trgm_idx on corpus.chunks using gin (content gin_trgm_ops);
create index if not exists documents_meta_idx on corpus.documents using gin (meta);
