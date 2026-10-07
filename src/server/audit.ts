import {
  appendFileSync,
  mkdirSync,
  existsSync,
  writeFileSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { HISTORY_DIR } from "../config.js";
import type { Job } from "../types.js";
import { normalizePageName } from "./pm-memory.js";

export type AuditEvent =
  | "qa.profile_selected"
  | "job.created"
  | "job.started"
  | "job.completed"
  | "job.outputs_missing"
  | "job.failed"
  | "job.recovered"
  | "job.killed"
  | "job.aborted"
  | "job.activated"
  // 상류(Anthropic) 세션/사용 한도로 지연 재개 — 실패가 아니라 재시도 대기 (upstream-limit.ts)
  | "job.deferred"
  | "job.defer_exhausted"
  | "lease.acquired"
  | "lease.released"
  | "lease.expired"
  // per-agent maxCacheTokens 초과로 clearPmSession이 발동한 시점 (2026-08-24, 손익분기 기반 상한)
  | "cache.reset"
  | "plan.proposed"
  | "plan.approved"
  | "plan.rejected"
  | "plan.exhausted";

const AUDIT_FILE = join(HISTORY_DIR, "audit.jsonl");
const ARCHIVE_DIR = join(HISTORY_DIR, "archive");

export function auditLog(event: AuditEvent, data: Record<string, unknown>): void {
  try {
    if (!existsSync(HISTORY_DIR)) mkdirSync(HISTORY_DIR, { recursive: true });
    const entry = {
      timestamp: new Date().toISOString(),
      event,
      ...data,
    };
    appendFileSync(AUDIT_FILE, JSON.stringify(entry) + "\n");
  } catch (err) {
    console.error("[Audit] 기록 실패:", err);
  }
}

// --- Archive (append-only 역사서) ---

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function todayYmd(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function nowHms(d: Date = new Date()): string {
  return `${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`;
}

export function archiveWikiPage(
  page: string,
  content: string,
  source: string,
): void {
  try {
    const now = new Date();
    const dir = join(ARCHIVE_DIR, "wiki", todayYmd(now));
    mkdirSync(dir, { recursive: true });

    const base = normalizePageName(page).replace(/\.md$/i, "");
    const filename = `${nowHms(now)}-${source}-${base}.md`;
    const filepath = join(dir, filename);

    const frontmatter = `---\npage: ${page}\nsource: ${source}\ntimestamp: ${now.toISOString()}\n---\n\n`;
    writeFileSync(filepath, frontmatter + content);
  } catch (err) {
    console.error("[Archive] 위키 기록 실패:", err);
    throw err; // caller에게 전파 → 원본 삭제 방지
  }
}

export function archiveJob(job: Job): void {
  try {
    const dir = join(ARCHIVE_DIR, "jobs", todayYmd());
    mkdirSync(dir, { recursive: true });
    const filepath = join(dir, `${job.id}.json`);
    writeFileSync(filepath, JSON.stringify(job, null, 2));
  } catch (err) {
    console.error("[Archive] 작업 기록 실패:", err);
  }
}

// 아카이브에서 job을 id로 조회 (날짜 폴더 역순 — 최근 우선). full id + 8자 prefix 모두 지원.
// get_job_result가 라이브 Map(프룬됨)에 없을 때 폴백 → "job not found" 무한재위임 방지.
export function readArchivedJob(id: string): Job | null {
  try {
    const jobsDir = join(ARCHIVE_DIR, "jobs");
    if (!existsSync(jobsDir)) return null;
    const exactName = `${id}.json`;
    for (const d of readdirSync(jobsDir).sort().reverse()) {
      const dirPath = join(jobsDir, d);
      let files: string[];
      try { files = readdirSync(dirPath); } catch { continue; }
      const match = files.includes(exactName)
        ? exactName
        : (id.length < 36 ? files.find((f) => f.endsWith(".json") && f.startsWith(id)) : undefined);
      if (match) return JSON.parse(readFileSync(join(dirPath, match), "utf-8")) as Job;
    }
  } catch (err) {
    console.error("[Archive] job 조회 실패:", err);
  }
  return null;
}

export function archiveChatMessage(
  role: "user" | "genie" | "system",
  content: string,
  meta?: Record<string, unknown>,
): void {
  try {
    const dir = join(ARCHIVE_DIR, "chat");
    mkdirSync(dir, { recursive: true });
    const filepath = join(dir, `${todayYmd()}.jsonl`);
    const entry = {
      timestamp: new Date().toISOString(),
      role,
      content,
      ...(meta ?? {}),
    };
    appendFileSync(filepath, JSON.stringify(entry) + "\n");
  } catch (err) {
    console.error("[Archive] 대화 기록 실패:", err);
  }
}
