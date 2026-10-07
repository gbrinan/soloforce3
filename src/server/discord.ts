// 디스코드 브릿지 — 사장님이 디스코드에서 지니(Genie)를 지휘하고 답변을 받는 통로.
// 구조: Gateway(WebSocket, discord.js) → 페어링 검증 → rate limit → enqueueInternal로 지니에게 전달
//       → 지니 응답 중 [REPLY_TO_DISCORD channelId=...] 마커를 뽑아 채널로 회신.
// 텔레그램 브릿지(telegram.ts)와 동일한 구조 — 페어링/트리아지/승인 버튼 로직을 최대한 재사용한다.
//
// 보안 원칙 (텔레그램과 동일):
// - 토큰은 반드시 process.env.DISCORD_BOT_TOKEN. 코드에 하드코딩 금지.
// - 페어링-바이-디폴트: 미등록 channel/DM은 아무 권한 없음.
// - 페어링 코드는 6자리, 10분 유효, 1회용, 5회 실패 시 15분 잠금 (텔레그램과 별도 상태 — 동시 발급 가능).
// - 디스코드 스노우플레이크 ID는 64비트라 JS number 정밀도를 넘는다 — 반드시 string으로 취급.
// - 이 모듈의 모든 예외는 서버를 다운시키지 않는다 (try/catch로 격리).

import { readFileSync, existsSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { HISTORY_DIR } from "../config.js";
import {
  createPairingState, generatePairingCode, hasActivePairingCodeIn, attemptPairing,
  parseApprovalCallbackData, decideApprovalCallbackBranch,
  type PairingState, type ApprovalCallbackAction,
} from "./telegram.js";
import type { HistoryTurn } from "./telegram-triage.js";

// ============================================================
// 상수
// ============================================================

const DISCORD_FILE = join(HISTORY_DIR, "discord.json");

const RATE_LIMIT_MAX_PER_MIN = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

const DISCORD_MSG_LIMIT = 2000; // 디스코드 메시지 하드 리밋
const SEND_CHUNK_LIMIT = DISCORD_MSG_LIMIT - 50;

const REPLY_MARKER_RE = /\[REPLY_TO_DISCORD\s+channelId=(\d+)\]([\s\S]*?)\[\/REPLY_TO_DISCORD\]/g;

const APPROVAL_CALLBACK_PREFIX = "apv:";

// ============================================================
// 타입
// ============================================================

export interface PairedChannel {
  channelId: string; // 디스코드 스노우플레이크 — 64비트라 number 정밀도를 넘으므로 반드시 string
  guildId: string | null; // null이면 DM
  username: string;
  pairedAt: string;
}

interface DiscordStoreData {
  version: number;
  pairedChannels: PairedChannel[];
}

interface RateLimitState {
  windowStart: number;
  count: number;
  warned: boolean;
}

// ============================================================
// 페어링 스토어 (history/discord.json 영속) — telegram.ts의 telegram.json 패턴과 동일
// ============================================================

let pairedChannelsCache: PairedChannel[] = [];
let storeLoaded = false;

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readRawStore(filePath: string): DiscordStoreData | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as DiscordStoreData;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (err) {
    console.warn(`[Discord] discord.json 파싱 실패, 빈 상태로 시작: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

export function loadDiscordStore(filePath: string = DISCORD_FILE): PairedChannel[] {
  const parsed = readRawStore(filePath);
  return parsed && Array.isArray(parsed.pairedChannels) ? parsed.pairedChannels : [];
}

export function saveDiscordStore(channels: PairedChannel[], filePath: string = DISCORD_FILE): void {
  ensureDir(filePath);
  const tmp = filePath + ".tmp";
  const data: DiscordStoreData = { version: 1, pairedChannels: channels };
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmp, filePath);
}

function loadIfNeeded(): void {
  if (storeLoaded) return;
  pairedChannelsCache = loadDiscordStore();
  storeLoaded = true;
}

/** 테스트 전용: 캐시를 강제로 리셋하고 지정된 파일에서 다시 로드 */
export function resetDiscordStoreForTest(filePath: string): void {
  pairedChannelsCache = loadDiscordStore(filePath);
  storeLoaded = true;
}

export function getPairedChannels(): PairedChannel[] {
  loadIfNeeded();
  return pairedChannelsCache;
}

export function isChannelPaired(channelId: string): boolean {
  loadIfNeeded();
  return pairedChannelsCache.some((c) => c.channelId === channelId);
}

export function pairChannel(channelId: string, guildId: string | null, username: string, filePath: string = DISCORD_FILE): void {
  loadIfNeeded();
  if (pairedChannelsCache.some((c) => c.channelId === channelId)) return;
  pairedChannelsCache.push({ channelId, guildId, username, pairedAt: new Date().toISOString() });
  saveDiscordStore(pairedChannelsCache, filePath);
}

export function unpairChannel(channelId: string, filePath: string = DISCORD_FILE): boolean {
  loadIfNeeded();
  const before = pairedChannelsCache.length;
  pairedChannelsCache = pairedChannelsCache.filter((c) => c.channelId !== channelId);
  if (pairedChannelsCache.length === before) return false;
  saveDiscordStore(pairedChannelsCache, filePath);
  return true;
}

// ============================================================
// 페어링 코드 상태 — telegram.ts의 순수 로직(createPairingState/generatePairingCode/attemptPairing)을
// 재사용하되, 상태(activeCode/lockouts)는 디스코드 전용으로 별도 보관한다(텔레그램과 동시 발급 가능).
// attemptPairing은 chatId: number를 키로 쓰므로, 디스코드 채널ID(string)는 정수 해시로 변환해 넘긴다.
// ============================================================

let pairingState: PairingState = createPairingState();

function hashChannelIdForLockout(channelId: string): number {
  let h = 0;
  for (let i = 0; i < channelId.length; i++) {
    h = (h * 31 + channelId.charCodeAt(i)) | 0;
  }
  return h;
}

// ============================================================
// Rate Limiter (분당 20건) — string 키(디스코드 스노우플레이크) 버전.
// telegram.ts의 버전은 number 키라 재사용 시 정밀도 손실 위험이 있어 별도로 둔다.
// ============================================================

function createRateLimitMap(): Map<string, RateLimitState> {
  return new Map();
}

function checkRateLimit(map: Map<string, RateLimitState>, channelId: string, now: number = Date.now()): { allowed: boolean; shouldWarn: boolean } {
  let state = map.get(channelId);
  if (!state || now - state.windowStart >= RATE_LIMIT_WINDOW_MS) {
    state = { windowStart: now, count: 0, warned: false };
    map.set(channelId, state);
  }
  state.count++;
  if (state.count <= RATE_LIMIT_MAX_PER_MIN) return { allowed: true, shouldWarn: false };
  const shouldWarn = !state.warned;
  state.warned = true;
  return { allowed: false, shouldWarn };
}

const rateLimitMap = createRateLimitMap();

// ============================================================
// 메시지 분할 (2000자 제한)
// ============================================================

export function splitDiscordMessage(text: string, chunkSize: number = SEND_CHUNK_LIMIT): string[] {
  if (text.length <= chunkSize) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= chunkSize) {
      chunks.push(remaining);
      break;
    }
    let cut = remaining.lastIndexOf("\n", chunkSize);
    if (cut < chunkSize * 0.5) cut = chunkSize;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n/, "");
  }
  return chunks;
}

// ============================================================
// 지니에게 전달할 프롬프트 빌더
// ============================================================

// 최근 대화 블록 상한 — 원 6턴 요구 + 총 길이 상한(오래된 것부터 절삭)
const PROMPT_HISTORY_MAX_TURNS = 6;
const PROMPT_HISTORY_MAX_CHARS = 1200;

function buildHistoryBlock(turns: HistoryTurn[]): string {
  const recent = turns.slice(-PROMPT_HISTORY_MAX_TURNS);
  const kept: string[] = [];
  let total = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    const t = recent[i];
    const line = `${t.role === "user" ? "사장님" : "지니"}: ${t.text}`;
    if (total + line.length > PROMPT_HISTORY_MAX_CHARS) break;
    kept.unshift(line);
    total += line.length;
  }
  if (kept.length === 0) return "";
  return [`[이 채널 최근 대화]`, ...kept].join("\n");
}

function buildDiscordPrompt(channelId: string, username: string, text: string, historyTurns: HistoryTurn[] = []): string {
  const historyBlock = buildHistoryBlock(historyTurns);
  return [
    `[디스코드] ${username}(channelId: ${channelId})님이 보낸 사장님 지시입니다.`,
    ...(historyBlock ? ["", historyBlock] : []),
    ``,
    text,
    ``,
    `[무아난(muanan) 페르소나 — 디스코드 답변 시 반드시 적용]`,
    `당신은 디스코드에서도 "무아난"으로 활동합니다. 예스맨이 아니라 비판적 사고 파트너입니다:`,
    `1. 결론을 먼저 한 줄로 제시하되, 판단·의견이 걸린 주제면 반대 근거(counter-evidence)를 최소 1개 함께 제시`,
    `2. 사장님이 스스로 판단할 수 있도록 근거가 되는 맥락(수치·출처·전제 조건)을 명시 — 아는 척 금지, 불확실하면 불확실하다고 표기`,
    `3. 결정이 필요한 사안은 경우의 수 2~3개를 각각 장단점 1줄씩으로 제시하고 권장안을 표시`,
    `4. 사장님 의견에 동의하지 않으면 정중하되 분명하게 반박`,
    `단, 단순 사실 확인·인사·상태 질문은 위 구조 없이 짧게 답하세요 (과잉 구조화 금지).`,
    ``,
    `⚠️ 답변은 반드시 아래 마커로 감싸 회신하세요. 마커 없이 답하면 사장님에게 전달되지 않습니다:`,
    `[REPLY_TO_DISCORD channelId=${channelId}]`,
    `회신 내용 (모바일 가독성을 위해 간결하게, 표/긴 코드블록 지양)`,
    `[/REPLY_TO_DISCORD]`,
  ].join("\n");
}

// ============================================================
// 지니 응답 → 디스코드 회신 마커 처리
// ============================================================

/** 지니 응답 본문에서 [REPLY_TO_DISCORD channelId=...] 마커를 뽑아 해당 채널로 발송한다. */
export async function processGenieDiscordReplyMarker(content: string): Promise<void> {
  if (!content || !content.includes("[REPLY_TO_DISCORD")) return;
  if (!discordClient) return;
  const matches = [...content.matchAll(REPLY_MARKER_RE)];
  for (const m of matches) {
    const channelId = m[1];
    const body = (m[2] || "").trim();
    if (!body) continue;
    if (!isChannelPaired(channelId)) {
      console.warn(`[Discord] 회신 마커의 channelId=${channelId}가 페어링되어 있지 않아 스킵`);
      continue;
    }
    try {
      await sendDiscordMessage(channelId, `🧞 ${body}`);
    } catch (err) {
      console.warn(`[Discord] 마커 회신 발송 실패 (channelId=${channelId}):`, err instanceof Error ? err.message : err);
    }
  }
}

// ============================================================
// discord.js 클라이언트 (동적 import — DISCORD_BOT_TOKEN 미설정 시 의존성 로드 자체를 생략)
// ============================================================

// discord.js의 실제 타입은 use-site에서 동적 import 후에만 확정되므로 최소한만 구조적으로 타입핑한다.
interface DiscordClientLike {
  login(token: string): Promise<string>;
  destroy(): Promise<void>;
  on(event: string, listener: (...args: unknown[]) => void): void;
  user?: { tag: string } | null;
}

let discordClient: DiscordClientLike | null = null;

async function sendDiscordMessage(channelId: string, text: string, components?: unknown[]): Promise<void> {
  if (!discordClient) return;
  const channel = await (discordClient as unknown as { channels: { fetch(id: string): Promise<{ send(opts: unknown): Promise<unknown> } | null> } }).channels.fetch(channelId);
  if (!channel) {
    console.warn(`[Discord] sendMessage 실패 — channel not found (channelId=${channelId})`);
    return;
  }
  const chunks = splitDiscordMessage(text);
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk.trim()) continue;
    const isLast = i === chunks.length - 1;
    try {
      await channel.send(isLast && components ? { content: chunk, components } : { content: chunk });
    } catch (err) {
      console.warn(`[Discord] sendMessage 실패 (channelId=${channelId}):`, err instanceof Error ? err.message : err);
    }
  }
}

async function sendDiscordEmbed(channelId: string, embed: unknown): Promise<void> {
  if (!discordClient) return;
  const channel = await (discordClient as unknown as { channels: { fetch(id: string): Promise<{ send(opts: unknown): Promise<unknown> } | null> } }).channels.fetch(channelId);
  if (!channel) {
    console.warn(`[Discord] sendEmbed 실패 — channel not found (channelId=${channelId})`);
    return;
  }
  try {
    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.warn(`[Discord] sendEmbed 실패 (channelId=${channelId}):`, err instanceof Error ? err.message : err);
  }
}

/**
 * 지니 + 모든 워커 에이전트의 현재 상태(대기중/작업중 + 작업중이면 무슨 작업인지)를
 * Discord 임베드 하나로 구성한다. jobs.ts/agent-registry.ts/chat.ts에 이미 있는 상태
 * 조회 함수만 재사용 — 별도 상태 저장소를 새로 만들지 않는다.
 */
async function buildAgentsEmbed(EmbedBuilder: unknown): Promise<unknown> {
  const { getAllWorkerAgents } = await import("../agent-registry.js");
  const { getAllJobs } = await import("./jobs.js");
  const { getGenieStatus, getGenieName } = await import("./chat.js");

  const jobs = getAllJobs();
  const TERMINAL = new Set(["completed", "outputs_missing", "failed"]);
  const activeJobByAgent = new Map<string, string>();
  for (const j of jobs) {
    if (!j.agent || TERMINAL.has(j.status) || j.status === "paused") continue;
    if (!activeJobByAgent.has(j.agent)) {
      activeJobByAgent.set(j.agent, (j.request || "").slice(0, 80));
    }
  }

  const Embed = EmbedBuilder as new () => {
    setTitle(t: string): unknown;
    setColor(c: number): unknown;
    setTimestamp(): unknown;
    addFields(...f: unknown[]): unknown;
  };
  const embed = new Embed();
  (embed.setTitle("🧞 mycrew 에이전트 현황") as { setColor(c: number): unknown }).setColor(0x5865f2);
  (embed as unknown as { setTimestamp(): unknown }).setTimestamp();

  const genieStatus = getGenieStatus();
  const fields: unknown[] = [
    {
      name: `🧞 ${getGenieName()} (오케스트레이터)`,
      value: genieStatus.busy ? `🔴 작업중 — ${(genieStatus.task ?? "").slice(0, 80) || "(내용 없음)"}` : "🟢 대기중",
    },
  ];

  for (const agent of getAllWorkerAgents()) {
    const currentTask = activeJobByAgent.get(agent.id);
    fields.push({
      name: `${agent.name} (${agent.role ?? agent.id})`,
      value: currentTask ? `🔴 작업중 — ${currentTask}` : "🟢 대기중",
    });
  }

  (embed as unknown as { addFields(...f: unknown[]): unknown }).addFields(...fields);
  return embed;
}

/** 모든 페어링된 채널에 알림 발송 (브릿지 비활성/미페어링 시 안전한 no-op). */
export async function sendDiscordNotice(text: string): Promise<void> {
  if (!discordClient) return;
  for (const ch of getPairedChannels()) {
    try {
      await sendDiscordMessage(ch.channelId, text);
    } catch (err) {
      console.warn(`[Discord] notice 발송 실패 (channelId=${ch.channelId}):`, err instanceof Error ? err.message : err);
    }
  }
}

// ============================================================
// 알림 스로틀 (카테고리별 최소 발송 간격 10초) — telegram.ts의 sendTelegramNoticeThrottled와 동일 로직.
// 잡 다건 동시 완료 등으로 인한 알림 폭주를 막는다.
// ============================================================

const NOTICE_THROTTLE_MS = 10_000;

const NOTICE_SUMMARY_MAX = 5; // 리스트에 보존할 최대 건수 — 초과분은 "…외 N건"으로 뭉침 (2000자 제한 보호)
const NOTICE_SUMMARY_LINE_LEN = 80;

interface NoticeThrottleState {
  lastSentAt: number;
  pendingCount: number;
  pendingSummaries: string[]; // 억제된 건들의 첫 줄 요약 — 스로틀에 뭉개져도 본문이 완전히 사라지지 않게 보존
  timer: ReturnType<typeof setTimeout> | null;
}

const noticeThrottleMap = new Map<string, NoticeThrottleState>();

function summarizeNoticeLine(text: string): string {
  const firstLine = text.split("\n")[0] ?? "";
  return firstLine.length > NOTICE_SUMMARY_LINE_LEN ? firstLine.slice(0, NOTICE_SUMMARY_LINE_LEN) + "…" : firstLine;
}

/** 카테고리별 10초당 1건만 즉시 발송, 그 사이 건은 각 건 첫 줄 요약을 리스트로 보존해 지연 발송(2000자 상한 준수). */
export function sendDiscordNoticeThrottled(category: string, text: string): void {
  const now = Date.now();
  let state = noticeThrottleMap.get(category);
  if (!state) {
    state = { lastSentAt: 0, pendingCount: 0, pendingSummaries: [], timer: null };
    noticeThrottleMap.set(category, state);
  }

  const elapsed = now - state.lastSentAt;
  if (elapsed >= NOTICE_THROTTLE_MS) {
    state.lastSentAt = now;
    state.pendingCount = 0;
    state.pendingSummaries = [];
    void sendDiscordNotice(text).catch((err) => {
      console.warn("[Discord] 스로틀 알림 발송 실패:", err instanceof Error ? err.message : err);
    });
    return;
  }

  state.pendingCount += 1;
  state.pendingSummaries.push(summarizeNoticeLine(text));
  const suppressedCount = state.pendingCount;
  const summaries = state.pendingSummaries;
  const lastText = text;
  if (state.timer) clearTimeout(state.timer);
  const delay = NOTICE_THROTTLE_MS - elapsed;
  state.timer = setTimeout(() => {
    const s = noticeThrottleMap.get(category);
    if (!s) return;
    s.lastSentAt = Date.now();
    s.pendingCount = 0;
    s.pendingSummaries = [];
    s.timer = null;
    let combined = lastText;
    if (suppressedCount > 1) {
      const shown = summaries.slice(0, NOTICE_SUMMARY_MAX);
      const extra = summaries.length - shown.length;
      const list = shown.map((line) => `· ${line}`).join("\n");
      combined = `${lastText}\n\n(뭉개진 ${suppressedCount - 1}건)\n${list}${extra > 0 ? `\n…외 ${extra}건` : ""}`;
      if (combined.length > DISCORD_MSG_LIMIT - 50) {
        combined = combined.slice(0, DISCORD_MSG_LIMIT - 53) + "...";
      }
    }
    void sendDiscordNotice(combined).catch((err) => {
      console.warn("[Discord] 스로틀 알림(지연) 발송 실패:", err instanceof Error ? err.message : err);
    });
  }, delay);
}

// ============================================================
// 승인 요청 ↔ 디스코드 메시지 매핑 (버튼 처리 후 원본 메시지 편집용)
// ============================================================

const approvalMessageMap = new Map<string, Map<string, { channelId: string; messageId: string }>>();

function buildApprovalComponents(ButtonBuilder: unknown, ActionRowBuilder: unknown, ButtonStyle: { Success: number; Danger: number }, approvalId: string): unknown[] {
  const Btn = ButtonBuilder as new () => { setCustomId(id: string): unknown; setLabel(l: string): unknown; setStyle(s: number): unknown };
  const Row = ActionRowBuilder as new () => { addComponents(...c: unknown[]): unknown };
  const allow = new Btn();
  (allow.setCustomId(`${APPROVAL_CALLBACK_PREFIX}allow:${approvalId}`) as { setLabel(l: string): unknown }).setLabel("✅ 승인");
  (allow as unknown as { setStyle(s: number): unknown }).setStyle(ButtonStyle.Success);
  const deny = new Btn();
  (deny.setCustomId(`${APPROVAL_CALLBACK_PREFIX}deny:${approvalId}`) as { setLabel(l: string): unknown }).setLabel("❌ 거부");
  (deny as unknown as { setStyle(s: number): unknown }).setStyle(ButtonStyle.Danger);
  const row = new Row();
  row.addComponents(allow, deny);
  return [row];
}

/** 승인 요청 알림을 버튼과 함께 발송하고, 이후 편집을 위해 messageId를 기억해둔다. */
export async function sendDiscordApprovalRequestWithButtons(approvalId: string, text: string): Promise<void> {
  if (!discordClient) return;
  try {
    const djs = await import("discord.js");
    const components = buildApprovalComponents(djs.ButtonBuilder, djs.ActionRowBuilder, djs.ButtonStyle, approvalId);
    const sentIds = new Map<string, { channelId: string; messageId: string }>();
    for (const ch of getPairedChannels()) {
      try {
        const channel = await (discordClient as unknown as { channels: { fetch(id: string): Promise<{ send(opts: unknown): Promise<{ id: string }> } | null> } }).channels.fetch(ch.channelId);
        if (!channel) continue;
        const sent = await channel.send({ content: text, components });
        sentIds.set(ch.channelId, { channelId: ch.channelId, messageId: sent.id });
      } catch (err) {
        console.warn(`[Discord] 버튼 알림 발송 실패 (channelId=${ch.channelId}):`, err instanceof Error ? err.message : err);
      }
    }
    if (sentIds.size > 0) approvalMessageMap.set(approvalId, sentIds);
  } catch (err) {
    console.warn("[Discord] 승인 버튼 발송 실패:", err instanceof Error ? err.message : err);
  }
}

async function finalizeApprovalMessages(approvalId: string, finalText: string): Promise<void> {
  const sent = approvalMessageMap.get(approvalId);
  if (!discordClient || !sent) return;
  for (const [, { channelId, messageId }] of sent) {
    try {
      const channel = await (discordClient as unknown as { channels: { fetch(id: string): Promise<{ messages: { fetch(id: string): Promise<{ edit(opts: unknown): Promise<unknown> }> } } | null> } }).channels.fetch(channelId);
      if (!channel) continue;
      const msg = await channel.messages.fetch(messageId);
      await msg.edit({ content: finalText, components: [] });
    } catch (err) {
      console.warn(`[Discord] 승인 메시지 최종화 실패 (channelId=${channelId}):`, err instanceof Error ? err.message : err);
    }
  }
  approvalMessageMap.delete(approvalId);
}

function approvalStatusLabel(status: string): string {
  switch (status) {
    case "allowed": return "승인됨";
    case "denied": return "거부됨";
    case "timeout": return "시간초과";
    case "pending_chat": return "대기 중";
    default: return status;
  }
}

// ============================================================
// 명령어 처리 (텔레그램과 동일한 텍스트 명령 — 슬래시커맨드 등록 없이 최대한 단순하게)
// ============================================================

async function handleCommand(channelId: string, guildId: string | null, username: string, text: string): Promise<boolean> {
  const [cmdRaw, ...rest] = text.trim().split(/\s+/);
  const cmd = cmdRaw.toLowerCase();

  if (cmd === "/start") {
    if (isChannelPaired(channelId)) {
      await sendDiscordMessage(channelId, "이미 페어링되어 있습니다. 바로 지니에게 메시지를 보내보세요.");
    } else {
      await issueDiscordPairingCode();
      await sendDiscordMessage(channelId, "안녕하세요! 이 채널/DM은 페어링된 경우만 사용할 수 있습니다.\nmycrew 화면에 표시된 코드를 `/pair 123456` 형식으로 보내주세요.");
    }
    return true;
  }

  if (cmd === "/pair") {
    const inputCode = rest.join("").trim();
    if (!inputCode) {
      await sendDiscordMessage(channelId, "사용법: /pair 123456");
      return true;
    }
    const result = attemptPairing(pairingState, hashChannelIdForLockout(channelId), inputCode);
    if (result.ok) {
      pairChannel(channelId, guildId, username);
      await sendDiscordMessage(channelId, "✅ 페어링 완료! 이제 디스코드에서 지니에게 지시할 수 있습니다.");
      const { addGenieMessage } = await import("./chat.js");
      addGenieMessage(`🔔 디스코드 페어링 완료: ${username} (channelId: ${channelId})`, { internal: true });
    } else if (result.reason === "locked_out") {
      const mins = Math.ceil(result.retryAfterMs / 60000);
      await sendDiscordMessage(channelId, `❌ 시도 횟수를 초과했습니다. ${mins}분 후 다시 시도해주세요.`);
    } else if (result.reason === "expired") {
      await sendDiscordMessage(channelId, "❌ 코드가 만료되었습니다. mycrew에서 새 코드를 발급받아주세요.");
    } else if (result.reason === "no_code") {
      await sendDiscordMessage(channelId, "❌ 발급된 코드가 없습니다. mycrew에서 페어링을 먼저 시작해주세요.");
    } else {
      await sendDiscordMessage(channelId, `❌ 코드가 일치하지 않습니다. (남은 시도: ${result.attemptsLeft}회)`);
    }
    return true;
  }

  if (cmd === "/unpair") {
    if (!isChannelPaired(channelId)) {
      await sendDiscordMessage(channelId, "페어링되어 있지 않습니다.");
      return true;
    }
    unpairChannel(channelId);
    await sendDiscordMessage(channelId, "페어링을 해제했습니다. 다시 사용하려면 /pair 코드로 재등록하세요.");
    return true;
  }

  if (cmd === "/help") {
    let assistantLine = "보조 AI(제미나이) 비활성 — 모든 메시지가 지니에게 직행합니다.";
    try {
      const triage = await import("./telegram-triage.js");
      if (triage.isTriageEnabled()) {
        assistantLine = "무아난 보조 AI(제미나이) 사용 중 — 일반 대화는 🤖가 먼저 응답하고, 지니 답변은 🧞로 표시됩니다.";
      }
    } catch { /* 트리아지 모듈 로드 실패 시에도 /help는 계속 동작 */ }
    await sendDiscordMessage(channelId, [
      "사용 가능한 명령어:",
      "/start - 안내",
      "/pair <code> - 페어링",
      "/unpair - 페어링 해제",
      "/status - 서버 상태 확인",
      "/agents - 에이전트별 현황(대기중/작업중) 카드로 확인",
      "/help - 도움말",
      "",
      assistantLine,
      `"지니야"로 시작하는 메시지는 항상 지니에게 직행합니다.`,
      "그 외 일반 텍스트는 보조 AI가 먼저 응답하거나(🤖), 필요 시 지니에게 전달됩니다(🧞).",
    ].join("\n"));
    return true;
  }

  if (cmd === "/status") {
    if (!isChannelPaired(channelId)) {
      await sendDiscordMessage(channelId, "페어링된 채널만 상태를 확인할 수 있습니다. /pair 코드로 먼저 등록해주세요.");
      return true;
    }
    try {
      const { getAllJobs } = await import("./jobs.js");
      const jobs = getAllJobs();
      const TERMINAL = new Set(["completed", "outputs_missing", "failed"]);
      const running = jobs.filter((j) => !TERMINAL.has(j.status) && j.status !== "paused");
      const uptimeSec = Math.floor(process.uptime());
      const h = Math.floor(uptimeSec / 3600);
      const m = Math.floor((uptimeSec % 3600) / 60);
      const s = uptimeSec % 60;
      await sendDiscordMessage(channelId, `서버 가동시간: ${h}시간 ${m}분 ${s}초\n진행 중인 작업: ${running.length}건`);
    } catch (err) {
      await sendDiscordMessage(channelId, "상태 조회 중 오류가 발생했습니다.");
      console.warn("[Discord] /status 처리 실패:", err instanceof Error ? err.message : err);
    }
    return true;
  }

  if (cmd === "/agents") {
    if (!isChannelPaired(channelId)) {
      await sendDiscordMessage(channelId, "페어링된 채널만 에이전트 현황을 확인할 수 있습니다. /pair 코드로 먼저 등록해주세요.");
      return true;
    }
    try {
      const djs = await import("discord.js");
      const embed = await buildAgentsEmbed(djs.EmbedBuilder);
      await sendDiscordEmbed(channelId, embed);
    } catch (err) {
      await sendDiscordMessage(channelId, "에이전트 현황 조회 중 오류가 발생했습니다.");
      console.warn("[Discord] /agents 처리 실패:", err instanceof Error ? err.message : err);
    }
    return true;
  }

  return false;
}

// ============================================================
// 인바운드 메시지 처리 (페어링/rate-limit/트리아지/relay)
// ============================================================

async function relayToGenie(channelId: string, username: string, text: string, historyTurns: HistoryTurn[] = []): Promise<void> {
  const prompt = buildDiscordPrompt(channelId, username, text, historyTurns);
  try {
    const { enqueueInternal } = await import("./genie-queue.js");
    const r = enqueueInternal(prompt, `discord:${channelId}`);
    console.log(`[Discord] enqueueInternal: channelId=${channelId} → ${r.queued ? "queued:" + r.id : "dropped:" + r.dropped}`);
  } catch (err) {
    console.error("[Discord] enqueueInternal 실패:", err instanceof Error ? err.message : err);
  }
}

async function handleIncomingMessage(channelId: string, guildId: string | null, username: string, text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  if (trimmed.startsWith("/")) {
    const handled = await handleCommand(channelId, guildId, username, trimmed);
    if (handled) return;
  }

  if (!isChannelPaired(channelId)) {
    if (!hasActivePairingCodeIn(pairingState)) {
      await issueDiscordPairingCode();
    }
    await sendDiscordMessage(channelId, "이 채널/DM은 페어링된 경우만 사용할 수 있습니다. mycrew 화면에 표시된 코드를 `/pair 123456` 형식으로 보내주세요.");
    return;
  }

  const rl = checkRateLimit(rateLimitMap, channelId);
  if (!rl.allowed) {
    if (rl.shouldWarn) {
      await sendDiscordMessage(channelId, "⚠️ 메시지가 너무 많습니다 (분당 20건 제한). 잠시 후 다시 시도해주세요.");
    }
    return;
  }

  // ── 보조 AI 트리아지 (텔레그램·데스크톱과 동일 로직 재사용, "discord:" 네임스페이스로 히스토리 분리) ──
  try {
    const triage = await import("./telegram-triage.js");
    if (!triage.isTriageEnabled()) {
      // 트리아지 비활성이어도 채널 대화 연속성은 유지한다 — 지니 회신은 REPLY_TO_DISCORD 마커 경로로
      // 분리돼 있어 이 지점에서 모델 turn으로 캡처할 수 없지만, 사장님 발화는 남겨 다음 메시지의 맥락이 된다.
      const historyState = triage.getOrCreateDesktopHistory(`discord:${channelId}`);
      const priorTurns = [...historyState.turns];
      triage.pushHistoryTurn(historyState, { role: "user", text: trimmed });
      await relayToGenie(channelId, username, trimmed, priorTurns);
      return;
    }

    const classification = triage.classifyMessage(trimmed);
    if (classification.route === "genie") {
      const historyState = triage.getOrCreateDesktopHistory(`discord:${channelId}`);
      const priorTurns = [...historyState.turns];
      triage.pushHistoryTurn(historyState, { role: "user", text: `${classification.strippedText} (지니에게 전달됨)` });
      await relayToGenie(channelId, username, classification.strippedText, priorTurns);
      return;
    }

    const historyState = triage.getOrCreateDesktopHistory(`discord:${channelId}`);
    const result = await triage.askAssistant(0, classification.strippedText, historyState.turns);

    if (!result.ok) {
      console.warn(`[Discord] 보조 AI 호출 실패 (channelId=${channelId}), 지니로 폴백:`, result.error);
      await relayToGenie(channelId, username, classification.strippedText, [...historyState.turns]);
      return;
    }

    if (result.escalate) {
      const priorTurns = [...historyState.turns];
      triage.pushHistoryTurn(historyState, { role: "user", text: `${classification.strippedText} (지니에게 전달됨)` });
      await relayToGenie(channelId, username, classification.strippedText, priorTurns);
      return;
    }

    triage.pushHistoryTurn(historyState, { role: "user", text: classification.strippedText });
    triage.pushHistoryTurn(historyState, { role: "model", text: result.text });
    await sendDiscordMessage(channelId, `🤖 ${result.text}`);
  } catch (err) {
    console.warn("[Discord] 트리아지 처리 중 예외, 지니로 폴백:", err instanceof Error ? err.message : err);
    await relayToGenie(channelId, username, trimmed);
  }
}

// ============================================================
// 승인/거부 버튼 클릭(interaction) 처리
// ============================================================

interface ButtonInteractionLike {
  customId: string;
  channelId: string;
  reply(opts: unknown): Promise<unknown>;
  deferUpdate(): Promise<unknown>;
}

async function handleButtonInteraction(interaction: ButtonInteractionLike): Promise<void> {
  try {
    const channelId = interaction.channelId;
    const paired = isChannelPaired(channelId);
    const parsed = parseApprovalCallbackData(interaction.customId);

    if (interaction.customId && !interaction.customId.startsWith(APPROVAL_CALLBACK_PREFIX)) {
      return; // 우리 접두가 아닌 다른 기능의 버튼 — 조용히 무시
    }

    let currentStatus: string | null = null;
    if (paired && parsed) {
      const { getApprovalStatus } = await import("./approvals.js");
      currentStatus = getApprovalStatus(parsed.approvalId)?.status ?? null;
    }

    const decision = decideApprovalCallbackBranch({ isPaired: paired, parsed, currentStatus });

    switch (decision.branch) {
      case "unauthorized": {
        await interaction.reply({ content: "🚫 권한 없음", ephemeral: true });
        return;
      }
      case "malformed": {
        await interaction.reply({ content: "처리할 수 없는 버튼입니다.", ephemeral: true });
        console.warn(`[Discord] malformed customId: ${interaction.customId}`);
        return;
      }
      case "not_found": {
        await interaction.reply({ content: "요청을 찾을 수 없습니다 (만료됨).", ephemeral: true });
        return;
      }
      case "already_resolved": {
        const statusLabel = approvalStatusLabel(decision.status);
        await interaction.reply({ content: `이미 처리됨 (${statusLabel})`, ephemeral: true });
        return;
      }
      case "apply": {
        if (!parsed) return;
        const { resolveApproval } = await import("./approvals.js");
        const allow = (decision.action as ApprovalCallbackAction) === "allow";
        const req = resolveApproval(parsed.approvalId, allow, "user", "디스코드에서 사장님 승인/거부");
        if (!req) {
          await interaction.reply({ content: "이미 처리됨", ephemeral: true });
          return;
        }
        const decidedLabel = req.status === "allowed" ? "✅ 승인됨" : req.status === "denied" ? "❌ 거부됨" : approvalStatusLabel(req.status);
        const when = new Date().toLocaleString("ko-KR", { hour12: false });
        await interaction.deferUpdate();
        const finalText = `${decidedLabel}\n처리자: 사장님(디스코드)\n처리 시각: ${when}`;
        await finalizeApprovalMessages(parsed.approvalId, finalText);
        return;
      }
    }
  } catch (err) {
    console.warn("[Discord] 버튼 interaction 처리 중 예외:", err instanceof Error ? err.message : err);
  }
}

// ============================================================
// 시작/정지
// ============================================================

let bridgeStarted = false;

/** 서버 부팅 시 호출. DISCORD_BOT_TOKEN 미설정이면 아무 것도 하지 않는다. */
export function startDiscordBridge(): void {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.log("[Discord] DISCORD_BOT_TOKEN 미설정 — 브릿지 비활성");
    return;
  }
  if (bridgeStarted) return;
  bridgeStarted = true;

  void (async () => {
    try {
      const { Client, GatewayIntentBits, Partials } = await import("discord.js");
      const client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
          GatewayIntentBits.DirectMessages,
        ],
        partials: [Partials.Channel], // DM 채널은 캐시 미스 시 partial로 옴 — 명시적으로 허용해야 DM 수신 가능
      });
      discordClient = client as unknown as DiscordClientLike;

      client.on("clientReady", () => {
        console.log(`[Discord] 브릿지 시작 (Gateway, bot=${client.user?.tag ?? "unknown"})`);
        if (process.env.GEMINI_API_KEY) {
          console.log("[Discord] 보조 AI 트리아지 활성화 (gemini-2.5-flash, $0 무료 티어)");
        } else {
          console.log("[Discord] GEMINI_API_KEY 미설정 — 보조 AI 트리아지 비활성 (모든 메시지 지니 직행)");
        }
      });

      client.on("messageCreate", (message: unknown) => {
        void (async () => {
          try {
            const msg = message as { author: { bot: boolean; username: string }; content: string; channelId: string; guildId: string | null };
            if (msg.author.bot) return; // 봇 자신/다른 봇 메시지 무한루프 방지
            await handleIncomingMessage(msg.channelId, msg.guildId, msg.author.username, msg.content ?? "");
          } catch (err) {
            console.error("[Discord] 메시지 처리 실패:", err instanceof Error ? err.message : err);
          }
        })();
      });

      client.on("interactionCreate", (interaction: unknown) => {
        void (async () => {
          try {
            const i = interaction as { isButton?: () => boolean };
            if (typeof i.isButton === "function" && i.isButton()) {
              await handleButtonInteraction(interaction as unknown as ButtonInteractionLike);
            }
          } catch (err) {
            console.error("[Discord] interaction 처리 실패:", err instanceof Error ? err.message : err);
          }
        })();
      });

      client.on("error", (err: unknown) => {
        console.error("[Discord] 클라이언트 오류 (서버는 유지):", err instanceof Error ? err.message : err);
      });

      await client.login(token);
    } catch (err) {
      console.error("[Discord] 브릿지 시작 실패 — 서버는 유지:", err instanceof Error ? err.message : err);
      bridgeStarted = false;
      discordClient = null;
    }
  })();
}

export function stopDiscordBridge(): void {
  bridgeStarted = false;
  if (discordClient) {
    void discordClient.destroy().catch(() => { /* best-effort */ });
    discordClient = null;
  }
  console.log("[Discord] 브릿지 정지");
}

// ============================================================
// mycrew UI/콘솔에 페어링 코드 노출
// ============================================================

export function hasActiveDiscordPairingCode(): boolean {
  return hasActivePairingCodeIn(pairingState);
}

export async function issueDiscordPairingCode(): Promise<string> {
  const code = generatePairingCode(pairingState);
  console.log(`[Discord] 페어링 코드 발급: ${code} (10분간 유효)`);
  try {
    const { addGenieMessage } = await import("./chat.js");
    addGenieMessage(
      `📱 [디스코드 페어링] 코드: ${code}\n디스코드 봇에게 \`/pair ${code}\` 를 전송해주세요. (10분간 유효)`,
      { internal: true },
    );
  } catch (err) {
    console.warn("[Discord] 페어링 코드 채팅 주입 실패:", err instanceof Error ? err.message : err);
  }
  return code;
}

// 테스트 전용 export
export const __testUtils = {
  RATE_LIMIT_MAX_PER_MIN,
  RATE_LIMIT_WINDOW_MS,
  createRateLimitMap,
  checkRateLimit,
};
