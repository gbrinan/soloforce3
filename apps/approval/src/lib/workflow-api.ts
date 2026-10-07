"use client";

// Local type definitions — no cross-import from server package
export type WorkflowType = "vacation" | "purchase" | "expense";
export type WorkflowStatus = "draft" | "submitted" | "approved" | "rejected" | "cancelled";

export interface ApproverStep {
  order: number;
  approverId: string;
  required: boolean;
  status: "pending" | "approved" | "rejected";
  comment?: string;
  decidedAt?: string;
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
}

export interface VacationBalance {
  userId: string;
  year: number;
  totalAllowed: number;
  used: number;
  remaining: number;
  updatedAt: string;
}

export interface ApprovalAdmin {
  userId: string;
  role: "approver" | "admin" | "hr";
  managedTypes?: WorkflowType[];
  createdAt: string;
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// Workflow routes
export async function listWorkflows(params?: { role?: string; status?: string; type?: string; limit?: number }): Promise<WorkflowRequest[]> {
  const qs = new URLSearchParams();
  if (params?.role) qs.set("role", params.role);
  if (params?.status) qs.set("status", params.status);
  if (params?.type) qs.set("type", params.type);
  if (params?.limit) qs.set("limit", String(params.limit));
  return json<WorkflowRequest[]>(`/api/workflows?${qs}`);
}

export async function createWorkflow(body: { type: WorkflowType; title: string; description?: string; data?: Record<string, unknown>; approverIds: string[] }): Promise<WorkflowRequest> {
  return json<WorkflowRequest>("/api/workflows", { method: "POST", body: JSON.stringify(body) });
}

export async function getWorkflow(id: string): Promise<WorkflowRequest> {
  return json<WorkflowRequest>(`/api/workflows/${id}`);
}

export async function submitWorkflow(id: string): Promise<WorkflowRequest> {
  return json<WorkflowRequest>(`/api/workflows/${id}/submit`, { method: "POST" });
}

export async function decideWorkflow(id: string, body: { decision: "approved" | "rejected"; comment?: string }): Promise<WorkflowRequest> {
  return json<WorkflowRequest>(`/api/workflows/${id}/decide`, { method: "POST", body: JSON.stringify(body) });
}

export async function cancelWorkflow(id: string): Promise<WorkflowRequest> {
  return json<WorkflowRequest>(`/api/workflows/${id}`, { method: "DELETE" });
}

// Admin routes
export async function getMyBalance(year?: number): Promise<VacationBalance> {
  const qs = year ? `?year=${year}` : "";
  return json<VacationBalance>(`/api/admin/approval/balances/me${qs}`);
}

export async function listBalances(year?: number): Promise<VacationBalance[]> {
  const qs = year ? `?year=${year}` : "";
  return json<VacationBalance[]>(`/api/admin/approval/balances${qs}`);
}

export async function upsertBalance(body: { userId: string; year: number; totalAllowed: number }): Promise<VacationBalance> {
  return json<VacationBalance>("/api/admin/approval/balances", { method: "POST", body: JSON.stringify(body) });
}

export async function listAdmins(): Promise<ApprovalAdmin[]> {
  return json<ApprovalAdmin[]>("/api/admin/approval/admins");
}

export async function addAdmin(body: { userId: string; role: string; managedTypes?: WorkflowType[] }): Promise<ApprovalAdmin> {
  return json<ApprovalAdmin>("/api/admin/approval/admins", { method: "POST", body: JSON.stringify(body) });
}

export async function getAuditLog(limit?: number): Promise<WorkflowRequest[]> {
  const qs = limit ? `?limit=${limit}` : "";
  return json<WorkflowRequest[]>(`/api/admin/approval/audit-log${qs}`);
}

export async function overrideWorkflow(id: string, body: { decision: "approved" | "rejected"; comment?: string }): Promise<WorkflowRequest> {
  return json<WorkflowRequest>(`/api/admin/approval/override/${id}`, { method: "POST", body: JSON.stringify(body) });
}

// ── AI routes — served by this Next app itself (unlike /api/workflows above,
// which the main server owns), so the app basePath prefix is required.
const APP_BASE = (process.env.NEXT_PUBLIC_BASE_PATH || "/api/apps/approval/proxy").replace(/\/+$/, "");

export interface AiDraftFields {
  leaveType?: string;
  startDate?: string;
  endDate?: string;
  days?: number;
  vendor?: string;
  amount?: number;
  category?: string;
  reason?: string;
}

export async function aiDraft(body: { type: WorkflowType; hints?: string }): Promise<AiDraftFields> {
  return json<AiDraftFields>(`${APP_BASE}/api/ai/draft`, { method: "POST", body: JSON.stringify(body) });
}

export interface AiSummary {
  summary: string[];
  risk?: string;
}

export async function aiSummarizeRequest(request: WorkflowRequest): Promise<AiSummary> {
  return json<AiSummary>(`${APP_BASE}/api/ai/summarize-request`, {
    method: "POST",
    body: JSON.stringify({
      type: request.type,
      title: request.title,
      description: request.description,
      data: request.data,
      requesterId: request.requesterId,
    }),
  });
}

// 동료(External 파트너) — 결재선 결재자 후보. 서버 /api/external/partners를 그대로 사용.
// 표시에 필요한 필드만 좁혀 정의한다(서버 Partner 전체를 import하지 않음).
export interface PartnerLite {
  id: string;
  companyName: string;
  contactName: string;
  department?: string;
  contactEmail?: string;
  active?: boolean;
}

// /api/external/* 는 사장님 인증 게이트(X-Approval-Token) 뒤에 있다. 메인 클라이언트와 동일하게
// SSO 세션으로 /api/approval-token을 먼저 받아 헤더에 실어야 파트너 목록을 읽을 수 있다.
let _approvalToken: string | null = null;
async function approvalToken(): Promise<string> {
  if (_approvalToken !== null) return _approvalToken;
  try {
    const res = await fetch("/api/approval-token", { cache: "no-store" });
    const data = res.ok ? ((await res.json()) as { token?: string }) : {};
    _approvalToken = data.token ?? "";
  } catch {
    _approvalToken = "";
  }
  return _approvalToken;
}

export async function listPartners(): Promise<PartnerLite[]> {
  const token = await approvalToken();
  const res = await fetch("/api/external/partners", {
    cache: "no-store",
    headers: token ? { "X-Approval-Token": token } : {},
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<PartnerLite[]>;
}
