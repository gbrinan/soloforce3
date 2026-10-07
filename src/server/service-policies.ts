import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { emitGlobalEvent } from "./jobs.js";

export type PolicyMode = "auto" | "approval";

export interface ServicePolicy {
  id: string;
  label: string;
  mcpServerId: string;
  category: string;
  connected: boolean;
  enabled: boolean;
  readPolicy: PolicyMode;
  writePolicy: PolicyMode;
  readTools: string[];
  writeTools: string[];
}

export interface ToolApprovalRequest {
  id: string;
  serviceId: string;
  serviceLabel: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  humanReadableDesc: string;
  requestedAt: number;
  timeoutMs: number;
}

export type ApprovalDecision = "approve" | "reject";

const POLICIES_FILE = resolve(".", "config", "service-policies.json");

const DEFAULT_POLICIES: ServicePolicy[] = [
  {
    id: "google-drive", label: "Google Drive", mcpServerId: "claude.ai Google_Drive",
    category: "google", connected: true, enabled: true, readPolicy: "auto", writePolicy: "approval",
    readTools: ["download_file_content", "read_file_content", "get_file_metadata", "search_files", "list_recent_files", "get_file_permissions"],
    writeTools: ["create_file", "copy_file"],
  },
  {
    id: "google-calendar", label: "Google Calendar", mcpServerId: "claude.ai Google_Calendar",
    category: "google", connected: true, enabled: true, readPolicy: "auto", writePolicy: "approval",
    readTools: ["list_calendars", "list_events", "get_event", "suggest_time"],
    writeTools: ["create_event", "update_event", "delete_event", "respond_to_event"],
  },
  {
    id: "gmail", label: "Gmail", mcpServerId: "claude.ai Gmail",
    category: "google", connected: true, enabled: true, readPolicy: "auto", writePolicy: "approval",
    readTools: ["search_threads", "get_thread", "list_drafts", "list_labels"],
    writeTools: ["create_draft", "label_message", "label_thread"],
  },
  {
    id: "slack", label: "Slack", mcpServerId: "claude.ai Slack",
    category: "communication", connected: true, enabled: true, readPolicy: "auto", writePolicy: "approval",
    readTools: ["slack_read_channel", "slack_read_thread", "slack_search_channels", "slack_search_public", "slack_read_user_profile"],
    writeTools: ["slack_send_message", "slack_send_message_draft", "slack_schedule_message", "slack_create_canvas"],
  },
  {
    id: "notion", label: "Notion", mcpServerId: "claude.ai Notion",
    category: "productivity", connected: true, enabled: true, readPolicy: "auto", writePolicy: "approval",
    readTools: ["notion-search", "notion-fetch", "notion-get-comments", "notion-get-teams", "notion-get-users"],
    writeTools: ["notion-create-pages", "notion-update-page", "notion-create-comment", "notion-create-database"],
  },
  {
    id: "asana", label: "Asana", mcpServerId: "",
    category: "productivity", connected: false, enabled: false, readPolicy: "approval", writePolicy: "approval",
    readTools: [], writeTools: [],
  },
];

// ── 정책 파일 읽기/쓰기 ──────────────────────────────────────────────────────

export function loadServicePolicies(): ServicePolicy[] {
  try {
    if (!existsSync(POLICIES_FILE)) return DEFAULT_POLICIES;
    const raw = JSON.parse(readFileSync(POLICIES_FILE, "utf-8"));
    return Array.isArray(raw.services) ? raw.services as ServicePolicy[] : DEFAULT_POLICIES;
  } catch {
    return DEFAULT_POLICIES;
  }
}

export function getServicePolicy(id: string): ServicePolicy | undefined {
  return loadServicePolicies().find((p) => p.id === id);
}

export function updateServicePolicy(id: string, patch: Partial<ServicePolicy>): ServicePolicy {
  const policies = loadServicePolicies();
  const idx = policies.findIndex((p) => p.id === id);
  if (idx < 0) throw new Error(`service policy not found: ${id}`);

  // 허용 필드만 patch — id/mcpServerId/readTools/writeTools 변경 불허
  const ALLOWED: Array<keyof ServicePolicy> = ["enabled", "readPolicy", "writePolicy"];
  const safe: Partial<ServicePolicy> = {};
  for (const key of ALLOWED) {
    if (key in patch) (safe as Record<string, unknown>)[key] = patch[key as keyof ServicePolicy];
  }

  const updated = { ...policies[idx], ...safe };
  policies[idx] = updated;

  try {
    mkdirSync(dirname(POLICIES_FILE), { recursive: true });
    const existing = existsSync(POLICIES_FILE)
      ? JSON.parse(readFileSync(POLICIES_FILE, "utf-8"))
      : { version: "1" };
    writeFileSync(POLICIES_FILE, JSON.stringify({ ...existing, services: policies }, null, 2), "utf-8");
  } catch { /* best-effort */ }

  return updated;
}

// ── 승인 대기 큐 ────────────────────────────────────────────────────────────

interface PendingApproval {
  request: ToolApprovalRequest;
  resolve: (decision: ApprovalDecision) => void;
  timer: ReturnType<typeof globalThis.setTimeout>;
}

const pendingApprovals = new Map<string, PendingApproval>();

export function requestApproval(
  serviceId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<ApprovalDecision> {
  const policy = getServicePolicy(serviceId);
  const serviceLabel = policy?.label ?? serviceId;
  const id = randomUUID();

  const request: ToolApprovalRequest = {
    id,
    serviceId,
    serviceLabel,
    toolName,
    toolInput,
    humanReadableDesc: buildHumanReadableDesc(serviceId, serviceLabel, toolName, toolInput),
    requestedAt: Date.now(),
    timeoutMs,
  };

  return new Promise<ApprovalDecision>((resolve) => {
    const timer = globalThis.setTimeout(() => {
      pendingApprovals.delete(id);
      emitGlobalEvent("tool-approval", { type: "timeout", requestId: id });
      resolve("reject");
    }, timeoutMs);

    pendingApprovals.set(id, { request, resolve, timer });
    emitGlobalEvent("tool-approval", { type: "request", ...request });
  });
}

export function resolveApproval(requestId: string, decision: ApprovalDecision): boolean {
  const pending = pendingApprovals.get(requestId);
  if (!pending) return false;
  clearTimeout(pending.timer);
  pendingApprovals.delete(requestId);
  pending.resolve(decision);
  emitGlobalEvent("tool-approval", { type: "resolved", requestId, decision });
  return true;
}

// ── 정책 체크 (MCP 도구 호출 전 삽입 지점) ──────────────────────────────────

export async function checkToolPolicy(
  serviceId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<ApprovalDecision> {
  const policy = getServicePolicy(serviceId);
  if (!policy || !policy.enabled) return "approve";

  const isWrite = policy.writeTools.includes(toolName);
  const mode = isWrite ? policy.writePolicy : policy.readPolicy;

  if (mode === "approval") {
    return requestApproval(serviceId, toolName, toolInput, 30_000);
  }
  return "approve";
}

// ── 정책 기반 차단 도구 목록 ─────────────────────────────────────────────────

export function getPolicyDisallowedTools(): string[] {
  const policies = loadServicePolicies();
  const result: string[] = [];
  for (const p of policies) {
    if (!p.mcpServerId) continue;
    const prefix = "mcp__" + p.mcpServerId.replace(/\./g, "_").replace(/\s+/g, "_") + "__";
    if (!p.enabled) {
      result.push(...p.readTools.map((t) => prefix + t));
      result.push(...p.writeTools.map((t) => prefix + t));
    } else {
      if (p.writePolicy === "approval") result.push(...p.writeTools.map((t) => prefix + t));
      if (p.readPolicy === "approval") result.push(...p.readTools.map((t) => prefix + t));
    }
  }
  return result;
}

// ── 설명 생성 헬퍼 ───────────────────────────────────────────────────────────

function buildHumanReadableDesc(
  serviceId: string,
  serviceLabel: string,
  toolName: string,
  toolInput: Record<string, unknown>,
): string {
  const descriptions: Record<string, (input: Record<string, unknown>) => string> = {
    "slack_send_message": (i) => `Slack ${String(i.channel ?? "")} 채널에 메시지 전송`,
    "create_event": (i) => `Google Calendar에 이벤트 생성: "${String(i.summary ?? "")}"`,
    "create_file": (i) => `Google Drive에 파일 생성: "${String(i.name ?? "")}"`,
    "create_draft": (i) => `Gmail 임시 메일 작성: 수신자 ${String(i.to ?? "")}`,
    "notion-create-pages": (i) => `Notion 페이지 생성: "${String(i.title ?? "")}"`,
    "notion-update-page": (i) => `Notion 페이지 수정`,
  };
  const builder = descriptions[toolName];
  if (builder) return builder(toolInput);
  return `${serviceLabel} — ${toolName} 실행`;
}
