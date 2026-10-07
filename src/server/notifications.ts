// Notification store: history/notifications/notifications-YYYY-MM-DD.jsonl
// Memory Map cache + append-only JSONL, following the same pattern as external-messages.ts.
// Types are defined inline (Paul's src/shared/notifications.ts will align later).

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { HISTORY_DIR, toKstDate } from "../config.js";
import { emitGlobalEvent } from "./jobs.js";

// ── Types (§4 model spec) ────────────────────────────────────────────────────

export type NotificationKind =
  | "partner_added"
  | "schedule"
  | "mail"
  | "booking"
  | "contract"
  | "workflow_approval"
  | "diary"
  | "update"
  | "notice";

export interface NotificationDeepLink {
  panel?: "staff" | "schedules" | "inbox" | "apps" | "settings";
  appId?: string;
  route?: string;
  targetUserKey?: string; // FE filters notifications by this key (undefined = broadcast)
}

export interface NotificationSource {
  appId?: string;
  refId?: string;
}

export interface NoticePayload {
  html: string;
  button?: { label: string; targetType: "url" | "app" | "plugin"; target: string; newTab?: boolean };
}

export interface Notification {
  id: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  createdAt: string;
  readAt?: string;
  deepLink?: NotificationDeepLink;
  source?: NotificationSource;
  expiresAt?: string;
  // 공지(kind:notice) 전용 — 알림 드로어에서 인라인 펼침으로 본문(HTML)·이동 버튼 렌더
  notice?: NoticePayload;
  _ikey?: string; // internal idempotency key — stored in JSONL, excluded from API responses
}

export type NotificationSSEPayload =
  | { type: "created" | "updated" | "deleted"; notification: Notification }
  | { type: "bulk-read"; count: number };

// ── Store ────────────────────────────────────────────────────────────────────

const NOTIFICATIONS_DIR = join(HISTORY_DIR, "notifications");
const RETENTION_DAYS = 30;

let notifCache: Map<string, Notification> = new Map();
let notifOrder: string[] = [];
let ikeyIndex: Map<string, string> = new Map(); // ikey → id
let notifInitialized = false;

function ensureNotifDir(): void {
  if (!existsSync(NOTIFICATIONS_DIR)) mkdirSync(NOTIFICATIONS_DIR, { recursive: true });
}

function notifFileForDate(dateStr: string): string {
  return join(NOTIFICATIONS_DIR, `notifications-${dateStr}.jsonl`);
}

function appendNotifLine(date: string, op: "create" | "update" | "delete", payload: Record<string, unknown>): void {
  ensureNotifDir();
  const line = JSON.stringify({ op, ...payload }) + "\n";
  try {
    appendFileSync(notifFileForDate(date), line, "utf-8");
  } catch (err) {
    console.error("[Notifications] append 실패:", err);
  }
}

export function loadNotifications(): void {
  if (notifInitialized) return;
  ensureNotifDir();
  notifCache = new Map();
  notifOrder = [];
  ikeyIndex = new Map();

  let files: string[] = [];
  try {
    files = readdirSync(NOTIFICATIONS_DIR)
      .filter((f) => f.startsWith("notifications-") && f.endsWith(".jsonl"))
      .sort();
  } catch { /* dir empty */ }

  const cutoffStr = toKstDate(new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000));
  const recent = files.filter((f) => {
    const m = /notifications-(\d{4}-\d{2}-\d{2})\.jsonl/.exec(f);
    return m ? m[1] >= cutoffStr : false;
  });

  for (const f of recent) {
    let content: string;
    try { content = readFileSync(join(NOTIFICATIONS_DIR, f), "utf-8"); } catch { continue; }
    for (const raw of content.split("\n")) {
      if (!raw.trim()) continue;
      let evt: Record<string, unknown>;
      try { evt = JSON.parse(raw); } catch { continue; }
      const op = evt.op as string;
      const id = evt.id as string;
      if (!id) continue;
      if (op === "create") {
        const n = evt.notification as Notification;
        if (n?.id === id) {
          notifCache.set(id, n);
          notifOrder.push(id);
          if (n._ikey) ikeyIndex.set(n._ikey, id);
        }
      } else if (op === "update") {
        const existing = notifCache.get(id);
        if (existing) Object.assign(existing, evt.patch as Partial<Notification>);
      } else if (op === "delete") {
        const n = notifCache.get(id);
        if (n?._ikey) ikeyIndex.delete(n._ikey);
        notifCache.delete(id);
        const idx = notifOrder.indexOf(id);
        if (idx !== -1) notifOrder.splice(idx, 1);
      }
    }
  }

  notifOrder.sort((a, b) =>
    (notifCache.get(a)?.createdAt ?? "").localeCompare(notifCache.get(b)?.createdAt ?? ""),
  );
  notifInitialized = true;
  console.log(`[Notifications] 부팅 복원: ${notifCache.size}건 (최근 ${RETENTION_DAYS}일)`);
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export interface AppendNotificationInput {
  kind: NotificationKind;
  title: string;
  body?: string;
  deepLink?: NotificationDeepLink;
  source?: NotificationSource;
  idempotencyKey?: string;
  expiresAt?: string;
  notice?: NoticePayload;
}

/** Persist and return a new Notification. Returns null if idempotencyKey already used (dedup). */
export function appendNotification(input: AppendNotificationInput): Notification | null {
  loadNotifications();
  if (input.idempotencyKey) {
    const existingId = ikeyIndex.get(input.idempotencyKey);
    if (existingId) return notifCache.get(existingId) ?? null;
  }
  const now = new Date().toISOString();
  const n: Notification = {
    id: randomUUID(),
    kind: input.kind,
    title: input.title,
    ...(input.body !== undefined ? { body: input.body } : {}),
    createdAt: now,
    ...(input.deepLink ? { deepLink: input.deepLink } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(input.notice ? { notice: input.notice } : {}),
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    ...(input.idempotencyKey ? { _ikey: input.idempotencyKey } : {}),
  };
  notifCache.set(n.id, n);
  notifOrder.push(n.id);
  if (input.idempotencyKey) ikeyIndex.set(input.idempotencyKey, n.id);
  appendNotifLine(toKstDate(new Date(now)), "create", { id: n.id, notification: n });
  return n;
}

/** Persist + emit SSE. No-op if idempotencyKey already used. */
export function emitNotification(input: AppendNotificationInput): void {
  const n = appendNotification(input);
  if (!n) return;
  emitGlobalEvent("notification", { type: "created", notification: n } as NotificationSSEPayload);
}

// ── Queries ──────────────────────────────────────────────────────────────────

export interface ListNotificationsQuery {
  since?: string;
  kind?: NotificationKind;
  unreadOnly?: boolean;
  limit?: number;
}

export function listNotifications(query: ListNotificationsQuery = {}): Notification[] {
  loadNotifications();
  const limit = Math.min(query.limit ?? 100, 500);
  const items: Notification[] = [];
  for (let i = notifOrder.length - 1; i >= 0; i--) {
    const n = notifCache.get(notifOrder[i]);
    if (!n) continue;
    if (query.kind && n.kind !== query.kind) continue;
    if (query.unreadOnly && n.readAt) continue;
    if (query.since && n.createdAt <= query.since) continue;
    // Strip internal field from API output
    items.push(publicNotif(n));
    if (items.length >= limit) break;
  }
  return items;
}

export function getNotification(id: string): Notification | undefined {
  loadNotifications();
  const n = notifCache.get(id);
  return n ? publicNotif(n) : undefined;
}

export function markNotificationRead(id: string): Notification | undefined {
  loadNotifications();
  const n = notifCache.get(id);
  if (!n || n.readAt) return n ? publicNotif(n) : undefined;
  const patch: Partial<Notification> = { readAt: new Date().toISOString() };
  Object.assign(n, patch);
  appendNotifLine(toKstDate(new Date(n.createdAt)), "update", { id, patch });
  emitGlobalEvent("notification", { type: "updated", notification: publicNotif(n) } as NotificationSSEPayload);
  return publicNotif(n);
}

export function markAllNotificationsRead(): number {
  loadNotifications();
  const now = new Date().toISOString();
  let count = 0;
  for (const n of notifCache.values()) {
    if (n.readAt) continue;
    const patch: Partial<Notification> = { readAt: now };
    Object.assign(n, patch);
    appendNotifLine(toKstDate(new Date(n.createdAt)), "update", { id: n.id, patch });
    count++;
  }
  if (count > 0) {
    emitGlobalEvent("notification", { type: "bulk-read", count } as NotificationSSEPayload);
  }
  return count;
}

export function deleteOneNotification(id: string): boolean {
  loadNotifications();
  const n = notifCache.get(id);
  if (!n) return false;
  notifCache.delete(id);
  const idx = notifOrder.indexOf(id);
  if (idx !== -1) notifOrder.splice(idx, 1);
  if (n._ikey) ikeyIndex.delete(n._ikey);
  appendNotifLine(toKstDate(new Date(n.createdAt)), "delete", { id });
  emitGlobalEvent("notification", { type: "deleted", notification: publicNotif(n) } as NotificationSSEPayload);
  return true;
}

export function purgeExpiredNotifications(): Notification[] {
  loadNotifications();
  const now = new Date().toISOString();
  const expired: Notification[] = [];
  for (const n of [...notifCache.values()]) {
    if (!n.expiresAt || n.expiresAt > now) continue;
    notifCache.delete(n.id);
    const idx = notifOrder.indexOf(n.id);
    if (idx !== -1) notifOrder.splice(idx, 1);
    if (n._ikey) ikeyIndex.delete(n._ikey);
    appendNotifLine(toKstDate(new Date(n.createdAt)), "delete", { id: n.id });
    emitGlobalEvent("notification", { type: "deleted", notification: publicNotif(n) } as NotificationSSEPayload);
    expired.push(n);
  }
  return expired;
}

function publicNotif(n: Notification): Notification {
  const { _ikey: _unused, ...rest } = n;
  return rest;
}
