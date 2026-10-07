// 텔레그램 브릿지 — 사장님이 텔레그램(@anan_cowork_bot)에서 지니(Genie)를 지휘하고 답변을 받는 통로.
// 구조: long polling(getUpdates) → 페어링 검증 → rate limit → enqueueInternal로 지니에게 전달
//       → 지니 응답 중 [REPLY_TO_TELEGRAM chatId=...] 마커를 뽑아 Bot API sendMessage로 회신.
//
// 보안 원칙 (§작업지시):
// - 토큰은 반드시 process.env.TELEGRAM_BOT_TOKEN. 코드에 하드코딩 금지.
// - 페어링-바이-디폴트(OpenClaw 패턴): 미등록 chat은 아무 권한 없음.
// - 페어링 코드는 6자리, 10분 유효, 1회용, 5회 실패 시 15분 잠금.
// - 이 모듈의 모든 예외는 서버를 다운시키지 않는다 (try/catch로 격리).

import { randomInt } from "node:crypto";
import { readFileSync, existsSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { HISTORY_DIR } from "../config.js";

// ============================================================
// 상수
// ============================================================

const TELEGRAM_FILE = join(HISTORY_DIR, "telegram.json");

const PAIRING_CODE_TTL_MS = 10 * 60 * 1000; // 10분
const PAIRING_MAX_ATTEMPTS = 5;
const PAIRING_LOCKOUT_MS = 15 * 60 * 1000; // 15분

const RATE_LIMIT_MAX_PER_MIN = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

const POLL_TIMEOUT_SEC = 50; // long poll timeout
const BACKOFF_MIN_MS = 5_000;
const BACKOFF_MAX_MS = 60_000;
const CONFLICT_RETRY_MS = 60_000; // 409 conflict(다른 poller 존재) 시 대기

// 롱폴 전용 HTTPS agent — keep-alive 미사용.
// 전역 fetch(undici)의 keep-alive 소켓 풀은 50초 롱폴이 끝나 서버가 닫은 소켓을
// 풀에 남겨두고, 다음 폴이 그 반쯤 죽은 소켓을 재사용하다 "fetch failed"로 실패한다.
// app-registry.ts의 probeAgent와 같은 처방 — 응답 소비 후 소켓을 즉시 닫는다.
const pollAgent = new HttpsAgent({ keepAlive: false, maxSockets: 2 });
// 롱폴 자체가 50초를 기다리므로 소켓 타임아웃은 그보다 넉넉해야 한다.
const POLL_REQUEST_TIMEOUT_MS = (POLL_TIMEOUT_SEC + 15) * 1000;

const TELEGRAM_MSG_LIMIT = 4096; // 텔레그램 sendMessage 하드 리밋
const SEND_CHUNK_LIMIT = TELEGRAM_MSG_LIMIT - 96; // 여유 마진 두고 분할 (= 4000)

const REPLY_MARKER_RE = /\[REPLY_TO_TELEGRAM\s+chatId=(-?\d+)\]([\s\S]*?)\[\/REPLY_TO_TELEGRAM\]/g;

// ============================================================
// 타입
// ============================================================

export interface PairedChat {
  chatId: number;
  username: string;
  pairedAt: string;
}

interface TelegramStoreData {
  version: number;
  pairedChats: PairedChat[];
  offset?: number; // getUpdates long-poll offset (재시작 후 중복 처리 방지용, 없으면 0)
}

interface PendingCode {
  code: string;
  createdAt: number;
  expiresAt: number;
}

interface LockoutState {
  attempts: number;
  lockedUntil: number | null;
}

interface RateLimitState {
  windowStart: number;
  count: number;
  warned: boolean;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

interface TelegramMessage {
  message_id: number;
  date: number;
  chat: { id: number; type: string; username?: string; first_name?: string };
  from?: { id: number; username?: string; first_name?: string };
  text?: string;
}

interface TelegramCallbackQuery {
  id: string;
  from: { id: number; username?: string; first_name?: string };
  message?: TelegramMessage;
  data?: string;
}

// ============================================================
// 승인 콜백 처리 — 순수 로직 (네트워크 의존 없음, 단위 테스트 가능)
// ============================================================
//
// callback_data 포맷: "apv:allow:<approvalId>" | "apv:deny:<approvalId>"
// 접두 "apv:allow:" / "apv:deny:"는 각 10자 — UUID(36자) 기준 총 46자로 Bot API의
// callback_data 64바이트 제한에 여유 있게 들어온다.

export const APPROVAL_CALLBACK_PREFIX = "apv:";

export type ApprovalCallbackAction = "allow" | "deny";

export interface ParsedApprovalCallback {
  action: ApprovalCallbackAction;
  approvalId: string;
}

/**
 * callback_data 문자열을 파싱한다. "apv:allow:<id>" / "apv:deny:<id>" 형식만 유효.
 * 형식이 다르거나(다른 기능의 콜백 등) approvalId가 비어있으면 null을 반환한다 (malformed 처리).
 */
export function parseApprovalCallbackData(data: string | undefined | null): ParsedApprovalCallback | null {
  if (!data || !data.startsWith(APPROVAL_CALLBACK_PREFIX)) return null;
  const rest = data.slice(APPROVAL_CALLBACK_PREFIX.length); // "allow:<id>" | "deny:<id>"
  const sepIndex = rest.indexOf(":");
  if (sepIndex < 0) return null;
  const action = rest.slice(0, sepIndex);
  const approvalId = rest.slice(sepIndex + 1);
  if (action !== "allow" && action !== "deny") return null;
  if (!approvalId) return null;
  return { action, approvalId };
}

/** 콜백을 보낸 chat이 페어링되어 있는지 확인하는 순수 가드 (실제 isChatPaired 호출부와 분리해 테스트 용이하게). */
export function isCallbackFromPairedChat(chatId: number, pairedChats: PairedChat[]): boolean {
  return pairedChats.some((c) => c.chatId === chatId);
}

export type ApprovalCallbackBranch =
  | { branch: "unauthorized" }
  | { branch: "malformed" }
  | { branch: "already_resolved"; status: string }
  | { branch: "not_found" }
  | { branch: "apply"; action: ApprovalCallbackAction };

/**
 * 콜백 처리 분기 결정 (순수 함수 — 네트워크/디스크 접근 없음).
 * 호출부(processApprovalCallback)가 이 결과에 따라 실제 resolveApproval 호출 및 텔레그램 응답을 수행한다.
 */
export function decideApprovalCallbackBranch(params: {
  isPaired: boolean;
  parsed: ParsedApprovalCallback | null;
  currentStatus: string | null; // getApprovalStatus(id)?.status ?? null
}): ApprovalCallbackBranch {
  if (!params.isPaired) return { branch: "unauthorized" };
  if (!params.parsed) return { branch: "malformed" };
  if (params.currentStatus === null) return { branch: "not_found" };
  if (params.currentStatus !== "pending_chat") return { branch: "already_resolved", status: params.currentStatus };
  return { branch: "apply", action: params.parsed.action };
}

/** 승인/거부 인라인 키보드 생성. */
export function buildApprovalKeyboard(approvalId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "✅ 승인", callback_data: `${APPROVAL_CALLBACK_PREFIX}allow:${approvalId}` },
        { text: "❌ 거부", callback_data: `${APPROVAL_CALLBACK_PREFIX}deny:${approvalId}` },
      ],
    ],
  };
}

// ============================================================
// 페어링 스토어 (history/telegram.json 영속)
// ============================================================

let pairedChatsCache: PairedChat[] = [];
let storeLoaded = false;

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** history/telegram.json 원문을 그대로 읽어온다 (파싱 실패/부재 시 null). 내부 헬퍼 — pairedChats/offset 저장 시 서로의 필드를 보존하기 위해 사용. */
function readRawStore(filePath: string): TelegramStoreData | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as TelegramStoreData;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (err) {
    console.warn(`[Telegram] telegram.json 파싱 실패, 빈 상태로 시작: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/** history/telegram.json 로드 (없으면 빈 배열로 시작). 테스트에서 재사용할 수 있도록 filePath를 인자로 받는다. */
export function loadTelegramStore(filePath: string = TELEGRAM_FILE): PairedChat[] {
  const parsed = readRawStore(filePath);
  return parsed && Array.isArray(parsed.pairedChats) ? parsed.pairedChats : [];
}

/** history/telegram.json 원자적 저장 (tmp → rename). 기존 offset 필드는 보존한다. */
export function saveTelegramStore(chats: PairedChat[], filePath: string = TELEGRAM_FILE): void {
  ensureDir(filePath);
  const tmp = filePath + ".tmp";
  const existing = readRawStore(filePath);
  const data: TelegramStoreData = { version: 1, pairedChats: chats, offset: existing?.offset ?? 0 };
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmp, filePath);
}

/**
 * getUpdates long-poll offset 로드 (없거나 손상된 값이면 0으로 기본).
 * 서버 재시작 시 이 값부터 이어서 poll하여, 이미 처리한 최대 24시간치 메시지를
 * Telegram이 재전송해 중복 트리아지/회신되는 것을 방지한다.
 */
export function loadTelegramOffset(filePath: string = TELEGRAM_FILE): number {
  const parsed = readRawStore(filePath);
  const offset = parsed?.offset;
  return typeof offset === "number" && Number.isFinite(offset) && offset >= 0 ? offset : 0;
}

/** getUpdates offset 원자적 저장 (tmp → rename). 기존 pairedChats는 보존한다. */
export function saveTelegramOffset(offset: number, filePath: string = TELEGRAM_FILE): void {
  ensureDir(filePath);
  const tmp = filePath + ".tmp";
  const existing = readRawStore(filePath);
  const pairedChats = existing && Array.isArray(existing.pairedChats) ? existing.pairedChats : [];
  const data: TelegramStoreData = { version: 1, pairedChats, offset };
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmp, filePath);
}

function loadIfNeeded(): void {
  if (storeLoaded) return;
  pairedChatsCache = loadTelegramStore();
  storeLoaded = true;
}

/** 테스트 전용: 캐시를 강제로 리셋하고 지정된 파일에서 다시 로드 */
export function resetTelegramStoreForTest(filePath: string): void {
  pairedChatsCache = loadTelegramStore(filePath);
  storeLoaded = true;
}

export function getPairedChats(): PairedChat[] {
  loadIfNeeded();
  return pairedChatsCache;
}

export function isChatPaired(chatId: number): boolean {
  loadIfNeeded();
  return pairedChatsCache.some((c) => c.chatId === chatId);
}

export function pairChat(chatId: number, username: string, filePath: string = TELEGRAM_FILE): void {
  loadIfNeeded();
  if (pairedChatsCache.some((c) => c.chatId === chatId)) return;
  pairedChatsCache.push({ chatId, username, pairedAt: new Date().toISOString() });
  saveTelegramStore(pairedChatsCache, filePath);
}

export function unpairChat(chatId: number, filePath: string = TELEGRAM_FILE): boolean {
  loadIfNeeded();
  const before = pairedChatsCache.length;
  pairedChatsCache = pairedChatsCache.filter((c) => c.chatId !== chatId);
  if (pairedChatsCache.length === before) return false;
  saveTelegramStore(pairedChatsCache, filePath);
  return true;
}

// ============================================================
// 페어링 코드 발급/검증 (순수 로직 — 테스트 가능하도록 상태를 인자로 주고받는다)
// ============================================================

export interface PairingState {
  activeCode: PendingCode | null; // 화면/콘솔에 노출되는 전역 활성 코드 (mycrew는 단일 사장님 인스턴스이므로 1개만 유지)
  lockouts: Map<number, LockoutState>;
}

export function createPairingState(): PairingState {
  return { activeCode: null, lockouts: new Map() };
}

/** 6자리 페어링 코드 생성 (crypto.randomInt 사용, 10분 유효). */
export function generatePairingCode(state: PairingState, now: number = Date.now()): string {
  const code = randomInt(100000, 1000000).toString().padStart(6, "0");
  const entry: PendingCode = { code, createdAt: now, expiresAt: now + PAIRING_CODE_TTL_MS };
  state.activeCode = entry;
  return code;
}

/** 현재 유효한(만료 전) 페어링 코드가 이미 발급되어 있는지 확인. */
export function hasActivePairingCodeIn(state: PairingState, now: number = Date.now()): boolean {
  return !!state.activeCode && now <= state.activeCode.expiresAt;
}

export type PairingAttemptResult =
  | { ok: true }
  | { ok: false; reason: "locked_out"; retryAfterMs: number }
  | { ok: false; reason: "no_code" }
  | { ok: false; reason: "expired" }
  | { ok: false; reason: "mismatch"; attemptsLeft: number };

/** /pair <code> 시도 검증. 성공 시 코드를 소모(1회용)하고 lockout 카운터를 리셋한다. */
export function attemptPairing(
  state: PairingState,
  chatId: number,
  inputCode: string,
  now: number = Date.now(),
): PairingAttemptResult {
  const lockout = state.lockouts.get(chatId);
  if (lockout?.lockedUntil && now < lockout.lockedUntil) {
    return { ok: false, reason: "locked_out", retryAfterMs: lockout.lockedUntil - now };
  }

  const active = state.activeCode;
  if (!active) return { ok: false, reason: "no_code" };
  if (now > active.expiresAt) {
    state.activeCode = null;
    return { ok: false, reason: "expired" };
  }

  if (active.code !== inputCode.trim()) {
    const prev = state.lockouts.get(chatId) ?? { attempts: 0, lockedUntil: null };
    const attempts = prev.attempts + 1;
    if (attempts >= PAIRING_MAX_ATTEMPTS) {
      state.lockouts.set(chatId, { attempts: 0, lockedUntil: now + PAIRING_LOCKOUT_MS });
      return { ok: false, reason: "locked_out", retryAfterMs: PAIRING_LOCKOUT_MS };
    }
    state.lockouts.set(chatId, { attempts, lockedUntil: null });
    return { ok: false, reason: "mismatch", attemptsLeft: PAIRING_MAX_ATTEMPTS - attempts };
  }

  // 성공: 코드 소모(1회용) + lockout 리셋
  state.activeCode = null;
  state.lockouts.delete(chatId);
  return { ok: true };
}

// ============================================================
// Rate Limiter (분당 20건, 초과 시 drop + 1회 경고)
// ============================================================

export function createRateLimitMap(): Map<number, RateLimitState> {
  return new Map();
}

export interface RateLimitResult {
  allowed: boolean;
  shouldWarn: boolean;
}

/** chatId별 분당 메시지 수 제한. 윈도우 초과 시 drop, 윈도우 진입 첫 초과 시에만 경고 플래그. */
export function checkRateLimit(
  map: Map<number, RateLimitState>,
  chatId: number,
  now: number = Date.now(),
): RateLimitResult {
  let state = map.get(chatId);
  if (!state || now - state.windowStart >= RATE_LIMIT_WINDOW_MS) {
    state = { windowStart: now, count: 0, warned: false };
    map.set(chatId, state);
  }
  state.count++;
  if (state.count <= RATE_LIMIT_MAX_PER_MIN) {
    return { allowed: true, shouldWarn: false };
  }
  const shouldWarn = !state.warned;
  state.warned = true;
  return { allowed: false, shouldWarn };
}

// ============================================================
// Telegram Bot API 클라이언트 (fetch 내장 사용, 신규 npm 의존성 없음)
// ============================================================

function apiBase(token: string): string {
  return `https://api.telegram.org/bot${token}`;
}

async function callTelegramApi<T = unknown>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
  timeoutMs = 60_000,
): Promise<{ ok: boolean; result?: T; error?: string; statusCode?: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${apiBase(token)}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });
    const statusCode = res.status;
    let json: { ok: boolean; result?: T; description?: string } | undefined;
    try {
      json = (await res.json()) as { ok: boolean; result?: T; description?: string };
    } catch {
      return { ok: false, error: `invalid json response (status ${statusCode})`, statusCode };
    }
    if (!res.ok || !json.ok) {
      return { ok: false, error: json.description ?? `HTTP ${statusCode}`, statusCode };
    }
    return { ok: true, result: json.result, statusCode };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** 4096자 제한을 넘는 메시지를 청크로 분할 (마크다운 파싱 실패 방지를 위해 parse_mode 미사용, plain text). */
export function splitTelegramMessage(text: string, chunkSize: number = SEND_CHUNK_LIMIT): string[] {
  if (text.length <= chunkSize) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= chunkSize) {
      chunks.push(remaining);
      break;
    }
    // 가능하면 줄바꿈 경계에서 자른다 (읽기 편의)
    let cut = remaining.lastIndexOf("\n", chunkSize);
    if (cut < chunkSize * 0.5) cut = chunkSize; // 너무 이른 위치면 그냥 강제 절단
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n/, "");
  }
  return chunks;
}

// 인라인 키보드 타입 (승인/거부 버튼 등에 사용) — Bot API InlineKeyboardMarkup 서브셋.
export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}
export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

/**
 * 메시지 발송. reply_markup(인라인 키보드)을 옵션으로 첨부할 수 있다.
 * 청크 분할 시 reply_markup은 마지막 청크에만 붙인다 (버튼은 메시지당 1세트면 충분 + 마지막 청크가
 * 사용자가 최종적으로 보는 화면이므로 자연스럽다).
 */
async function sendTelegramMessage(
  token: string,
  chatId: number,
  text: string,
  replyMarkup?: InlineKeyboardMarkup,
): Promise<number | null> {
  const chunks = splitTelegramMessage(text);
  let lastMessageId: number | null = null;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk.trim()) continue;
    const isLast = i === chunks.length - 1;
    const body: Record<string, unknown> = { chat_id: chatId, text: chunk };
    if (isLast && replyMarkup) body.reply_markup = replyMarkup;
    const r = await callTelegramApi<{ message_id: number }>(token, "sendMessage", body);
    if (!r.ok) {
      console.warn(`[Telegram] sendMessage 실패 (chatId=${chatId}): ${r.error}`);
    } else if (r.result?.message_id) {
      lastMessageId = r.result.message_id;
    }
  }
  return lastMessageId;
}

/** 콜백 쿼리에 응답(토스트 표시 + 로딩 스피너 해제). 실패해도 크래시하지 않음. */
export async function answerCallbackQuery(
  token: string,
  callbackQueryId: string,
  text?: string,
  showAlert = false,
): Promise<void> {
  const r = await callTelegramApi(token, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text, show_alert: showAlert } : {}),
  });
  if (!r.ok) {
    console.warn(`[Telegram] answerCallbackQuery 실패: ${r.error}`);
  }
}

/** 기존 메시지의 텍스트를 수정 (버튼 처리 결과 반영용). 실패해도 크래시하지 않음. */
export async function editMessageText(
  token: string,
  chatId: number,
  messageId: number,
  text: string,
  replyMarkup?: InlineKeyboardMarkup,
): Promise<void> {
  const body: Record<string, unknown> = { chat_id: chatId, message_id: messageId, text };
  if (replyMarkup) body.reply_markup = replyMarkup;
  const r = await callTelegramApi(token, "editMessageText", body);
  if (!r.ok) {
    console.warn(`[Telegram] editMessageText 실패 (chatId=${chatId}, messageId=${messageId}): ${r.error}`);
  }
}

/** 메시지의 인라인 키보드만 제거/교체 (텍스트는 그대로 두고 버튼만 없애고 싶을 때). */
export async function editMessageReplyMarkup(
  token: string,
  chatId: number,
  messageId: number,
  replyMarkup?: InlineKeyboardMarkup,
): Promise<void> {
  const body: Record<string, unknown> = { chat_id: chatId, message_id: messageId };
  if (replyMarkup) body.reply_markup = replyMarkup;
  const r = await callTelegramApi(token, "editMessageReplyMarkup", body);
  if (!r.ok) {
    console.warn(`[Telegram] editMessageReplyMarkup 실패 (chatId=${chatId}, messageId=${messageId}): ${r.error}`);
  }
}

/** 모든 페어링된 chat에 알림 발송 (브릿지 비활성/미페어링 시 안전한 no-op). */
export async function sendTelegramNotice(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const chats = getPairedChats();
  for (const chat of chats) {
    try {
      await sendTelegramMessage(token, chat.chatId, text);
    } catch (err) {
      console.warn(`[Telegram] notice 발송 실패 (chatId=${chat.chatId}):`, err instanceof Error ? err.message : err);
    }
  }
}

/**
 * 모든 페어링된 chat에 인라인 키보드가 첨부된 알림 발송 (승인 요청 등).
 * 각 chat에 발송된 messageId를 { chatId -> messageId } 맵으로 반환한다 — 이후 콜백 처리 시
 * editMessageText/editMessageReplyMarkup으로 해당 메시지를 갱신(버튼 제거)하는 데 사용.
 */
export async function sendTelegramNoticeWithKeyboard(
  text: string,
  replyMarkup: InlineKeyboardMarkup,
): Promise<Map<number, number>> {
  const sentMessageIds = new Map<number, number>();
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return sentMessageIds;
  const chats = getPairedChats();
  for (const chat of chats) {
    try {
      const messageId = await sendTelegramMessage(token, chat.chatId, text, replyMarkup);
      if (messageId) sentMessageIds.set(chat.chatId, messageId);
    } catch (err) {
      console.warn(`[Telegram] 버튼 알림 발송 실패 (chatId=${chat.chatId}):`, err instanceof Error ? err.message : err);
    }
  }
  return sentMessageIds;
}

// ============================================================
// 승인 요청 ↔ 텔레그램 메시지 매핑 (버튼 처리 후 원본 메시지 편집용)
// ============================================================
//
// approvalId 하나가 여러 페어링된 chat에 동시 발송될 수 있으므로 chatId -> messageId 맵을 보관.
// 승인/거부 확정 시 이 맵을 순회하며 모든 chat의 버튼을 동시에 제거(중복 클릭 방지).
const approvalMessageMap = new Map<string, Map<number, number>>();

/** 승인 요청 알림을 인라인 키보드와 함께 발송하고, 이후 편집을 위해 messageId를 기억해둔다. */
export async function sendApprovalRequestWithButtons(approvalId: string, text: string): Promise<void> {
  const keyboard = buildApprovalKeyboard(approvalId);
  const sentIds = await sendTelegramNoticeWithKeyboard(text, keyboard);
  if (sentIds.size > 0) approvalMessageMap.set(approvalId, sentIds);
}

/**
 * 승인 처리 완료 후 모든 관련 텔레그램 메시지의 버튼을 제거하고 최종 상태 텍스트로 갱신한다.
 * 메시지가 없거나(알림 발송 실패 등) 이미 처리됐다면 조용히 no-op.
 */
async function finalizeApprovalMessages(approvalId: string, finalText: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const sentIds = approvalMessageMap.get(approvalId);
  if (!token || !sentIds) return;
  for (const [chatId, messageId] of sentIds) {
    try {
      await editMessageText(token, chatId, messageId, finalText);
    } catch (err) {
      console.warn(`[Telegram] 승인 메시지 최종화 실패 (chatId=${chatId}):`, err instanceof Error ? err.message : err);
    }
  }
  approvalMessageMap.delete(approvalId);
}

// ============================================================
// 알림 스로틀 (카테고리별 최소 발송 간격 10초 — 다건 동시 완료 시 알림 폭주 방지)
// ============================================================

const NOTICE_THROTTLE_MS = 10_000;

interface NoticeThrottleState {
  lastSentAt: number;
  pendingCount: number; // 억제된 발송 건수 (다음 발송 시 "외 N건"으로 합산)
  timer: ReturnType<typeof setTimeout> | null;
}

const noticeThrottleMap = new Map<string, NoticeThrottleState>();

/**
 * 카테고리별로 분당 1건(정확히는 10초당 1건)만 즉시 발송하고, 그 사이 들어온 알림은
 * 카운트만 누적했다가 스로틀 윈도우가 끝나는 시점에 "외 N건"을 붙여 마지막 메시지로 발송한다.
 * 잡 다건 동시 완료 등으로 인한 텔레그램 알림 폭주(rate limit 역풍)를 막기 위한 용도.
 */
export function sendTelegramNoticeThrottled(category: string, text: string): void {
  const now = Date.now();
  let state = noticeThrottleMap.get(category);
  if (!state) {
    state = { lastSentAt: 0, pendingCount: 0, timer: null };
    noticeThrottleMap.set(category, state);
  }

  const elapsed = now - state.lastSentAt;
  if (elapsed >= NOTICE_THROTTLE_MS) {
    // 윈도우 밖 — 즉시 발송
    state.lastSentAt = now;
    state.pendingCount = 0;
    void sendTelegramNotice(text).catch((err) => {
      console.warn("[Telegram] 스로틀 알림 발송 실패:", err instanceof Error ? err.message : err);
    });
    return;
  }

  // 윈도우 내부 — 카운트만 누적, 윈도우 종료 시점에 합산 발송 (마지막 억제분만 대표로 전송)
  state.pendingCount += 1;
  const suppressedCount = state.pendingCount;
  const lastText = text;
  if (state.timer) clearTimeout(state.timer);
  const delay = NOTICE_THROTTLE_MS - elapsed;
  state.timer = setTimeout(() => {
    const s = noticeThrottleMap.get(category);
    if (!s) return;
    s.lastSentAt = Date.now();
    s.pendingCount = 0;
    s.timer = null;
    const suffix = suppressedCount > 1 ? ` (외 ${suppressedCount - 1}건)` : "";
    void sendTelegramNotice(`${lastText}${suffix}`).catch((err) => {
      console.warn("[Telegram] 스로틀 알림(지연) 발송 실패:", err instanceof Error ? err.message : err);
    });
  }, delay);
}

// ============================================================
// 지니 응답 → 텔레그램 회신 마커 처리
// ============================================================

/**
 * 지니 응답 본문에서 [REPLY_TO_TELEGRAM chatId=...]...[/REPLY_TO_TELEGRAM]  마커를 뽑아
 * 해당 chat으로 발송한다. addGenieMessage / _sendMessageImpl 양쪽에서 fire-and-forget으로 호출.
 */
export async function processGenieTelegramReplyMarker(content: string): Promise<void> {
  if (!content || !content.includes("[REPLY_TO_TELEGRAM")) return;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const matches = [...content.matchAll(REPLY_MARKER_RE)];
  for (const m of matches) {
    const chatId = Number(m[1]);
    const body = (m[2] || "").trim();
    if (!body || !Number.isFinite(chatId)) continue;
    if (!isChatPaired(chatId)) {
      console.warn(`[Telegram] 회신 마커의 chatId=${chatId}가 페어링되어 있지 않아 스킵`);
      continue;
    }
    try {
      // 🧞 접두 — 지니(Genie)가 보낸 회신임을 사장님이 한눈에 구분할 수 있도록 표시 (보조 AI는 🤖).
      await sendTelegramMessage(token, chatId, `🧞 ${body}`);
    } catch (err) {
      console.warn(`[Telegram] 마커 회신 발송 실패 (chatId=${chatId}):`, err instanceof Error ? err.message : err);
    }
  }
}

// ============================================================
// 지니에게 전달할 프롬프트 빌더
// ============================================================

function buildTelegramPrompt(chatId: number, username: string, text: string): string {
  return [
    `[텔레그램] ${username}(chatId: ${chatId})님이 보낸 사장님 지시입니다.`,
    ``,
    text,
    ``,
    `[무아난(muanan) 페르소나 — 텔레그램 답변 시 반드시 적용]`,
    `당신은 텔레그램에서 "무아난"으로 활동합니다. 예스맨이 아니라 비판적 사고 파트너입니다:`,
    `1. 결론을 먼저 한 줄로 제시하되, 판단·의견이 걸린 주제면 반대 근거(counter-evidence)를 최소 1개 함께 제시`,
    `2. 사장님이 스스로 판단할 수 있도록 근거가 되는 맥락(수치·출처·전제 조건)을 명시 — 아는 척 금지, 불확실하면 불확실하다고 표기`,
    `3. 결정이 필요한 사안은 경우의 수 2~3개를 각각 장단점 1줄씩으로 제시하고 권장안을 표시`,
    `4. 사장님 의견에 동의하지 않으면 정중하되 분명하게 반박`,
    `단, 단순 사실 확인·인사·상태 질문은 위 구조 없이 짧게 답하세요 (과잉 구조화 금지).`,
    ``,
    `⚠️ 답변은 반드시 아래 마커로 감싸 회신하세요. 마커 없이 답하면 사장님에게 전달되지 않습니다:`,
    `[REPLY_TO_TELEGRAM chatId=${chatId}]`,
    `회신 내용 (모바일 가독성을 위해 간결하게, 표/긴 코드블록 지양)`,
    `[/REPLY_TO_TELEGRAM]`,
  ].join("\n");
}

// ============================================================
// 명령어 처리
// ============================================================

let pairingState: PairingState = createPairingState();

async function handleCommand(
  token: string,
  msg: TelegramMessage,
  text: string,
): Promise<boolean> {
  const chatId = msg.chat.id;
  const username = msg.from?.username ?? msg.chat.username ?? msg.from?.first_name ?? "unknown";
  const [cmdRaw, ...rest] = text.trim().split(/\s+/);
  const cmd = cmdRaw.toLowerCase();

  if (cmd === "/start") {
    if (isChatPaired(chatId)) {
      await sendTelegramMessage(token, chatId, "이미 페어링되어 있습니다. 바로 지니에게 메시지를 보내보세요.");
    } else {
      await issuePairingCode();
      await sendTelegramMessage(
        token,
        chatId,
        "안녕하세요! 이 봇은 페어링된 사용자만 사용할 수 있습니다.\nmycrew 화면에 표시된 코드를 `/pair 123456` 형식으로 보내주세요.",
      );
    }
    return true;
  }

  if (cmd === "/pair") {
    const inputCode = rest.join("").trim();
    if (!inputCode) {
      await sendTelegramMessage(token, chatId, "사용법: /pair 123456");
      return true;
    }
    const result = attemptPairing(pairingState, chatId, inputCode);
    if (result.ok) {
      pairChat(chatId, username);
      await sendTelegramMessage(token, chatId, "✅ 페어링 완료! 이제 텔레그램에서 지니에게 지시할 수 있습니다.");
      const { addGenieMessage } = await import("./chat.js");
      addGenieMessage(`🔔 텔레그램 페어링 완료: ${username} (chatId: ${chatId})`, { internal: true });
    } else if (result.reason === "locked_out") {
      const mins = Math.ceil(result.retryAfterMs / 60000);
      await sendTelegramMessage(token, chatId, `❌ 시도 횟수를 초과했습니다. ${mins}분 후 다시 시도해주세요.`);
    } else if (result.reason === "expired") {
      await sendTelegramMessage(token, chatId, "❌ 코드가 만료되었습니다. mycrew에서 새 코드를 발급받아주세요.");
    } else if (result.reason === "no_code") {
      await sendTelegramMessage(token, chatId, "❌ 발급된 코드가 없습니다. mycrew에서 페어링을 먼저 시작해주세요.");
    } else {
      await sendTelegramMessage(token, chatId, `❌ 코드가 일치하지 않습니다. (남은 시도: ${result.attemptsLeft}회)`);
    }
    return true;
  }

  if (cmd === "/unpair") {
    if (!isChatPaired(chatId)) {
      await sendTelegramMessage(token, chatId, "페어링되어 있지 않습니다.");
      return true;
    }
    unpairChat(chatId);
    await sendTelegramMessage(token, chatId, "페어링을 해제했습니다. 다시 사용하려면 /pair 코드로 재등록하세요.");
    return true;
  }

  if (cmd === "/help") {
    let assistantLine = "보조 AI(제미나이) 비활성 — 모든 메시지가 지니에게 직행합니다.";
    try {
      const triage = await import("./telegram-triage.js");
      if (triage.isTriageEnabled()) {
        assistantLine = "무아난 보조 AI(제미나이) 사용 중 — 일반 대화는 🤖가 먼저 응답하고, 지니 답변은 🧞로 표시됩니다.";
      }
    } catch {
      // 트리아지 모듈 로드 실패 시에도 /help는 계속 동작해야 하므로 기본 문구 유지
    }
    await sendTelegramMessage(
      token,
      chatId,
      [
        "사용 가능한 명령어:",
        "/start - 안내",
        "/pair <code> - 페어링",
        "/unpair - 페어링 해제",
        "/status - 서버 상태 확인",
        "/일 <직원> <지시> - 직원에게 바로 위임 (완료 시 알림)",
        "/hermes <지시> - 헤르메스(오퍼레이터 셸)에게 바로 위임",
        "/jobs - 진행 중 작업 확인",
        "/직원 - 직원 현황",
        "/away - 부재중 전환 (읽기·쓰기 자동 허용, bash 자동 거부)",
        "/back - 재석 복귀 (승인 요청 다시 받기)",
        "/help - 도움말",
        "",
        assistantLine,
        `"지니야"로 시작하는 메시지는 항상 지니에게 직행합니다.`,
        "그 외 일반 텍스트는 보조 AI가 먼저 응답하거나(🤖), 필요 시 지니에게 전달됩니다(🧞).",
      ].join("\n"),
    );
    return true;
  }

  if (cmd === "/status") {
    if (!isChatPaired(chatId)) {
      await sendTelegramMessage(token, chatId, "페어링된 사용자만 상태를 확인할 수 있습니다. /pair 코드로 먼저 등록해주세요.");
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
      let assistantStatus = "보조 AI: 비활성 (모든 메시지 지니 직행)";
      try {
        const triage = await import("./telegram-triage.js");
        if (triage.isTriageEnabled()) assistantStatus = "보조 AI: 활성 (무아난/제미나이, $0 무료 티어)";
      } catch {
        // 상태 조회 실패는 무시하고 기본값 유지
      }
      let awayStatus = "";
      try {
        const { isOwnerAway } = await import("./approvals.js");
        awayStatus = isOwnerAway() ? "\n재석 상태: 🔴 부재중 (/back 으로 복귀)" : "\n재석 상태: 🟢 재석 (/away 로 부재중 전환)";
      } catch {
        // 조회 실패 시 상태 줄만 생략
      }
      await sendTelegramMessage(
        token,
        chatId,
        `서버 가동시간: ${h}시간 ${m}분 ${s}초\n진행 중인 작업: ${running.length}건\n${assistantStatus}${awayStatus}`,
      );
    } catch (err) {
      await sendTelegramMessage(token, chatId, "상태 조회 중 오류가 발생했습니다.");
      console.warn("[Telegram] /status 처리 실패:", err instanceof Error ? err.message : err);
    }
    return true;
  }

  // 결정적 위임 — 무아의 재량(바쁨·생략)을 거치지 않고 확정적으로 잡을 생성한다.
  // 사용법: /일 <직원id|이름> <지시내용>   (루프 엔진의 '지니 우회 직접 위임'과 동일 원리)
  // /hermes <지시> = /일 hermes <지시> 단축 (오퍼레이터 셸 직행)
  if (cmd === "/일" || cmd === "/task" || cmd === "/hermes") {
    if (!isChatPaired(chatId)) {
      await sendTelegramMessage(token, chatId, "페어링된 사용자만 사용할 수 있습니다. /pair 코드로 먼저 등록해주세요.");
      return true;
    }
    try {
      const { getAllWorkerAgents } = await import("../agent-registry.js");
      const agents = getAllWorkerAgents();
      const isHermesShortcut = cmd === "/hermes";
      const agentKey = isHermesShortcut ? "hermes" : (rest[0] ?? "").trim();
      const instruction = (isHermesShortcut ? rest : rest.slice(1)).join(" ").trim();
      const found = agents.find((a) => a.id === agentKey || a.name === agentKey);
      if (!found || !instruction) {
        const roster = agents.map((a) => `${a.name}(${a.id})`).join(", ");
        await sendTelegramMessage(token, chatId, `사용법: /일 <직원> <지시내용>\n직원: ${roster}`);
        return true;
      }
      const base = `http://127.0.0.1:${process.env.PORT || "3456"}`;
      const res = await fetch(`${base}/api/delegate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request: `[텔레그램 지시] ${instruction}`,
          agent: found.id,
          todoText: instruction.slice(0, 80),
        }),
      });
      const ack = await res.json().catch(() => null) as { jobId?: string; error?: string } | null;
      if (res.ok && ack?.jobId) {
        await sendTelegramMessage(token, chatId, `📋 ${found.name}에게 위임 완료 (job ${ack.jobId.slice(0, 8)})\n완료/실패 시 여기로 알려드립니다. 진행 확인: /jobs`);
      } else {
        await sendTelegramMessage(token, chatId, `❌ 위임 실패: ${ack?.error ?? `HTTP ${res.status}`}`);
      }
    } catch (err) {
      await sendTelegramMessage(token, chatId, "위임 처리 중 오류가 발생했습니다.");
      console.warn("[Telegram] /일 처리 실패:", err instanceof Error ? err.message : err);
    }
    return true;
  }

  // 진행 가시성 — 현재 작업 목록
  if (cmd === "/jobs" || cmd === "/작업") {
    if (!isChatPaired(chatId)) {
      await sendTelegramMessage(token, chatId, "페어링된 사용자만 사용할 수 있습니다.");
      return true;
    }
    try {
      const { getAllJobs } = await import("./jobs.js");
      const TERMINAL = new Set(["completed", "outputs_missing", "failed"]);
      const all = getAllJobs();
      const active = all.filter((j) => !TERMINAL.has(j.status));
      const recent = all.filter((j) => TERMINAL.has(j.status)).slice(-3);
      const fmt = (j: { id: string; status: string; agent?: string; request: string }) =>
        `· [${j.status}] ${j.agent ?? "미지정"} — ${j.request.replace(/\n/g, " ").slice(0, 60)} (${j.id.slice(0, 8)})`;
      const lines = [
        `진행 중 ${active.length}건:`,
        ...(active.length ? active.map(fmt) : ["  (없음)"]),
        "",
        "최근 종결 3건:",
        ...(recent.length ? recent.map(fmt) : ["  (없음)"]),
      ];
      await sendTelegramMessage(token, chatId, lines.join("\n"));
    } catch (err) {
      await sendTelegramMessage(token, chatId, "작업 조회 중 오류가 발생했습니다.");
      console.warn("[Telegram] /jobs 처리 실패:", err instanceof Error ? err.message : err);
    }
    return true;
  }

  // 직원 로스터 + 현재 하는 일
  if (cmd === "/직원" || cmd === "/agents") {
    if (!isChatPaired(chatId)) {
      await sendTelegramMessage(token, chatId, "페어링된 사용자만 사용할 수 있습니다.");
      return true;
    }
    try {
      const { getAllWorkerAgents } = await import("../agent-registry.js");
      const { getAllJobs } = await import("./jobs.js");
      const TERMINAL = new Set(["completed", "outputs_missing", "failed"]);
      const activeByAgent = new Map<string, string>();
      for (const j of getAllJobs()) {
        if (!TERMINAL.has(j.status) && j.agent) {
          activeByAgent.set(j.agent, j.request.replace(/\n/g, " ").slice(0, 40));
        }
      }
      const lines = getAllWorkerAgents().map((a) => {
        const doing = activeByAgent.get(a.id);
        return `· ${a.name}(${a.id})${doing ? ` — 진행중: ${doing}` : " — 대기"}`;
      });
      await sendTelegramMessage(token, chatId, ["직원 현황:", ...lines, "", "위임: /일 <직원id> <지시>"].join("\n"));
    } catch (err) {
      await sendTelegramMessage(token, chatId, "직원 조회 중 오류가 발생했습니다.");
      console.warn("[Telegram] /직원 처리 실패:", err instanceof Error ? err.message : err);
    }
    return true;
  }

  // 부재중/재석 토글 — 대시보드 헤더 버튼과 동일 동작.
  // 부재중은 "자리에 없을 때" 켜는 것이라 데스크톱 앞에서만 켤 수 있으면 모순이므로 폰에서 토글한다.
  // approvals.js가 telegram.js를 import하므로 순환을 피하려 동적 import를 쓴다.
  if (cmd === "/away" || cmd === "/back") {
    if (!isChatPaired(chatId)) {
      await sendTelegramMessage(token, chatId, "페어링된 사용자만 사용할 수 있습니다. /pair 코드로 먼저 등록해주세요.");
      return true;
    }
    const wantAway = cmd === "/away";
    try {
      const { setOwnerAway, isOwnerAway } = await import("./approvals.js");
      if (isOwnerAway() === wantAway) {
        await sendTelegramMessage(token, chatId, wantAway ? "이미 부재중입니다." : "이미 재석 상태입니다.");
        return true;
      }
      setOwnerAway(wantAway);
      await sendTelegramMessage(
        token,
        chatId,
        wantAway
          ? "🔴 부재중으로 전환했습니다.\n지니의 읽기·쓰기 승인은 자동 허용되고, bash는 자동 거부됩니다.\n복귀하면 /back 을 보내주세요."
          : "🟢 재석으로 전환했습니다.\n이제 승인 요청이 다시 사장님께 전달됩니다.",
      );
    } catch (err) {
      await sendTelegramMessage(token, chatId, "상태 전환 중 오류가 발생했습니다.");
      console.warn(`[Telegram] ${cmd} 처리 실패:`, err instanceof Error ? err.message : err);
    }
    return true;
  }

  return false; // 알려진 명령어가 아님 → 일반 메시지로 처리
}

// ============================================================
// 인바운드 메시지 처리 (페어링/rate-limit/relay)
// ============================================================

const rateLimitMap = createRateLimitMap();

/** 지니에게 메시지를 릴레이 (기존 경로 — 트리아지 도입 전과 동일한 enqueueInternal 호출). */
async function relayToGenie(chatId: number, username: string, text: string): Promise<void> {
  const prompt = buildTelegramPrompt(chatId, username, text);
  try {
    const { enqueueInternal } = await import("./genie-queue.js");
    const r = enqueueInternal(prompt, `telegram:${chatId}`);
    console.log(`[Telegram] enqueueInternal: chatId=${chatId} → ${r.queued ? "queued:" + r.id : "dropped:" + r.dropped}`);
  } catch (err) {
    console.error("[Telegram] enqueueInternal 실패:", err instanceof Error ? err.message : err);
  }
}

async function handleIncomingMessage(token: string, msg: TelegramMessage): Promise<void> {
  const chatId = msg.chat.id;
  const text = (msg.text ?? "").trim();
  if (!text) return; // 텍스트 없는 메시지(사진 등)는 v1에서 무시

  // 명령어 우선 처리 (/pair, /unpair 등은 미페어링 상태에서도 동작해야 함)
  if (text.startsWith("/")) {
    const handled = await handleCommand(token, msg, text);
    if (handled) return;
  }

  // 미페어링 chat → 코드 발급 + 안내만 하고 종료 (해당 chat 요청 시마다 활성 코드 재사용/재발급)
  if (!isChatPaired(chatId)) {
    if (!hasActivePairingCode()) {
      await issuePairingCode();
    }
    await sendTelegramMessage(
      token,
      chatId,
      "이 봇은 페어링된 사용자만 사용할 수 있습니다. mycrew 화면에 표시된 코드를 `/pair 123456` 형식으로 보내주세요.",
    );
    return;
  }

  // rate limit (페어링된 chat 대상)
  const rl = checkRateLimit(rateLimitMap, chatId);
  if (!rl.allowed) {
    if (rl.shouldWarn) {
      await sendTelegramMessage(token, chatId, "⚠️ 메시지가 너무 많습니다 (분당 20건 제한). 잠시 후 다시 시도해주세요.");
    }
    return;
  }

  const username = msg.from?.username ?? msg.chat.username ?? msg.from?.first_name ?? "unknown";

  // ── 보조 AI 트리아지 ────────────────────────────────────────
  // GEMINI_API_KEY 미설정 시 트리아지 완전 비활성 → 기존 동작(전부 지니行)과 100% 동일.
  try {
    const triage = await import("./telegram-triage.js");
    if (!triage.isTriageEnabled()) {
      await relayToGenie(chatId, username, text);
      return;
    }

    const classification = triage.classifyMessage(text);
    if (classification.route === "genie") {
      // "지니야" 접두/명령/키워드 매칭 → 곧바로 지니行. 원문(접두 제거본)을 히스토리에 참고용으로만 기록.
      triage.recordGenieHandoff(chatId, classification.strippedText);
      await relayToGenie(chatId, username, classification.strippedText);
      return;
    }

    // 보조 AI(Gemini Flash) 응답 시도
    const history = triage.getOrCreateHistory(chatId);
    const result = await triage.askAssistant(chatId, classification.strippedText, history.turns);

    if (!result.ok) {
      // Gemini 호출 실패(타임아웃/네트워크/쿼터 등) → 메시지를 절대 드롭하지 않고 지니로 폴백.
      console.warn(`[Telegram] 보조 AI 호출 실패 (chatId=${chatId}), 지니로 폴백:`, result.error);
      await relayToGenie(chatId, username, classification.strippedText);
      return;
    }

    if (result.escalate) {
      // 보조 AI가 스스로 <<ESCALATE>> 판단 → 원문을 지니에게 그대로 전달.
      triage.pushHistoryTurn(history, { role: "user", text: `${classification.strippedText} (지니에게 전달됨)` });
      await relayToGenie(chatId, username, classification.strippedText);
      return;
    }

    // 보조 AI가 직접 응답 → 히스토리에 기록 후 🤖 접두로 회신.
    triage.pushHistoryTurn(history, { role: "user", text: classification.strippedText });
    triage.pushHistoryTurn(history, { role: "model", text: result.text });
    await sendTelegramMessage(token, chatId, `🤖 ${result.text}`);
  } catch (err) {
    // 트리아지 레이어 자체의 예상치 못한 예외 → crash-safe: 지니로 폴백 (메시지 드롭 금지).
    console.warn("[Telegram] 트리아지 처리 중 예외, 지니로 폴백:", err instanceof Error ? err.message : err);
    await relayToGenie(chatId, username, text);
  }
}

// ============================================================
// 승인/거부 콜백 쿼리 처리
// ============================================================

/**
 * callback_query 업데이트 처리 (승인/거부 버튼 클릭).
 * 절대 throw하지 않는다 — 예외 발생 시 콘솔 warn만 남기고 종료 (poll loop를 죽이지 않기 위함).
 */
async function handleCallbackQuery(token: string, cq: TelegramCallbackQuery): Promise<void> {
  try {
    const chatId = cq.message?.chat.id;
    if (chatId === undefined) {
      await answerCallbackQuery(token, cq.id, "처리할 수 없는 요청입니다.");
      return;
    }

    const paired = isChatPaired(chatId);
    const parsed = parseApprovalCallbackData(cq.data);

    // 다른 기능(향후 확장)의 콜백일 수 있으므로, 우리 접두가 아니면 조용히 무시 (malformed 처리와는 구분).
    if (cq.data && !cq.data.startsWith(APPROVAL_CALLBACK_PREFIX)) {
      await answerCallbackQuery(token, cq.id);
      return;
    }

    let currentStatus: string | null = null;
    if (paired && parsed) {
      const { getApprovalStatus } = await import("./approvals.js");
      currentStatus = getApprovalStatus(parsed.approvalId)?.status ?? null;
    }

    const decision = decideApprovalCallbackBranch({ isPaired: paired, parsed, currentStatus });

    switch (decision.branch) {
      case "unauthorized": {
        await answerCallbackQuery(token, cq.id, "🚫 권한 없음", true);
        return;
      }
      case "malformed": {
        await answerCallbackQuery(token, cq.id, "처리할 수 없는 버튼입니다.");
        console.warn(`[Telegram] malformed callback_data: ${cq.data}`);
        return;
      }
      case "not_found": {
        await answerCallbackQuery(token, cq.id, "요청을 찾을 수 없습니다 (만료됨).");
        if (cq.message) {
          await editMessageReplyMarkup(token, chatId, cq.message.message_id);
        }
        return;
      }
      case "already_resolved": {
        const statusLabel = approvalStatusLabel(decision.status);
        await answerCallbackQuery(token, cq.id, `이미 처리됨 (${statusLabel})`);
        if (cq.message) {
          await editMessageText(token, chatId, cq.message.message_id, `${cq.message.text ?? ""}\n\n— ${statusLabel} (다른 경로에서 처리됨)`.trim());
        }
        return;
      }
      case "apply": {
        if (!parsed) return; // decideApprovalCallbackBranch가 apply를 반환하면 parsed는 항상 존재하지만 타입가드 목적
        const { resolveApproval } = await import("./approvals.js");
        const allow = decision.action === "allow";
        const req = resolveApproval(parsed.approvalId, allow, "user", "텔레그램에서 사장님 승인/거부");
        if (!req) {
          // resolveApproval이 null을 반환하는 경우(레이스 컨디션으로 그 사이 삭제된 등) — 이미 처리됨과 동일 취급.
          await answerCallbackQuery(token, cq.id, "이미 처리됨");
          return;
        }
        const decidedLabel = req.status === "allowed" ? "✅ 승인됨" : req.status === "denied" ? "❌ 거부됨" : approvalStatusLabel(req.status);
        const who = "사장님(텔레그램)";
        const when = new Date().toLocaleString("ko-KR", { hour12: false });
        await answerCallbackQuery(token, cq.id, decidedLabel);
        const finalText = `${decidedLabel}\n처리자: ${who}\n처리 시각: ${when}`;
        await finalizeApprovalMessages(parsed.approvalId, finalText);
        // 여러 chat에 발송되지 않았거나 매핑이 없는 경우(예: 알림 발송 실패) 최소한 클릭된 메시지는 갱신.
        if (cq.message) {
          await editMessageReplyMarkup(token, chatId, cq.message.message_id);
        }
        return;
      }
    }
  } catch (err) {
    console.warn("[Telegram] callback_query 처리 중 예외:", err instanceof Error ? err.message : err);
  }
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
// Long polling 루프
// ============================================================

let pollingActive = false;
let pollAbortController: AbortController | null = null;
let currentOffset = 0;

// getUpdates 전용 POST — 전역 fetch 대신 keep-alive 없는 agent를 쓴다.
// 실패 시 err.code(ECONNRESET 등)가 그대로 올라와 로그에 원인이 남는다.
function pollRequest(
  url: string,
  payload: unknown,
  signal: AbortSignal,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    const req = httpsRequest(
      url,
      {
        method: "POST",
        agent: pollAgent,
        timeout: POLL_REQUEST_TIMEOUT_MS,
        headers: {
          "content-type": "application/json",
          "content-length": String(body.length),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") });
        });
        res.on("error", reject);
      },
    );
    const onAbort = (): void => {
      const err = new Error("aborted");
      err.name = "AbortError";
      req.destroy(err);
    };
    req.on("timeout", () => {
      req.destroy(new Error(`getUpdates 응답 없음 (${POLL_REQUEST_TIMEOUT_MS}ms)`));
    });
    req.on("error", reject);
    req.on("close", () => signal.removeEventListener("abort", onAbort));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    req.end(body);
  });
}

async function pollOnce(token: string): Promise<{ conflict: boolean; networkError: boolean }> {
  pollAbortController = new AbortController();
  try {
    const res = await pollRequest(
      `${apiBase(token)}/getUpdates`,
      {
        offset: currentOffset,
        timeout: POLL_TIMEOUT_SEC,
        allowed_updates: ["message", "callback_query"],
      },
      pollAbortController.signal,
    );
    if (res.status === 409) {
      return { conflict: true, networkError: false };
    }
    if (res.status < 200 || res.status >= 300) {
      console.warn(`[Telegram] getUpdates HTTP ${res.status}`);
      return { conflict: false, networkError: true };
    }
    const json = JSON.parse(res.text) as { ok: boolean; result?: TelegramUpdate[]; description?: string };
    if (!json.ok || !Array.isArray(json.result)) {
      console.warn("[Telegram] getUpdates 응답 이상:", json.description);
      return { conflict: false, networkError: true };
    }
    for (const update of json.result) {
      currentOffset = update.update_id + 1;
      if (update.message) {
        try {
          await handleIncomingMessage(token, update.message);
        } catch (err) {
          console.error("[Telegram] 메시지 처리 실패:", err instanceof Error ? err.message : err);
        }
      }
      if (update.callback_query) {
        try {
          await handleCallbackQuery(token, update.callback_query);
        } catch (err) {
          console.error("[Telegram] callback_query 처리 실패:", err instanceof Error ? err.message : err);
        }
      }
      // update 1건 처리 완료 시점마다 offset 영속화 — 크래시가 나도 재시작 시
      // 최대 이번 update 1건만 재처리되도록 (배치 전체 24시간치 재전송 방지).
      try {
        saveTelegramOffset(currentOffset);
      } catch (err) {
        console.error("[Telegram] offset 저장 실패 (다음 재시작 시 일부 재처리 가능):", err instanceof Error ? err.message : err);
      }
    }
    return { conflict: false, networkError: false };
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      return { conflict: false, networkError: false }; // 정지 요청에 의한 abort — 정상 종료 취급
    }
    const code =
      (err as NodeJS.ErrnoException)?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
    console.warn(
      "[Telegram] getUpdates 네트워크 오류:",
      err instanceof Error ? err.message : err,
      code ? `(code=${code})` : "",
    );
    return { conflict: false, networkError: true };
  } finally {
    pollAbortController = null;
  }
}

async function pollLoop(token: string): Promise<void> {
  let backoffMs = BACKOFF_MIN_MS;
  while (pollingActive) {
    const { conflict, networkError } = await pollOnce(token);
    if (!pollingActive) break;
    if (conflict) {
      console.warn(`[Telegram] 409 conflict — 다른 poller가 활성 상태로 추정. ${CONFLICT_RETRY_MS / 1000}초 후 재시도.`);
      await sleep(CONFLICT_RETRY_MS);
      continue;
    }
    if (networkError) {
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
      continue;
    }
    backoffMs = BACKOFF_MIN_MS; // 성공 시 백오프 리셋
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// 마커 후킹 — chat.ts의 addGenieMessage()와 _sendMessageImpl() 두 지점에서
// content.includes("[REPLY_TO_TELEGRAM")일 때 이 모듈의 processGenieTelegramReplyMarker를
// 동적 import로 호출하도록 chat.ts에 직접 훅을 심어두었다 ([REPLY_TO_PARTNER]와 동일 패턴).
// 즉, 이 파일은 별도의 이벤트 구독 없이도 지니 응답 발생 시점에 자동으로 호출된다.
// ============================================================

// ============================================================
// 시작/정지
// ============================================================

let bridgeStarted = false;

/** 서버 부팅 시 호출. TELEGRAM_BOT_TOKEN 미설정이면 아무 것도 하지 않는다. */
export function startTelegramBridge(): void {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log("[Telegram] TELEGRAM_BOT_TOKEN 미설정 — 브릿지 비활성");
    return;
  }
  if (bridgeStarted) return;
  bridgeStarted = true;
  pollingActive = true;
  currentOffset = loadTelegramOffset();
  console.log(`[Telegram] 브릿지 시작 (long polling, offset=${currentOffset})`);
  if (process.env.GEMINI_API_KEY) {
    console.log("[Telegram] 보조 AI 트리아지 활성화 (gemini-2.5-flash, $0 무료 티어)");
  } else {
    console.log("[Telegram] GEMINI_API_KEY 미설정 — 보조 AI 트리아지 비활성 (모든 메시지 지니 직행)");
  }
  pollLoop(token).catch((err) => {
    console.error("[Telegram] pollLoop 예외 종료 — 서버는 유지:", err instanceof Error ? err.message : err);
    bridgeStarted = false;
    pollingActive = false;
  });
}

export function stopTelegramBridge(): void {
  pollingActive = false;
  bridgeStarted = false;
  pollAbortController?.abort();
  pollAbortController = null;
  console.log("[Telegram] 브릿지 정지");
}

// ============================================================
// mycrew UI/콘솔에 페어링 코드 노출 (§요구사항: console.log + Genie 채팅 주입)
// ============================================================

/** 현재 활성(미만료) 페어링 코드가 있는지 확인 — 미페어링 chat 요청마다 새 코드를 남발하지 않기 위함. */
export function hasActivePairingCode(): boolean {
  return hasActivePairingCodeIn(pairingState);
}

/** 페어링 코드를 발급하고 콘솔 + 지니 채팅창에 노출한다. mycrew 서버 부팅 후 또는 API 트리거로 호출. */
export async function issuePairingCode(): Promise<string> {
  const code = generatePairingCode(pairingState);
  console.log(`[Telegram] 페어링 코드 발급: ${code} (10분간 유효)`);
  try {
    const { addGenieMessage } = await import("./chat.js");
    addGenieMessage(
      `📱 [텔레그램 페어링] 코드: ${code}\n텔레그램 봇(@anan_cowork_bot)에서 \`/pair ${code}\` 를 전송해주세요. (10분간 유효)`,
      { internal: true },
    );
  } catch (err) {
    console.warn("[Telegram] 페어링 코드 채팅 주입 실패:", err instanceof Error ? err.message : err);
  }
  return code;
}

// 테스트 전용 export (scripts/telegram-pairing-test.ts에서 사용)
export const __testUtils = {
  PAIRING_CODE_TTL_MS,
  PAIRING_MAX_ATTEMPTS,
  PAIRING_LOCKOUT_MS,
  RATE_LIMIT_MAX_PER_MIN,
  RATE_LIMIT_WINDOW_MS,
};
