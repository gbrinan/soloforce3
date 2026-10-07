// Human-to-human chat backend — separate from AI chat (chat.ts, which must not be touched).
// Supports: DM channels, group channels, thread replies.
// SSE via emitGlobalEvent (same infra as notifications.ts).
// Persistence: channels.json + JSONL per day for messages (7-day in-memory cache).
// API contract: see history/outputs/linus/b2b-api-contract_linus_2026-06-26.md

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { HISTORY_DIR } from "../config.js";
import { emitGlobalEvent } from "./jobs.js";

const HCHAT_DIR = join(HISTORY_DIR, "human-chat");

function ensureDir(): void {
  if (!existsSync(HCHAT_DIR)) mkdirSync(HCHAT_DIR, { recursive: true });
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type ChannelType = "dm" | "group";

export interface Channel {
  id: string;
  type: ChannelType;
  name?: string;
  members: string[];
  createdAt: string;
  createdBy: string;
}

export interface ChatMessage {
  id: string;
  channelId: string;
  senderId: string;
  text: string;
  threadOf?: string;    // parent message id for thread replies
  editedAt?: string;
  deletedAt?: string;
  createdAt: string;
}

export type HumanChatSSEPayload =
  | { type: "hchat_message"; message: ChatMessage }
  | { type: "hchat_channel_created"; channel: Channel };

// ── In-memory store ────────────────────────────────────────────────────────────

const channelCache = new Map<string, Channel>();
const messageCache = new Map<string, ChatMessage>();
const channelMsgOrder = new Map<string, string[]>(); // channelId → ordered message ids

let initialized = false;

function channelsPath(): string { return join(HCHAT_DIR, "channels.json"); }

function msgFilePath(dateStr: string): string {
  return join(HCHAT_DIR, `messages-${dateStr}.jsonl`);
}

function todayStr(): string { return new Date().toISOString().slice(0, 10); }

export function loadHumanChat(): void {
  if (initialized) return;
  ensureDir();

  // Load channels
  try {
    if (existsSync(channelsPath())) {
      const arr = JSON.parse(readFileSync(channelsPath(), "utf-8")) as Channel[];
      for (const ch of arr) channelCache.set(ch.id, ch);
    }
  } catch { /* empty */ }

  // Load last 7 days of messages
  let files: string[] = [];
  try {
    files = readdirSync(HCHAT_DIR)
      .filter((f) => f.startsWith("messages-") && f.endsWith(".jsonl"))
      .sort()
      .slice(-7);
  } catch { /* empty */ }

  for (const f of files) {
    try {
      const content = readFileSync(join(HCHAT_DIR, f), "utf-8");
      for (const raw of content.split("\n")) {
        if (!raw.trim()) continue;
        try {
          const m = JSON.parse(raw) as ChatMessage;
          messageCache.set(m.id, m);
          const arr = channelMsgOrder.get(m.channelId) ?? [];
          arr.push(m.id);
          channelMsgOrder.set(m.channelId, arr);
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  initialized = true;
}

function persistChannels(): void {
  ensureDir();
  try {
    writeFileSync(channelsPath(), JSON.stringify(Array.from(channelCache.values()), null, 2));
  } catch (err) {
    console.error("[HumanChat] channels persist error:", err);
  }
}

// ── Channels ──────────────────────────────────────────────────────────────────

export function createChannel(
  type: ChannelType,
  members: string[],
  name?: string,
  createdBy?: string,
): Channel {
  loadHumanChat();
  // DM dedup: reuse existing channel for same pair
  if (type === "dm" && members.length === 2) {
    const sorted = [...members].sort().join("|");
    for (const ch of channelCache.values()) {
      if (ch.type === "dm" && [...ch.members].sort().join("|") === sorted) return ch;
    }
  }
  const channel: Channel = {
    id: randomUUID(),
    type,
    members,
    ...(name ? { name } : {}),
    createdAt: new Date().toISOString(),
    createdBy: createdBy ?? members[0] ?? "system",
  };
  channelCache.set(channel.id, channel);
  persistChannels();
  emitGlobalEvent("human-chat", { type: "hchat_channel_created", channel } as HumanChatSSEPayload);
  return channel;
}

export function getChannel(id: string): Channel | null {
  loadHumanChat();
  return channelCache.get(id) ?? null;
}

export function listChannelsForUser(userKey: string): Channel[] {
  loadHumanChat();
  return Array.from(channelCache.values()).filter((ch) => ch.members.includes(userKey));
}

// ── Messages ──────────────────────────────────────────────────────────────────

export function sendHumanMessage(
  channelId: string,
  senderId: string,
  text: string,
  threadOf?: string,
): ChatMessage | null {
  loadHumanChat();
  if (!channelCache.has(channelId)) return null;
  const msg: ChatMessage = {
    id: randomUUID(),
    channelId,
    senderId,
    text: text.trim(),
    ...(threadOf ? { threadOf } : {}),
    createdAt: new Date().toISOString(),
  };
  messageCache.set(msg.id, msg);
  const arr = channelMsgOrder.get(channelId) ?? [];
  arr.push(msg.id);
  channelMsgOrder.set(channelId, arr);
  try {
    appendFileSync(msgFilePath(todayStr()), JSON.stringify(msg) + "\n", "utf-8");
  } catch (err) {
    console.error("[HumanChat] append error:", err);
  }
  emitGlobalEvent("human-chat", { type: "hchat_message", message: msg } as HumanChatSSEPayload);
  return msg;
}

export interface GetMessagesQuery {
  before?: string;
  limit?: number;
  threadOf?: string | null;
}

export function getMessages(channelId: string, query: GetMessagesQuery = {}): ChatMessage[] {
  loadHumanChat();
  const limit = Math.min(query.limit ?? 50, 200);
  const ids = channelMsgOrder.get(channelId) ?? [];
  const msgs: ChatMessage[] = [];
  for (let i = ids.length - 1; i >= 0 && msgs.length < limit; i--) {
    const m = messageCache.get(ids[i]);
    if (!m || m.deletedAt) continue;
    if (query.before && m.createdAt >= query.before) continue;
    if (query.threadOf !== undefined && m.threadOf !== (query.threadOf ?? undefined)) continue;
    msgs.push(m);
  }
  return msgs.reverse();
}

export function getHumanMessage(id: string): ChatMessage | null {
  loadHumanChat();
  return messageCache.get(id) ?? null;
}
