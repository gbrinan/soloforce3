// memory/graph.ts — 엔티티 수준 시간적 지식 그래프 (스키마 v2, Graphiti 스타일).
// fact는 valid_from/valid_to 시간 유효성을 가지며, 같은 (subject, predicate)의 새 fact가
// 기존 활성 fact와 모순되면 기존 fact를 닫는다(valid_to + invalidated_by) — 삭제 없음(M8 보존).
// 불변식 M1: source_memory_id로 출처 memories에 연결 → 마크다운에서 재생성 가능한 인덱스.

import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";

export interface KgEntity {
  id: string; name: string; type: string;
  aliases: string[]; summary: string | null;
  created_at: string; updated_at: string;
}

export interface KgFact {
  id: string; subject_id: string; predicate: string;
  object_id: string | null; object_value: string | null;
  source_memory_id: string | null; confidence: number;
  valid_from: string; valid_to: string | null; invalidated_by: string | null;
  created_at: string;
  object_name?: string | null;                 // 조인 편의 (object_id의 엔티티명)
}

interface EntityRow {
  id: string; name: string; type: string; aliases: string | null; summary: string | null;
  created_at: string; updated_at: string;
}

function parseAliases(raw: string | null): string[] {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.map(String) : []; }
  catch { return []; }
}

function toEntity(r: EntityRow): KgEntity {
  return { ...r, aliases: parseAliases(r.aliases) };
}

// 이름 또는 alias로 엔티티 조회 (type 미지정 시 전체에서 첫 매치).
export function findEntity(db: Database, name: string, type?: string): KgEntity | null {
  const byName = type
    ? db.prepare("select * from kg_entities where name = ? and type = ?").get(name, type)
    : db.prepare("select * from kg_entities where name = ?").get(name);
  if (byName) return toEntity(byName as EntityRow);
  // alias 매치 — 엔티티 수가 작다는 전제로 JS에서 JSON 파싱 스캔 (LIKE 오탐 방지)
  const rows = (type
    ? db.prepare("select * from kg_entities where aliases is not null and type = ?").all(type)
    : db.prepare("select * from kg_entities where aliases is not null").all()) as EntityRow[];
  for (const r of rows) if (parseAliases(r.aliases).includes(name)) return toEntity(r);
  return null;
}

export interface UpsertEntityInput {
  name: string; type?: string; aliases?: string[]; summary?: string;
}

// (name,type) 또는 alias 매치로 찾고, 없으면 생성. aliases는 합집합 병합, summary는 덮어쓰기.
export function upsertEntity(db: Database, input: UpsertEntityInput): KgEntity {
  const type = input.type ?? "generic";
  const now = new Date().toISOString();
  const found = findEntity(db, input.name, type);
  if (found) {
    const mergedAliases = [...new Set([...found.aliases, ...(input.aliases ?? [])])];
    const summary = input.summary ?? found.summary;
    const changed = mergedAliases.length !== found.aliases.length || summary !== found.summary;
    if (changed) {
      db.prepare("update kg_entities set aliases = ?, summary = ?, updated_at = ? where id = ?")
        .run(JSON.stringify(mergedAliases), summary, now, found.id);
    }
    return { ...found, aliases: mergedAliases, summary, updated_at: changed ? now : found.updated_at };
  }
  const entity: KgEntity = {
    id: randomUUID(), name: input.name, type,
    aliases: input.aliases ?? [], summary: input.summary ?? null,
    created_at: now, updated_at: now,
  };
  db.prepare(`insert into kg_entities(id, name, type, aliases, summary, created_at, updated_at)
    values (?,?,?,?,?,?,?)`)
    .run(entity.id, entity.name, entity.type, JSON.stringify(entity.aliases), entity.summary, now, now);
  return entity;
}

export interface AddFactInput {
  subject: string;                // 주어 엔티티명 (자동 upsert)
  predicate: string;
  object?: string;                // 목적어 엔티티명 (자동 upsert) 또는
  objectValue?: string;           // 리터럴 값 (둘 중 하나)
  sourceMemoryId?: string;
  confidence?: number;
  validFrom?: string;             // ISO-8601, 기본 now
}

// fact 추가 + 시간적 무효화: 같은 (subject, predicate)의 활성 fact가 다른 대상을 가리키면
// 그 fact를 닫는다(functional predicate 의미론). 정확히 같은 대상이면 confidence만 갱신(무변동).
// [후속 과제 — 보류 판정 2026-07-07] 다중값 관계(참여 프로젝트·스킬 목록 등)는 이 의미론상
// 마지막 값만 활성으로 남음. 잡 결과→fact 자동 추출 파이프라인을 배선할 때 추출 predicate에
// 다중값 관계가 포함되면 `exclusive?: boolean`(기본 true) opt-out 파라미터를 함께 추가할 것.
// 현재는 호출자 부재 + 1차 유스케이스(결정·담당자·상태 = functional)라 의도적으로 미구현.
export function addFact(db: Database, input: AddFactInput): KgFact {
  const now = new Date().toISOString();
  const validFrom = input.validFrom ?? now;
  const confidence = input.confidence ?? 1.0;

  const tx = db.transaction((): KgFact => {
    const subject = upsertEntity(db, { name: input.subject });
    const object = input.object ? upsertEntity(db, { name: input.object }) : null;
    const objectId = object?.id ?? null;
    const objectValue = input.objectValue ?? null;

    const active = db.prepare(
      "select * from kg_facts where subject_id = ? and predicate = ? and valid_to is null",
    ).all(subject.id, input.predicate) as KgFact[];

    // 정확한 중복 — confidence를 max로 올리고 기존 fact 반환 (churn 없음)
    const dup = active.find((f) => f.object_id === objectId && f.object_value === objectValue);
    if (dup) {
      const bumped = Math.max(dup.confidence ?? 1.0, confidence);
      if (bumped !== dup.confidence) {
        db.prepare("update kg_facts set confidence = ? where id = ?").run(bumped, dup.id);
      }
      return { ...dup, confidence: bumped };
    }

    const fact: KgFact = {
      id: randomUUID(), subject_id: subject.id, predicate: input.predicate,
      object_id: objectId, object_value: objectValue,
      source_memory_id: input.sourceMemoryId ?? null, confidence,
      valid_from: validFrom, valid_to: null, invalidated_by: null, created_at: now,
    };

    // 모순 — 활성 fact를 새 fact의 valid_from 시점에 닫는다
    for (const old of active) {
      db.prepare("update kg_facts set valid_to = ?, invalidated_by = ? where id = ?")
        .run(validFrom, fact.id, old.id);
    }

    db.prepare(`insert into kg_facts(id, subject_id, predicate, object_id, object_value,
      source_memory_id, confidence, valid_from, valid_to, invalidated_by, created_at)
      values (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(fact.id, fact.subject_id, fact.predicate, fact.object_id, fact.object_value,
        fact.source_memory_id, fact.confidence, fact.valid_from, fact.valid_to,
        fact.invalidated_by, fact.created_at);
    return fact;
  });
  return tx();
}

const FACT_COLS = "f.*, o.name as object_name";

// 특정 시점(기본 now)에 유효한 fact 조회 — 시간여행 질의.
export function getFactsAt(db: Database, entityName: string, atIso?: string): KgFact[] {
  const e = findEntity(db, entityName);
  if (!e) return [];
  const at = atIso ?? new Date().toISOString();
  return db.prepare(`select ${FACT_COLS} from kg_facts f
    left join kg_entities o on o.id = f.object_id
    where f.subject_id = ? and f.valid_from <= ? and (f.valid_to is null or f.valid_to > ?)
    order by f.valid_from`).all(e.id, at, at) as KgFact[];
}

// 닫힌 fact 포함 전체 이력 — "이 결정이 언제 바뀌었나"에 답한다.
export function getEntityTimeline(db: Database, entityName: string, predicate?: string): KgFact[] {
  const e = findEntity(db, entityName);
  if (!e) return [];
  const filt = predicate ? " and f.predicate = ?" : "";
  const args: unknown[] = predicate ? [e.id, predicate] : [e.id];
  return db.prepare(`select ${FACT_COLS} from kg_facts f
    left join kg_entities o on o.id = f.object_id
    where f.subject_id = ?${filt}
    order by f.valid_from, f.created_at`).all(...args) as KgFact[];
}

export interface KgNeighbor {
  entity: KgEntity; predicate: string; direction: "out" | "in";
}

// 활성 fact로 연결된 이웃 엔티티 (depth 1 고정 — 단순 유지).
export function getNeighbors(db: Database, entityName: string, _opts: { depth?: 1 } = {}): KgNeighbor[] {
  const e = findEntity(db, entityName);
  if (!e) return [];
  const out = db.prepare(`select o.*, f.predicate from kg_facts f
    join kg_entities o on o.id = f.object_id
    where f.subject_id = ? and f.valid_to is null`).all(e.id) as (EntityRow & { predicate: string })[];
  const inn = db.prepare(`select s.*, f.predicate from kg_facts f
    join kg_entities s on s.id = f.subject_id
    where f.object_id = ? and f.valid_to is null`).all(e.id) as (EntityRow & { predicate: string })[];
  const seen = new Set<string>();
  const result: KgNeighbor[] = [];
  for (const [rows, direction] of [[out, "out"], [inn, "in"]] as const) {
    for (const r of rows) {
      const key = `${r.id}:${r.predicate}:${direction}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const { predicate, ...row } = r;
      result.push({ entity: toEntity(row), predicate, direction });
    }
  }
  return result;
}

export interface GraphSearchHit { entity: KgEntity; facts: KgFact[] }

// 검색어를 kg_entities.name/aliases에 정확/LIKE 매치 → 매치 엔티티의 활성 fact 반환.
// search.ts를 건드리지 않는 독립 함수 (M9: 그래프에 쓰기 유발 없음).
export function searchGraph(db: Database, query: string, limit = 5): GraphSearchHit[] {
  const q = query.trim();
  if (!q) return [];
  const like = `%${q}%`;
  const rows = db.prepare(
    "select * from kg_entities where name = ? or name like ? or aliases like ? limit ?",
  ).all(q, like, like, limit) as EntityRow[];
  return rows.map((r) => {
    const e = toEntity(r);
    return { entity: e, facts: getFactsAt(db, e.name) };
  });
}
