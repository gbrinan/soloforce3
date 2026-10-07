// 크루 라운지 — 에이전트 간 대화 채널. [로컬 패치 2026-07-15]
// human-chat 인프라를 재사용해 에이전트(워커/지니)들의 공개 대화를 한 그룹 채널에 기록한다.
// - 워커는 SafeBash curl로 POST /api/crew-chat 호출 (127.0.0.1 전용 서버라 로컬 워커만 접근 가능)
// - 메시지는 human-chat SSE(hchat_message)로 MyCrew UI(휴먼챗 패널)에 실시간 반영
// - 페어링된 Discord 채널에도 즉시 미러링 (agentverse의 inbox+push 패턴 참조)
import {
  createChannel,
  getChannel,
  listChannelsForUser,
  sendHumanMessage,
  getMessages,
  loadHumanChat,
  type ChatMessage,
} from "./human-chat.js";
import { getAllWorkerAgents, getWorkerAgent } from "../agent-registry.js";
import { sendDiscordNotice } from "./discord.js";

const LOUNGE_NAME = "크루 라운지";
const LOCAL_USER_KEY = "__local__"; // SSO 미사용(로컬) 모드의 사용자 키 — UI 채널 목록 노출용
let loungeId: string | null = null;

/** 크루 라운지 채널을 보장하고 id를 반환한다 (없으면 생성, lazy). */
export function ensureCrewLounge(): string {
  if (loungeId && getChannel(loungeId)) return loungeId;
  loadHumanChat();
  for (const ch of listChannelsForUser(LOCAL_USER_KEY)) {
    if (ch.type === "group" && ch.name === LOUNGE_NAME) {
      loungeId = ch.id;
      return loungeId;
    }
  }
  const members = [
    LOCAL_USER_KEY,
    "genie",
    ...getAllWorkerAgents().map((a) => a.id),
  ];
  const ch = createChannel("group", [...new Set(members)], LOUNGE_NAME, "genie");
  loungeId = ch.id;
  return loungeId;
}

/** 발신자 id를 표시 이름으로 변환한다. */
function displayName(senderId: string): string {
  if (senderId === "genie") return "지니";
  if (senderId === LOCAL_USER_KEY) return "사용자";
  const agent = getWorkerAgent(senderId);
  return agent ? `${agent.name}(${senderId})` : senderId;
}

/** 유효한 발신자인지 검사 — 등록된 워커, genie, 로컬 사용자만 허용. */
export function isValidCrewSender(senderId: string): boolean {
  if (senderId === "genie" || senderId === LOCAL_USER_KEY) return true;
  return Boolean(getWorkerAgent(senderId));
}

/**
 * 크루 라운지에 메시지를 게시한다.
 * human-chat 영속화 + SSE + Discord 미러까지 한 번에 처리.
 */
export function postCrewMessage(
  senderId: string,
  text: string,
  threadOf?: string,
): ChatMessage | null {
  const channelId = ensureCrewLounge();
  const msg = sendHumanMessage(channelId, senderId, text, threadOf);
  if (!msg) return null;
  // Discord 미러 — 브릿지 비활성 시 no-op. 대화 흐름 보존을 위해 스로틀 없이 직발송.
  const mirror = `🗣️ **${displayName(senderId)}**\n${text}`;
  void sendDiscordNotice(mirror).catch(() => {
    /* 미러 실패는 라운지 기록에 영향 없음 */
  });
  return msg;
}

/** 최근 라운지 메시지 조회 (오래된 → 최신 순). */
export function getCrewMessages(limit: number = 30): ChatMessage[] {
  const channelId = ensureCrewLounge();
  return getMessages(channelId, { limit });
}

// ── 아웃박스 워처 — 워커 SafeBash에 curl/node가 없는 경우를 위한 파일 기반 게시 경로.
// 워커가 history/crew-chat-outbox/*.json 에 {"agentId","text","threadOf"?}를 저장하면
// 서버가 10초 주기로 읽어 라운지에 게시하고 파일을 .posted 로 이동시킨다.
import { readdirSync, readFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { join as joinPath } from "node:path";
import { HISTORY_DIR } from "../config.js";

const OUTBOX_DIR = joinPath(HISTORY_DIR, "crew-chat-outbox");
let outboxTimer: ReturnType<typeof setInterval> | null = null;

function drainOutboxOnce(): void {
  try {
    if (!existsSync(OUTBOX_DIR)) return;
    const files = readdirSync(OUTBOX_DIR).filter((f) => f.endsWith(".json"));
    for (const f of files) {
      const full = joinPath(OUTBOX_DIR, f);
      try {
        const raw = readFileSync(full, "utf-8").replace(/^﻿/, "");
        const body = JSON.parse(raw) as { agentId?: string; text?: string; threadOf?: string };
        if (body.agentId?.trim() && body.text?.trim() && isValidCrewSender(body.agentId.trim())) {
          postCrewMessage(body.agentId.trim(), body.text.trim(), body.threadOf);
          console.log(`[CrewChat] 아웃박스 게시: ${f} (${body.agentId})`);
        } else {
          console.warn(`[CrewChat] 아웃박스 무시 (형식/발신자 오류): ${f}`);
        }
      } catch (err) {
        console.warn(`[CrewChat] 아웃박스 처리 실패: ${f}`, err instanceof Error ? err.message : err);
      }
      try { renameSync(full, `${full}.posted`); } catch { /* 이동 실패 시 다음 주기 재시도 방지 불가 — 로그로만 */ }
    }
  } catch (err) {
    console.warn("[CrewChat] 아웃박스 스캔 실패:", err instanceof Error ? err.message : err);
  }
  // 워커 샌드박스 호환 경로: history/outputs/<agentId>/crew-post-*.json
  // (writePaths가 본인 outputs 폴더만 허용하는 에이전트용 — agentId는 폴더명으로 강제해 사칭 차단)
  try {
    const outputsDir = joinPath(HISTORY_DIR, "outputs");
    if (!existsSync(outputsDir)) return;
    for (const agentDir of readdirSync(outputsDir)) {
      if (!isValidCrewSender(agentDir)) continue;
      const dir = joinPath(outputsDir, agentDir);
      let files: string[] = [];
      try {
        files = readdirSync(dir).filter((f) => f.startsWith("crew-post") && f.endsWith(".json"));
      } catch { continue; }
      for (const f of files) {
        const full = joinPath(dir, f);
        try {
          const raw = readFileSync(full, "utf-8").replace(/^﻿/, "");
          const body = JSON.parse(raw) as { text?: string; threadOf?: string };
          if (body.text?.trim()) {
            postCrewMessage(agentDir, body.text.trim(), body.threadOf);
            console.log(`[CrewChat] outputs 아웃박스 게시: ${agentDir}/${f}`);
          }
        } catch (err) {
          console.warn(`[CrewChat] outputs 아웃박스 처리 실패: ${agentDir}/${f}`, err instanceof Error ? err.message : err);
        }
        try { renameSync(full, `${full}.posted`); } catch { /* */ }
      }
    }
  } catch (err) {
    console.warn("[CrewChat] outputs 아웃박스 스캔 실패:", err instanceof Error ? err.message : err);
  }
}

/** 아웃박스 워처 시작 (10초 주기, 중복 시작 안전). registerRoutes에서 1회 호출. */
export function startCrewChatOutboxWatcher(): void {
  if (outboxTimer) return;
  try { mkdirSync(OUTBOX_DIR, { recursive: true }); } catch { /* */ }
  outboxTimer = setInterval(drainOutboxOnce, 10_000);
  console.log(`[CrewChat] 아웃박스 워처 시작: ${OUTBOX_DIR}`);
}

/** 라운지 최근 대화를 위임 프롬프트에 끼워넣기 좋은 텍스트로 요약한다. */
export function renderCrewHistory(limit: number = 20): string {
  const msgs = getCrewMessages(limit);
  if (msgs.length === 0) return "(라운지에 아직 메시지가 없습니다)";
  return msgs
    .map((m) => `[${m.createdAt.slice(5, 16)}] ${displayName(m.senderId)}: ${m.text}`)
    .join("\n");
}
