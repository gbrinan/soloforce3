/**
 * Typed API client for MySign frontend.
 * All functions call internal Next.js API routes via fetch().
 */

// mycrew iframe 프록시(basePath) 하위에서 동작하므로 내부 API 호출도 같은 프리픽스를 거쳐야
// 호스트(동일출처)→프록시→이 앱으로 라우팅된다. 직접 :13202 접근 시엔 빈 문자열로 동작.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";
const API_BASE = `${BASE_PATH}/api/v1`;
const NOTIFY_BASE = `${BASE_PATH}/api/notifications`;
const BAROCERT_BASE = `${BASE_PATH}/api/barocert`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiListResponse<T> {
  data: T[];
  pagination: PaginationMeta;
}

export interface ApiSingleResponse<T> {
  data: T;
}

export interface ApiErrorBody {
  error: string;
  details?: unknown;
}

export interface TemplateDTO {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  author: { id: string; firstName: string | null; email: string } | null;
  folder: { id: string; name: string } | null;
  _count: { submissions: number };
}

export interface SubmitterDTO {
  id: string;
  slug?: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  completedAt: string | null;
  verificationMethod: string | null;
  verifiedAt: string | null;
}

export interface SubmissionEventDTO {
  id: string;
  eventType: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface SubmissionDTO {
  id: string;
  slug?: string;
  status: string;
  createdAt: string;
  expiresAt: string | null;
  completedAt?: string | null;
  template: { id: string; name: string } | null;
  createdBy: { id: string; firstName: string | null; email: string } | null;
  submitters: SubmitterDTO[];
  submissionEvents?: SubmissionEventDTO[];
}

export interface NotificationRequest {
  type: "signing_request" | "signing_reminder" | "signing_complete";
  channel: "email" | "kakao" | "sms";
  recipient: {
    name: string;
    email?: string;
    phone?: string;
  };
  data: {
    senderName: string;
    documentName: string;
    signingUrl?: string;
    downloadUrl?: string;
    expiresAt?: string;
    message?: string;
  };
}

export interface VerificationRequest {
  provider: "kakao" | "naver" | "toss";
  type: "identity" | "sign";
  receiverInfo: {
    receiverHP: string;
    receiverName: string;
    receiverBirthday: string;
  };
  token?: string;
  reqTitle?: string;
  reqMessage?: string;
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  status: number;
  body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  const json = await res.json();

  if (!res.ok) {
    throw new ApiError(res.status, json as ApiErrorBody);
  }

  return json as T;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export interface DashboardStatsDTO {
  totalTemplates: number;
  pendingSignatures: number;
  completedSignatures: number;
  monthlySignatures: number;
}

export async function fetchDashboardStats(): Promise<DashboardStatsDTO> {
  return request<DashboardStatsDTO>(`${API_BASE}/dashboard/stats`);
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export async function fetchTemplates(params?: {
  page?: number;
  limit?: number;
  search?: string;
  folderId?: string;
}): Promise<ApiListResponse<TemplateDTO>> {
  const sp = new URLSearchParams();
  if (params?.page) sp.set("page", String(params.page));
  if (params?.limit) sp.set("limit", String(params.limit));
  if (params?.search) sp.set("search", params.search);
  if (params?.folderId) sp.set("folderId", params.folderId);

  return request<ApiListResponse<TemplateDTO>>(
    `${API_BASE}/templates?${sp.toString()}`
  );
}

export async function fetchTemplate(
  id: string
): Promise<ApiSingleResponse<TemplateDTO>> {
  return request<ApiSingleResponse<TemplateDTO>>(
    `${API_BASE}/templates/${id}`
  );
}

export async function createTemplate(data: {
  name: string;
  folderId?: string;
}): Promise<ApiSingleResponse<TemplateDTO>> {
  return request<ApiSingleResponse<TemplateDTO>>(`${API_BASE}/templates`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteTemplate(
  id: string
): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`${API_BASE}/templates/${id}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export interface FolderDTO {
  id: string;
  name: string;
  createdAt: string;
  _count: { templates: number };
}

export async function fetchFolders(): Promise<{ data: FolderDTO[] }> {
  return request<{ data: FolderDTO[] }>(`${API_BASE}/folders`);
}

export interface TemplateSharingDTO {
  id: string;
  slug: string;
  submitters: unknown;
  expiresAt: string | null;
  createdAt: string;
  templateId: string;
}

export async function fetchTemplateSharing(
  templateId: string
): Promise<ApiSingleResponse<TemplateSharingDTO>> {
  return request<ApiSingleResponse<TemplateSharingDTO>>(
    `${API_BASE}/templates/${templateId}/sharing`
  );
}

export async function createFolder(data: {
  name: string;
  parentFolderId?: string;
}): Promise<ApiSingleResponse<FolderDTO>> {
  return request<ApiSingleResponse<FolderDTO>>(`${API_BASE}/folders`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------

export async function fetchSubmissions(params?: {
  page?: number;
  limit?: number;
  status?: string;
}): Promise<ApiListResponse<SubmissionDTO>> {
  const sp = new URLSearchParams();
  if (params?.page) sp.set("page", String(params.page));
  if (params?.limit) sp.set("limit", String(params.limit));
  if (params?.status) sp.set("status", params.status);

  return request<ApiListResponse<SubmissionDTO>>(
    `${API_BASE}/submissions?${sp.toString()}`
  );
}

export async function fetchSubmission(
  id: string
): Promise<ApiSingleResponse<SubmissionDTO>> {
  return request<ApiSingleResponse<SubmissionDTO>>(
    `${API_BASE}/submissions/${id}`
  );
}

export interface CreateSubmissionRequest {
  templateId: string;
  submitterOrder?: "RANDOM" | "SEQUENTIAL";
  expiresAt?: string;
  submitters: Array<{
    name: string;
    email?: string;
    phone?: string;
    role?: string;
    notificationChannel?: "email" | "kakao" | "sms";
    verificationMethod?:
      | "NONE"
      | "EMAIL"
      | "SMS"
      | "KAKAO_CERT"
      | "NAVER_CERT"
      | "TOSS_CERT";
  }>;
}

export async function createSubmission(
  data: CreateSubmissionRequest
): Promise<ApiSingleResponse<SubmissionDTO>> {
  return request<ApiSingleResponse<SubmissionDTO>>(
    `${API_BASE}/submissions`,
    {
      method: "POST",
      body: JSON.stringify(data),
    }
  );
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export async function sendNotification(
  data: NotificationRequest
): Promise<{ success: boolean; channel: string; message: string; id?: string }> {
  return request<{
    success: boolean;
    channel: string;
    message: string;
    id?: string;
  }>(NOTIFY_BASE, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ---------------------------------------------------------------------------
// Booking - Event Types
// ---------------------------------------------------------------------------

export interface EventTypeDTO {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  duration: number;
  locations: unknown;
  color: string | null;
  hidden: boolean;
  requiresConfirmation: boolean;
  minimumNotice: number;
  bufferBefore: number;
  bufferAfter: number;
  slotInterval: number | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  user: { id: string; firstName: string | null; email: string } | null;
  _count: { bookings: number };
}

export async function fetchEventTypes(params?: {
  page?: number;
  limit?: number;
}): Promise<ApiListResponse<EventTypeDTO>> {
  const sp = new URLSearchParams();
  if (params?.page) sp.set("page", String(params.page));
  if (params?.limit) sp.set("limit", String(params.limit));
  return request<ApiListResponse<EventTypeDTO>>(
    `${API_BASE}/event-types?${sp.toString()}`
  );
}

export async function fetchEventType(
  id: string
): Promise<ApiSingleResponse<EventTypeDTO>> {
  return request<ApiSingleResponse<EventTypeDTO>>(
    `${API_BASE}/event-types/${id}`
  );
}

export async function createEventType(data: {
  title: string;
  slug: string;
  description?: string;
  duration?: number;
  locations?: unknown;
  color?: string;
  requiresConfirmation?: boolean;
  minimumNotice?: number;
  scheduleId?: string;
}): Promise<ApiSingleResponse<EventTypeDTO>> {
  return request<ApiSingleResponse<EventTypeDTO>>(`${API_BASE}/event-types`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateEventType(
  id: string,
  data: Partial<{
    title: string;
    slug: string;
    description: string;
    duration: number;
    locations: unknown;
    color: string;
    hidden: boolean;
    requiresConfirmation: boolean;
    minimumNotice: number;
    bufferBefore: number;
    bufferAfter: number;
    slotInterval: number;
    scheduleId: string;
  }>
): Promise<ApiSingleResponse<EventTypeDTO>> {
  return request<ApiSingleResponse<EventTypeDTO>>(
    `${API_BASE}/event-types/${id}`,
    { method: "PATCH", body: JSON.stringify(data) }
  );
}

export async function deleteEventType(
  id: string
): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`${API_BASE}/event-types/${id}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Booking - Schedules
// ---------------------------------------------------------------------------

export interface AvailabilityDTO {
  id: string;
  days: number[];
  startTime: string;
  endTime: string;
  date: string | null;
}

export interface ScheduleDTO {
  id: string;
  name: string;
  timeZone: string;
  isDefault: boolean;
  createdAt: string;
  availabilities: AvailabilityDTO[];
}

export async function fetchSchedules(): Promise<{ data: ScheduleDTO[] }> {
  return request<{ data: ScheduleDTO[] }>(`${API_BASE}/schedules`);
}

export async function createSchedule(data: {
  name: string;
  timeZone?: string;
  isDefault?: boolean;
  availabilities?: Array<{
    days: number[];
    startTime: string;
    endTime: string;
  }>;
}): Promise<ApiSingleResponse<ScheduleDTO>> {
  return request<ApiSingleResponse<ScheduleDTO>>(`${API_BASE}/schedules`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateSchedule(
  id: string,
  data: Partial<{
    name: string;
    timeZone: string;
    isDefault: boolean;
    availabilities: Array<{
      days: number[];
      startTime: string;
      endTime: string;
      date?: string;
    }>;
  }>
): Promise<ApiSingleResponse<ScheduleDTO>> {
  return request<ApiSingleResponse<ScheduleDTO>>(`${API_BASE}/schedules/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

// ---------------------------------------------------------------------------
// Booking - Bookings
// ---------------------------------------------------------------------------

export interface BookingAttendeeDTO {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  timeZone: string;
}

export interface BookingDTO {
  id: string;
  uid: string;
  title: string;
  startTime: string;
  endTime: string;
  status: string;
  location: string | null;
  description: string | null;
  cancellationReason: string | null;
  createdAt: string;
  eventType: { id: string; title: string; slug: string; duration: number } | null;
  user: { id: string; firstName: string | null; email: string } | null;
  attendees: BookingAttendeeDTO[];
}

export async function fetchBookings(params?: {
  page?: number;
  limit?: number;
  status?: string;
  period?: "upcoming" | "past" | "today";
}): Promise<ApiListResponse<BookingDTO>> {
  const sp = new URLSearchParams();
  if (params?.page) sp.set("page", String(params.page));
  if (params?.limit) sp.set("limit", String(params.limit));
  if (params?.status) sp.set("status", params.status);
  if (params?.period) sp.set("period", params.period);
  return request<ApiListResponse<BookingDTO>>(
    `${API_BASE}/bookings?${sp.toString()}`
  );
}

export async function fetchBooking(
  id: string
): Promise<ApiSingleResponse<BookingDTO>> {
  return request<ApiSingleResponse<BookingDTO>>(`${API_BASE}/bookings/${id}`);
}

export async function cancelBooking(
  id: string,
  reason?: string
): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`${API_BASE}/bookings/${id}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

// ---------------------------------------------------------------------------
// Booking - Dashboard Stats
// ---------------------------------------------------------------------------

export interface BookingStatsDTO {
  totalBookings: number;
  upcomingBookings: number;
  completedBookings: number;
  todayBookings: number;
}

export async function fetchBookingStats(): Promise<BookingStatsDTO> {
  return request<BookingStatsDTO>(`${API_BASE}/bookings/stats`);
}

// ---------------------------------------------------------------------------
// Booking - Availability Slots (public)
// ---------------------------------------------------------------------------

export async function fetchAvailableSlots(params: {
  eventTypeId: string;
  date: string; // YYYY-MM-DD
  timeZone?: string;
}): Promise<{ slots: string[] }> {
  const sp = new URLSearchParams({
    eventTypeId: params.eventTypeId,
    date: params.date,
  });
  if (params.timeZone) sp.set("timeZone", params.timeZone);
  return request<{ slots: string[] }>(
    `${API_BASE}/availability?${sp.toString()}`
  );
}

export async function createPublicBooking(data: {
  eventTypeId: string;
  startTime: string;
  attendee: {
    name: string;
    email: string;
    phone?: string;
    timeZone?: string;
    notes?: string;
  };
}): Promise<ApiSingleResponse<BookingDTO>> {
  return request<ApiSingleResponse<BookingDTO>>(`${API_BASE}/bookings/public`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ---------------------------------------------------------------------------
// Verification (Barocert)
// ---------------------------------------------------------------------------

export async function requestVerification(
  data: VerificationRequest
): Promise<{ receiptID: string; provider: string; type: string }> {
  return request<{ receiptID: string; provider: string; type: string }>(
    BAROCERT_BASE,
    {
      method: "POST",
      body: JSON.stringify(data),
    }
  );
}

export async function checkVerification(
  receiptId: string,
  provider: string,
  type: string = "identity",
  verify: boolean = false
): Promise<{ status: unknown; result?: unknown }> {
  const sp = new URLSearchParams({
    receiptId,
    provider,
    type,
    ...(verify && { verify: "true" }),
  });

  return request<{ status: unknown; result?: unknown }>(
    `${BAROCERT_BASE}?${sp.toString()}`
  );
}
