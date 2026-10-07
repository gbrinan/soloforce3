// 동료 통신 감사 로그 (append-only).
// 토큰 회전, 권한 거부, injection 매칭, 자동 비활성 등 보안 이벤트 기록.
// 7일 보관 후 archive 정책은 별도 (todo-monitor와 동일 사이클 — MVP는 무제한).

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { HISTORY_DIR } from "../config.js";

const AUDIT_FILE = join(HISTORY_DIR, "external", "audit.jsonl");

export type AuditEventType =
  | "partner_created"
  | "partner_updated"
  | "partner_deleted"
  | "partner_activated"
  | "partner_deactivated"
  | "partner_auto_deactivated"
  | "token_rotated"
  | "resume_shared"
  | "resume_unshared"
  | "inbound_received"
  | "inbound_denied_auth"
  | "inbound_denied_rate"
  | "inbound_denied_length"
  | "inbound_denied_inactive"
  | "inbound_dedup"
  | "outbound_sent"
  | "outbound_failed"
  | "injection_detected"
  | "approval_required"
  | "approval_resolved"
  | "partner_request_received"
  | "partner_request_approved"
  | "partner_request_rejected"
  | "partner_request_expired"
  | "partner_request_blacklisted"
  | "partner_request_callback_sent"
  | "partner_request_callback_failed"
  | "schedule_request_handled"
  | "schedule_response_handled"
  | "contact_created"
  | "contact_updated"
  | "contact_deleted"
  | "contact_auto_added"
  | "contact_favorite_toggled"
  | "contact_ocr_failed";

export interface AuditEntry {
  type: AuditEventType;
  partnerId?: string;
  messageId?: string;
  detail?: Record<string, unknown>;
}

function ensureDir(): void {
  const dir = dirname(AUDIT_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function auditEvent(entry: AuditEntry): void {
  ensureDir();
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n";
  try {
    appendFileSync(AUDIT_FILE, line, "utf-8");
  } catch (err) {
    console.error("[ExternalAudit] append 실패:", err);
  }
}
