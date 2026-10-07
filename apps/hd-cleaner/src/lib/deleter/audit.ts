// Append-only jsonl 감사 로그 — 경로+크기+사유를 timestamped로 기록 (QA §0.5 가역 로그 원칙)
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const AUDIT_PATH = join(process.cwd(), ".data", "audit.jsonl");

export interface AuditEntry {
  path: string;
  action: "trashed" | "denied" | "failed" | "dry-run";
  reason: string;
  dryRun: boolean;
  size?: number;
}

export async function appendAudit(entry: AuditEntry): Promise<void> {
  await mkdir(dirname(AUDIT_PATH), { recursive: true });
  const line = `${JSON.stringify({ ...entry, at: new Date().toISOString() })}\n`;
  await appendFile(AUDIT_PATH, line, "utf-8");
}

export function getAuditPath(): string {
  return AUDIT_PATH;
}
