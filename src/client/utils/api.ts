export interface ChatMessage {
  id: string;
  role: 'user' | 'genie';
  content: string;
  timestamp: string;
  jobs?: Array<{ id: string; request: string; agent?: string }>;
  attachments?: string[];
  pending?: boolean;
  aborted?: boolean;
}

// 직원 권한(restricted/standard/admin) + 마이크루 파일접근 권한(whitelist/workspace/full) 양쪽을 수용.
export type PermissionLevel = 'restricted' | 'standard' | 'admin' | 'whitelist' | 'workspace' | 'full';

export interface StaffMember {
  id: string;
  name: string;
  role: string;
  permissionLevel?: PermissionLevel;
  model?: string | null;
  recentActualModel?: string | null;
  adapter?: string;
  busy: boolean;
  task?: string;
  sessionStartedAt?: string;
  baseTokens?: number;
  lastTokens?: number;
}

export interface StaffTeam {
  name: string;
  lead: StaffMember | null;
  members: StaffMember[];
}

export interface Job {
  id: string;
  request: string;
  status: string;
  projectName?: string;
  agent?: string;
  createdAt: string;
  completedAt?: string;
  logs: string[];
  error?: string;
  outputFiles?: string[];
  fullResult?: string;
}

export interface Todo {
  id: string;
  instruction: string;
  origin: string;
  status: string;
  state: string;
  createdAt: string;
  stages?: string[];
  stageAgents?: string[];
  currentStage?: number;
  relatedJobIds?: string[];
  stateHistory?: Array<{ state: string; at: string; note?: string }>;
  cronExpr?: string;
  agentName?: string;
  jobStatus?: string;
  jobOutcome?: 'success' | 'fail' | 'review';
  jobSummary?: string;
}

export type TaskStatus = 'active' | 'done' | 'cancelled';

export interface TaskWithTodos {
  id: string;
  origin: string;
  instruction: string;
  createdAt: string;
  status: TaskStatus;
  todoIds: string[];
  doneAt?: string;
  doneSummary?: string;
  todos: Todo[];
  routineType?: 'master' | 'instance';
  masterTaskId?: string;
  cronExpr?: string;
}

export interface ApprovalRequest {
  id: string;
  agentRole: string;
  tool: string;
  path: string;
  createdAt: number;
  resolvedAt?: number;
  status: string;
  genieOpinion?: { allow: boolean; reason?: string };
  decisionSource?: string;
  revokedAt?: number;
  permissionLevel?: PermissionLevel;
}

export async function fetchChatHistory(): Promise<ChatMessage[]> {
  const res = await fetch('/api/chat/history');
  return res.json();
}

export async function sendChatMessage(message: string, attachments?: string[], browserId?: string): Promise<ChatMessage> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, attachments, browserId }),
  });
  return res.json();
}

export async function abortGenieResponse(): Promise<void> {
  await fetch('/api/chat/abort', { method: 'POST' }).catch(() => {});
}

export async function fetchStaff(): Promise<{ genie?: StaffMember; teams: StaffTeam[]; bootTime?: string }> {
  const res = await fetch('/api/staff');
  return res.json();
}

export interface StaffModelCatalog {
  adapter: string;
  models: Array<{ id: string; label: string }>;
  source: 'live' | 'static' | 'fallback';
}

export async function fetchStaffModels(id: string): Promise<StaffModelCatalog> {
  const res = await fetch(`/api/staff/${encodeURIComponent(id)}/models`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `http_${res.status}`);
  return data as StaffModelCatalog;
}

// StaffPanel 셀렉트로 직원 model/permissionLevel 변경. 화이트리스트 값만 허용 (서버 400 검증).
export async function updateStaffConfig(
  id: string,
  patch: { model?: string; permissionLevel?: 'restricted' | 'standard' | 'admin'; name?: string },
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/staff/${encodeURIComponent(id)}/config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data?.error ?? `http_${res.status}` };
  return { ok: true };
}

export interface CreateStaffInput {
  name: string;
  role?: string;
  team?: string;
  model?: string;
  permissionLevel?: 'restricted' | 'standard' | 'admin';
  roleDirective?: string;
}

// 신규 Claude 에이전트 채용. 성공 시 생성된 id 반환. 서버가 paul 템플릿 기반 안전 기본값으로 생성.
export async function createStaff(input: CreateStaffInput): Promise<{ ok: boolean; id?: string; error?: string }> {
  const res = await fetch('/api/staff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data?.error ?? `http_${res.status}` };
  return { ok: true, id: data?.id };
}

export async function fetchTodos(): Promise<Todo[]> {
  const res = await fetch('/api/todos');
  return res.json();
}

// 노트 체크리스트 항목 → 마이크루 태스크 생성. 성공 시 { taskId, todoId } 반환(노트에 [[task:id]] 링크용).
export async function createTaskFromNote(instruction: string, noteId?: string): Promise<{ taskId: string; todoId: string } | null> {
  const res = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instruction, noteId }),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return data && typeof data.taskId === 'string' ? { taskId: data.taskId, todoId: data.todoId } : null;
}

export async function fetchTaskTree(): Promise<TaskWithTodos[]> {
  const res = await fetch('/api/tasks');
  return res.json();
}

export async function fetchPendingApprovals(): Promise<ApprovalRequest[]> {
  const res = await fetch('/api/approvals');
  return res.json();
}

export async function fetchResolvedApprovals(limit = 500): Promise<ApprovalRequest[]> {
  const res = await fetch(`/api/approvals/resolved?limit=${limit}`);
  return res.json();
}

let _approvalToken = '';
function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return { ...(extra ?? {}), 'X-Approval-Token': _approvalToken };
}
export function getApprovalToken(): string {
  return _approvalToken;
}
export async function loadApprovalToken(): Promise<void> {
  try {
    const res = await fetch('/api/approval-token');
    const data = await res.json();
    _approvalToken = data.token || '';
  } catch { /* */ }
}

export async function resolveApproval(id: string, allow: boolean): Promise<void> {
  await fetch(`/api/approvals/${id}/resolve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Approval-Token': _approvalToken,
    },
    body: JSON.stringify({ allow, source: 'user' }),
  });
}

export async function fetchJob(id: string): Promise<Job | null> {
  const res = await fetch(`/api/jobs/${id}`);
  if (!res.ok) return null;
  return res.json();
}

export async function uploadFiles(files: File[]): Promise<string[]> {
  const form = new FormData();
  for (const f of files) form.append('files', f);
  const res = await fetch('/api/upload', { method: 'POST', body: form });
  const data = await res.json();
  return data.paths || [];
}

export async function fetchOnboardingNeeded(): Promise<boolean> {
  const res = await fetch('/api/onboarding');
  const data = await res.json();
  return data.needed;
}

export async function submitOnboarding(data: { name: string; genieName: string; ctoName?: string; csoName?: string; cqoName?: string }): Promise<void> {
  await fetch('/api/onboarding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function fetchGenieStatus(): Promise<{ busy: boolean; task?: string; startTime?: number; away?: boolean; autoMode?: boolean; autoCount?: number }> {
  const [staffRes, awayRes] = await Promise.all([
    fetch('/api/staff'),
    fetch('/api/owner-away'),
  ]);
  const data = await staffRes.json();
  const genie = data.genie;
  const awayData = await awayRes.json();
  return { busy: genie?.busy ?? false, task: genie?.task, startTime: genie?.startTime, away: awayData?.away ?? false, autoMode: genie?.autoMode ?? false, autoCount: genie?.autoCount ?? 0 };
}

// 활동 하트비트 — 실제 사용자 조작 시 스로틀 전송. 서버가 유휴 타이머 리셋 + 자동 부재중이면 재석 복귀.
export async function sendOwnerActivity(): Promise<{ away: boolean } | null> {
  try {
    const res = await fetch('/api/owner-activity', { method: 'POST' });
    return await res.json();
  } catch {
    return null; // 하트비트 실패는 치명적이지 않음 — 조용히 무시
  }
}

export async function setOwnerAway(away: boolean): Promise<void> {
  await fetch('/api/owner-away', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ away }),
  });
}

export async function setAutoMode(enabled: boolean): Promise<void> {
  await fetch('/api/auto-mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
}

// === 동료 비서 통합 ===

export interface PartnerScope {
  canDelegate?: boolean;
  canAccessFiles?: boolean;
  allowExternalShelfShare?: boolean;
  allowedTopics?: string[];
}

export interface PartnerTokenHistoryEntry {
  rotatedAt: string;
  rotatedBy: 'us' | 'them';
  reason?: string;
  field: 'inbound' | 'outbound';
}

export interface Partner {
  id: string;
  companyName: string;
  department?: string;
  contactName: string;
  secretaryName?: string;
  contactEmail?: string;
  contactPhone?: string;
  apiUrl: string;
  inboundToken: string;          // 마스킹됨 (includeTokens=false 기본)
  outboundToken: string;
  scope?: PartnerScope;
  registeredAt: string;
  registeredBy?: string;
  active: boolean;
  tokenHistory: PartnerTokenHistoryEntry[];
  // presence: 친구 측이 우리에게 마지막으로 응답한 시각 (15분 이내면 재석 표시)
  lastSeenAt?: string;
}

export type ExternalMessageDirection = 'inbound' | 'outbound';
export type ExternalMessageStatus =
  | 'pending' | 'sent' | 'delivered' | 'received'
  | 'auto_handled' | 'awaiting_approval' | 'approved_handled'
  | 'rejected' | 'error';
export type ExternalMessageType = 'request' | 'reply' | 'notification' | 'token_update';
export type ExternalMessageClassification =
  | 'info' | 'info_with_files' | 'simple_answer' | 'delegation'
  | 'data_share' | 'financial' | 'token_update' | 'ambiguous';
export type ExternalHandlingMode = 'auto' | 'approval_required' | 'asked_owner';

export interface ExternalInjectionFlag {
  pattern: string;
  detectedAt: string;
}

export interface ExternalMessage {
  id: string;
  partnerId: string;
  threadId: string;
  direction: ExternalMessageDirection;
  senderLabel: string;
  recipientLabel: string;
  body: string;
  bodyLength: number;
  receivedAt: string;
  sentAt?: string;
  status: ExternalMessageStatus;
  messageType?: ExternalMessageType;
  classification?: ExternalMessageClassification;
  handlingMode?: ExternalHandlingMode;
  inReplyToMessageId?: string;
  injectionFlags?: ExternalInjectionFlag[];
  errorReason?: string;
  payload?: { newToken?: string; [k: string]: unknown };
  attachments?: Array<{ id: string; filename: string; mimeType: string; size: number }>;
  hidden?: boolean;
}

export async function fetchPartners(): Promise<Partner[]> {
  const res = await fetch('/api/external/partners', { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

export async function getPartner(id: string): Promise<Partner | null> {
  const res = await fetch(`/api/external/partners/${id}`, { headers: authHeaders() });
  if (!res.ok) return null;
  return res.json();
}

export interface CreatePartnerInput {
  companyName: string;
  department?: string;
  contactName: string;
  secretaryName?: string;
  contactEmail?: string;
  contactPhone?: string;
  apiUrl: string;
  scope?: PartnerScope;
}

export interface CreatePartnerResult {
  partner: Partner;
  inboundToken: string;   // 평문 (1회 노출)
  outboundToken: string;
}

export async function createPartner(input: CreatePartnerInput): Promise<CreatePartnerResult> {
  const res = await fetch('/api/external/partners', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'create failed');
  return res.json();
}

export async function updatePartner(id: string, patch: Partial<CreatePartnerInput> & { active?: boolean }): Promise<Partner> {
  const res = await fetch(`/api/external/partners/${id}`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'update failed');
  return res.json();
}

export async function deletePartner(id: string): Promise<void> {
  const res = await fetch(`/api/external/partners/${id}`, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) throw new Error((await res.json()).error || 'delete failed');
}

export async function setPartnerActive(id: string, active: boolean, reason?: string): Promise<Partner> {
  const res = await fetch(`/api/external/partners/${id}/active`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ active, reason }),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'set active failed');
  return res.json();
}

export async function rotatePartnerInboundToken(id: string, reason?: string): Promise<{ partner: Partner; inboundToken: string }> {
  const res = await fetch(`/api/external/partners/${id}/rotate-inbound-token`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'rotate failed');
  return res.json();
}

export async function rotatePartnerOutboundToken(id: string, opts?: { reason?: string; notify?: boolean }): Promise<{ partner: Partner; outboundToken: string }> {
  const res = await fetch(`/api/external/partners/${id}/rotate-outbound-token`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(opts ?? {}),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'rotate failed');
  return res.json();
}

export interface FetchExternalMessagesQuery {
  partnerId?: string;
  q?: string;
  before?: string;
  status?: ExternalMessageStatus;
  limit?: number;
  includeHidden?: boolean;
}

export async function fetchExternalMessages(query: FetchExternalMessagesQuery = {}): Promise<ExternalMessage[]> {
  const params = new URLSearchParams();
  if (query.partnerId) params.set('partnerId', query.partnerId);
  if (query.q) params.set('q', query.q);
  if (query.before) params.set('before', query.before);
  if (query.status) params.set('status', query.status);
  if (query.limit) params.set('limit', String(query.limit));
  if (query.includeHidden) params.set('includeHidden', 'true');
  const url = '/api/external/messages' + (params.toString() ? '?' + params.toString() : '');
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

export async function getExternalMessage(id: string): Promise<ExternalMessage | null> {
  const res = await fetch(`/api/external/messages/${id}`, { headers: authHeaders() });
  if (!res.ok) return null;
  return res.json();
}

export async function approveExternalMessage(id: string, reply?: string): Promise<void> {
  const res = await fetch(`/api/external/messages/${id}/approve`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ reply }),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'approve failed');
}

export async function rejectExternalMessage(id: string, reply?: string): Promise<void> {
  const res = await fetch(`/api/external/messages/${id}/reject`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ reply }),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'reject failed');
}

// 메시지 숨김/복구 (전송 여부 무관) — 동료 드로어에서 목록·뱃지에서 제외. hidden=false로 복구.
export async function setExternalMessageHidden(id: string, hidden: boolean): Promise<void> {
  const res = await fetch(`/api/external/messages/${id}/${hidden ? 'hide' : 'unhide'}`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'hide failed');
}

export async function sendOutboundTest(input: { partnerId: string; message: string; messageType?: ExternalMessageType; attachments?: Array<{ filename: string; mimeType: string; size: number; data: string }> }): Promise<{ ok: boolean; messageId: string; status: number; errorReason?: string }> {
  const res = await fetch('/api/external/outbound/test', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(input),
  });
  return res.json();
}

export async function fetchExternalUnreadCount(partnerId?: string): Promise<number> {
  const url = '/api/external/messages/unread-count' + (partnerId ? `?partnerId=${partnerId}` : '');
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) return 0;
  const data = await res.json();
  return data.count ?? 0;
}

// === Partner Request (동료 자동 등록) ===

export type PartnerRequestStatus = 'pending' | 'approved' | 'rejected' | 'expired';
export type PartnerRequestRejectReason =
  | 'out_of_scope' | 'unknown_company' | 'suspicious' | 'scope_too_broad' | 'other';

export interface PartnerRequestBodyDisk {
  companyName: string;
  contactName: string;
  contactEmail?: string;
  apiUrl: string;
  inboundToken: string;     // 마스킹됨 (디스크 저장 시)
  scope?: PartnerScope;
  message?: string;
  timestamp: string;
  requestId: string;
  callbackSecret: string;   // 마스킹됨
}

export interface PartnerRequest {
  id: string;
  receivedAt: string;
  status: PartnerRequestStatus;
  body: PartnerRequestBodyDisk;
  sourceIp: string;
  expiresAt: string;
  resolvedAt?: string;
  resolvedBy?: 'owner' | 'auto-expire';
  rejectReason?: PartnerRequestRejectReason;
  rejectReasonText?: string;
  resultDeliveredAt?: string;
  resultDeliveryAttempts?: number;
  scopeOverride?: PartnerScope;
}

export interface SendPartnerRequestInput {
  targetApiUrl: string;
}

export async function sendPartnerRequest(input: SendPartnerRequestInput): Promise<{ ok: boolean; requestId?: string; error?: string }> {
  const res = await fetch('/api/external/partner-request/send', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data?.error ?? 'send failed' };
  return { ok: true, requestId: data?.requestId };
}

export async function approvePartnerRequest(id: string, scopeOverride?: PartnerScope): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/external/partner-request/${id}/approve`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ scopeOverride }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data?.error ?? 'approve failed' };
  return { ok: true };
}

export async function rejectPartnerRequest(id: string, reason: PartnerRequestRejectReason, reasonText?: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/external/partner-request/${id}/reject`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ reason, reasonText }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data?.error ?? 'reject failed' };
  return { ok: true };
}

export async function resendPartnerRequestCallback(id: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/external/partner-request/${id}/resend-callback`, {
    method: 'POST',
    headers: authHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data?.error ?? 'resend failed' };
  return { ok: true };
}

export async function fetchPendingPartnerRequests(): Promise<PartnerRequest[]> {
  const res = await fetch('/api/external/partner-requests', { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

// 단일 친구 즉시 health ping — partner-row "↻" 버튼용.
export interface PingPartnerResult {
  ok: boolean;
  status?: number;
  responseTimeMs: number;
  error?: string;
  lastSeenAt?: string;
}
export async function pingPartner(partnerId: string): Promise<PingPartnerResult> {
  // /api/external/health-check는 사장님 인증 게이트(/api/external/*) 뒤에 있으므로 X-Approval-Token 필수.
  // (dev는 APPROVAL_RESOLVE_TOKEN 미설정 시 bypass되나, 운영에서 토큰 설정 시 누락하면 401)
  const res = await fetch('/api/external/health-check', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ partnerId }),
  });
  return res.json().catch(() => ({ ok: false, responseTimeMs: 0, error: `http_${res.status}` }));
}

// 전체 친구 강제 동기화 (10분 게이트 무시). InboxPanel 헤더 "지금 동기화" 버튼용.
export interface FriendSyncNowResult {
  ok: boolean;
  result?: {
    totalPartners: number;
    pingedOk: number;
    scheduleRequestsSent: number;
    scheduleRequestsSkipped: number;
    profilesUpdated: number;
    errors: string[];
  };
  error?: string;
}
export async function runFriendSyncNow(): Promise<FriendSyncNowResult> {
  const res = await fetch('/api/schedules/friend-sync-now', { method: 'POST' });
  return res.json().catch(() => ({ ok: false, error: `http_${res.status}` }));
}

// === URL 미리보기 (OG 메타 태그) ===

export interface UrlPreviewData {
  url: string;
  finalUrl?: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  ok: boolean;
  error?: string;
}

export async function fetchUrlPreview(url: string): Promise<UrlPreviewData> {
  const res = await fetch(`/api/url-preview?url=${encodeURIComponent(url)}`);
  if (!res.ok) return { url, ok: false, error: `http_${res.status}` };
  return res.json();
}

// === 일정(캘린더) ===

export type ScheduleColor = 'blue' | 'green' | 'red' | 'yellow' | 'violet' | 'orange';

// 알림 설정 — chat=true면 시작 minutesBefore분 전 데어스가 대화창 안내,
// toast=true면 같은 시점 우측 상단 토스트 팝업(클라이언트 전용)
export interface ScheduleNotification {
  chat?: boolean;
  toast?: boolean;
  minutesBefore?: number;
}

export interface Schedule {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  description?: string;
  location?: string;
  color?: ScheduleColor;
  owner: 'me' | string;
  createdAt: string;
  updatedAt: string;
  notification?: ScheduleNotification;
}

export interface ScheduleInput {
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  description?: string;
  location?: string;
  color?: ScheduleColor;
  notification?: ScheduleNotification;
}

export async function fetchSchedules(params: { from?: string; to?: string; owner?: 'me' | 'friends' | 'all' } = {}): Promise<Schedule[]> {
  const q = new URLSearchParams();
  if (params.from) q.set('from', params.from);
  if (params.to) q.set('to', params.to);
  if (params.owner) q.set('owner', params.owner);
  const res = await fetch(`/api/schedules${q.toString() ? `?${q.toString()}` : ''}`);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data.schedules) ? data.schedules : [];
}

export async function createSchedule(input: ScheduleInput): Promise<Schedule | null> {
  const res = await fetch('/api/schedules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.schedule ?? null;
}

export async function updateSchedule(id: string, patch: Partial<ScheduleInput>): Promise<Schedule | null> {
  const res = await fetch(`/api/schedules/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.schedule ?? null;
}

export async function deleteSchedule(id: string): Promise<boolean> {
  const res = await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
  return res.ok;
}

export async function fetchFriendSchedules(params: { from?: string; to?: string; partnerId?: string } = {}): Promise<Schedule[]> {
  const q = new URLSearchParams();
  if (params.from) q.set('from', params.from);
  if (params.to) q.set('to', params.to);
  if (params.partnerId) q.set('partnerId', params.partnerId);
  const res = await fetch(`/api/schedules/friends${q.toString() ? `?${q.toString()}` : ''}`);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data.schedules) ? data.schedules : [];
}

export interface FriendScheduleRequestResult {
  ok: boolean;
  requestId?: string;
  messageId?: string;
  error?: string;
}

export async function sendFriendScheduleRequest(input: { partnerId: string; from: string; to: string }): Promise<FriendScheduleRequestResult> {
  const res = await fetch('/api/schedules/friend-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data?.error ?? `http_${res.status}` };
  return { ok: true, requestId: data.requestId, messageId: data.messageId };
}

export type FriendScheduleRequestStatus = 'pending' | 'received' | 'expired';

export interface FriendScheduleRequestEntry {
  requestId: string;
  partnerId: string;
  from: string;
  to: string;
  sentAt: string;
  status: FriendScheduleRequestStatus;
  resolvedAt?: string;
  schedulesReceived?: number;
}

export async function fetchFriendScheduleRequests(): Promise<FriendScheduleRequestEntry[]> {
  const res = await fetch('/api/schedules/friend-requests');
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data.requests) ? data.requests : [];
}

// === Google SSO 프로필 ===

export interface MeInfo {
  enabled: boolean;        // SSO 활성 여부 (GOOGLE_CLIENT_ID/SECRET 설정 시 true)
  authenticated: boolean;  // 유효 세션 보유 여부
  email?: string | null;
  name?: string | null;
  picture?: string | null;
}

// 현재 로그인 사용자 정보. SSO 비활성이면 { enabled:false }, 미인증이면 401 → authenticated:false.
export async function fetchMe(): Promise<MeInfo> {
  try {
    const res = await fetch('/auth/me');
    if (res.status === 401) {
      // 401 + { login: "/auth/google" } → SSO 재로그인 필요
      try {
        const body = await res.clone().json();
        if (body?.login) {
          window.location.href = body.login;
          return { enabled: true, authenticated: false };
        }
      } catch { /* body 파싱 실패 시 무시 */ }
      return { enabled: true, authenticated: false };
    }
    if (!res.ok) return { enabled: true, authenticated: false };
    return res.json();
  } catch {
    return { enabled: false, authenticated: false };
  }
}

/**
 * 일반 API fetch 래퍼 — 401 + { login } 응답 감지 시 SSO 재로그인 리디렉션.
 * SSO 세션 만료 시 클라이언트가 자동으로 /auth/google로 보내야 할 API 호출에 사용.
 */
export async function apiFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401) {
    try {
      const body = await res.clone().json();
      if (body?.login) {
        window.location.href = body.login;
      }
    } catch { /* body 파싱 실패 무시 */ }
  }
  return res;
}

// === 자료실 편집 ===

export type FileEditBase = 'history' | 'reports' | 'config';

export interface FileEditLoadResult {
  ok: boolean;
  content?: string;
  mtime?: string;
  error?: string;
}

// 자료실 파일 원본 + Last-Modified mtime을 함께 fetch. PUT의 If-Match 헤더 값으로 mtime을 보관.
export async function loadFileForEdit(base: FileEditBase, subpath: string): Promise<FileEditLoadResult> {
  try {
    const url = `/api/files/download/${base}/${subpath.split('/').map(encodeURIComponent).join('/')}`;
    const res = await fetch(url);
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    const content = await res.text();
    const mtime = res.headers.get('Last-Modified') ?? undefined;
    return { ok: true, content, mtime };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'load failed' };
  }
}

export interface FileEditSaveResult {
  ok: boolean;
  mtime?: string;
  error?: string;
  conflictMtime?: string;
}

// 자료실 파일 저장. ifMatch는 loadFileForEdit에서 받은 mtime 그대로 전달.
// 서버 mtime과 다르면 409 → conflictMtime 반환 → 호출자가 사용자에게 충돌 안내.
export async function saveFileContent(
  base: FileEditBase,
  subpath: string,
  content: string,
  ifMatch?: string,
): Promise<FileEditSaveResult> {
  try {
    const url = `/api/files/edit/${base}/${subpath.split('/').map(encodeURIComponent).join('/')}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (ifMatch) headers['If-Match'] = ifMatch;
    const res = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ content }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409) return { ok: false, error: 'etag mismatch', conflictMtime: data?.currentMtime };
    if (!res.ok) return { ok: false, error: data?.error ?? `http_${res.status}` };
    return { ok: true, mtime: data?.mtime };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'save failed' };
  }
}

// === Config Editor ===

export interface ConfigFileEntry {
  relPath: string;
  size: number;
  mtime: number;
}

export async function listConfigFiles(): Promise<ConfigFileEntry[]> {
  const res = await fetch('/api/config/files');
  if (!res.ok) return [];
  const data = await res.json();
  return (data.files ?? []) as ConfigFileEntry[];
}

export async function rollbackConfig(): Promise<{ ok: boolean; restoredFiles: number; error?: string }> {
  const res = await fetch('/api/config/rollback', { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, restoredFiles: 0, error: data.error ?? `http_${res.status}` };
  return { ok: true, restoredFiles: data.restoredFiles ?? 0 };
}

// === Service Policies ===
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

export interface ToolApprovalEvent {
  type: "request" | "resolved" | "timeout";
  id?: string;
  requestId?: string;
  serviceId?: string;
  serviceLabel?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  humanReadableDesc?: string;
  requestedAt?: number;
  timeoutMs?: number;
  decision?: "approve" | "reject";
}

export async function listServicePolicies(): Promise<ServicePolicy[]> {
  const res = await fetch("/api/service-policies");
  if (!res.ok) return [];
  const data = await res.json();
  return data.services ?? [];
}

export async function patchServicePolicy(
  id: string,
  patch: { enabled?: boolean; readPolicy?: PolicyMode; writePolicy?: PolicyMode },
): Promise<{ ok: boolean; service?: ServicePolicy; error?: string }> {
  const res = await fetch(`/api/service-policies/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error ?? `http_${res.status}` };
  return { ok: true, service: data.service ?? data.policy };
}

export async function respondToolApproval(
  requestId: string,
  decision: "approve" | "reject",
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/tool-approval/${encodeURIComponent(requestId)}/respond`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error ?? `http_${res.status}` };
  return { ok: true };
}

// === Key Vault ===

export type KeyScope = 'client' | 'server';

export interface KeyEntry {
  id: string;
  label: string;
  envName?: string;
  scope: KeyScope;
  masked: string;
  hasValue: boolean;
  prefix?: string;
}

export async function fetchKeys(): Promise<KeyEntry[]> {
  const res = await fetch('/api/keys');
  if (!res.ok) return [];
  const data = await res.json();
  return data.keys ?? [];
}

export async function saveKey(id: string, value: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/keys/${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error };
  return { ok: true };
}

export async function deleteKey(id: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/keys/${encodeURIComponent(id)}`, { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error };
  return { ok: true };
}

// === 앱 연동 마법사 ===

export interface IntegrationFieldStatus {
  envName: string;
  label: string;
  required: boolean;
  secret: boolean;
  placeholder?: string;
  hasValue: boolean;
  masked: string;
}

export interface IntegrationStatus {
  appId: string;
  appName: string;
  summary: string;
  docsUrl: string;
  steps: string[];
  note?: string;
  fields: IntegrationFieldStatus[];
  configured: boolean;
}

export async function fetchAppIntegrations(): Promise<IntegrationStatus[]> {
  const res = await fetch('/api/app-integrations');
  if (!res.ok) return [];
  const data = await res.json();
  return data.integrations ?? [];
}

export async function saveAppIntegration(
  appId: string,
  values: Record<string, string>,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/app-integrations/${encodeURIComponent(appId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error };
  return { ok: true };
}

export async function restartIntegrationApp(appId: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/app-integrations/${encodeURIComponent(appId)}/restart`, { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error };
  return { ok: true };
}

// === 연락처 (마이크루 연락처) ===

export type ContactSource = 'photo' | 'camera' | 'manual';

export interface Contact {
  id: string;
  name: string;
  phone?: string;
  phones?: string[];
  email?: string;
  emails?: string[];
  company?: string;
  department?: string;
  position?: string;
  address?: string;
  memo?: string;
  labels: string[];
  favorite: boolean;
  source: ContactSource;
  sourcePhotoSha?: string;
  ocrConfidence?: number;
  createdAt: string;
  updatedAt: string;
}

export type ContactSort = 'name' | 'recent' | 'company';

export interface ContactsQuery {
  q?: string;
  label?: string;
  company?: string;
  favoriteOnly?: boolean;
  source?: ContactSource;
  sort?: ContactSort;
}

export interface ContactDraft {
  name?: string;
  phone?: string;
  phones?: string[];
  email?: string;
  emails?: string[];
  company?: string;
  department?: string;
  position?: string;
  address?: string;
  memo?: string;
  labels?: string[];
  favorite?: boolean;
  source?: ContactSource;
  sourcePhotoSha?: string;
  ocrConfidence?: number;
}

export interface ContactStats {
  total: number;
  favorites: number;
  bySource: Record<ContactSource, number>;
}

export async function fetchContacts(query: ContactsQuery = {}): Promise<Contact[]> {
  const q = new URLSearchParams();
  if (query.q) q.set('q', query.q);
  if (query.label) q.set('label', query.label);
  if (query.company) q.set('company', query.company);
  if (query.favoriteOnly) q.set('favoriteOnly', 'true');
  if (query.source) q.set('source', query.source);
  if (query.sort) q.set('sort', query.sort);
  const url = '/api/contacts' + (q.toString() ? `?${q.toString()}` : '');
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data.contacts) ? data.contacts : [];
}

export async function createContact(input: ContactDraft): Promise<Contact | null> {
  const res = await fetch('/api/contacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.contact ?? null;
}

export async function updateContact(id: string, patch: ContactDraft): Promise<Contact | null> {
  const res = await fetch(`/api/contacts/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.contact ?? null;
}

export async function deleteContact(id: string): Promise<boolean> {
  const res = await fetch(`/api/contacts/${id}`, { method: 'DELETE' });
  return res.ok;
}

export async function toggleContactFavorite(id: string): Promise<Contact | null> {
  const res = await fetch(`/api/contacts/${id}/favorite`, { method: 'POST' });
  if (!res.ok) return null;
  const data = await res.json();
  return data.contact ?? null;
}

export async function postContactOcr(file: File): Promise<Contact | null> {
  const form = new FormData();
  form.append('image', file);
  const res = await fetch('/api/contacts/ocr', { method: 'POST', body: form });
  if (!res.ok) return null;
  const data = await res.json();
  return data.contact ?? null;
}

export async function fetchContactsLabels(): Promise<string[]> {
  const res = await fetch('/api/contacts/labels');
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data.labels) ? data.labels : [];
}

export async function fetchContactsCompanies(): Promise<string[]> {
  const res = await fetch('/api/contacts/companies');
  if (!res.ok) return [];
  const data = await res.json();
  if (!Array.isArray(data.companies)) return [];
  // server returns { company, count }[] — extract string names
  return data.companies.map((c: any) => (typeof c === 'string' ? c : c.company)).filter(Boolean);
}

export async function fetchContactsStats(): Promise<ContactStats | null> {
  const res = await fetch('/api/contacts/stats');
  if (!res.ok) return null;
  return res.json();
}
