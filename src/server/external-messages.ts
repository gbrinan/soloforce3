// 외부 메시지 저장소 (JSONL append-only, 일별 파일 회전).
// 디렉토리: history/external/messages/messages-YYYY-MM-DD.jsonl
// 메모리 캐시: 최근 7일 + status 변경은 별도 status-update 라인 append (replay로 합성).

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { HISTORY_DIR, toKstDate } from "../config.js";
import type {
  ExternalMessage,
  ExternalMessageStatus,
  ExternalMessageDirection,
  ExternalMessageType,
  ExternalMessageClassification,
  ExternalHandlingMode,
  ExternalInjectionFlag,
  ExternalMessagePayload,
  ExternalAttachment,
} from "../types.js";

const MESSAGES_DIR = join(HISTORY_DIR, "external", "messages");
const RETENTION_DAYS = 7;

let cache: Map<string, ExternalMessage> = new Map();
let order: string[] = []; // 시간순 id 배열
let initialized = false;

function ensureDir(): void {
  if (!existsSync(MESSAGES_DIR)) mkdirSync(MESSAGES_DIR, { recursive: true });
}

function fileForDate(dateStr: string): string {
  return join(MESSAGES_DIR, `messages-${dateStr}.jsonl`);
}

function appendLine(date: string, op: "create" | "update", payload: Record<string, unknown>): void {
  ensureDir();
  const file = fileForDate(date);
  const line = JSON.stringify({ op, ...payload }) + "\n";
  try {
    appendFileSync(file, line, "utf-8");
  } catch (err) {
    console.error("[ExternalMessages] append 실패:", err);
  }
}

export function loadMessages(): void {
  if (initialized) return;
  ensureDir();
  cache = new Map();
  order = [];
  let files: string[] = [];
  try {
    files = readdirSync(MESSAGES_DIR)
      .filter((f) => f.startsWith("messages-") && f.endsWith(".jsonl"))
      .sort();
  } catch { /* dir 없음 */ }

  // 최근 RETENTION_DAYS만 로드
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const cutoffStr = toKstDate(cutoff);
  const recent = files.filter((f) => {
    const m = /messages-(\d{4}-\d{2}-\d{2})\.jsonl/.exec(f);
    return m ? m[1] >= cutoffStr : false;
  });

  for (const f of recent) {
    let content: string;
    try { content = readFileSync(join(MESSAGES_DIR, f), "utf-8"); }
    catch { continue; }
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      let evt: Record<string, unknown>;
      try { evt = JSON.parse(line); } catch { continue; }
      const op = evt.op as string;
      const id = evt.id as string;
      if (!id) continue;
      if (op === "create") {
        const msg = evt.message as ExternalMessage;
        if (msg && msg.id === id) {
          cache.set(id, msg);
          order.push(id);
        }
      } else if (op === "update") {
        const existing = cache.get(id);
        if (existing) {
          const patch = evt.patch as Partial<ExternalMessage>;
          Object.assign(existing, patch);
        }
      }
    }
  }
  // order는 시간순으로 정렬 (receivedAt 기준)
  order.sort((a, b) => {
    const ta = cache.get(a)?.receivedAt ?? "";
    const tb = cache.get(b)?.receivedAt ?? "";
    return ta.localeCompare(tb);
  });
  initialized = true;
  console.log(`[ExternalMessages] 부팅 복원: ${cache.size}건 (최근 ${RETENTION_DAYS}일)`);
}

export interface CreateMessageInput {
  partnerId: string;
  threadId?: string;
  direction: ExternalMessageDirection;
  senderLabel: string;
  recipientLabel: string;
  body: string;
  status: ExternalMessageStatus;
  messageType?: ExternalMessageType;
  classification?: ExternalMessageClassification;
  handlingMode?: ExternalHandlingMode;
  inReplyToMessageId?: string;
  injectionFlags?: ExternalInjectionFlag[];
  payload?: ExternalMessagePayload;
  sentAt?: string;
  attachments?: ExternalAttachment[];
}

export function appendMessage(input: CreateMessageInput): ExternalMessage {
  loadMessages();
  const now = new Date().toISOString();
  const msg: ExternalMessage = {
    id: randomUUID(),
    partnerId: input.partnerId,
    threadId: input.threadId ?? input.partnerId,
    direction: input.direction,
    senderLabel: input.senderLabel,
    recipientLabel: input.recipientLabel,
    body: input.body,
    bodyLength: input.body.length,
    receivedAt: now,
    sentAt: input.sentAt,
    status: input.status,
    messageType: input.messageType,
    classification: input.classification,
    handlingMode: input.handlingMode,
    inReplyToMessageId: input.inReplyToMessageId,
    injectionFlags: input.injectionFlags,
    payload: input.payload,
    attachments: input.attachments,
  };
  cache.set(msg.id, msg);
  order.push(msg.id);
  appendLine(toKstDate(new Date(now)), "create", { id: msg.id, message: msg });
  return msg;
}

export function updateMessage(id: string, patch: Partial<ExternalMessage>): ExternalMessage | undefined {
  loadMessages();
  const existing = cache.get(id);
  if (!existing) return undefined;
  Object.assign(existing, patch);
  appendLine(toKstDate(new Date(existing.receivedAt)), "update", { id, patch });
  return existing;
}

export function getMessage(id: string): ExternalMessage | undefined {
  loadMessages();
  return cache.get(id);
}

export interface ListMessagesQuery {
  partnerId?: string;
  q?: string;
  before?: string; // ISO timestamp — 이 시각 이전(오래된)
  limit?: number;
  status?: ExternalMessageStatus;
  includeHidden?: boolean; // true면 숨긴 메시지도 포함 (기본 제외)
}

export function listMessages(query: ListMessagesQuery = {}): ExternalMessage[] {
  loadMessages();
  const limit = Math.min(query.limit ?? 50, 200);
  const items: ExternalMessage[] = [];
  // order는 오름차순 → 최근부터 보려면 역순 순회
  for (let i = order.length - 1; i >= 0; i--) {
    const m = cache.get(order[i]);
    if (!m) continue;
    if (m.hidden && !query.includeHidden) continue; // 숨긴 메시지는 기본 제외
    if (query.partnerId && m.partnerId !== query.partnerId) continue;
    if (query.status && m.status !== query.status) continue;
    if (query.before && m.receivedAt >= query.before) continue;
    if (query.q) {
      const q = query.q.toLowerCase();
      if (!m.body.toLowerCase().includes(q) && !m.senderLabel.toLowerCase().includes(q) && !(m.recipientLabel && m.recipientLabel.toLowerCase().includes(q))) continue;
    }
    items.push(m);
    if (items.length >= limit) break;
  }
  return items;
}

export function countAwaitingApproval(partnerId?: string): number {
  loadMessages();
  let n = 0;
  for (const m of cache.values()) {
    if (m.status !== "awaiting_approval") continue;
    if (m.hidden) continue; // 숨긴 메시지는 뱃지 카운트에서 제외
    if (partnerId && m.partnerId !== partnerId) continue;
    n++;
  }
  return n;
}

// 메시지 숨김/복구 (soft-hide). updateMessage가 append-only update 라인을 남겨 재부팅 후에도 유지.
export function setMessageHidden(id: string, hidden: boolean): ExternalMessage | undefined {
  return updateMessage(id, { hidden });
}

// 숨긴 메시지 개수 (partnerId 옵션) — "숨김 N개 보기" 토글 노출 판단용.
export function countHidden(partnerId?: string): number {
  loadMessages();
  let n = 0;
  for (const m of cache.values()) {
    if (!m.hidden) continue;
    if (partnerId && m.partnerId !== partnerId) continue;
    n++;
  }
  return n;
}

