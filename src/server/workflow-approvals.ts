// Workflow approvals — human approval flows for vacation / purchase / expense.
// Completely separate from AI task approvals in approvals.ts (do not touch that file).
// State machine: draft → submitted → (sequential approver decisions) → approved | rejected.
// Persistence: JSONL per day (upsert ops), in-memory cache for fast reads.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { HISTORY_DIR } from "../config.js";
import { emitGlobalEvent } from "./jobs.js";
import { emitNotification } from "./notifications.js";
import { decrement, increment } from "./vacation-balance.js";

const WF_DIR = join(HISTORY_DIR, "workflow-approvals");

function ensureDir(): void {
  if (!existsSync(WF_DIR)) mkdirSync(WF_DIR, { recursive: true });
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type WorkflowType = "vacation" | "purchase" | "expense";

export type WorkflowStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "cancelled";

export interface ApproverStep {
  order: number;
  approverId: string;
  status: "pending" | "approved" | "rejected";
  decidedAt?: string;
  comment?: string;
}

export interface WorkflowRequest {
  id: string;
  type: WorkflowType;
  requesterId: string;
  title: string;
  description?: string;
  data: Record<string, unknown>;
  approvers: ApproverStep[];
  status: WorkflowStatus;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  resolvedAt?: string;
  _auditLog?: string[]; // admin override records
}

export type WorkflowSSEPayload =
  | { type: "wf_created"; request: WorkflowRequest }
  | { type: "wf_updated"; request: WorkflowRequest };

// ── In-memory store ────────────────────────────────────────────────────────────

const cache = new Map<string, WorkflowRequest>();
let initialized = false;

function wfFilePath(dateStr: string): string { return join(WF_DIR, `wf-${dateStr}.jsonl`); }
function todayStr(): string { return new Date().toISOString().slice(0, 10); }

export function loadWorkflowApprovals(): void {
  if (initialized) return;
  ensureDir();
  let files: string[] = [];
  try {
    files = readdirSync(WF_DIR)
      .filter((f) => f.startsWith("wf-") && f.endsWith(".jsonl"))
      .sort()
      .slice(-90); // 90 days retention
  } catch { /* empty */ }
  for (const f of files) {
    try {
      const content = readFileSync(join(WF_DIR, f), "utf-8");
      for (const raw of content.split("\n")) {
        if (!raw.trim()) continue;
        try {
          const evt = JSON.parse(raw) as { op: string; request: WorkflowRequest };
          if (evt.op === "upsert" && evt.request?.id) cache.set(evt.request.id, evt.request);
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }
  initialized = true;
}

function persist(req: WorkflowRequest): void {
  req.updatedAt = new Date().toISOString();
  cache.set(req.id, req);
  try {
    appendFileSync(wfFilePath(todayStr()), JSON.stringify({ op: "upsert", request: req }) + "\n", "utf-8");
  } catch (err) {
    console.error("[WorkflowApprovals] append error:", err);
  }
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export interface CreateWorkflowInput {
  type: WorkflowType;
  requesterId: string;
  title: string;
  description?: string;
  data?: Record<string, unknown>;
  approverIds: string[];
}

export function createWorkflowRequest(input: CreateWorkflowInput): WorkflowRequest {
  loadWorkflowApprovals();
  const now = new Date().toISOString();
  const req: WorkflowRequest = {
    id: randomUUID(),
    type: input.type,
    requesterId: input.requesterId,
    title: input.title,
    ...(input.description ? { description: input.description } : {}),
    data: input.data ?? {},
    approvers: input.approverIds.map((approverId, i) => ({
      order: i + 1,
      approverId,
      status: "pending",
    })),
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };
  persist(req);
  emitGlobalEvent("workflow-approval", { type: "wf_created", request: req } as WorkflowSSEPayload);
  return req;
}

export function submitWorkflowRequest(
  id: string,
  requesterId: string,
): WorkflowRequest | null | { error: string } {
  loadWorkflowApprovals();
  const req = cache.get(id);
  if (!req || req.requesterId !== requesterId || req.status !== "draft") return null;

  // Vacation balance check — decrement before submission
  if (req.type === "vacation") {
    const days = typeof req.data.days === "number" ? req.data.days : 1;
    const year = new Date().getFullYear();
    try {
      decrement(requesterId, year, days, `submit:${req.id}`);
    } catch (err) {
      if (err instanceof Error && err.message === "INSUFFICIENT_BALANCE") {
        return { error: "잔액 부족" };
      }
      throw err;
    }
  }

  req.status = "submitted";
  req.submittedAt = new Date().toISOString();
  persist(req);
  emitGlobalEvent("workflow-approval", { type: "wf_updated", request: req } as WorkflowSSEPayload);

  // Notify first approver
  const firstApprover = req.approvers.find((s) => s.order === 1);
  if (firstApprover) {
    emitNotification({
      kind: "workflow_approval",
      title: "새 결재 요청",
      body: `${req.title} (${req.type})`,
      deepLink: {
        appId: "approval",
        route: `/requests/${req.id}`,
        targetUserKey: firstApprover.approverId,
      },
      source: { appId: "approval", refId: req.id },
      idempotencyKey: `wf-submit-${req.id}`,
    });
  }

  return req;
}

export function decideWorkflowRequest(
  id: string,
  approverId: string,
  decision: "approved" | "rejected",
  comment?: string,
): WorkflowRequest | null {
  loadWorkflowApprovals();
  const req = cache.get(id);
  if (!req || req.status !== "submitted") return null;

  const step = req.approvers.find(
    (s) => s.approverId === approverId && s.status === "pending",
  );
  if (!step) return null;

  // Enforce sequential order — all prior steps must be approved
  const blockedByPrior = req.approvers.some(
    (s) => s.order < step.order && s.status === "pending",
  );
  if (blockedByPrior) return null;

  step.status = decision;
  step.decidedAt = new Date().toISOString();
  if (comment) step.comment = comment;

  if (decision === "rejected") {
    req.status = "rejected";
    req.resolvedAt = new Date().toISOString();
    // Rollback vacation balance
    if (req.type === "vacation") {
      const days = typeof req.data.days === "number" ? req.data.days : 1;
      increment(req.requesterId, new Date().getFullYear(), days, `reject-rollback:${req.id}`);
    }
  } else if (req.approvers.every((s) => s.status === "approved")) {
    req.status = "approved";
    req.resolvedAt = new Date().toISOString();
    // Notify requester of approval
    emitNotification({
      kind: "workflow_approval",
      title: "결재 승인됨",
      body: req.title,
      deepLink: {
        appId: "approval",
        route: `/requests/${req.id}`,
        targetUserKey: req.requesterId,
      },
      source: { appId: "approval", refId: req.id },
      idempotencyKey: `wf-approved-${req.id}`,
    });
  } else {
    // Notify next approver in sequence
    const nextStep = req.approvers.find((s) => s.order === step.order + 1);
    if (nextStep) {
      emitNotification({
        kind: "workflow_approval",
        title: "새 결재 요청",
        body: `${req.title} (${req.type})`,
        deepLink: {
          appId: "approval",
          route: `/requests/${req.id}`,
          targetUserKey: nextStep.approverId,
        },
        source: { appId: "approval", refId: req.id },
        idempotencyKey: `wf-step-${req.id}-${nextStep.order}`,
      });
    }
  }

  persist(req);
  emitGlobalEvent("workflow-approval", { type: "wf_updated", request: req } as WorkflowSSEPayload);
  return req;
}

export function cancelWorkflowRequest(id: string, requesterId: string): WorkflowRequest | null {
  loadWorkflowApprovals();
  const req = cache.get(id);
  if (!req || req.requesterId !== requesterId) return null;
  if (["approved", "rejected", "cancelled"].includes(req.status)) return null;

  const wasSubmitted = req.status === "submitted";
  req.status = "cancelled";
  req.resolvedAt = new Date().toISOString();

  // Rollback vacation balance if already submitted (decrement already happened)
  if (wasSubmitted && req.type === "vacation") {
    const days = typeof req.data.days === "number" ? req.data.days : 1;
    increment(req.requesterId, new Date().getFullYear(), days, `cancel-rollback:${req.id}`);
  }

  persist(req);
  emitGlobalEvent("workflow-approval", { type: "wf_updated", request: req } as WorkflowSSEPayload);
  return req;
}

/** Admin override: force-resolve a workflow, bypassing approver steps. */
export function overrideWorkflowRequest(
  id: string,
  adminKey: string,
  decision: "approved" | "rejected",
  comment?: string,
): WorkflowRequest | null {
  loadWorkflowApprovals();
  const req = cache.get(id);
  if (!req || ["approved", "rejected", "cancelled"].includes(req.status)) return null;
  const wasSubmitted = req.status === "submitted";

  const auditEntry = `[admin-override] ${adminKey} → ${decision} at ${new Date().toISOString()}${comment ? ` | ${comment}` : ""}`;
  req._auditLog = [...(req._auditLog ?? []), auditEntry];

  // Mark all pending steps as the decided status
  for (const step of req.approvers) {
    if (step.status === "pending") {
      step.status = decision;
      step.decidedAt = new Date().toISOString();
      step.comment = `[admin-override] ${comment ?? ""}`;
    }
  }

  req.status = decision;
  req.resolvedAt = new Date().toISOString();

  if (decision === "rejected" && req.type === "vacation" && wasSubmitted) {
    const days = typeof req.data.days === "number" ? req.data.days : 1;
    increment(req.requesterId, new Date().getFullYear(), days, `admin-reject-rollback:${req.id}`);
  }

  emitNotification({
    kind: "workflow_approval",
    title: decision === "approved" ? "결재 승인됨 (관리자 처리)" : "결재 반려됨 (관리자 처리)",
    body: req.title,
    deepLink: {
      appId: "approval",
      route: `/requests/${req.id}`,
      targetUserKey: req.requesterId,
    },
    source: { appId: "approval", refId: req.id },
    idempotencyKey: `wf-override-${req.id}`,
  });

  persist(req);
  emitGlobalEvent("workflow-approval", { type: "wf_updated", request: req } as WorkflowSSEPayload);
  return req;
}

// ── Queries ───────────────────────────────────────────────────────────────────

export interface ListWorkflowQuery {
  requesterId?: string;
  approverId?: string;
  type?: WorkflowType;
  status?: WorkflowStatus;
  limit?: number;
}

export function listWorkflowRequests(query: ListWorkflowQuery = {}): WorkflowRequest[] {
  loadWorkflowApprovals();
  const limit = Math.min(query.limit ?? 50, 200);
  return Array.from(cache.values())
    .filter((r) => {
      if (query.requesterId && r.requesterId !== query.requesterId) return false;
      if (query.approverId && !r.approvers.some((s) => s.approverId === query.approverId)) return false;
      if (query.type && r.type !== query.type) return false;
      if (query.status && r.status !== query.status) return false;
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export function getWorkflowRequest(id: string): WorkflowRequest | null {
  loadWorkflowApprovals();
  return cache.get(id) ?? null;
}
