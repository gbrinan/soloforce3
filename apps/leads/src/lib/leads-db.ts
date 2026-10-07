import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";

// SQLite 리드 파이프라인 저장소 — Krayin 차용 멀티 파이프라인(제품/서비스당 1개) 단순화 스키마.
// 기본 저장 위치: apps/leads/data/leads.sqlite (gitignored).
// 테스트용으로 LEADS_DB_PATH 환경변수 오버라이드 지원 (finance 패턴).

export type LeadSource = "website" | "sns" | "email" | "manual" | "agent";
export const LEAD_SOURCES: LeadSource[] = ["website", "sns", "email", "manual", "agent"];

export interface Pipeline {
  id: string;
  name: string;
  product: string;
  created_at: string;
}

export interface Stage {
  id: string;
  pipeline_id: string;
  name: string;
  sort: number;
  rotting_days: number | null;
}

export interface Lead {
  id: string;
  pipeline_id: string;
  stage_id: string;
  title: string;
  contact_name: string;
  contact_channel: string;
  source: LeadSource;
  value_krw: number;
  memo: string;
  next_action: string;
  next_action_date: string | null;
  created_at: string;
  stage_changed_at: string;
}

export interface LeadEvent {
  id: string;
  lead_id: string;
  ts: string;
  type: string; // stage_change | memo | inbound | created
  body: string;
}

/** rotting 계산이 포함된 리드 응답 형태. */
export interface LeadWithRotting extends Lead {
  rotting: boolean;
}

// 기본 스테이지 세트 — 파이프라인 생성 시 자동 시드, 이후 커스텀 가능.
const DEFAULT_STAGES: Array<{ name: string; sort: number; rotting_days: number | null }> = [
  { name: "문의", sort: 1, rotting_days: 7 },
  { name: "미팅", sort: 2, rotting_days: 7 },
  { name: "견적", sort: 3, rotting_days: 7 },
  { name: "계약완료", sort: 4, rotting_days: null },
];

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const envPath = process.env.LEADS_DB_PATH;
  const filePath = envPath && envPath.trim().length > 0
    ? envPath
    : join(process.cwd(), "data", "leads.sqlite");
  mkdirSync(dirname(filePath), { recursive: true });
  db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS pipelines (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      product     TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS stages (
      id            TEXT PRIMARY KEY,
      pipeline_id   TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      sort          INTEGER NOT NULL,
      rotting_days  INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_stages_pipeline ON stages(pipeline_id, sort);
    CREATE TABLE IF NOT EXISTS leads (
      id                TEXT PRIMARY KEY,
      pipeline_id       TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
      stage_id          TEXT NOT NULL REFERENCES stages(id),
      title             TEXT NOT NULL,
      contact_name      TEXT NOT NULL DEFAULT '',
      contact_channel   TEXT NOT NULL DEFAULT '',
      source            TEXT NOT NULL CHECK (source IN ('website','sns','email','manual','agent')),
      value_krw         INTEGER NOT NULL DEFAULT 0,
      memo              TEXT NOT NULL DEFAULT '',
      next_action       TEXT NOT NULL DEFAULT '',
      next_action_date  TEXT,
      created_at        TEXT NOT NULL,
      stage_changed_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_leads_pipeline ON leads(pipeline_id);
    CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(stage_id);
    CREATE TABLE IF NOT EXISTS lead_events (
      id       TEXT PRIMARY KEY,
      lead_id  TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      ts       TEXT NOT NULL,
      type     TEXT NOT NULL,
      body     TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_events_lead ON lead_events(lead_id, ts);
  `);

  seed(db);
  return db;
}

/** 테스트에서 DB 핸들 재설정용 (LEADS_DB_PATH 변경 후 재오픈). */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function newId(): string {
  return randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

// 최초 실행 시 기본 파이프라인 1개("기본") + 기본 스테이지 4종 시드.
function seed(d: Database.Database) {
  const count = (d.prepare("SELECT COUNT(*) AS c FROM pipelines").get() as { c: number }).c;
  if (count === 0) {
    insertPipelineWithDefaultStages(d, "기본", "");
  }
}

function insertPipelineWithDefaultStages(d: Database.Database, name: string, product: string): Pipeline {
  const pipeline: Pipeline = { id: randomUUID(), name, product, created_at: nowIso() };
  const tx = d.transaction(() => {
    d.prepare("INSERT INTO pipelines (id, name, product, created_at) VALUES (?, ?, ?, ?)").run(
      pipeline.id,
      pipeline.name,
      pipeline.product,
      pipeline.created_at,
    );
    const ins = d.prepare(
      "INSERT INTO stages (id, pipeline_id, name, sort, rotting_days) VALUES (?, ?, ?, ?, ?)",
    );
    for (const s of DEFAULT_STAGES) {
      ins.run(randomUUID(), pipeline.id, s.name, s.sort, s.rotting_days);
    }
  });
  tx();
  return pipeline;
}

// ---- 파이프라인 ----

export function listPipelines(): Pipeline[] {
  return getDb().prepare("SELECT * FROM pipelines ORDER BY created_at").all() as Pipeline[];
}

/** 파이프라인 생성 — 기본 스테이지 4종(문의→미팅→견적→계약완료) 자동 생성. */
export function createPipeline(name: string, product: string): Pipeline {
  return insertPipelineWithDefaultStages(getDb(), name, product);
}

export function getPipeline(id: string): Pipeline | undefined {
  return getDb().prepare("SELECT * FROM pipelines WHERE id = ?").get(id) as Pipeline | undefined;
}

// ---- 스테이지 ----

export function listStages(pipelineId?: string): Stage[] {
  const d = getDb();
  if (pipelineId) {
    return d
      .prepare("SELECT * FROM stages WHERE pipeline_id = ? ORDER BY sort")
      .all(pipelineId) as Stage[];
  }
  return d.prepare("SELECT * FROM stages ORDER BY pipeline_id, sort").all() as Stage[];
}

export function getStage(id: string): Stage | undefined {
  return getDb().prepare("SELECT * FROM stages WHERE id = ?").get(id) as Stage | undefined;
}

export function firstStageOf(pipelineId: string): Stage | undefined {
  return getDb()
    .prepare("SELECT * FROM stages WHERE pipeline_id = ? ORDER BY sort LIMIT 1")
    .get(pipelineId) as Stage | undefined;
}

// ---- 리드 ----

export interface NewLeadInput {
  pipeline_id: string;
  stage_id: string;
  title: string;
  contact_name?: string;
  contact_channel?: string;
  source: LeadSource;
  value_krw?: number;
  memo?: string;
  next_action?: string;
  next_action_date?: string | null;
}

export function createLead(input: NewLeadInput): Lead {
  const now = nowIso();
  const lead: Lead = {
    id: randomUUID(),
    pipeline_id: input.pipeline_id,
    stage_id: input.stage_id,
    title: input.title,
    contact_name: input.contact_name ?? "",
    contact_channel: input.contact_channel ?? "",
    source: input.source,
    value_krw: input.value_krw ?? 0,
    memo: input.memo ?? "",
    next_action: input.next_action ?? "",
    next_action_date: input.next_action_date ?? null,
    created_at: now,
    stage_changed_at: now,
  };
  getDb()
    .prepare(
      `INSERT INTO leads (id, pipeline_id, stage_id, title, contact_name, contact_channel,
        source, value_krw, memo, next_action, next_action_date, created_at, stage_changed_at)
       VALUES (@id, @pipeline_id, @stage_id, @title, @contact_name, @contact_channel,
        @source, @value_krw, @memo, @next_action, @next_action_date, @created_at, @stage_changed_at)`,
    )
    .run(lead);
  return lead;
}

export function getLead(id: string): Lead | undefined {
  return getDb().prepare("SELECT * FROM leads WHERE id = ?").get(id) as Lead | undefined;
}

/** stage.rotting_days 초과 정체 여부 계산. */
export function isRotting(lead: Lead, stage: Stage | undefined, now: Date = new Date()): boolean {
  if (!stage || stage.rotting_days == null) return false;
  const changed = new Date(lead.stage_changed_at).getTime();
  if (Number.isNaN(changed)) return false;
  return now.getTime() - changed > stage.rotting_days * 24 * 60 * 60 * 1000;
}

/** 리드 목록 (선택: 파이프라인 필터) — rotting 계산 포함. */
export function listLeads(pipelineId?: string): LeadWithRotting[] {
  const d = getDb();
  const rows = (
    pipelineId
      ? d.prepare("SELECT * FROM leads WHERE pipeline_id = ? ORDER BY created_at").all(pipelineId)
      : d.prepare("SELECT * FROM leads ORDER BY created_at").all()
  ) as Lead[];
  const stages = new Map(listStages().map((s) => [s.id, s]));
  const now = new Date();
  return rows.map((l) => ({ ...l, rotting: isRotting(l, stages.get(l.stage_id), now) }));
}

/** 전 파이프라인 rotting 리드 (lead-keeper 에이전트용). */
export function listRottingLeads(): LeadWithRotting[] {
  return listLeads().filter((l) => l.rotting);
}

/** 스테이지 이동 — stage_changed_at 갱신 + stage_change 이벤트 기록. */
export function moveLeadStage(leadId: string, stageId: string): Lead {
  const d = getDb();
  const lead = getLead(leadId);
  if (!lead) throw new Error("lead not found");
  const from = getStage(lead.stage_id);
  const to = getStage(stageId);
  if (!to) throw new Error("stage not found");
  if (to.pipeline_id !== lead.pipeline_id) throw new Error("stage belongs to another pipeline");
  const now = nowIso();
  const tx = d.transaction(() => {
    d.prepare("UPDATE leads SET stage_id = ?, stage_changed_at = ? WHERE id = ?").run(
      stageId,
      now,
      leadId,
    );
    addEvent(leadId, "stage_change", `${from?.name ?? "?"} → ${to.name}`, now);
  });
  tx();
  return getLead(leadId) as Lead;
}

// ---- 이벤트 ----

export function addEvent(leadId: string, type: string, body: string, ts?: string): LeadEvent {
  const ev: LeadEvent = { id: randomUUID(), lead_id: leadId, ts: ts ?? nowIso(), type, body };
  getDb()
    .prepare("INSERT INTO lead_events (id, lead_id, ts, type, body) VALUES (?, ?, ?, ?, ?)")
    .run(ev.id, ev.lead_id, ev.ts, ev.type, ev.body);
  return ev;
}

export function listEvents(leadId: string): LeadEvent[] {
  return getDb()
    .prepare("SELECT * FROM lead_events WHERE lead_id = ? ORDER BY ts")
    .all(leadId) as LeadEvent[];
}

// ---- 인바운드 캡처 (공개 웹훅) ----

export interface InboundInput {
  title: string;
  contactName?: string;
  contactChannel?: string;
  source: LeadSource;
  pipelineId?: string;
  memo?: string;
}

/** 인바운드 웹훅 — 지정/기본 파이프라인의 첫 스테이지로 리드 생성 + inbound 이벤트. */
export function captureInbound(input: InboundInput): Lead {
  const d = getDb();
  let pipeline: Pipeline | undefined;
  if (input.pipelineId) {
    pipeline = getPipeline(input.pipelineId);
    if (!pipeline) throw new Error("pipeline not found");
  } else {
    pipeline = d.prepare("SELECT * FROM pipelines ORDER BY created_at LIMIT 1").get() as
      | Pipeline
      | undefined;
    if (!pipeline) throw new Error("no pipeline exists");
  }
  const p = pipeline;
  const stage = firstStageOf(p.id);
  if (!stage) throw new Error("pipeline has no stages");
  const tx = d.transaction(() => {
    const lead = createLead({
      pipeline_id: p.id,
      stage_id: stage.id,
      title: input.title,
      contact_name: input.contactName,
      contact_channel: input.contactChannel,
      source: input.source,
      memo: input.memo,
    });
    addEvent(lead.id, "inbound", `인바운드 접수 (source: ${input.source})`);
    return lead;
  });
  return tx();
}
