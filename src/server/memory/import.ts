// memory/import.ts — 마크다운(history/) → memories 행 빌드. P1은 report-only(dry-run).
// 불변식 M1: 전적으로 마크다운에서 재생성. M4: frontmatter는 additive(없으면 추론/백필).

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import type { Database } from "better-sqlite3";
import type { MemoryType } from "./schema.js";

export interface MemoryRow {
  id: string; type: MemoryType; owner_entity_id: string; scope: string;
  title: string; prompt_summary: string; body: string;
  keywords: string | null; tags: string | null; context: string | null;
  importance: number; confidence: number; status: string;
  source_path: string; content_hash: string;
  valid_from: string; valid_to: string | null; created_at: string; updated_at: string;
}

interface Frontmatter { name?: string; description?: string; type?: string; tags?: string; keywords?: string; importance?: string }

// 아주 단순한 frontmatter 파서 (--- ... --- 사이 key: value). YAML 의존 없음.
function parseFrontmatter(text: string): { fm: Frontmatter; body: string } {
  if (!text.startsWith("---")) return { fm: {}, body: text };
  const end = text.indexOf("\n---", 3);
  if (end < 0) return { fm: {}, body: text };
  const head = text.slice(3, end).trim();
  const body = text.slice(end + 4).replace(/^\s*\n/, "");
  const fm: Record<string, string> = {};
  for (const line of head.split("\n")) {
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (m) fm[m[1]] = m[2].trim();
  }
  return { fm, body };
}

// frontmatter type 또는 파일명 접두로 memories.type 추론 (M4: additive)
export function inferType(filename: string, fmType?: string): MemoryType {
  const map: Record<string, MemoryType> = {
    feedback: "feedback", project: "project_state", user: "profile",
    reference: "semantic", procedure: "procedural", decision: "decision", warning: "warning",
  };
  if (fmType && map[fmType]) return map[fmType];
  const b = filename.toLowerCase();
  if (b.startsWith("feedback")) return "feedback";
  if (b.startsWith("project")) return "project_state";
  if (b.startsWith("procedure")) return "procedural";
  if (b.includes("role-directive")) return "role";
  if (b.includes("self-profile") || b.includes("profile")) return "profile";
  return "semantic";
}

// 경로에서 소유자/스코프 도출
function ownerScope(historyDir: string, absPath: string): { owner: string; scope: string } {
  const rel = relative(historyDir, absPath).split(/[\\/]/);
  if (rel[0] === "genie" && rel[1] === "wiki") return { owner: "genie", scope: "wiki" };
  if (rel[0] === "genie" && rel[1] === "daily") return { owner: "genie", scope: "daily" };  // 지니 일별 대화요약
  if (rel[0] === "agents" && rel[2] === "wiki") return { owner: rel[1], scope: "wiki" };
  if (rel[0] === "guides") return { owner: "shared", scope: "guides" };
  if (rel[0] === "skills") return { owner: "shared", scope: "skills" };
  return { owner: "shared", scope: rel[0] ?? "misc" };
}

const PROMPT_SUMMARY_CAP = 800;            // prompt_summary는 토큰 단위 관심 → 글자 기준 유지
// 본문 방어 캡 16KB(바이트). 한글=3바이트라 글자 기준이면 ~48KB가 돼 의미가 어긋남 → byteLength 기준.
const BODY_CAP_BYTES = 16 * 1024;

function capBytes(s: string, maxBytes: number): string {
  if (Buffer.byteLength(s, "utf-8") <= maxBytes) return s;
  let str = Buffer.from(s, "utf-8").subarray(0, maxBytes).toString("utf-8");
  if (str.endsWith("�")) str = str.slice(0, -1);   // 멀티바이트 경계 잘림 정리
  return str;
}

// prompt_summary 시드: frontmatter.description 우선, 없으면 본문 앞부분 (LLM 없이 — P1)
function seedSummary(fm: Frontmatter, body: string, title: string): string {
  if (fm.description) return fm.description.slice(0, PROMPT_SUMMARY_CAP);
  const plain = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`\-|]/g, " ")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return (plain || title).slice(0, PROMPT_SUMMARY_CAP);
}

export function parseNote(historyDir: string, absPath: string): MemoryRow {
  const raw = readFileSync(absPath, "utf-8");
  const { fm, body } = parseFrontmatter(raw);
  const file = basename(absPath);
  const { owner, scope } = ownerScope(historyDir, absPath);
  const st = statSync(absPath);
  const mtime = st.mtime.toISOString();
  const title = (fm.name || file.replace(/\.md$/, "")).slice(0, 300);
  const importance = fm.importance ? Math.max(1, Math.min(10, parseInt(fm.importance, 10) || 5)) : 5;
  // daily 디렉토리의 일별 요약은 episodic_summary (대화 회상용)
  const isDaily = relative(historyDir, absPath).split(/[\\/]/).includes("daily");
  return {
    id: relative(historyDir, absPath),                  // 안정·고유·재생성 가능
    type: isDaily ? "episodic_summary" : inferType(file, fm.type),
    owner_entity_id: owner, scope,
    title,
    prompt_summary: seedSummary(fm, body, title),
    body: capBytes(body, BODY_CAP_BYTES),                            // 방어 캡(바이트 기준, M: 작은 인덱스)
    keywords: fm.keywords ?? null, tags: fm.tags ?? null, context: null,
    importance, confidence: 1.0, status: "active",
    source_path: relative(historyDir, absPath),         // 상대경로 — 이동/복원/홈차이 강건(읽을 때 HISTORY_DIR join)
    content_hash: createHash("sha256").update(raw).digest("hex"),
    valid_from: mtime, valid_to: null, created_at: mtime, updated_at: mtime,
  };
}

// 인덱싱 대상: genie/wiki, genie/daily(일별 대화요약), agents/*/wiki, guides, skills(알바풀), playbooks(작업 절차)
export function p1Roots(historyDir: string): string[] {
  const roots: string[] = [join(historyDir, "genie", "wiki"), join(historyDir, "genie", "daily")];
  const agentsDir = join(historyDir, "agents");
  if (existsSync(agentsDir)) {
    for (const a of readdirSync(agentsDir)) {
      const w = join(agentsDir, a, "wiki");
      if (existsSync(w)) roots.push(w);
    }
  }
  roots.push(join(historyDir, "guides"), join(historyDir, "skills"), join(historyDir, "playbooks"));
  return roots.filter(existsSync);
}

function walkMd(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (e.name === "_drafts") continue;   // 미검증 초안 — 검색 색인 제외(정식 지식인 양 뜨면 오염)
      out.push(...walkMd(join(dir, e.name)));
    } else if (e.name.endsWith(".md") && e.name !== "index.md") out.push(join(dir, e.name));
  }
  return out;
}

export function scanRoots(historyDir: string): { rows: MemoryRow[]; issues: string[] } {
  const rows: MemoryRow[] = [];
  const issues: string[] = [];
  for (const root of p1Roots(historyDir)) {
    for (const f of walkMd(root)) {
      try {
        const r = parseNote(historyDir, f);
        if (!r.title) issues.push(`title 없음: ${r.id}`);
        rows.push(r);
      } catch (e) {
        issues.push(`파싱 실패 ${relative(historyDir, f)}: ${(e as Error).message}`);
      }
    }
  }
  return { rows, issues };
}

export interface BuildResult { added: number; updated: number; unchanged: number; removed: number; issues: string[] }

// content_hash 증분 빌드: 마크다운 → memories upsert/삭제. FTS는 트리거로 자동 동기.
// 불변식 M1: 마크다운에서만 빌드(재생성 가능). 검색은 쓰기 유발 안 함(M9) — 빌드 경로에서만 기록.
const COLS = "id,type,owner_entity_id,scope,title,prompt_summary,body,keywords,tags,context," +
  "importance,confidence,status,source_event_id,source_path,content_hash,valid_from,valid_to,created_at,updated_at";

export function buildIndex(db: Database, historyDir: string): BuildResult {
  const { rows, issues } = scanRoots(historyDir);
  // 가드: 마크다운-backed(source_path is not null)만 비교/삭제 대상 — P6 DB-native memory는 마크다운 빌드가 안 건드림.
  const existing = new Map<string, string>();
  for (const r of db.prepare("select id, content_hash from memories where source_path is not null").all() as Array<{ id: string; content_hash: string }>)
    existing.set(r.id, r.content_hash);

  const placeholders = COLS.split(",").map((c) => "@" + c.trim()).join(",");
  const upsert = db.prepare(
    `insert into memories (${COLS}) values (${placeholders})
     on conflict(id) do update set
       type=@type, owner_entity_id=@owner_entity_id, scope=@scope, title=@title,
       prompt_summary=@prompt_summary, body=@body, keywords=@keywords, tags=@tags, context=@context,
       importance=@importance, source_path=@source_path, content_hash=@content_hash,
       valid_from=@valid_from, valid_to=@valid_to, updated_at=@updated_at`);
  const del = db.prepare("delete from memories where id = ?");

  let added = 0, updated = 0, unchanged = 0, removed = 0;
  const seen = new Set<string>();
  const tx = db.transaction(() => {
    for (const r of rows) {
      seen.add(r.id);
      const prev = existing.get(r.id);
      if (prev === r.content_hash) { unchanged++; continue; }
      upsert.run({ ...r, source_event_id: null, confidence: r.confidence });
      if (prev === undefined) added++; else updated++;
    }
    for (const id of existing.keys()) if (!seen.has(id)) { del.run(id); removed++; }
  });
  tx();
  return { added, updated, unchanged, removed, issues };
}
