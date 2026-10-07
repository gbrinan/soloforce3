// 동료 outbound HTTP 클라이언트.
// fire-and-forget 패턴: 10초 timeout, 5xx/네트워크 에러 시 30초 후 1회 재시도.
// 본문 길이 제한 + 메시지 영속 + 감사 로그.

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";
import { getPartnerWithTokens, validateApiUrl } from "./partners.js";
import { appendMessage, updateMessage } from "./external-messages.js";
import { HISTORY_DIR } from "../config.js";
import { auditEvent } from "./external-audit.js";
import { emitGlobalEvent } from "./jobs.js";
import { MAX_BODY_LENGTH } from "./external-rate-limit.js";
import type {
  ExternalMessageType,
  ExternalMessagePayload,
  PartnerRequestBody,
  PartnerRequestCallback,
  PartnerRequestImmediateResponse,
} from "../types.js";

const REQUEST_TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 30_000;
const USER_AGENT = "mycrew/1.0";

export interface SendExternalOptions {
  inReplyToMessageId?: string;
  messageType?: ExternalMessageType;
  payload?: ExternalMessagePayload;
  ourLabel?: string;
  attachments?: Array<{ filename: string; mimeType: string; size: number; data: string }>;  // data = base64
}

export interface SendExternalResult {
  ok: boolean;
  messageId: string;
  status: number;
  errorReason?: string;
}

async function postOnce(url: string, token: string, body: unknown): Promise<{ status: number; ok: boolean; bodyText: string } | { error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text().catch(() => "");
    return { status: res.status, ok: res.ok, bodyText: text.slice(0, 500) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export async function sendExternal(
  partnerId: string,
  body: string,
  opts: SendExternalOptions = {},
): Promise<SendExternalResult> {
  const partner = getPartnerWithTokens(partnerId);
  if (!partner) {
    return { ok: false, messageId: "", status: 0, errorReason: "partner not found" };
  }
  if (!partner.active) {
    return { ok: false, messageId: "", status: 0, errorReason: "partner inactive" };
  }
  if (body.length > MAX_BODY_LENGTH) {
    return { ok: false, messageId: "", status: 0, errorReason: `body exceeds ${MAX_BODY_LENGTH} chars` };
  }

  // 메시지 영속 (status=pending)
  const ourLabel = opts.ourLabel || "우리 비서";
  const recipientLabel = partner.companyName + (partner.contactName ? ` ${partner.contactName}` : "");
  const stored = appendMessage({
    partnerId,
    threadId: partnerId,
    direction: "outbound",
    senderLabel: ourLabel,
    recipientLabel,
    body,
    status: "pending",
    messageType: opts.messageType ?? "request",
    inReplyToMessageId: opts.inReplyToMessageId,
    payload: opts.payload,
    attachments: opts.attachments?.map(a => {
      const id = randomUUID().slice(0, 8);
      const safeName = a.filename.replace(/[^a-zA-Z0-9가-힣._-]/g, "_").slice(0, 100);
      const dir = join(HISTORY_DIR, "external", "attachments");
      mkdirSync(dir, { recursive: true });
      const storagePath = join(dir, `${id}_${safeName}`);
      try { writeFileSync(storagePath, Buffer.from(a.data, "base64")); } catch { /* skip */ }
      return { id, filename: a.filename, mimeType: a.mimeType, size: a.size, storagePath };
    }),
    sentAt: new Date().toISOString(),
  });
  emitGlobalEvent("external-message", {
    op: "create",
    message: stored,
    partner: { id: partner.id, companyName: partner.companyName, contactName: partner.contactName },
  });

  const url = `${partner.apiUrl}/api/external/inbound`;
  const httpBody = {
    sender: ourLabel,
    message: body,
    timestamp: new Date().toISOString(),
    messageType: opts.messageType ?? "request",
    ...(opts.payload ? { payload: opts.payload } : {}),
    ...(opts.inReplyToMessageId ? { inReplyToMessageId: opts.inReplyToMessageId } : {}),
    ...(opts.attachments?.length ? { attachments: opts.attachments } : {}),
  };

  const tryDeliver = async (attempt: number): Promise<{ ok: boolean; status: number; errorReason?: string }> => {
    const r = await postOnce(url, partner.outboundToken, httpBody);
    if ("error" in r) {
      return { ok: false, status: 0, errorReason: `network: ${r.error}` };
    }
    if (r.ok || (r.status >= 200 && r.status < 300)) {
      return { ok: true, status: r.status };
    }
    // 401/403/4xx (기타) → 재시도 안 함
    if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) {
      return { ok: false, status: r.status, errorReason: `http ${r.status}: ${r.bodyText}` };
    }
    // 408/429/5xx → attempt 0이면 재시도
    if (attempt === 0) {
      await new Promise((res) => setTimeout(res, RETRY_DELAY_MS));
      return tryDeliver(1);
    }
    return { ok: false, status: r.status, errorReason: `http ${r.status} (after retry): ${r.bodyText}` };
  };

  const result = await tryDeliver(0);

  if (result.ok) {
    updateMessage(stored.id, { status: "sent" });
    emitGlobalEvent("external-message", { op: "update", message: { ...stored, status: "sent" }, partner: { id: partner.id, companyName: partner.companyName, contactName: partner.contactName } });
    auditEvent({ type: "outbound_sent", partnerId, messageId: stored.id, detail: { httpStatus: result.status, messageType: opts.messageType } });
    return { ok: true, messageId: stored.id, status: result.status };
  } else {
    updateMessage(stored.id, { status: "error", errorReason: result.errorReason });
    emitGlobalEvent("external-message", { op: "update", message: { ...stored, status: "error", errorReason: result.errorReason }, partner: { id: partner.id, companyName: partner.companyName, contactName: partner.contactName } });
    auditEvent({
      type: "outbound_failed",
      partnerId,
      messageId: stored.id,
      detail: { httpStatus: result.status, errorReason: result.errorReason, messageType: opts.messageType },
    });
    return { ok: false, messageId: stored.id, status: result.status, errorReason: result.errorReason };
  }
}

// ===== partner-request helper =====
// 외부 공개 라우트로 partner-request 발신. Bearer 없음 (공개 API).
export async function sendPartnerRequest(
  targetApiUrl: string,
  body: PartnerRequestBody,
): Promise<{ ok: boolean; status: number; response?: PartnerRequestImmediateResponse; errorReason?: string }> {
  try {
    validateApiUrl(targetApiUrl);
  } catch (err) {
    return { ok: false, status: 0, errorReason: `invalid targetApiUrl: ${err instanceof Error ? err.message : String(err)}` };
  }
  const url = `${targetApiUrl.replace(/\/+$/, "")}/api/external/partner-request`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      // ngrok-skip-browser-warning: ngrok-free.dev 인터스티셜 HTML 응답 방지 (서버측 UA는 비-브라우저지만 명시).
      headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT, "ngrok-skip-browser-warning": "true" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let parsed: PartnerRequestImmediateResponse | undefined;
    try { parsed = await res.json() as PartnerRequestImmediateResponse; } catch { /* */ }
    if (res.ok) {
      return { ok: true, status: res.status, response: parsed };
    }
    return { ok: false, status: res.status, response: parsed, errorReason: parsed?.error ?? `http ${res.status}` };
  } catch (err) {
    return { ok: false, status: 0, errorReason: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

// 콜백 송신: X-Partner-Request-Callback-Secret 헤더 + 재시도 1회.
// 재시도 delay는 envvar MYCREW_PARTNER_REQUEST_CALLBACK_RETRY_DELAY_MS (기본 30000ms).
// 재시도 trigger: HTTP 4xx 외 (네트워크 에러 / 408 / 429 / 5xx).
export async function sendPartnerRequestCallback(
  targetApiUrl: string,
  callback: PartnerRequestCallback,
  callbackSecret: string,
): Promise<{ ok: boolean; status: number; errorReason?: string; attempts: number }> {
  const url = `${targetApiUrl.replace(/\/+$/, "")}/api/external/partner-request-result`;
  const retryDelayMs = parseInt(process.env.MYCREW_PARTNER_REQUEST_CALLBACK_RETRY_DELAY_MS ?? "30000", 10);

  const tryOnce = async (): Promise<{ status: number; ok: boolean; transient: boolean; errorReason?: string }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT,
          "X-Partner-Request-Callback-Secret": callbackSecret,
        },
        body: JSON.stringify(callback),
        signal: controller.signal,
      });
      await res.arrayBuffer().catch(() => {}); // body drain: keep-alive 소켓 fd 누수 방지
      if (res.ok) return { status: res.status, ok: true, transient: false };
      // 4xx (408/429 제외)는 재시도 안 함
      const transient = res.status === 408 || res.status === 429 || res.status >= 500;
      return { status: res.status, ok: false, transient, errorReason: `http ${res.status}` };
    } catch (err) {
      return { status: 0, ok: false, transient: true, errorReason: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }
  };

  const r1 = await tryOnce();
  if (r1.ok) return { ok: true, status: r1.status, attempts: 1 };
  if (!r1.transient) return { ok: false, status: r1.status, errorReason: r1.errorReason, attempts: 1 };
  // 재시도
  await new Promise((res) => setTimeout(res, retryDelayMs));
  const r2 = await tryOnce();
  if (r2.ok) return { ok: true, status: r2.status, attempts: 2 };
  return { ok: false, status: r2.status, errorReason: r2.errorReason ?? r1.errorReason, attempts: 2 };
}

