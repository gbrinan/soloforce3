import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import {
  mkdirSync,
  existsSync,
  appendFileSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
  renameSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { runAgent, type RunAgentOptions } from "../agent.js";
import { getGenieAgent } from "../agents/genie.js";
import { withAgentLock } from "./agent-lock.js";
import { createJob, emitGlobalEvent, getBusyAgentIds, getAllJobs, getAgentCurrentJob, buildOrgChart, checkStaffChange, saveStaffHash, logCost, cacheCapExceeded } from "./jobs.js";
import { clearPmSession, savePmSessionTokens, normalizePageName, PROTECTED_PAGE_NAMES, PROTECTED_PAGE_PREFIXES, JUNK_PAGES, JUNK_CONTENTS } from "./pm-memory.js";
import { getAllWorkerAgents, getWorkerAgent } from "../agent-registry.js";
import { HISTORY_DIR as ROOT_HISTORY_DIR, PROJECT_SELF_DIR, getTodayKST, kstDaysAgo, TSX_BIN, TSX_CLI_ARGS } from "../config.js";
import { safeKill } from "./utils/platform.js";
import { archiveWikiPage, archiveChatMessage, auditLog } from "./audit.js";
import { addTodo, markTodoDone, cancelTodo, deleteTodo, linkJobToTodo, setTodoState, setTodoStages, getTodos } from "./todos.js";
import { createSchedule, updateSchedule, deleteSchedule } from "./schedules.js";
import type { GenieTodo, AgentResult } from "../types.js";
import { setApprovalNotifier, resolveApproval, type ApprovalRequest } from "./approvals.js";
import { spawnGenieOpinion } from "./approval-genie.js";
import { decideInternalEmit, notifyOnlyFromEnv } from "./internal-reply-emit.js";
import { getUserTitle } from "./user-title.js";
import { claudeSessionExists } from "./agent-pty.js";
import { isSelectiveRecallEnabled, getRecallBudgetChars, buildWikiIndex, buildToc, formatToc, recallRelevant } from "./memory/recall.js";
import { resolveTier } from "./model-tiers.js";
import { modelForInternalSource } from "./internal-source-tier.js";
import { resolveGenieSource } from "./cost-entry.js";
import { isFreshNoticeSource, appendNoticeDigest, consumeNoticeDigest, makeDigestEntry } from "./notice-digest.js";
import { ProgressGate, stallLimitFromEnv, buildStallPrompt } from "./auto-continuation-gate.js";

import { withoutAnthropicKeys } from "./utils/safeChildEnv.js";
// 침묵 catch 관측 훅 — 예상된 부재(ENOENT)는 무시, 그 외는 warn.
// (플랫폼 분석 2026-07-04 P0: 빈 catch 26곳이 대화 유실을 은폐하던 문제)
function swallow(context: string, err: unknown): void {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  if (code === "ENOENT") return; // 첫 부팅/파일 없음 — 정상 경로
  console.warn(`[chat] 무시된 오류 (${context}):`, err instanceof Error ? err.message : err);
}

interface ChatMessage {
  id: string;
  role: "user" | "genie";
  content: string;
  timestamp: string;
  attachments?: string[];
  jobs?: Array<{ id: string; request: string; agent?: string }>;
  internal?: boolean; // true이면 getChatHistory()에서 필터링 (UI 노출 안 됨)
  pending?: boolean;  // 사용자 race 큐잉 중 — drainQueue 처리 시 false 갱신
  aborted?: boolean;  // 사용자가 응답 생성을 중단함 — UI에 (중단됨) 마커
}

const CONV_DIR = join(ROOT_HISTORY_DIR, "conversations");
const GENIE_DIR = join(ROOT_HISTORY_DIR, "genie");
const WIKI_DIR = join(GENIE_DIR, "wiki");
const DAILY_DIR = join(GENIE_DIR, "daily");
const SESSION_FILE = join(GENIE_DIR, "session.json");

const history: ChatMessage[] = [];
let historyLoaded = false;
let sessionId: string | undefined;

// internal=true 메시지 중 [REPORT]/[NOTIFY] 마커 있으면 사장님 보고용 → UI 노출 허용.
const REPORT_MARKER_RE = /^\[(NOTIFY|REPORT)\]\s*/i;

// JOB_COMPLETE raw 코멘트(internal=true·logOnly=true로 저장)는 ChatBubble가 결과보기 버튼으로 복원.
// (jobs.ts:2020 주석 "리프레시 시 태그로 복원" 본래 의도 — 2026-05-03 internal 필터 도입으로 회귀, 본 가드로 회복)
const JOB_COMPLETE_RE = /^<!--JOB_COMPLETE:/;

// 마이크루 관련 파일 mtime 변동 감지
const genieMtimes = new Map<string, number>();
function checkGenieFilesChanged(): boolean {
  const files = [
    join(WIKI_DIR, "role-directive.md"),
    join(WIKI_DIR, "self-profile.md"),
    join(PROJECT_SELF_DIR, "prompts", "genie.md"),
    join(ROOT_HISTORY_DIR, "genie-config.json"),
  ];
  let changed = false;
  for (const filepath of files) {
    try {
      const mtime = statSync(filepath).mtimeMs;
      const prev = genieMtimes.get(filepath);
      if (prev && mtime !== prev) changed = true;
      genieMtimes.set(filepath, mtime);
    } catch (err) { swallow("파일 없음", err); }
  }
  return changed;
}

// 비용 기반 세션 리셋: cacheReadTokens가 maxCacheTokens를 초과하면 다음 메시지 전에 세션 리셋
let lastGenieCacheTokens = 0;
let midResetContext = ""; // 도중 리셋 시 직전 맥락 (다음 새 세션에 주입 후 소멸)

// 도중 리셋 시 새 세션에 주입할 맥락 (마지막 3턴 + 진행 TODO)
function buildMidResetContext(): string {
  const parts: string[] = [];
  // 마지막 10턴 — 캐시 한도 하향으로 리셋이 잦아진 만큼 이월 맥락 확대 (망각 완화)
  const recentTurns = history.filter(m => m.role === "user" || m.role === "genie");
  const lastTurns = recentTurns.slice(-20); // user+genie 쌍 10개
  if (lastTurns.length > 0) {
    const lines = lastTurns.map(m => `[${m.role === "user" ? getUserTitle() : getGenieName()}] ${m.content.slice(0, 500)}`);
    parts.push(`[세션 리셋 전 직전 대화]\n${lines.join("\n")}\n[직전 대화 끝]`);
  }
  // 진행 중 TODO
  const pending = getTodos({ status: "pending" });
  if (pending.length > 0) {
    const todoLines = pending.map(t => `- [${t.state ?? "received"}] ${t.instruction.slice(0, 80)}`);
    parts.push(`[진행 중 업무]\n${todoLines.join("\n")}\n[진행 중 업무 끝]`);
  }
  return parts.join("\n\n");
}

// 마이크루 상태 추적
let genieBusy = false;
let genieTask: string | undefined;
let genieTurnId = ""; // 턴마다 갱신되는 고유 ID
let genieIdleWaiters: Array<() => void> = [];

// 마이크루 응답 중단 — claude CLI 자식 PID와 abort 플래그
let genieChildPid: number | undefined;
let genieAborted = false;

export function abortGenie(): { ok: boolean; reason?: string } {
  if (!genieBusy) return { ok: false, reason: "not_busy" };
  if (!genieChildPid) return { ok: false, reason: "no_child" };
  try {
    process.kill(genieChildPid, "SIGKILL");
    genieAborted = true;
    console.log(`[MyCrew] 사용자 중단 요청 → SIGKILL pid=${genieChildPid}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

// 스트림 복원용 — 현재 진행 중인 스트림 청크를 서버에 누적
let activeStreamChunks: string[] = [];
let activeStreamStartTime = 0;

export function getActiveStream(): { chunks: string[]; startTime: number } | null {
  if (!genieBusy) return null;
  return { chunks: activeStreamChunks, startTime: activeStreamStartTime };
}

function resetActiveStream(): void {
  activeStreamChunks = [];
  activeStreamStartTime = 0;
}

export function waitForGenieIdle(): Promise<void> {
  if (!genieBusy) return Promise.resolve();
  return new Promise((resolve) => {
    genieIdleWaiters.push(resolve);
  });
}

export function isGenieBusy(): boolean {
  return genieBusy;
}

/** 현재 마이크루 턴 ID. busy=false면 빈 문자열 */
export function getGenieTurnId(): string {
  return genieBusy ? genieTurnId : "";
}

// 자동 진행 모드 (작업 완료 시 마이크루가 자동으로 다음 단계 이어감)
let autoContinuationMode = false;
// 내부 발화 source → 모델 티어 고정표는 internal-source-tier.ts 로 분리했다(2026-08-22).
// 2단(haiku / 기본) → 3단(cheap / standard / 기본)으로 확장. 표와 티어 어휘는 그 모듈 참조.

let autoContinuationCount = 0;
const MAX_AUTO_CONTINUATIONS = 20;
// 한도 도달 안내 1회 발화 플래그 — count 리셋 시 함께 리셋
let autoCapNoticeSent = false;
// 자동 진행 진척 게이트(auto-continuation-gate.ts). 연속 무진척 N회면 멈추고 AI 가 정체 보고.
// 정체 상태는 사용자 메시지·모드 토글 시 풀린다(한도 도달과 같은 규칙).
const autoProgressGate = new ProgressGate(stallLimitFromEnv());
let autoContinuationStalled = false;
const autoRecentRequests: string[] = [];
const autoRecentOutputs: string[] = [];
function resetAutoProgress(): void {
  autoProgressGate.reset();
  autoContinuationStalled = false;
  autoRecentRequests.length = 0;
  autoRecentOutputs.length = 0;
}
// 비재개 단발로 처리한 내부 알림의 한 줄 요약(최대 50줄). 다음 재개 턴에 1회 주입 후 소비.
const NOTICE_DIGEST_FILE = join(ROOT_HISTORY_DIR, "genie", "notice-digest.jsonl");

const AUTO_MODE_FILE = join(ROOT_HISTORY_DIR, "genie", ".auto-mode");

// 자동 RESTART (2026-04-30) — self 작업 완료 누적 시 다음 자동 진행 직전에 자동 재시작.
// jobs.ts processCallback 직후 jobs.ts에서 setSelfRestartPending(true) 호출.
// triggerGenieAutoContinuation에서 idle + busy 0 시점에 consume + tryAutoRestart 발화.
// c124f30 RESTART 가드는 그대로 (busy 검사 후 자연 통과). 가드 우회 아님.
let selfRestartPending = false;
export function setSelfRestartPending(v: boolean): void {
  if (selfRestartPending !== v) {
    console.log(`[AutoMode] self 변경 ${v ? "감지" : "해소"} (자동 RESTART pending=${v})`);
  }
  selfRestartPending = v;
}
export function isSelfRestartPending(): boolean { return selfRestartPending; }

// routes.ts /api/genie/restart, /api/restart 핸들러용
// 기존 tryAutoRestart 인프라(idle 시점에 tsc→빌드→health 후 restartSelf) 트리거
export function requestRestart(): void {
  setSelfRestartPending(true);
}
export function triggerSafeRestart(): void {
  setSelfRestartPending(true);
}

// routes.ts /api/genie/reset 핸들러용 — 마이크루 세션 리셋 예약 (resetGenieSession은 hoisted)
export function requestGenieReset(): void {
  resetGenieSession();
}

// routes.ts /api/genie/agent-event 핸들러용 — 알바(Agent) lifecycle 기록
const subagentEvents: Array<{ event: string; agentId?: string; ts: string }> = [];
export function noteSubagentEvent(event: string, agentId?: string): void {
  subagentEvents.push({ event, agentId, ts: new Date().toISOString() });
  while (subagentEvents.length > 100) subagentEvents.shift();
  console.log(`[Subagent] ${event}${agentId ? ` ${agentId}` : ""}`);
}

// 서버 시작 시 파일에서 복원
try {
  if (existsSync(AUTO_MODE_FILE)) {
    autoContinuationMode = true;
    console.log("[MyCrew] 자동 진행 모드: ON (파일에서 복원)");
  }
} catch (err) {
  swallow("자동 진행 모드 복원", err);
}

export function isAutoContinuationMode(): boolean {
  return autoContinuationMode && autoContinuationCount < MAX_AUTO_CONTINUATIONS;
}

export function setAutoContinuationMode(v: boolean): void {
  const prev = autoContinuationMode;
  autoContinuationMode = v;
  if (!v) { autoContinuationCount = 0; autoCapNoticeSent = false; }
  if (prev !== v) resetAutoProgress();
  if (prev !== v) {
    console.log(`[MyCrew] 자동 진행 모드: ${v ? "ON" : "OFF"}`);
    emitGlobalEvent("genie-status", { busy: genieBusy, task: genieTask, startTime: genieBusy ? activeStreamStartTime : undefined, autoMode: v, autoCount: autoContinuationCount });
  }
  // 파일 영속화
  try {
    ensureDirs();
    if (v) {
      writeFileSync(AUTO_MODE_FILE, "1");
    } else if (existsSync(AUTO_MODE_FILE)) {
      unlinkSync(AUTO_MODE_FILE);
    }
  } catch (err) {
    swallow("자동 진행 모드 저장", err);
  }
}

// 자동 RESTART 시도 — self 작업 완료가 누적된 상태에서 idle 시점에 tsc/health 검증 후 restartSelf.
// 통과 시: TODO "[재시작 후 이어가기] {nextPrompt}" 등록 → 부팅 후 handleSelfRestart가 자동 sendMessage.
// 실패/비활성 시: false 반환 → 호출자는 평소 자동 진행 흐름 그대로.
// env: AUTO_RESTART_ON_STAGE=false 면 비활성 (안전망).
async function tryAutoRestart(reason: string, nextPrompt: string): Promise<boolean> {
  if (process.env.AUTO_RESTART_ON_STAGE === "false") {
    console.log("[AutoMode] AUTO_RESTART_ON_STAGE=false — 자동 RESTART 비활성");
    return false;
  }
  // c124f30 가드와 동일한 busy 검사 (가드 우회 아님 — idle 시점에만 발화)
  const busy = getBusyAgentIds();
  if (busy.length > 0) {
    console.log(`[AutoMode] 자동 RESTART 보류 — busy=${busy.join(",")}`);
    return false;
  }
  console.log(`[AutoMode] 자동 RESTART 시도: ${reason}`);
  try {
    const gate = await runRestartSafetyGate();
    if (!gate.ok) {
      // 침묵 취소 금지 — 어디서 막혔는지 남긴다(이 로그 부재가 D-3 훅 미반영을 오래 감췄다).
      console.error(`[AutoMode] 자동 RESTART 취소 — ${gate.stage}: ${gate.detail}`);
      addGenieMessage(`⚠️ 자동 재시작 취소됨 (${gate.stage}): ${gate.detail.slice(0, 200)}`, { internal: true });
      return false;
    }
    // 부팅 후 handleSelfRestart가 자동 sendMessage 재발화 (기존 인프라)
    addTodo("genie", `[재시작 후 이어가기] ${nextPrompt.slice(0, 500)}`);
    console.log(`[AutoMode] 자동 RESTART 검증 통과 (${gate.detail}) — 재시작 진행`);
    const { restartSelf } = await import("./jobs.js");
    setTimeout(() => restartSelf().catch((e: unknown) => console.error("[AutoMode] restartSelf 실패:", e)), 500);
    return true;
  } catch (err) {
    console.error("[AutoMode] 자동 RESTART 검증 실패:", err);
    return false;
  }
}

// 자동 진행 배치: 마이크루 busy 대기 중 완료된 작업들을 모아 1회 호출로 처리 (토큰 절감)
let pendingAutoJobs: Array<{ request: string; status: "completed" | "failed" }> = [];
let autoDrainActive = false;

// 한도 도달 시 사용자에게 1회 안내 — 조용한 정지 방지 (다음 사용자 메시지에서 count 리셋)
function notifyAutoCapOnce(): void {
  if (autoCapNoticeSent) return;
  autoCapNoticeSent = true;
  addGenieMessage(`⏸️ 자동 진행 한도(${MAX_AUTO_CONTINUATIONS}회)에 도달해 잠시 멈췄어요. 이어서 진행하려면 메시지를 보내주세요.`);
  console.log(`[MyCrew] 자동 진행 한도 도달 (${MAX_AUTO_CONTINUATIONS}회) — 사용자 안내 발화`);
}

export async function triggerGenieAutoContinuation(
  jobRequest: string,
  jobStatus: "completed" | "failed",
): Promise<void> {
  if (!autoContinuationMode) return;
  if (autoContinuationCount >= MAX_AUTO_CONTINUATIONS) {
    notifyAutoCapOnce();
    return;
  }
  // 진척 게이트로 멈춘 상태 — 정체 보고는 이미 나갔다. 사용자 메시지가 오면 풀린다.
  if (autoContinuationStalled) {
    console.log(`[AutoMode] 정체로 정지 중 — '${jobRequest.slice(0, 40)}' 완료 건은 자동 진행하지 않음`);
    return;
  }
  pendingAutoJobs.push({ request: jobRequest, status: jobStatus });
  if (autoDrainActive) return; // 이미 대기 중인 드레인이 함께 처리
  autoDrainActive = true;
  try {
  // sendMessage 중 새로 쌓인 완료 건도 이어서 처리 (방치 방지)
  while (pendingAutoJobs.length > 0) {
    // 마이크루가 이미 작업 중이면 끝날 때까지 기다림 (병렬 실행 방지)
    await waitForGenieIdle();
    // 기다리는 동안 모드가 꺼졌거나 한도에 도달했을 수 있음 - 다시 체크
    if (!autoContinuationMode) { pendingAutoJobs = []; return; }
    if (autoContinuationCount >= MAX_AUTO_CONTINUATIONS) {
      pendingAutoJobs = [];
      notifyAutoCapOnce();
      return;
    }
    const batch = pendingAutoJobs;
    pendingAutoJobs = [];
    autoContinuationCount++;
    emitGlobalEvent("genie-status", { busy: genieBusy, task: genieTask, startTime: genieBusy ? activeStreamStartTime : undefined, autoMode: autoContinuationMode, autoCount: autoContinuationCount });

    // self 변경 누적 여부 캡처 — prompt 분기(잭키 3단계 규칙) + consume race fix용
    const selfPending = selfRestartPending;
    const selfNote = selfPending
      ? ` self 코드 변경 누적 — 잭키 검증을 3단계로 위임하세요: ① 코드+회귀(planGate=false) → ② <!--RESTART--> 발화 → ③ 부팅 후 라이브 검증 (자동 재발화).`
      : ` 빌드 확인하고 다음 단계를 계속 진행해주세요.`;
    const head = `[시스템 자동 진행 ${autoContinuationCount}/${MAX_AUTO_CONTINUATIONS}]`;
    const prompt = batch.length === 1
      ? `${head} 방금 '${batch[0].request.slice(0, 80)}' 작업이 ${batch[0].status === "completed" ? "완료" : "실패"}되었습니다.${selfNote} 더 진행할 작업이 없으면 ${getUserTitle()}에게 최종 완료를 알려주세요.`
      : `${head} 방금 다음 ${batch.length}건 작업이 끝났습니다:\n${batch.map((b) => `- '${b.request.slice(0, 80)}' ${b.status === "completed" ? "완료" : "실패"}`).join("\n")}\n${selfNote} 더 진행할 작업이 없으면 ${getUserTitle()}에게 최종 완료를 알려주세요.`;

    // 자동 RESTART: self 변경 누적 + idle → 자동 재시작 시도 (사장님 수동 재부팅 제거)
    // 통과 시 process.exit() 예정 — 다음 prompt는 부팅 후 handleSelfRestart가 발화.
    // 실패 시 false 반환 → selfRestartPending 유지 → 다음 자동 진행 사이클에서 재시도 (consume race 폭탄 제거).
    if (selfPending) {
      const restarted = await tryAutoRestart(batch[0].request, prompt);
      if (restarted) {
        setSelfRestartPending(false); // 성공 시에만 consume
        return;
      }
      // 실패: selfRestartPending 그대로 유지 — 평소 자동 진행 폴백 후 다음 사이클에서 재시도.
    }

    try {
      // 진척 관측: 턴 전후 TODO 서명 + 새 위임 수 + 출력(루프 감지).
      const todoSigBefore = todoSignature();
      const reply = await sendMessage(prompt, undefined, undefined, { internal: true, source: "chat:auto-continuation" });
      for (const b of batch) autoRecentRequests.push(`${b.request.slice(0, 100)} (${b.status === "completed" ? "완료" : "실패"})`);
      if (autoRecentRequests.length > 10) autoRecentRequests.splice(0, autoRecentRequests.length - 10);
      if (reply.content.trim()) autoRecentOutputs.push(reply.content);
      if (autoRecentOutputs.length > 5) autoRecentOutputs.splice(0, autoRecentOutputs.length - 5);
      const g = autoProgressGate.record({
        output: reply.content,
        jobsCreated: reply.jobs?.length ?? 0,
        todoSigBefore,
        todoSigAfter: todoSignature(),
      });
      console.log(`[AutoMode] 진척 판정: ${g.progress ? "진척" : "무진척"}(${g.why}) 연속무진척=${autoProgressGate.consecutiveNoProgress}/${autoProgressGate.limit}`);
      if (g.stalled) {
        autoContinuationStalled = true;
        pendingAutoJobs = [];
        console.warn(`[AutoMode] 연속 ${autoProgressGate.limit}회 무진척 — 자동 진행 정지, 정체 보고 발화`);
        await reportAutoContinuationStall(g.why);
        return;
      }
    } catch (err) {
      if (!(err instanceof Error && err.message === "genie_queued")) {
        console.error("[MyCrew] 자동 진행 트리거 실패:", err);
      }
      // genie_queued: 큐가 대신 전달 — 루프 계속 (잔여 pending 처리)
    }
  }
  } finally {
    autoDrainActive = false;
  }
}

// TODO 상태 서명 — 자동 진행 턴 전후 비교용(같으면 TODO 변화 없음).
function todoSignature(): string {
  try {
    return getTodos().map((t) => `${t.id}:${t.status}:${t.state ?? ""}`).sort().join("|");
  } catch { return ""; }
}

// AI-last: 정체 시 저가 단발(비재개) 호출로 «무엇이 막혔는지 / 다음에 필요한 것»을 채팅에 남긴다.
// 실패하면 시스템 문구로 대신 알린다(조용한 정지 금지).
async function reportAutoContinuationStall(why: string): Promise<void> {
  try {
    const p = buildStallPrompt(autoRecentRequests, autoRecentOutputs, why, getUserTitle());
    const r = await sendMessage(p, undefined, undefined, { internal: true, source: "chat:auto-continuation-stalled" });
    if (!/^\[(NOTIFY|REPORT)\]/i.test(r.content.trim())) {
      addGenieMessage(`⏸️ 자동 진행이 ${autoProgressGate.limit}회 연속 진척 없이 반복돼 멈췄어요. 이어가려면 메시지를 보내주세요.`);
    }
  } catch (err) {
    console.error("[AutoMode] 정체 보고 실패:", err);
    addGenieMessage(`⏸️ 자동 진행이 ${autoProgressGate.limit}회 연속 진척 없이 반복돼 멈췄어요. 이어가려면 메시지를 보내주세요.`);
  }
}

let _queueSizeGetter: (() => number) | null = null;
export function registerQueueSizeGetter(fn: () => number): void { _queueSizeGetter = fn; }

export function getGenieStatus(): { busy: boolean; task?: string; startTime?: number; autoMode: boolean; autoCount: number } {
  return { busy: genieBusy, task: genieTask, startTime: genieBusy ? activeStreamStartTime : undefined, autoMode: autoContinuationMode, autoCount: autoContinuationCount };
}

function setGenieBusy(busy: boolean, task?: string): void {
  const wasBusy = genieBusy;
  genieBusy = busy;
  genieTask = busy ? task : undefined;
  if (!wasBusy && busy) {
    genieTurnId = randomUUID();
    resetActiveStream();
    activeStreamStartTime = Date.now();
  }

  // 큐에 아이템 있으면 클라이언트에 busy 유지 (idle 깜빡임 방지)
  const queueSize = _queueSizeGetter?.() ?? 0;
  const clientBusy = genieBusy || (wasBusy && !busy && queueSize > 0);
  emitGlobalEvent("genie-status", {
    busy: clientBusy,
    task: clientBusy ? (genieTask || "큐 처리 대기") : undefined,
    startTime: clientBusy ? (activeStreamStartTime || Date.now()) : undefined,
  });

  // busy → idle 전환 시 스트림 리셋 + 대기자 깨움 + 큐 드레인 트리거
  if (wasBusy && !busy) {
    resetActiveStream();
    activeStreamStartTime = 0;
    if (genieIdleWaiters.length > 0) {
      console.log(`[BusyState] idle 대기자 ${genieIdleWaiters.length}명 깨움`);
      const waiters = genieIdleWaiters;
      genieIdleWaiters = [];
      for (const w of waiters) w();
    }
    console.log(`[BusyState] notifyIdle 호출`);
    import("./genie-queue.js")
      .then((m) => m.notifyIdle())
      .catch((err) => console.error("[notifyIdle]", err));
  }
}

// DelegateTask jobId 버퍼: 응답 종료 시 createdJobs로 flush
const pendingDelegateJobs: Array<{ id: string; request: string; agent?: string }> = [];
export function notePendingDelegateJob(job: { id: string; request: string; agent?: string }): void {
  pendingDelegateJobs.push(job);
}
const WIKI_RE = () => /<!--\s*WIKI\s*:\s*(.*?)\s*-->/gsi;
const SCHEDULE_RE = () => /<!--\s*SCHEDULE\s*:\s*(.*?)\s*-->/gsi;
const SCHEDULE_UPDATE_RE = () => /<!--\s*SCHEDULE_UPDATE\s*:\s*(.*?)\s*-->/gsi;
const SCHEDULE_DELETE_RE = () => /<!--\s*SCHEDULE_DELETE\s*:\s*(.*?)\s*-->/gsi;
// 캘린더 일정 탭(schedules.json) 전용 태그 — SCHEDULE(schedule.md 알림)와 별개 저장소.
// genie.md: CALENDAR={JSON}, CALENDAR_UPDATE={"id",...patch}, CALENDAR_DELETE=<id>
const CALENDAR_RE = () => /<!--\s*CALENDAR\s*:\s*(.*?)\s*-->/gsi;
const CALENDAR_UPDATE_RE = () => /<!--\s*CALENDAR_UPDATE\s*:\s*(.*?)\s*-->/gsi;
const CALENDAR_DELETE_RE = () => /<!--\s*CALENDAR_DELETE\s*:\s*(.*?)\s*-->/gsi;
const RESET_RE = () => /^\s*<!--\s*RESET\s*:\s*(.*?)\s*-->\s*$/gim;
const RESTART_RE = () => /^\s*<!--\s*RESTART\s*-->\s*$/gim;


// ── 재시작 안전 검증 (공용) ──────────────────────────────────────────
// [핫픽스 2026-08-08] 이 게이트는 원래 bash·npx·curl·lsof에 기대고 있었다.
// 이 머신엔 bash가 없어서 execFile("bash", ...)가 항상 실패했는데, 옛 헬퍼는 실패를
// reject가 아니라 "[에러] ..." 문자열로 resolve했다. 그 결과:
//   · tsc 게이트  — "[에러] ..."에 'error TS'가 없어 통과로 읽힘(침묵 통과)
//   · vite 게이트 — 예외가 아니라 정상 resolve라 catch에 들어가지 않음(침묵 통과)
//   · health 게이트 — curl 출력이 JSON이 아니라 JSON.parse가 터져 healthOk가 영원히 false
// 즉 검증이 아니라 '항상 취소'였고, self 코드 변경이 전부 미반영으로 남았다(D-3 훅 404).
// 이제 셸을 거치지 않는다: node 진입점 직접 실행 + 내장 fetch + PID 종료.
// 검증을 느슨하게 만든 게 아니라, 같은 검증을 실제로 수행되게 옮긴 것이다.

/** node로 로컬 CLI를 직접 실행한다(셸·PATH 비의존). ok=false면 진짜 실패다. */
async function runNodeTool(args: string[], timeoutMs: number): Promise<{ ok: boolean; out: string }> {
  const { execFile } = await import("node:child_process");
  return new Promise((resolve) => {
    execFile(process.execPath, args, {
      cwd: PROJECT_SELF_DIR,
      maxBuffer: 5 * 1024 * 1024,
      timeout: timeoutMs,
    }, (error, stdout, stderr) => {
      const out = `${stdout || ""}${stderr || ""}`.trim();
      resolve({ ok: !error, out: out || (error ? error.message : "") });
    });
  });
}

/** OS가 비어 있다고 알려준 포트를 쓴다 — 고정 포트 + lsof 조합이 남기던 유령 인스턴스 오탐 제거. */
async function findFreePort(): Promise<number> {
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error("빈 포트 확보 실패"))));
    });
  });
}

type RestartGateStage = "tsc" | "client-build" | "health" | "passed";
interface RestartGateResult { ok: boolean; stage: RestartGateStage; detail: string }

/**
 * 재시작 전 안전 검증: tsc → 클라이언트 빌드 → 임시 서버 health.
 * 실패하면 어느 단계에서 왜 막혔는지 stage/detail로 돌려준다 — 침묵 취소를 만들지 않는다.
 */
async function runRestartSafetyGate(): Promise<RestartGateResult> {
  const tsc = await runNodeTool([join("node_modules", "typescript", "bin", "tsc"), "--noEmit"], 180_000);
  if (!tsc.ok || /error TS\d+/.test(tsc.out)) {
    return { ok: false, stage: "tsc", detail: tsc.out.slice(0, 400) || "tsc 실행 실패" };
  }
  const build = await runNodeTool(
    [join("node_modules", "vite", "bin", "vite.js"), "build", "--config", "src/client/vite.config.ts"],
    180_000,
  );
  if (!build.ok) return { ok: false, stage: "client-build", detail: build.out.slice(0, 400) || "vite build 실행 실패" };

  let port: number;
  try {
    port = await findFreePort();
  } catch (err) {
    return { ok: false, stage: "health", detail: `임시 포트 확보 실패: ${err instanceof Error ? err.message : String(err)}` };
  }

  // 설치 릴리스는 읽기 전용이고 history/가 없을 수 있다. 런타임 데이터 루트에 기록해야
  // systemd 배포에서도 안전 재시작 게이트가 임시 서버를 띄울 수 있다.
  const dryRunLog = join(ROOT_HISTORY_DIR, `.dry-run-${port}.log`);
  let pid = -1;
  try {
    pid = await spawnDryRunTestServer(port, dryRunLog);
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/staff`, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) continue;
        await res.json();
        return { ok: true, stage: "passed", detail: `임시 서버 :${port} health OK` };
      } catch (err) { swallow("임시 서버 아직 준비 안 됨", err); }
    }
    return { ok: false, stage: "health", detail: `임시 서버 :${port} health 실패 — 로그: ${dryRunLog}` };
  } finally {
    if (pid > 0) safeKill(pid, "SIGTERM");
  }
}

// 임시(dry-run) 서버를 진짜 detached + stdio:ignore 로 띄운다.
// 과거 `bash -c "... tsx src/index.ts &"` 패턴은 자식 tsx가 부모의 stdio pipe를
// 상속·유지하기 때문에 execFile이 stdio close를 기다리며 timeout(30s)까지 hang하던
// 회귀의 근본 원인이었다. 이제는 즉시 반환하고, 임시 서버는 백그라운드에서 부팅된다.
async function spawnDryRunTestServer(port: number, logFile: string): Promise<number> {
  const { spawn } = await import("node:child_process");
  const { openSync } = await import("node:fs");
  const out = openSync(logFile, "a");
  const err = openSync(logFile, "a");
  const child = spawn(process.execPath, [...TSX_CLI_ARGS, "src/index.ts"], {
    cwd: PROJECT_SELF_DIR,
    detached: true,
    stdio: ["ignore", out, err],
    env: withoutAnthropicKeys({ ...process.env, PORT: String(port), DRY_RUN: "1" }),
  });
  child.unref();
  return child.pid ?? -1;
}
const CHECKIN_RE = () => /^\s*<!--\s*CHECKIN\s*:\s*\d+\s*-->\s*$/gim;
const AUTO_RE = () => /^\s*<!--\s*AUTO\s*:\s*(on|off)\s*-->\s*$/gim;
const TODO_ADD_RE = () => /<!--\s*TODO\s*:\s*add\s+(.*?)\s*-->/gsi;
const TODO_DONE_RE = () => /<!--\s*TODO\s*:\s*done\s+(.*?)\s*-->/gsi;
const TODO_CANCEL_RE = () => /<!--\s*TODO\s*:\s*cancel\s+(.*?)\s*-->/gsi;
const TODO_DELETE_RE = () => /<!--\s*TODO\s*:\s*delete\s+(.*?)\s*-->/gsi;
const APPROVAL_RE = () => /<!--\s*APPROVAL\s*:\s*(.*?)\s*-->/gsi;
// 가드레일: 마이크루가 DelegateTask 툴 대신 환각으로 내뱉는 <!--DELEGATE:{json}--> 태그를
// 실제 위임(/api/delegate)으로 라우팅한다. 태그 자체는 정식 위임 메커니즘이 아니다.
const DELEGATE_RE = () => /<!--\s*DELEGATE\s*:\s*(.*?)\s*-->/gsi;

// planGate 에이전트가 포함된 stages에 '계획수립'+'승인대기' 자동 삽입
export function expandStagesForPlanGate(
  stages: string[],
  stageAgents: string[],
): { stages: string[]; stageAgents: string[] } {
  const expanded: string[] = [];
  const expandedAgents: string[] = [];
  for (let i = 0; i < stages.length; i++) {
    const agentId = stageAgents[i];
    if (agentId) {
      const def = getWorkerAgent(agentId);
      if (def?.planGate) {
        expanded.push("계획수립", "승인대기");
        expandedAgents.push(agentId, getGenieName());
      }
    }
    expanded.push(stages[i]);
    expandedAgents.push(agentId ?? "");
  }
  return { stages: expanded, stageAgents: expandedAgents };
}

// Librarian 보호 페이지 — 절대 삭제 금지
function isProtectedPage(page: string): boolean {
  const key = page.replace(/\.md$/i, "");
  if (PROTECTED_PAGE_NAMES.has(key)) return true;
  return PROTECTED_PAGE_PREFIXES.some((p) => key.startsWith(p));
}

function getToday(): string {
  return getTodayKST();
}

let lastUserMessageTime = Date.now();
/** 마지막 사용자 채팅 시각(ms). 상태 변화 배칭의 활동 판정용(state-change-batch.ts). */
export function getLastUserMessageTime(): number { return lastUserMessageTime; }
const ABSENCE_THRESHOLD = 30 * 60 * 1000; // 30분

// 직전 상황 블록 본문(시각 제외) — 무변동 축약 비교용
let lastStatusBody = "";

function getSystemStatus(): string {
  try {
    return _getSystemStatusImpl();
  } catch (err) {
    console.error("[MyCrew] 시스템 상태 조회 실패:", err);
    return `현재 시각: ${new Date().toLocaleString("ko-KR")}\n시스템 상태 조회 실패`;
  }
}

function _getSystemStatusImpl(): string {
  const agents = getAllWorkerAgents();
  const busy = new Set(getBusyAgentIds());
  const jobs = getAllJobs();

  const lines: string[] = [];
  const now = new Date();
  const _wd = ["일", "월", "화", "수", "목", "금", "토"][now.getDay()];
  lines.push(`현재 시각: ${now.toLocaleString("ko-KR")} (${_wd}요일)`);
  lines.push(`날짜 계산 주의: 오늘은 ${_wd}요일. 상대 날짜를 절대날짜로 바꿀 때 반드시 오늘 요일 기준으로 계산하라. "이번주 X요일"=오늘이 속한 주(월~일)의 X요일, "다음주 X요일"=그 다음 주의 X요일. 캘린더(CALENDAR) 등록 시 시각에 +09:00을 반드시 붙일 것.`);

  // 사용자 부재 감지
  const absence = now.getTime() - lastUserMessageTime;
  const isAbsenceBriefing = absence > ABSENCE_THRESHOLD;
  if (absence > ABSENCE_THRESHOLD) {
    const mins = Math.floor(absence / 60000);
    const hours = Math.floor(mins / 60);
    const timeStr = hours > 0 ? `${hours}시간 ${mins % 60}분` : `${mins}분`;
    lines.push(`⚠️ 사용자가 ${timeStr}만에 돌아왔습니다. 그동안 있었던 일을 간략히 브리핑해주세요.`);
  }

  // 직원 상태
  const staffLines: string[] = [];
  for (const agent of agents) {
    const currentJob = getAgentCurrentJob(agent.id);
    if (busy.has(agent.id) && currentJob) {
      staffLines.push(`- ${agent.name}: 작업 중 — "${currentJob.request.slice(0, 60)}"`);
    } else {
      staffLines.push(`- ${agent.name}: 대기 중`);
    }
  }
  if (staffLines.length) lines.push(`직원 상태:\n${staffLines.join("\n")}`);

  // 작업 큐
  const queued = jobs.filter((j) => j.status === "queued");
  const running = jobs.filter((j) => j.status === "running");
  // 부재 중이면 부재 시간 동안의 완료 작업, 아니면 최근 24시간 — 하루 누적 이력 파악용.
  const lookbackMs = Math.max(absence, 24 * 60 * 60 * 1000);
  const recentDone = jobs
    .filter((j) => (j.status === "completed" || j.status === "failed") && j.completedAt)
    .filter((j) => now.getTime() - new Date(j.completedAt!).getTime() < lookbackMs)
    .sort((a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime())
    // 부재 복귀 브리핑 시에만 50건 전체 — 평상시엔 10건 (매 메시지 주입되는 토큰 절감)
    .slice(0, isAbsenceBriefing ? 50 : 10);

  if (running.length) {
    lines.push(`진행 중 작업 (${running.length}건):\n${running.map((j) => `- "${j.request.slice(0, 60)}"`).join("\n")}`);
  }
  if (queued.length) {
    lines.push(`대기 중 작업 (${queued.length}건):\n${queued.map((j) => `- "${j.request.slice(0, 60)}"`).join("\n")}`);
  }
  if (recentDone.length) {
    lines.push(`최근 완료 (${recentDone.length}건):\n${recentDone.map((j) => `- "${j.request.slice(0, 60)}" (${j.status})`).join("\n")}`);
  }
  if (!running.length && !queued.length) {
    lines.push("현재 진행 중이거나 대기 중인 작업 없음");
  }

  // 활성 TODO (ID 포함 — done/cancel 처리용)
  const activeTodos = getTodos().filter(t => t.status !== "done");
  if (activeTodos.length) {
    lines.push(`업무 목록 (${activeTodos.length}건):\n${activeTodos.map(t => `- [${t.id.slice(0, 8)}] "${t.instruction.slice(0, 60)}" (${t.state})`).join("\n")}`);
  }

  // 직전 메시지와 내용 동일(시각 제외)하면 축약 — 매 메시지 반복 주입 토큰 절감.
  // 부재 브리핑 시에는 축약하지 않음 (전체 목록이 브리핑 재료).
  const body = lines.slice(1).join("\n\n");
  if (!isAbsenceBriefing && body === lastStatusBody) {
    return `${lines[0]}\n\n(시스템 상황 변동 없음 — 직전 메시지와 동일)`;
  }
  lastStatusBody = body;
  return lines.join("\n\n");
}

function getConvPath(date?: string): string {
  return join(CONV_DIR, `${date ?? getToday()}.md`);
}

function ensureDirs(): void {
  if (!existsSync(CONV_DIR)) mkdirSync(CONV_DIR, { recursive: true });
  if (!existsSync(WIKI_DIR)) mkdirSync(WIKI_DIR, { recursive: true });
  if (!existsSync(GENIE_DIR)) mkdirSync(GENIE_DIR, { recursive: true });
  if (!existsSync(DAILY_DIR)) mkdirSync(DAILY_DIR, { recursive: true });
}

// --- 사용자 이름 ---

export function getUserName(): string {
  const profilePath = join(WIKI_DIR, "user-profile.md");
  if (!existsSync(profilePath)) return "사용자";
  const content = readFileSync(profilePath, "utf-8");
  const match = content.match(/이름[:\s]*(.+)/);
  return match ? match[1].trim() : "사용자";
}

// --- 위키 ---

let wikiOverLimit = false;

const PAGE_LINE_LIMIT = 200;

function loadWiki(): string {
  ensureDirs();
  // 온디맨드 로딩: index.md만 로드. 개별 페이지는 에이전트가 Read 도구로 읽음.
  const indexPath = join(WIKI_DIR, "index.md");
  let indexContent = "";
  if (existsSync(indexPath)) {
    indexContent = readFileSync(indexPath, "utf-8");
  }

  // 개별 페이지 임계 체크 (Librarian 트리거용) — 파일 크기만 확인, 내용 읽지 않음
  // 한글 기준 1줄 ≈ 60~80바이트, 200줄 ≈ 12KB~16KB → 15KB를 임계로 사용
  const BYTE_LIMIT = 15000;
  const files = readdirSync(WIKI_DIR).filter(
    (f) => f.endsWith(".md") && f !== "index.md",
  );
  const oversized: Array<{ file: string; size: number }> = [];
  for (const file of files) {
    const size = statSync(join(WIKI_DIR, file)).size;
    if (size > BYTE_LIMIT) oversized.push({ file, size });
  }
  wikiOverLimit = oversized.length > 0;
  if (wikiOverLimit) {
    const detail = oversized.map((o) => `${o.file}(${Math.round(o.size / 1024)}KB)`).join(", ");
    console.warn(
      `[MyCrew] ⚠️ ${PAGE_LINE_LIMIT}줄 초과 페이지 ${oversized.length}건 발견: ${detail}. 정리가 필요합니다.`,
    );
  }

  if (!indexContent) return "";
  return `${indexContent}\n\n(개별 페이지는 Read 도구로 ${WIKI_DIR}/<파일명> 읽기)`;
}

function generateScheduleId(content: string): string {
  const existing = new Set<string>();
  for (const m of content.matchAll(/\[s-([a-z0-9]{4})\]/g)) {
    existing.add(m[1]);
  }
  let id: string;
  do {
    id = randomUUID().slice(0, 4).replace(/[^a-z0-9]/g, () => Math.random().toString(36)[2]);
  } while (existing.has(id));
  return `s-${id}`;
}

export function addScheduleEntry(entry: string): void {
  ensureDirs();
  const schedulePath = join(WIKI_DIR, "schedule.md");
  let content = existsSync(schedulePath)
    ? readFileSync(schedulePath, "utf-8")
    : `# ${getGenieName()} 스케줄\n\n## 반복\n\n## 리마인더\n`;

  const id = generateScheduleId(content);
  const isCron = entry.startsWith("cron ");
  const section = isCron ? "## 반복" : "## 리마인더";
  const line = `- [${id}] ${entry}`;

  if (content.includes(section)) {
    const lines = content.split("\n");
    const idx = lines.findIndex(l => l.trim() === section);
    if (idx >= 0) {
      if (idx + 1 < lines.length && lines[idx + 1].startsWith("(")) {
        lines[idx + 1] = line;
      } else {
        lines.splice(idx + 1, 0, line);
      }
      content = lines.join("\n");
    }
  } else {
    content += `\n${section}\n${line}\n`;
  }

  writeFileSync(schedulePath, content);
  console.log(`[MyCrew] 스케줄 추가 [${id}] (${isCron ? "반복" : "일회성"}): ${entry}`);
}

export function updateScheduleEntry(idAndEntry: string): void {
  const schedulePath = join(WIKI_DIR, "schedule.md");
  if (!existsSync(schedulePath)) return;
  // "s-a1b2 cron 0 10 * * *: 새 내용" 형태
  const m = idAndEntry.match(/^(s-[a-z0-9]{4})\s+(.+)/);
  if (!m) { console.warn("[MyCrew] SCHEDULE_UPDATE 파싱 실패:", idAndEntry); return; }
  const [, id, newEntry] = m;
  const lines = readFileSync(schedulePath, "utf-8").split("\n");
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(`[${id}]`)) {
      lines[i] = `- [${id}] ${newEntry}`;
      found = true;
      break;
    }
  }
  if (found) {
    writeFileSync(schedulePath, lines.join("\n"));
    console.log(`[MyCrew] 스케줄 수정 [${id}]: ${newEntry}`);
  } else {
    console.warn(`[MyCrew] SCHEDULE_UPDATE: id=${id} 없음`);
  }
}

export function deleteScheduleEntry(id: string): void {
  const schedulePath = join(WIKI_DIR, "schedule.md");
  if (!existsSync(schedulePath)) return;
  const trimmedId = id.trim();
  const lines = readFileSync(schedulePath, "utf-8").split("\n");
  const filtered = lines.filter(l => !l.includes(`[${trimmedId}]`));
  if (filtered.length < lines.length) {
    writeFileSync(schedulePath, filtered.join("\n"));
    console.log(`[MyCrew] 스케줄 삭제 [${trimmedId}]`);
  } else {
    console.warn(`[MyCrew] SCHEDULE_DELETE: id=${trimmedId} 없음`);
  }
}

export function saveWikiPage(page: string, content: string): void {
  if (JUNK_PAGES.has(page) || JUNK_CONTENTS.has(content.trim())) {
    console.warn(`[MyCrew] placeholder 저장 거부: page="${page}"`);
    return;
  }
  const MAX_WIKI_BYTES = 5000;
  if (Buffer.byteLength(content, "utf-8") > MAX_WIKI_BYTES) {
    console.warn(`[MyCrew] wiki 크기 초과 거부: page="${page}" (${Buffer.byteLength(content, "utf-8")}B > ${MAX_WIKI_BYTES}B). 산출물은 history/outputs/genie/ 에 직접 저장하세요.`);
    return;
  }
  ensureDirs();
  const filename = normalizePageName(page);
  const filepath = join(WIKI_DIR, filename);
  writeFileSync(filepath, content);
  archiveWikiPage(page, content, "genie");

  // index.md 업데이트
  updateWikiIndex(page, filename);
  console.log(`[MyCrew] 위키 업데이트: ${filename}`);

  // 기억 인덱스 증분 갱신 (위키 저장 시, fire-and-forget — memory.search 도구가 최신 색인을 쓰게)
  import("./memory/service.js").then((m) => m.refreshMemoryIndex()).catch(() => {});

  // 위키 정리 필요 체크 → Librarian 비동기 트리거
  loadWiki(); // wikiOverLimit 갱신
  const pageCount = readdirSync(WIKI_DIR).filter((f) => f.endsWith(".md") && f !== "index.md").length;
  if ((wikiOverLimit || pageCount > MAX_WIKI_PAGES) && !librarianRunning) {
    runLibrarian().catch((err) =>
      console.error("[Librarian] 자동 정리 실패:", err),
    );
  }
}

function updateWikiIndex(page: string, filename: string): void {
  const indexPath = join(WIKI_DIR, "index.md");
  // 동시 쓰기 보호 (atomic write)
  let index = existsSync(indexPath) ? readFileSync(indexPath, "utf-8") : `# ${getGenieName()}의 기억\n`;

  const entry = `- [${page}](${filename}) — (업데이트: ${getToday()})`;

  if (!index.includes(filename)) {
    index += `\n${entry}`;
  } else {
    const lineRe = new RegExp(`- \\[[^\\]]+\\]\\(${filename.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\)[^\\n]*`, "g");
    index = index.replace(lineRe, entry);
  }
  const tmp = indexPath + ".tmp";
  writeFileSync(tmp, index);
  renameSync(tmp, indexPath);
}

// --- 압축 전 플러시 ---

async function flushSessionMemory(): Promise<void> {
  if (history.length === 0) return;

  const recent = history.slice(-10);
  const formatted = recent.map((m) => {
    const role = m.role === "user" ? "사용자" : getGenieName();
    const text = m.content.length > 500 ? m.content.slice(0, 500) + "..." : m.content;
    return `[${role}] ${text}`;
  }).join("\n\n");

  // 에이전트로 요약 생성 시도
  try {
    const flushConfig = {
      role: "orchestrator" as const,
      name: "MemoryFlush",
      systemPrompt: `대화 내용을 분석하여 중요한 정보만 추출하세요.
결과를 반드시 WIKI 태그로 출력하세요.
형식: <!--WIKI:{"page":"<실제 페이지명>","content":"<실제 내용>"}-->
저장할 것: 결정사항, 작업 결과, 사용자 요청, 프로젝트 상태
저장하지 않을 것: 인사, 이미 저장된 정보, 일상 대화`,
      allowedTools: [] as string[],
      textOnly: true,
      maxTurns: 1,
      model: resolveTier("cheap"), // 저비용 티어 핀 — 프론티어 모델 불필요
    };

    const result = await runAgent(
      flushConfig,
      "flush",
      `세션이 만료됩니다. 아래 최근 대화에서 중요한 정보를 WIKI 태그로 저장하세요.\n\n${formatted}`,
    );
    if (result.cost) logCost("genie", undefined, result.cost, "genie:flush-memory");

    if (result.success && result.output) {
      // WIKI 태그 파싱하여 저장
      const wikiMatches = result.output.matchAll(WIKI_RE());
      let saved = false;
      for (const match of wikiMatches) {
        try {
          const data = JSON.parse(match[1]) as { page: string; content: string };
          saveWikiPage(data.page, data.content);
          saved = true;
        } catch (err) {
          console.error(
            "[MyCrew] WIKI 파싱 실패 (flush):",
            err instanceof Error ? err.message : err,
            "| body:",
            match[1].slice(0, 200),
          );
        }
      }
      if (saved) {
        console.log("[MyCrew] 세션 만료 — 에이전트 요약 플러시 완료");
        return;
      }
    }
  } catch (err) {
    swallow("세션 만료 요약 플러시 — 폴백 진행", err);
  }

  // 폴백: raw dump
  const today = getToday();
  const lines = recent.map((m) => {
    const role = m.role === "user" ? "사용자" : getGenieName();
    const short = m.content.length > 200 ? m.content.slice(0, 200) + "..." : m.content;
    return `- [${role}] ${short}`;
  });
  const fallbackContent = `# 세션 만료 저장 (${today})\n\n${lines.join("\n")}\n`;
  const filename = `session-flush-${today}.md`;
  const filepath = join(WIKI_DIR, filename);

  if (existsSync(filepath)) {
    appendFileSync(filepath, `\n---\n\n${fallbackContent}`);
  } else {
    writeFileSync(filepath, fallbackContent);
    updateWikiIndex(`세션 플러시 ${today}`, filename);
  }
  archiveWikiPage(`session-flush-${today}`, fallbackContent, "genie");
  console.log("[MyCrew] 세션 만료 — 폴백 플러시 완료");
}

// --- 일일 요약 ---

async function generateDailySummaries(): Promise<void> {
  ensureDirs();
  if (!existsSync(CONV_DIR)) return;

  const convFiles = readdirSync(CONV_DIR).filter((f) => f.endsWith(".md"));
  const today = getToday();

  for (const file of convFiles) {
    const date = file.replace(".md", "");
    if (date === today) continue; // 오늘 것은 스킵

    const summaryPath = join(DAILY_DIR, `${date}.md`);
    if (existsSync(summaryPath)) continue; // 이미 요약됨

    const convPath = join(CONV_DIR, file);
    const convContent = readFileSync(convPath, "utf-8");
    if (convContent.trim().length < 100) continue; // 너무 짧으면 스킵

    // 에이전트로 요약 생성
    try {
      const summarizerConfig = {
        role: "orchestrator" as const,
        name: "Summarizer",
        systemPrompt: "주어진 대화 기록을 핵심 내용만 간결하게 요약하세요. 마크다운 형식으로 5-10줄 이내.",
        allowedTools: [] as string[],
        textOnly: true,
        maxTurns: 1,
        model: resolveTier("cheap"), // 저비용 티어 핀 — 프론티어 모델 불필요
      };
      const result = await runAgent(
        summarizerConfig,
        `summary-${date}`,
        `다음은 ${date}의 대화 기록입니다. 핵심 내용만 간결하게 요약해주세요.\n\n${convContent.slice(0, 8000)}`,
      );
      if (result.cost) logCost("genie", undefined, result.cost, "genie:daily-summary");

      if (result.success && result.output) {
        writeFileSync(summaryPath, `# ${date} 대화 요약\n\n${result.output}\n`);
        console.log(`[MyCrew] 일일 요약 생성: ${date}`);
      }
    } catch {
      console.error(`[MyCrew] 일일 요약 생성 실패: ${date}`);
    }
  }
}

// 오늘 대화 요약 (세션 리셋 시 프롬프트 주입용, 파일 저장 없음)
let todaySummaryCache: { date: string; mtime: number; summary: string } | null = null;

// genie.md 섹션 mtime 캐싱
let genieMdCache: { mtime: number; tagSection: string; coreDirective: string } | null = null;
function loadGenieMdSections(): { tagSection: string; coreDirective: string } {
  const genieMdPath = join(PROJECT_SELF_DIR, "prompts", "genie.md");
  try {
    const mtime = statSync(genieMdPath).mtimeMs;
    if (genieMdCache && genieMdCache.mtime === mtime) return genieMdCache;
    const genieMd = readFileSync(genieMdPath, "utf-8");
    const tagMatch = genieMd.match(/## 보조 태그\n([\s\S]*?)(?=\n##\s|\n$|$)/);
    const tagSection = tagMatch ? tagMatch[1].trim().replace(/`/g, "") : "";
    const coreMatch = genieMd.match(/## 핵심 지시\n([\s\S]*?)(?=\n##\s|\n$|$)/);
    const coreDirective = coreMatch ? coreMatch[1].trim() : "";
    genieMdCache = { mtime, tagSection, coreDirective };
    return genieMdCache;
  } catch { return genieMdCache ?? { tagSection: "", coreDirective: "" }; }
}

// 가이드 키워드 매핑 — index.md에서 동적 파싱 (mtime 캐싱)
let guideIndexCache: { mtime: number; entries: Array<{ file: string; keywords: string[] }> } | null = null;
let guideContentCache = new Map<string, { mtime: number; content: string }>();

function loadGuideIndex(): Array<{ file: string; keywords: string[] }> {
  const indexPath = join(PROJECT_SELF_DIR, "config", "guides", "index.md");
  try {
    const mtime = statSync(indexPath).mtimeMs;
    if (guideIndexCache && guideIndexCache.mtime === mtime) return guideIndexCache.entries;
    const raw = readFileSync(indexPath, "utf-8");
    const entries: Array<{ file: string; keywords: string[] }> = [];
    // 테이블 행 파싱: | `파일명` | ... | 키워드1, 키워드2 |
    for (const line of raw.split("\n")) {
      const m = line.match(/\|\s*`([^`]+)`\s*\|[^|]*\|\s*([^|]+)\|/);
      if (m) {
        const file = m[1];
        const keywords = m[2].split(",").map(k => k.trim().toLowerCase()).filter(Boolean);
        if (keywords.length) entries.push({ file, keywords });
      }
    }
    guideIndexCache = { mtime, entries };
    return entries;
  } catch { return guideIndexCache?.entries ?? []; }
}

function matchGuideByKeyword(message: string): string {
  if (!message) return "";
  const msg = message.toLowerCase();
  const guidesDir = join(PROJECT_SELF_DIR, "config", "guides");
  const entries = loadGuideIndex();
  for (const { file, keywords } of entries) {
    if (keywords.some(kw => msg.includes(kw))) {
      const filePath = join(guidesDir, file);
      try {
        const mtime = statSync(filePath).mtimeMs;
        const cached = guideContentCache.get(file);
        if (cached && cached.mtime === mtime) return cached.content;
        const content = readFileSync(filePath, "utf-8");
        guideContentCache.set(file, { mtime, content });
        return content;
      } catch (err) { swallow("파일 없음", err); }
    }
  }
  return "";
}

// user-profile mtime 캐싱 (부서 + 직책만 추출)
let userProfileCache: { mtime: number; content: string } | null = null;
function loadUserProfileSummary(): string {
  const profilePath = join(WIKI_DIR, "user-profile.md");
  try {
    const mtime = statSync(profilePath).mtimeMs;
    if (userProfileCache && userProfileCache.mtime === mtime) return userProfileCache.content;
    const raw = readFileSync(profilePath, "utf-8");
    const lines = raw.split("\n").filter(l => l.startsWith("- "));
    const pick = lines.filter(l => l.includes("부서:") || l.includes("직업/직책:")).map(l => l.slice(2));
    const content = pick.length ? pick.join(" / ") : "";
    userProfileCache = { mtime, content };
    return content;
  } catch { return userProfileCache?.content ?? ""; }
}

async function generateTodaySummary(): Promise<string | null> {
  const today = getToday();
  const convPath = join(CONV_DIR, `${today}.md`);
  if (!existsSync(convPath)) return null;
  const mtime = statSync(convPath).mtimeMs;
  // 같은 날 + 같은 mtime이면 캐시 반환 (대화 변경 없으면 재생성 안 함)
  if (todaySummaryCache && todaySummaryCache.date === today && todaySummaryCache.mtime === mtime) {
    console.log("[MyCrew] 오늘 대화 요약 캐시 사용");
    return todaySummaryCache.summary;
  }
  // 오늘 캐시가 있으면(내용만 오래됨) 즉시 반환 + 백그라운드 갱신 — 리셋 후 첫 응답 지연 제거.
  // 캐시가 아예 없을 때(서버 재시작 후 첫 리셋)만 동기 생성.
  if (todaySummaryCache && todaySummaryCache.date === today) {
    const stale = todaySummaryCache.summary;
    void refreshTodaySummary(today, convPath, mtime).catch(() => {});
    console.log("[MyCrew] 오늘 대화 요약 stale 캐시 사용 + 백그라운드 갱신");
    return stale;
  }
  return refreshTodaySummary(today, convPath, mtime);
}

let todaySummaryInflight = false;
async function refreshTodaySummary(today: string, convPath: string, mtime: number): Promise<string | null> {
  if (todaySummaryInflight) return todaySummaryCache?.summary ?? null;
  todaySummaryInflight = true;
  try {
  const content = readFileSync(convPath, "utf-8");
  if (content.trim().length < 100) return null;
  try {
    const result = await runAgent(
      {
        role: "orchestrator" as const,
        name: "Summarizer",
        systemPrompt: "주어진 대화 기록을 핵심 내용만 간결하게 요약하세요. 마크다운 형식으로 5-15줄 이내. 진행 중인 작업, 결정사항, 미완료 사항을 우선 포함.",
        allowedTools: [] as string[],
        textOnly: true,
        maxTurns: 1,
        model: resolveTier("cheap"), // 저비용 티어 핀 — 프론티어 모델 불필요
      },
      `today-summary-${today}`,
      `다음은 오늘(${today}) 대화 기록입니다. 핵심 내용만 간결하게 요약해주세요.\n\n${content.slice(0, 12000)}`,
    );
    if (result.cost) logCost("genie", undefined, result.cost, "genie:today-summary");
    if (result.success && result.output) {
      todaySummaryCache = { date: today, mtime, summary: result.output };
      console.log(`[MyCrew] 오늘 대화 요약 생성 완료 (${result.output.length}자)`);
      return result.output;
    }
  } catch {
    console.error("[MyCrew] 오늘 대화 요약 생성 실패");
  }
  return null;
  } finally {
    todaySummaryInflight = false;
  }
}

// --- Librarian: 위키 정리 ---

const MAX_WIKI_PAGES = 20;
let librarianRunning = false;
let workerLibrarianRunning = false;

export async function runLibrarian(): Promise<void> {
  if (librarianRunning) return;
  librarianRunning = true;

  try {
    const files = readdirSync(WIKI_DIR).filter(
      (f) => f.endsWith(".md") && f !== "index.md",
    );
    const pageCount = files.length;
    const needsCleanup = wikiOverLimit || pageCount > MAX_WIKI_PAGES;
    if (!needsCleanup) return;

    // 사서에게 보낼 위키 전체 내용 로드 (정리 판단용)
    const pages: string[] = [];
    for (const file of files) {
      pages.push(`--- ${file} ---\n${readFileSync(join(WIKI_DIR, file), "utf-8")}`);
    }
    const wikiContent = pages.join("\n\n");

    const reason = wikiOverLimit
      ? `개별 페이지 크기 초과`
      : `페이지 수 ${pageCount}개 (제한 ${MAX_WIKI_PAGES}개)`;
    console.log(`[Librarian] 위키 정리 시작 (${reason}, ${files.length}개 파일)`);

    const librarianConfig = {
      role: "orchestrator" as const,
      name: "Librarian",
      systemPrompt: `당신은 위키 정리 담당입니다.
위키 페이지를 ${MAX_WIKI_PAGES}개 이하로 줄이고, 큰 페이지는 요약하세요.
정리 기준:
- 오래된 작업 로그, 세션 플러시 기록 → 아카이브 (삭제)
- 완료된 일회성 작업 기록 → 아카이브
- 중복된 정보 → 하나로 통합
- 일시적 상태 정보 → 아카이브
- 핵심 결정사항, 사용자 선호도 → 유지
- 비슷한 feedback → 하나로 통합
결과를 WIKI 태그로 출력하세요.
형식: <!--WIKI:{"page":"<실제 페이지명>","content":"<정리된 내용>"}-->
아카이브할 페이지는: <!--WIKI:{"page":"<실제 페이지명>","content":""}-->

보호 대상 — 다음 페이지는 절대 삭제하지 마세요: ${[...PROTECTED_PAGE_NAMES].join(", ")}, ${PROTECTED_PAGE_PREFIXES.map((p) => p + "*").join(", ")}로 시작하는 페이지.
이 페이지들에 대해서는 빈 content WIKI 태그를 절대 출력하지 마세요. 내용이 길면 요약만 허용됩니다.`,
      allowedTools: [] as string[],
      textOnly: true,
      maxTurns: 5,
      model: resolveTier("cheap"), // 저비용 티어 핀 — 프론티어 모델 불필요
    };

    const result = await runAgent(
      librarianConfig,
      "librarian",
      `위키 정리가 필요합니다. (${reason})\n\n${wikiContent}`,
    );
    if (result.cost) logCost("genie", undefined, result.cost, "genie:librarian");

    let archivedCount = 0;
    let updatedCount = 0;

    if (result.success && result.output) {
      const wikiMatches = result.output.matchAll(WIKI_RE());
      for (const match of wikiMatches) {
        try {
          const data = JSON.parse(match[1]) as { page: string; content: string };
          if (data.content === "") {
            // 보호 페이지 건너뜀
            if (isProtectedPage(data.page)) {
              console.log(`[Librarian] 보호 페이지 건너뜀: ${data.page}`);
              continue;
            }
            // 삭제 (archive/wiki/날짜/에 생성 시 사본이 이미 보존됨)
            const filename = normalizePageName(data.page);
            const filepath = join(WIKI_DIR, filename);
            if (!existsSync(filepath)) continue;
            unlinkSync(filepath);
            archivedCount++;
            console.log(`[Librarian] 페이지 삭제: ${filename}`);
          } else {
            saveWikiPage(data.page, data.content);
            updatedCount++;
          }
        } catch (err) {
          console.error(
            "[Librarian] WIKI 파싱 실패:",
            err instanceof Error ? err.message : err,
            "| body:",
            match[1].slice(0, 200),
          );
        }
      }

      // index.md 재구축
      rebuildWikiIndex();
      console.log(
        `[Librarian] 위키 정리 완료 — 아카이브 ${archivedCount}건, 정리 ${updatedCount}건`,
      );

      if (archivedCount + updatedCount > 0) {
        addGenieMessage(
          `📚 위키 정리: ${archivedCount}개 페이지 아카이브, ${updatedCount}개 페이지 정리됨`,
        );
      }
    }
    // 워커 에이전트 위키 정리
  } catch (err) {
    console.error("[Librarian] 정리 실패:", err);
  } finally {
    librarianRunning = false;
  }
}

export async function runWorkerLibrarian(agentId?: string): Promise<void> {
  if (workerLibrarianRunning) { console.log("[Librarian] worker skip — already running"); return; }
  workerLibrarianRunning = true;
  try {
    const allAgents = getAllWorkerAgents();
    const agents = agentId
      ? allAgents.filter((a) => a.id === agentId)
      : allAgents;
    for (const agent of agents) {
    const wDir = join(ROOT_HISTORY_DIR, "agents", agent.id, "wiki");
    if (!existsSync(wDir)) continue;
    const files = readdirSync(wDir).filter((f) => f.endsWith(".md") && f !== "index.md");
    if (files.length <= MAX_WIKI_PAGES) continue;

    const pages = files.map((f) => `--- ${f} ---\n${readFileSync(join(wDir, f), "utf-8")}`);
    const wikiContent = pages.join("\n\n");
    console.log(`[Librarian] ${agent.name} 위키 정리 시작 (${files.length}개 파일, 제한 ${MAX_WIKI_PAGES}개)`);

    const config = {
      role: "orchestrator" as const,
      name: "Librarian",
      systemPrompt: `당신은 위키 정리 담당입니다.
위키 페이지를 ${MAX_WIKI_PAGES}개 이하로 줄이고, 큰 페이지는 요약하세요.
정리 기준:
- 오래된 작업 로그 → 아카이브
- 완료된 일회성 작업 기록 → 아카이브
- 중복 → 통합
- 핵심 결정사항, 피드백 → 유지
결과를 WIKI 태그로 출력하세요.
형식: <!--WIKI:{"page":"<실제 페이지명>","content":"<정리된 내용>"}-->
아카이브: <!--WIKI:{"page":"<실제 페이지명>","content":""}-->

보호 대상: ${[...PROTECTED_PAGE_NAMES].join(", ")}, ${PROTECTED_PAGE_PREFIXES.map((p) => p + "*").join(", ")}로 시작하는 페이지는 절대 삭제 금지.`,
      allowedTools: [] as string[],
      textOnly: true,
      maxTurns: 5,
      model: resolveTier("cheap"), // 저비용 티어 핀 — 프론티어 모델 불필요
    };

    const result = await runAgent(config, `librarian-${agent.id}`, `${agent.name} 위키 정리 (${files.length}개 → ${MAX_WIKI_PAGES}개 이하)\n\n${wikiContent}`);
    if (result.cost) logCost(agent.id, undefined, result.cost, "worker:librarian");
    if (!result.success || !result.output) continue;

    let archived = 0;
    let updated = 0;
    const wikiMatches = result.output.matchAll(WIKI_RE());
    for (const match of wikiMatches) {
      try {
        const data = JSON.parse(match[1]) as { page: string; content: string };
        const filename = normalizePageName(data.page);
        if (data.content === "") {
          if (isProtectedPage(data.page)) continue;
          const filepath = join(wDir, filename);
          if (!existsSync(filepath)) continue;
          unlinkSync(filepath);
          archived++;
        } else {
          const { savePmWikiPage } = await import("./pm-memory.js");
          savePmWikiPage(agent.id, data.page, data.content);
          updated++;
        }
      } catch (err) { swallow("skip", err); }
    }

    // index.md 재구축
    const remaining = readdirSync(wDir).filter((f) => f.endsWith(".md") && f !== "index.md");
    let index = `# ${agent.name}의 기억\n`;
    for (const f of remaining) {
      index += `\n- [${f.replace(".md", "")}](${f})`;
    }
    writeFileSync(join(wDir, "index.md"), index);

    if (archived + updated > 0) {
      console.log(`[Librarian] ${agent.name} 정리 완료 — 아카이브 ${archived}건, 정리 ${updated}건`);
    }
    }
  } finally {
    workerLibrarianRunning = false;
  }
}

function rebuildWikiIndex(): void {
  const files = readdirSync(WIKI_DIR).filter(
    (f) => f.endsWith(".md") && f !== "index.md",
  );
  let index = `# ${getGenieName()}의 기억\n`;
  for (const file of files) {
    const name = file.replace(".md", "").replace(/-/g, " ");
    index += `\n- [${name}](${file})`;
  }
  writeFileSync(join(WIKI_DIR, "index.md"), index);
}

// --- 세션 ---

function loadSession(): void {
  if (sessionId) return;
  if (!existsSync(SESSION_FILE)) return;
  try {
    const data = JSON.parse(readFileSync(SESSION_FILE, "utf-8"));
    sessionId = data.sessionId;
    console.log(`[MyCrew] 세션 복원: ${sessionId}`);
  } catch (err) {
    swallow("세션 파일 파싱 — 새 세션 시작", err);
  }
}

// terminal-ws.ts 호환 — 신규 PTY 세션용 컨텍스트 구성 stub.
// 실제 시스템 프롬프트는 baseDirective로 충분하므로 빈 문자열 반환.
export async function buildSessionContext(): Promise<string> {
  return "";
}
// terminal-ws.ts 호환 — PTY가 새 세션 시작 시 모듈 sessionId 동기화.
export function setGenieSessionId(id: string, _opts?: { resetTokens?: boolean }): void {
  sessionId = id;
  saveSession();
}

function saveSession(): void {
  ensureDirs();
  // 기존 데이터 보존 (startedAt, baseTokens, lastTokens)
  let existing: Record<string, unknown> = {};
  try { if (existsSync(SESSION_FILE)) existing = JSON.parse(readFileSync(SESSION_FILE, "utf-8")); } catch (err) { swallow("unexpected", err); }
  existing.sessionId = sessionId;
  writeFileSync(SESSION_FILE, JSON.stringify(existing));
}

export function resetGenieSession(silent = false): void {
  sessionId = undefined;
  saveSession();
  history.length = 0;
  historyLoaded = false;
  if (!silent) addGenieMessage(`🔄 ${getGenieName()}가 기분전환(세션리셋)했습니다.`);
  console.log("[MyCrew] 세션 리셋 완료");
}

// --- 대화 기록 ---

function appendToLog(msg: ChatMessage): void {
  ensureDirs();
  const time = new Date(msg.timestamp).toLocaleTimeString("ko-KR");
  const sender = msg.role === "user" ? "사용자" : getGenieName();
  // internal/pending 표식 디스크 보존 — 재시작 후 parseConvFile에서 flag 복원.
  const flags: string[] = [];
  if (msg.internal) flags.push("internal");
  if (msg.pending) flags.push("pending");
  const flagSuffix = flags.length ? ` (${flags.join(", ")})` : "";
  let entry = `\n### [${time}] ${sender}${flagSuffix}\n\n${msg.content}\n`;

  if (msg.attachments?.length) {
    entry += `\n첨부:\n${msg.attachments.map((p) => `- ![image](${p})`).join("\n")}\n`;
  }

  if (msg.jobs?.length) {
    entry += `\n작업 생성:\n${msg.jobs.map((j) => `- \`${j.id}\`${j.agent ? ` (${j.agent})` : ""}: ${j.request}`).join("\n")}\n`;
  }

  appendFileSync(getConvPath(), entry);
}

const MAX_DISPLAY_MESSAGES = 100;

function parseConvFile(path: string, dateStr: string): ChatMessage[] {
  if (!existsSync(path)) return [];
  const content = readFileSync(path, "utf-8");
  // system 헤더(## system / ...)도 split 경계로 인식 — 직전 user/genie 본문에 raw JSON이 합쳐지는 회귀 방지
  const blocks = content.split(/\n(?:### \[|## system )/).filter(Boolean);
  const msgs: ChatMessage[] = [];

  for (const block of blocks) {
    const match = block.match(
      /^(.+?)\] (사용자|\S+)(?: \(([^)]+)\))?\n\n([\s\S]*?)(?=\n첨부:|\n작업 생성:|$)/,
    );
    if (!match) continue;

    const [, timeStr, sender, flagsStr, text] = match;
    const flagList = flagsStr ? flagsStr.split(", ") : [];
    const isInternal = flagList.includes("internal");
    const isPending = flagList.includes("pending");
    let timestamp: string;
    try {
      const amPm = timeStr.includes("오후");
      const timeParts = timeStr.replace(/오전|오후/g, "").trim().split(":");
      let h = parseInt(timeParts[0], 10);
      if (amPm && h < 12) h += 12;
      if (!amPm && h === 12) h = 0;
      const m = parseInt(timeParts[1], 10) || 0;
      const s = parseInt(timeParts[2], 10) || 0;
      const d = new Date(`${dateStr}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}+09:00`);
      timestamp = d.toISOString();
    } catch {
      timestamp = new Date().toISOString();
    }
    // 작업 생성 블록에서 jobs 복원 (agent 옵셔널 그룹 — 옛 메시지 호환)
    let jobs: Array<{ id: string; request: string; agent?: string }> | undefined;
    const jobsMatch = block.match(/\n작업 생성:\n((?:- `[^`]+`(?: \([^)]+\))?: .+\n?)+)/);
    if (jobsMatch) {
      jobs = [];
      for (const line of jobsMatch[1].split("\n")) {
        const jm = line.match(/^- `([^`]+)`(?: \(([^)]+)\))?: (.+)/);
        if (jm) jobs.push({ id: jm[1], request: jm[3], agent: jm[2] });
      }
      if (!jobs.length) jobs = undefined;
    }
    msgs.push({
      id: randomUUID(),
      role: sender === "사용자" ? "user" : "genie",
      content: text.trim(),
      timestamp,
      jobs,
      ...(isInternal ? { internal: true } : {}),
      ...(isPending ? { pending: true } : {}),
    });
  }
  return msgs;
}

function loadHistoryFromDisk(): void {
  if (historyLoaded) return;
  historyLoaded = true;
  loadSession();

  // 최근 N건 채울 때까지 날짜를 거슬러 올라감 (최대 7일, KST 기준)
  const allMsgs: ChatMessage[] = [];
  for (let i = 0; i < 7 && allMsgs.length < MAX_DISPLAY_MESSAGES; i++) {
    const dateStr = kstDaysAgo(i);
    const msgs = parseConvFile(getConvPath(dateStr), dateStr);
    allMsgs.unshift(...msgs);
  }
  history.push(...allMsgs.slice(-MAX_DISPLAY_MESSAGES));
}

// --- 최근 대화 로드 ---

function listRecentConversations(): string {
  ensureDirs();
  if (!existsSync(CONV_DIR)) return "";

  const files = readdirSync(CONV_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();

  if (files.length === 0) return "";

  const today = getToday();
  const lines: string[] = [];

  for (const file of files) {
    lines.push(`- ${CONV_DIR}/${file}`);
  }

  return `이전 대화 기록 (경로만 — 필요 시 Read 도구로 확인):\n${lines.join("\n")}`;
}

// --- 온보딩 ---

const ONBOARDING_DONE_FILE = join(GENIE_DIR, ".onboarding-done");

export function isOnboardingNeeded(): boolean {
  ensureDirs();
  return !existsSync(ONBOARDING_DONE_FILE);
}

let onboardingInProgress = false;
export function isOnboardingInProgress(): boolean { return onboardingInProgress; }

export function completeOnboarding(name: string, genieName: string, ctoName?: string, csoName?: string, cqoName?: string, companyName?: string, department?: string, contactEmail?: string, contactPhone?: string, jobTitle?: string): void {
  onboardingInProgress = true;
  const cto = ctoName || "데이브";
  const cso = csoName || "리사";
  const cqo = cqoName || "잭키";
  ensureDirs();

  // 사용자 프로필 저장 (archiveWikiPage 실패 시에도 온보딩 계속)
  const profileLines = [`# 사용자 프로필`, ``, `- 이름: ${name}`];
  if (companyName) profileLines.push(`- 회사: ${companyName}`);
  if (department) profileLines.push(`- 부서: ${department}`);
  if (jobTitle) profileLines.push(`- 직업/직책: ${jobTitle}`);
  if (contactEmail) profileLines.push(`- 이메일: ${contactEmail}`);
  if (contactPhone) profileLines.push(`- 전화번호: ${contactPhone}`);
  try { saveWikiPage("user-profile", profileLines.join("\n")); } catch (e) { console.error("[Onboarding] user-profile 저장 실패:", e); }

  // myProfile 저장 (partners.json) — 클라이언트 API 호출이 인증 문제로 실패할 수 있으므로 서버에서 직접
  try {
    import("./partners.js").then(({ setMyProfile, loadPartners }) => {
      loadPartners();
      setMyProfile({ companyName: companyName || "", contactName: name, secretaryName: genieName, department: department || "", contactEmail: contactEmail || "", contactPhone: contactPhone || "" });
      console.log("[Onboarding] myProfile 저장 완료");
    }).catch((e) => console.error("[Onboarding] myProfile 저장 실패:", e));
  } catch (e) { console.error("[Onboarding] myProfile import 실패:", e); }

  // role-directive 자동 생성 — 템플릿에서 복사 + 이름 치환
  const rdTemplatePath = join(PROJECT_SELF_DIR, "config", "role-directives", "genie.md");
  const rdPath = join(WIKI_DIR, "role-directive.md");
  if (!existsSync(rdPath) && existsSync(rdTemplatePath)) {
    try {
      let tmpl = readFileSync(rdTemplatePath, "utf-8");
      tmpl = tmpl.replace(/\{\{GENIE\}\}/g, genieName).replace(/\{\{USER\}\}/g, name);
      saveWikiPage("role-directive", tmpl);
    } catch (e) { console.error("[Onboarding] role-directive 저장 실패:", e); }
  }

  // agents.json 자동 생성 (템플릿에서 복사 + 이름 치환)
  const agentsJsonPath = join(ROOT_HISTORY_DIR, "agents.json");
  if (!existsSync(agentsJsonPath)) {
    const templatePath = join(PROJECT_SELF_DIR, "config", "agents-default.json");
    if (existsSync(templatePath)) {
      let tmpl = readFileSync(templatePath, "utf-8");
      tmpl = tmpl.replace(/\{\{CTO\}\}/g, cto).replace(/\{\{CSO\}\}/g, cso).replace(/\{\{CQO\}\}/g, cqo);
      writeFileSync(agentsJsonPath, tmpl);
    }
    console.log("[MyCrew] agents.json 기본 생성 (템플릿)");
  }

  // genie-config.json 자동 생성 (템플릿에서 복사)
  const genieConfigPath = join(ROOT_HISTORY_DIR, "genie-config.json");
  if (!existsSync(genieConfigPath)) {
    const templatePath = join(PROJECT_SELF_DIR, "config", "genie-config-default.json");
    if (existsSync(templatePath)) {
      writeFileSync(genieConfigPath, readFileSync(templatePath, "utf-8"));
    }
    console.log("[MyCrew] genie-config.json 기본 생성 (템플릿)");
  }


  // 직원 role-directive 자동 생성 — 템플릿에서 복사 + 이름 치환
  const agentsDir = join(ROOT_HISTORY_DIR, "agents");
  const rdReplacements: Record<string, string> = {
    "{{GENIE}}": genieName, "{{USER}}": name,
    "{{CTO}}": cto, "{{CSO}}": cso, "{{CQO}}": cqo,
  };
  function applyTemplate(content: string): string {
    let result = content;
    for (const [key, val] of Object.entries(rdReplacements)) {
      result = result.replace(new RegExp(key.replace(/[{}]/g, "\\$&"), "g"), val);
    }
    return result;
  }
  // isCore=true 직원의 role-directive 자동 생성 (agents.json + agents-default.json 합집합)
  let coreAgentIds: string[] = [];
  try {
    const liveCores = (JSON.parse(readFileSync(agentsJsonPath, "utf-8")) as { agents: Array<{ id: string; isCore?: boolean }> })
      .agents.filter((a) => a.isCore).map((a) => a.id);
    const defaultPath = join(PROJECT_SELF_DIR, "config", "agents-default.json");
    const defCores = existsSync(defaultPath)
      ? (JSON.parse(readFileSync(defaultPath, "utf-8")) as { agents: Array<{ id: string; isCore?: boolean }> })
          .agents.filter((a) => a.isCore).map((a) => a.id)
      : [];
    coreAgentIds = Array.from(new Set([...liveCores, ...defCores]));
  } catch (e) { console.error("[Onboarding] isCore 추출 실패:", e); }
  for (const agentId of coreAgentIds) {
    const destPath = join(agentsDir, agentId, "wiki", "role-directive.md");
    const tmplPath = join(PROJECT_SELF_DIR, "config", "role-directives", `${agentId}.md`);
    if (!existsSync(destPath) && existsSync(tmplPath)) {
      mkdirSync(join(agentsDir, agentId, "wiki"), { recursive: true });
      writeFileSync(destPath, applyTemplate(readFileSync(tmplPath, "utf-8")));
      console.log(`[MyCrew] ${agentId} role-directive 생성 (템플릿)`);
    }
  }

  // .mcp.json 자동 생성 (원본에서 복사, 없을 때만)
  const mcpDest = join(PROJECT_SELF_DIR, ".mcp.json");
  const mcpBase = join(PROJECT_SELF_DIR, "config", "mcp-base.json");
  if (!existsSync(mcpDest) && existsSync(mcpBase)) {
    writeFileSync(mcpDest, readFileSync(mcpBase, "utf-8"));
    console.log("[MyCrew] .mcp.json 기본 설정 생성");
  }

  // external-reports 폴더 생성
  const externalReportsDir = join(ROOT_HISTORY_DIR, "external-reports");
  if (!existsSync(externalReportsDir)) mkdirSync(externalReportsDir, { recursive: true });

  // 에이전트별 폴더 구조 생성 (agents.json에서 동적 추출)
  const agentsData = JSON.parse(readFileSync(agentsJsonPath, "utf-8")) as { agents: Array<{ id: string; name: string }> };
  const agentEntries = agentsData.agents;
  for (const entry of agentEntries) {
    const id = entry.id;
    const wikiDir = join(agentsDir, id, "wiki");
    const dailyDir = join(wikiDir, "daily");
    const outputsDir = join(ROOT_HISTORY_DIR, "outputs", id);
    if (!existsSync(dailyDir)) mkdirSync(dailyDir, { recursive: true });
    if (!existsSync(outputsDir)) mkdirSync(outputsDir, { recursive: true });

    // index.md 초기 생성
    const indexPath = join(wikiDir, "index.md");
    if (!existsSync(indexPath)) {
      writeFileSync(indexPath, `# ${entry.name}의 기억\n\n## 기억\n- [role-directive](role-directive.md)\n\n## 주요 산출물 (최대 5건)\n(전체: history/outputs/${id}/ — Glob/Read로 접근)\n`);
      console.log(`[MyCrew] ${id} index.md 생성`);
    }
  }

  // 마이크루 outputs 폴더
  const genieOutputsDir = join(ROOT_HISTORY_DIR, "outputs", "genie");
  if (!existsSync(genieOutputsDir)) mkdirSync(genieOutputsDir, { recursive: true });

  // 마이크루 index.md 초기 생성
  const genieIndexPath = join(WIKI_DIR, "index.md");
  if (!existsSync(genieIndexPath)) {
    writeFileSync(genieIndexPath, `# ${genieName}의 기억\n\n## 기억\n- [role-directive](role-directive.md)\n- [user-profile](user-profile.md)\n\n## 주요 산출물 (최대 5건)\n(전체: history/outputs/genie/ — Glob/Read로 접근)\n`);
    console.log("[MyCrew] 마이크루 index.md 생성");
  }

  // 자동 모드는 온보딩 시 기본 OFF — 이전에는 여기서 무조건 ON으로 켰으나,
  // AutoMode 자동진행이 self-restart 루프를 유발해 Genie PTY가 반복 종료되고
  // 데어스가 무응답이 되는 장애가 반복됐다(2026-07-02/03). 사용자가 필요 시
  // /api/auto-mode 또는 UI 토글로 명시적으로 켠다.
  setAutoContinuationMode(false);

  // 스케줄러 state에 오늘 리셋 완료 표시 (온보딩 당일 불필요한 리셋 메시지 방지)
  const schedulerStatePath = join(GENIE_DIR, "scheduler-state.json");
  try {
    const ss: Record<string, unknown> = existsSync(schedulerStatePath) ? JSON.parse(readFileSync(schedulerStatePath, "utf-8")) : {};
    const today = getToday();
    const ra: Record<string, string> = (ss.resetedAgents as Record<string, string>) ?? {};
    ra["genie"] = today;
    for (const entry of agentEntries) ra[entry.id] = today;
    ss.resetedAgents = ra;
    ss.lastReset = today;
    writeFileSync(schedulerStatePath, JSON.stringify(ss, null, 2));
  } catch (err) { swallow("unexpected", err); }

  // 온보딩 완료 플래그 (마이크루 이름 포함)
  writeFileSync(ONBOARDING_DONE_FILE, JSON.stringify({ genieName, completedAt: new Date().toISOString() }));
  onboardingInProgress = false;
  console.log(`[MyCrew] 온보딩 완료: ${name} (비서: ${genieName})`);

  // 온보딩 후 첫 안내 — 자기소개 + 직원 소개 + README-USER.md 기반 사용법
  try {
    const userGuidePath = join(PROJECT_SELF_DIR, "README-USER.md");
    const guide = existsSync(userGuidePath) ? readFileSync(userGuidePath, "utf-8") : "";
    const onboardingPrompt = `온보딩이 완료됐어. 첫 인사를 해줘. 응답 첫 줄에 반드시 [NOTIFY]를 붙여.

너: ${genieName} (${name}의 AI 비서)
사용자: ${name}
직원: ${cto}(개발팀장), ${cso}(기획팀장), ${cqo}(감사팀장)

첫 인사에 포함할 내용:
1. 자기소개 (이름, 역할)
2. 직원들 소개 (이름, 역할 한 줄씩)
3. 아래 사용 가이드를 참고해서 주요 기능 안내 (그대로 읽지 말고 핵심만 짧게)

${guide}`;
    sendMessage(onboardingPrompt, undefined, undefined, { internal: true, source: "onboarding" })
      .catch((err) => console.error("[Onboarding] 첫 안내 실패:", err));
  } catch (err) {
    console.error("[Onboarding] 첫 안내 준비 실패:", err);
  }
}

export function getGenieName(): string {
  ensureDirs();
  if (!existsSync(ONBOARDING_DONE_FILE)) return "MyCrew";
  try {
    const data = JSON.parse(readFileSync(ONBOARDING_DONE_FILE, "utf-8"));
    return data.genieName || "MyCrew";
  } catch {
    return "MyCrew";
  }
}

// --- 공개 API ---

export function getGenieSessionId(): string | undefined {
  loadHistoryFromDisk();
  return sessionId;
}

export function getGenieSessionInfo(): { sessionId?: string; startedAt?: string; baseTokens?: number; lastTokens?: number } {
  try {
    if (existsSync(SESSION_FILE)) return JSON.parse(readFileSync(SESSION_FILE, "utf-8"));
  } catch (err) { swallow("unexpected", err); }
  return {};
}

export function getChatHistory(): ChatMessage[] {
  loadHistoryFromDisk();
  // internal=true 중 사장님에게 보여야 하는 것만 통과:
  // - [REPORT]/[NOTIFY] 마커 (보고/알림)
  // - <!--JOB_COMPLETE: (결과보기 버튼)
  // - 🔐 (승인 요청 카드)
  return history.filter(
    (m) => !m.internal || REPORT_MARKER_RE.test(m.content) || JOB_COMPLETE_RE.test(m.content) || m.content.includes('🔐'),
  );
}

export function addGenieMessage(
  content: string,
  options?: { internal?: boolean; logOnly?: boolean },
): void {
  // 온보딩 중 리셋 메시지 억제
  if (onboardingInProgress && content.includes("기분전환")) return;
  // 빈 content 메시지 방지 (연속 도구호출 시 빈 말풍선 방지)
  if (!content.trim() && !options?.logOnly) return;
  
  loadHistoryFromDisk();
  
  // 중복 메시지 방지: 직전 genie 메시지와 동일하고 3초 이내면 스킵
  // 단, 마커 메시지(<!--...-->)는 정상 동작 보존을 위해 예외
  const hasMarker = /<!--.*?-->/.test(content);
  if (!hasMarker && !options?.logOnly) {
    const lastGenie = [...history].reverse().find(m => m.role === "genie");
    if (lastGenie && lastGenie.content === content) {
      const timeDiff = Date.now() - new Date(lastGenie.timestamp).getTime();
      if (timeDiff < 3000) {
        console.log(`[Chat] 중복 메시지 스킵 (${timeDiff}ms 이내): "${content.slice(0, 60)}"`);
        return;
      }
    }
  }
  
  const msg: ChatMessage = {
    id: randomUUID(),
    role: "genie",
    content,
    timestamp: new Date().toISOString(),
    ...(options?.internal ? { internal: true } : {}),
  };
  history.push(msg);
  appendToLog(msg);
  if (!options?.internal) {
    archiveChatMessage("genie", content);
  }
  if (!options?.logOnly) {
    emitGlobalEvent("chat", { id: msg.id, role: "genie", content, timestamp: msg.timestamp });
    // 동료 자동 회신 마커 후처리 (fire-and-forget, dynamic import로 순환 의존성 회피)
    if (content.includes("[REPLY_TO_PARTNER")) {
      import("./external-inbound.js").then((m) => m.processGenieReplyMarker(content)).catch(() => {});
    }
     // 텔레그램 회신 마커 후처리 (fire-and-forget, dynamic import로 순환 의존성 회피)
    if (content.includes("[REPLY_TO_TELEGRAM")) {
      import("./telegram.js").then((m) => m.processGenieTelegramReplyMarker(content)).catch(() => {});
    }
    // 디스코드 회신 마커 후처리 (fire-and-forget, dynamic import로 순환 의존성 회피)
    if (content.includes("[REPLY_TO_DISCORD")) {
      import("./discord.js").then((m) => m.processGenieDiscordReplyMarker(content)).catch(() => {});
    }
  }
}

// Phase B: 승인 요청 → 대화창 주입 바인딩 (approvals.ts → addGenieMessage 단방향)
// server/index.ts의 startServer()에서 호출 (ESM 순환 import TDZ 회피 — Step 11 Phase 1 수정)
export function bindApprovalNotifier(): void {
  setApprovalNotifier((req: ApprovalRequest) => {
    const shortId = req.id.slice(0, 8);
    console.log(`[MyCrew] 승인 요청 대화창 주입: ${shortId} (${req.tool} ${req.path})`);
    const msg = `🔐 [승인 요청 ${shortId}]\n- 에이전트: ${req.agentRole}\n- 도구: ${req.tool}\n- 경로: ${req.path}\n\n판단 후 응답:\n<!--APPROVAL:{"id":"${req.id}","decision":"allow|deny","reason":"<한 줄>"}-->`;
    addGenieMessage(msg, { internal: true });
    // 3단계: 마이크루 비동기 의견 spawn (사장님 무응답 시 55초 후 autoDecide 1순위로 적용)
    setTimeout(() => {
      spawnGenieOpinion(req).catch(err => {
        console.error(`[Approval] genieOpinion 비동기 실패:`, err instanceof Error ? err.message : err);
      });
    }, 0);
  });
}

export async function sendMessage(
  message: string,
  attachments?: string[],
  browserId?: string,
  options?: { internal?: boolean; source?: string; pendingId?: string },
): Promise<ChatMessage> {
  // 사용자 메시지 큐잉은 lock 밖에서 처리 (lock 대기 방지)
  const isInternal = options?.internal === true;
  console.log(`[SendMessage] source=${options?.source ?? 'user'} internal=${isInternal} genieBusy=${genieBusy}`);
  if (!isInternal && genieBusy) {
    return _queueUserMessage(message, attachments, browserId);
  }
  if (isInternal && genieBusy) {
    const source = options?.source ?? "unknown";
    const RESPONSE_DEPENDENT = new Set(["job:report", "scheduler:state-change"]);
    if (RESPONSE_DEPENDENT.has(source)) {
      throw new Error("genie_busy");
    }
    const { enqueueInternal } = await import("./genie-queue.js");
    const r = enqueueInternal(message, source, { attachments, browserId });
    console.log(`[MyCrew] 큐잉: ${source} → ${r.queued ? "queued:" + r.id : "dropped:" + r.dropped}`);
    throw new Error("genie_queued");
  }
  return withAgentLock("genie", () =>
    _sendMessageImpl(message, attachments, browserId, options),
  );
}

async function _queueUserMessage(
  message: string,
  attachments?: string[],
  browserId?: string,
): Promise<ChatMessage> {
  loadHistoryFromDisk();
  const userMsg: ChatMessage = {
    id: randomUUID(),
    role: "user",
    content: message,
    timestamp: new Date().toISOString(),
    attachments,
    pending: true,
  };
  history.push(userMsg);
  appendToLog(userMsg);
  archiveChatMessage("user", message, { browserId, attachments });
  emitGlobalEvent("chat", {
    id: userMsg.id,
    role: "user",
    content: message,
    timestamp: userMsg.timestamp,
    attachments,
    browserId,
    pending: true,
  });
  const { enqueueUser } = await import("./genie-queue.js");
  const r = enqueueUser(message, attachments, browserId, userMsg.id);
  console.log(`[MyCrew] 사용자 메시지 큐잉: ${r.queued ? "queued:" + r.id : "dropped:" + r.dropped}`);
  const err = new Error("genie_queued") as Error & { pendingId?: string };
  err.pendingId = userMsg.id;
  throw err;
}

// 모든 runAgent(genieAgent, ...) 호출은 이 래퍼를 통과시켜야 한다.
// 마이크루 세션의 동시 resume으로 인한 대화 분기를 방지하고, 리턴된 session_id를
// 한 곳에서 일관되게 저장한다. 주의: _sendMessageImpl 내부에서 호출 금지
// (self-deadlock). sendMessage 자체는 이미 같은 lock을 걸고 있기 때문이다.
export async function runGenieAgent(
  taskId: string,
  prompt: string,
  options?: Omit<RunAgentOptions, "resumeSessionId" | "sessionId"> & { freshSession?: boolean },
): Promise<AgentResult> {
  return withAgentLock("genie", async () => {
    const fresh = options?.freshSession;
    // 세션 파일이 아직 없으면 --session-id(새 세션 생성), 있으면 --resume(이어받기)
    // freshSession=true 시 이전 세션을 재개하지 않음 (손상된 세션 회피용)
    const fileExists = !fresh && (sessionId ? claudeSessionExists(sessionId, process.cwd()) : false);
    const { freshSession: _fresh, ...restOptions } = options ?? {};
    const result = await runAgent(getGenieAgent(), taskId, prompt, {
      ...restOptions,
      resumeSessionId: fileExists ? sessionId : undefined,
      sessionId: (!fileExists && !fresh && sessionId) ? sessionId : undefined,
    });
    if (!fresh && result.sessionId) {
      sessionId = result.sessionId;
      saveSession();
    }
    // ★ 2026-08-23 신설 — 이 래퍼를 타는 호출(jobs.ts 의 verify·plan-review-N)은
    //   여태 cost-log 에 한 행도 남지 않았다. 계획 심사 비용이 통째로 장부 밖이었다.
    //   총액이 오르는 게 아니라 «보이게» 되는 것이다.
    if (result.cost) logCost("genie", undefined, result.cost, `genie:${taskId}`);
    return result;
  });
}

async function _sendMessageImpl(
  message: string,
  attachments?: string[],
  browserId?: string,
  options?: { internal?: boolean; source?: string; pendingId?: string },
): Promise<ChatMessage> {
  loadHistoryFromDisk();
  const isInternal = options?.internal === true;

  // busy 큐잉은 sendMessage() (lock 밖)에서 처리됨 — 여기서는 lock 안이므로 idle 보장.

  // 사용자 메시지 시 자동 진행 count 리셋 (한도 초과 후에도 새 작업에서 자동 진행 재개)
  if (!isInternal) { autoContinuationCount = 0; autoCapNoticeSent = false; resetAutoProgress(); }
  // 단순 내부 알림은 genie 장기 세션을 재개하지 않고 단발(새 세션)로 처리한다(notice-digest.ts).
  const freshNotice = isInternal && isFreshNoticeSource(options?.source);

  // 사용자 메시지 저장 (internal이면 건너뜀 — 시스템 자동 진행 프롬프트는 채팅에 표시하지 않음)
  // pendingId 있으면 = drainQueue 처리 흐름 → 사전 등록된 user msg의 pending 해제만.
  const pendingId = options?.pendingId;
  const userMsg: ChatMessage = {
    id: randomUUID(),
    role: "user",
    content: message,
    timestamp: new Date().toISOString(),
    attachments,
  };
  if (!isInternal) {
    if (pendingId) {
      lastUserMessageTime = Date.now();
      const existing = history.find((m) => m.role === "user" && m.id === pendingId);
      if (existing) existing.pending = false;
      emitGlobalEvent("chat-update", { id: pendingId, pending: false });
    } else {
      lastUserMessageTime = Date.now();
      history.push(userMsg);
      appendToLog(userMsg);
      archiveChatMessage("user", message, { browserId, attachments });
      emitGlobalEvent("chat", { id: userMsg.id, role: "user", content: message, timestamp: userMsg.timestamp, attachments, browserId });
    }
  }

  // 프롬프트 구성
  const systemStatus = getSystemStatus();
  // 에이전트 목록을 동적으로 구성
  const agents = getAllWorkerAgents();
  const agentList = agents.map((a) => `${a.id}(${a.name})`).join(", ");
  const agentRouting = agents.map((a) => {
    const keywords = a.routeKeywords.length > 0 ? a.routeKeywords.join("/") : "전문 키워드 없음";
    return `    - ${a.id}(${a.name}) [${a.team ?? "팀 없음"}]: ${keywords}`;
  }).join("\n");

  // 시스템 상황: 매 메시지 (resume 포함)
  const statusBlock = `[현재 시스템 상황]\n${systemStatus}`;

  // 팀 요약 + 태그 규칙: 새 세션에서만 주입
  const teamSummary = agents.map((a) => {
    const kw = a.routeKeywords.length > 0 ? a.routeKeywords.join("/") : "기본";
    return `- ${a.name}(${a.id}) [${a.team ?? "팀 없음"}]: ${kw}`;
  }).join("\n");

  // genie.md에서 '## 보조 태그' + '## 핵심 지시' 섹션을 동적으로 읽어서 구성 (mtime 캐싱)
  const { tagSection, coreDirective } = loadGenieMdSections();
  const userProfile = loadUserProfileSummary();
  // 키워드 매칭 → 가이드 자동 주입 (속도 향상: 마이크루가 SafeRead 안 해도 됨)
  const guideContent = matchGuideByKeyword(message);

  const tagRules = `[우리 조직]
${teamSummary}
${userProfile ? `\n[사용자 정보] ${userProfile}` : ""}
${coreDirective ? `\n[핵심 지시]\n${coreDirective}\n[핵심 지시 끝]` : ""}
${guideContent ? `\n[참고 가이드]\n${guideContent.replace(/\{\{USER\}\}/g, getUserTitle())}\n[참고 가이드 끝]` : ""}
[태그 규칙 - 필요 시 응답에 반드시 포함]
${tagSection}`;

  let prompt: string;

  if (freshNotice) {
    // 단발 알림: 대화·위키·일일요약 없이 «조직/태그 규칙 + 현재 상황 + 알림»만.
    // 시스템 프롬프트(genie 지시)·도구·권한은 runAgent 가 비재개 시 그대로 싣는다.
    prompt = `${tagRules}\n\n${statusBlock}\n\n[단발 처리] 이 알림은 대화 세션과 분리된 단발 호출입니다(이전 대화 맥락 없음). 알림에 필요한 조치만 하세요. 처리 결과는 다음 대화 턴에 요약으로 전달됩니다.\n\n${message}`;
  } else if (!sessionId) {
    // 세션 리셋 시점 기록 (startedAt + baseTokens 초기화)
    try {
      const sf = SESSION_FILE;
      const sd: Record<string, unknown> = existsSync(sf) ? JSON.parse(readFileSync(sf, "utf-8")) : {};
      sd.startedAt = new Date().toISOString();
      delete sd.baseTokens;
      delete sd.lastTokens;
      writeFileSync(sf, JSON.stringify(sd));
    } catch (err) { swallow("unexpected", err); }

    // 이전 날 대화 요약 생성 — 백그라운드 (첫 응답 지연 제거; 미완성 요약은 다음 리셋부터 반영)
    void generateDailySummaries().catch((err) => swallow("일일 요약 백그라운드 생성", err));

    // 오늘 대화 요약 (파일 저장 없이 프롬프트에만 주입)
    const todaySummary = await generateTodaySummary();

    const wiki = loadWiki();
    const recentConvs = listRecentConversations();
    const context: string[] = [];

    // 마이크루 정체성 (role-directive + self-profile)
    const genieRdPath = join(WIKI_DIR, "role-directive.md");
    const genieSpPath = join(WIKI_DIR, "self-profile.md");
    if (existsSync(genieRdPath)) context.push(`[역할 지시서]\n${readFileSync(genieRdPath, "utf-8")}\n[역할 지시서 끝]`);
    if (existsSync(genieSpPath)) context.push(`[자기 프로필]\n${readFileSync(genieSpPath, "utf-8")}\n[자기 프로필 끝]`);

    saveStaffHash("genie");

    if (wiki) context.push(`[${getGenieName()}의 기억]\n${wiki}\n[기억 끝]`);
    if (recentConvs) context.push(`[최근 대화 기록]\n${recentConvs}\n[대화 기록 끝]`);

    // 최근 3일 daily 요약
    const dailyFiles = existsSync(DAILY_DIR)
      ? readdirSync(DAILY_DIR).filter((f: string) => f.endsWith(".md")).sort().reverse().slice(0, 3)
      : [];
    if (dailyFiles.length) {
      const dailyParts = dailyFiles.map((f: string) => `--- ${f.replace(".md", "")} ---\n${readFileSync(join(DAILY_DIR, f), "utf-8")}`);
      context.push(`[최근 기억]\n${dailyParts.join("\n\n")}\n[최근 기억 끝]`);
    }

    // 선별 회상(MEMORY_SELECTIVE_RECALL=1) — 개별 위키 페이지 전문 대신 TOC + 질의 관련 상위 페이지만 주입.
    // 기본 OFF: 값 미설정 시 위 index.md/최근 daily만 유지되는 기존 동작 그대로(무변경).
    if (isSelectiveRecallEnabled()) {
      try {
        buildWikiIndex("genie");
        const toc = buildToc("genie");
        const tocText = formatToc(toc);
        if (tocText) context.push(`[${getGenieName()}의 위키 목차]\n${tocText}\n(개별 페이지가 필요하면 Read로 1~3개만 선택 로드)\n[목차 끝]`);
        const recall = recallRelevant("genie", message, getRecallBudgetChars());
        if (recall.text) {
          context.push(`[관련 기억 회상]\n${recall.text}${recall.truncated ? "\n(예산 초과로 일부 생략됨 — 필요 시 Read로 전문 확인)" : ""}\n[관련 기억 회상 끝]`);
        }
      } catch (e) {
        console.error("[MyCrew] 선별 회상 실패(기존 동작으로 진행):", e);
      }
    }

    // 오늘 대화 요약 (세션 리셋 전 맥락 보존)
    if (todaySummary) {
      context.push(`[오늘 대화 요약 (${getToday()})]\n${todaySummary}\n[오늘 대화 요약 끝]`);
    }

    // 위키 100줄 초과 시 안내
    if (wikiOverLimit) {
      context.push(`[⚠️ 위키 정리 필요]\n위키가 100줄을 초과했습니다. 불필요한 정보를 정리하고 오래된 페이지를 삭제 또는 통합해주세요.`);
    }

    // 도중 리셋 맥락 주입 (비용 기반 리셋 시에만 존재)
    if (midResetContext) {
      context.push(midResetContext);
      console.log("[MyCrew] 도중 리셋 맥락 주입됨 (직전 대화 + 진행 TODO)");
      midResetContext = ""; // 1회성 — 주입 후 소멸
    }

    const contextBlock = context.length ? context.join("\n\n") + "\n\n" : "";
    prompt = `${contextBlock}${tagRules}\n\n${statusBlock}\n\n${message}`;
    console.log(`[MyCrew] 새 세션으로 깨어납니다 (위키${wiki ? " ✓" : " ✗"}, 최근대화${recentConvs ? " ✓" : " ✗"}${wikiOverLimit ? ", ⚠️위키초과" : ""})`);
  } else {
    // resume: 변동 감지 → 세션 리셋
    const needsReset =
      checkStaffChange("genie") ||    // 직원 추가/삭제
      checkGenieFilesChanged();        // genie.md, role-directive, self-profile, genie-config 수정
    if (needsReset) {
      clearPmSession("genie");
      sessionId = undefined;
      saveSession();
      addGenieMessage(`🔄 ${getGenieName()}가 설정변경을 감지해서 기분전환(세션리셋) 했습니다.`);
      console.log("[MyCrew] 변동 감지 → 세션 리셋");
      return _sendMessageImpl(message, attachments, browserId, options);
    }
    // resume: 시스템 상황만
    prompt = `${statusBlock}\n\n${message}`;
  }

  // 재개(또는 새) 대화 턴: 그동안 단발로 처리된 알림 요약을 1회 덧붙이고 소비 처리.
  if (!freshNotice) {
    const digest = consumeNoticeDigest(NOTICE_DIGEST_FILE);
    if (digest) prompt = `${digest}\n\n${prompt}`;
  }

  if (attachments?.length) {
    const paths = attachments.map((p) => `  - ${p}`).join("\n");
    prompt += `\n\n첨부 파일:\n${paths}\n(이미지는 SafeReadImage, 텍스트는 SafeRead로 확인하세요)`;
  }

  // 마이크루 호출 (세션 유지 + 텍스트/도구 사용 모두 같은 스트림으로)
  // 내부 메시지(CHECKIN 등)는 스트리밍을 대시보드에 보내지 않음
  let pendingStreamText = "";
  let liveMessageIdx = -1; // 히스토리 내 라이브 메시지 인덱스 (-1 = 없음)
  // 토큰 스트리밍(A1): 150ms 스로틀로 묶어 emit + 미완성 제어 태그 표시 보류.
  // 보류 상한 500자 — 그 이상 안 닫히면 태그가 아닌 본문(<!-- 포함 코드 예시 등)으로 간주하고 방출.
  let emittedLen = 0; // sanitize된 텍스트 중 화면으로 내보낸 길이
  let flushTimer: NodeJS.Timeout | null = null;
  const TAG_HOLD_MAX = 500;
  const sanitizeForDisplay = (raw: string): string => {
    const s = raw.replace(/<!--[\s\S]*?-->/g, "");
    const i = s.lastIndexOf("<!--");
    if (i !== -1 && s.length - i <= TAG_HOLD_MAX) return s.slice(0, i);
    return s;
  };
  const flushStream = () => {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    const display = sanitizeForDisplay(pendingStreamText);
    if (display.length <= emittedLen) return;
    const chunk = display.slice(emittedLen);
    emittedLen = display.length;
    activeStreamChunks.push(chunk);
    emitGlobalEvent("chat-stream", { chunk, browserId });
    const text = display.trim();
    if (!text) return;
    // 히스토리 저장 — 첫 텍스트 시 생성, 이후 업데이트 (리프레시 대응)
    loadHistoryFromDisk();
    if (liveMessageIdx < 0) {
      const msg: ChatMessage = { id: randomUUID(), role: "genie", content: text, timestamp: new Date().toISOString() };
      history.push(msg);
      liveMessageIdx = history.length - 1;
    } else {
      history[liveMessageIdx].content = text;
    }
  };
  const onText = isInternal ? undefined : (chunk: string) => {
    pendingStreamText += chunk;
    if (!flushTimer) flushTimer = setTimeout(flushStream, 150);
  };
  let confirmedCount = 0; // onProgress에서 확정된 메시지 수 (최종 저장 시 중복 방지)
  const onProgress = isInternal ? undefined : (msg: string) => {
    flushStream(); // 도구 호출 직전까지 도착한 텍스트 반영 (스로틀 잔여분)
    console.log(`[Stream] onProgress: "${msg.slice(0, 60)}" liveIdx=${liveMessageIdx} pending="${pendingStreamText.slice(0, 40)}"`);
    // 도구 호출 감지 → 라이브 메시지 확정 (디스크 + SSE)
    if (liveMessageIdx >= 0) {
      const draftMsg = history[liveMessageIdx];
      appendToLog(draftMsg);
      archiveChatMessage("genie", draftMsg.content);
      // 다른 기기에 전달 (browserId 포함 → 원본 기기는 handleChatEvent에서 필터)
      console.log(`[Stream] chat emit: "${draftMsg.content.slice(0, 40)}" browserId=${browserId?.slice(0, 8)}`);
      emitGlobalEvent("chat", { id: draftMsg.id, role: "genie", content: draftMsg.content, timestamp: draftMsg.timestamp, browserId });
      liveMessageIdx = -1;
      confirmedCount++;
    }
    pendingStreamText = "";
    emittedLen = 0;
    const chunk = `🔧 ${msg}\n`;
    activeStreamChunks.push(chunk);
    emitGlobalEvent("chat-stream", { chunk, browserId });
    // 도구 progress를 모든 기기에 브로드캐스트 (browserId 없음)
    emitGlobalEvent("genie-progress", { progress: msg });
  };
  // 백그라운드 Agent(task-notification) 등 system/tool_result raw를 conv에 영구 저장
  // 마이크루가 verbatim 인용 안 해도 휘발 안 되도록 시스템이 직접 기록
  const onSystemMessage = (event: unknown) => {
    try {
      const ev = event as { type?: string; subtype?: string };
      // system/init은 매 resume마다 반복 — 스킵
      if (ev.subtype === "init") return;
      const ts = new Date().toISOString();
      const tag = ev.type === "user"
        ? "user/tool_result"
        : ev.subtype ? `system/${ev.subtype}` : "system";
      // 대형 tool_result raw로 아카이브가 수백 MB로 불어나는 것 방지 (2026-07-03 하루 217MB 사례)
      let raw = JSON.stringify(event, null, 2);
      const MAX_ARCHIVE_EVENT_CHARS = 20_000;
      if (raw.length > MAX_ARCHIVE_EVENT_CHARS) {
        raw = `${raw.slice(0, MAX_ARCHIVE_EVENT_CHARS)}\n... (truncated: 원본 ${raw.length.toLocaleString()}자)`;
      }
      const entry = `\n## system / ${tag} (${ts})\n\n\`\`\`json\n${raw}\n\`\`\`\n`;
      appendFileSync(getConvPath(), entry);
    } catch (e) {
      console.error("[Conv] system message append failed:", e);
    }
  };

  // 내부 발화는 source 별로 모델 티어를 고정한다(internal-source-tier.ts).
  // cheap: 단순 안내성(job:notify:ok·scheduler:notify·scheduler:state-change)
  // standard: 정형이지만 후속 판단이 필요한 발화(job:notify:fail·loop:runner·scheduler:trigger·task:report)
  // 표에 없는 source(job:report·사용자 채팅)는 undefined → 기본 모델 유지.
  const lightModel = modelForInternalSource(isInternal, options?.source);
  // 원장(cost-log)에 남길 발화 출처. 모델 티어와 «같은 값»을 쓴다 —
  // 두 곳이 다른 어휘를 쓰면 "모델은 haiku 인데 태그는 다른 이름"이 된다.
  const genieCostSource = resolveGenieSource(isInternal, options?.source);

  setGenieBusy(true, message.slice(0, 80));
  // 세션 충돌 예방(2026-07-13): 터미널 PTY가 부팅 eager-spawn 등으로 같은 세션을 점유하고
  // 있으면 아래 --resume이 "Session ID already in use"로 실패한다. 아무도 터미널을 안 보는
  // idle PTY면 종료해 세션을 놓아준 뒤 이어받는다 (뷰어가 있으면 건드리지 않음).
  try {
    const tw = await import("./terminal-ws.js");
    if (tw.isPtyReady() && !tw.hasTerminalViewers()) {
      await tw.releaseGeniePtyForChat();
    }
  } catch (e) { swallow("PTY 릴리스", e); }
  let result;
  try {
    const chatFileExists = !freshNotice && sessionId ? claudeSessionExists(sessionId, process.cwd()) : false;
    result = await runAgent(getGenieAgent(), "chat", prompt, {
      // freshNotice: resume/sessionId 둘 다 생략 → CLI 가 새 세션을 만든다(genie 세션 포인터 불변).
      resumeSessionId: chatFileExists ? sessionId : undefined,
      sessionId: (!freshNotice && !chatFileExists && sessionId) ? sessionId : undefined,
      model: lightModel,
      partialStream: !isInternal, // A1: 토큰 단위 스트리밍 (대시보드 표시 콜만)
      onText,
      onProgress,
      onSystemMessage,
      onSpawn: (pid) => { genieChildPid = pid; },
    });
  } finally {
    flushStream(); // 스로틀 잔여 텍스트 방출 + 타이머 정리 (턴 종료 후 지연 발화 방지)
    genieChildPid = undefined;
    setGenieBusy(false);
  }

  // 사용자 중단 — 부분 응답 보존 + (중단됨) 마커
  if (!result.success && genieAborted) {
    genieAborted = false;
    if (liveMessageIdx >= 0) {
      // 라이브 메시지 보존 + aborted 플래그
      history[liveMessageIdx].aborted = true;
      const draftMsg = history[liveMessageIdx];
      appendToLog(draftMsg);
      if (!isInternal) archiveChatMessage("genie", draftMsg.content);
      emitGlobalEvent("chat", {
        id: draftMsg.id,
        role: "genie",
        content: draftMsg.content,
        timestamp: draftMsg.timestamp,
        aborted: true,
        browserId,
      });
      return draftMsg;
    }
    // 라이브 없음 → (중단됨) 시스템 한 줄
    const abortMsg: ChatMessage = {
    id: randomUUID(),
      role: "genie",
      content: "(중단됨)",
      timestamp: new Date().toISOString(),
      aborted: true,
      ...(isInternal ? { internal: true } : {}),
    };
    history.push(abortMsg);
    appendToLog(abortMsg);
    if (!isInternal) {
      emitGlobalEvent("chat", { id: abortMsg.id, role: "genie", content: "(중단됨)", timestamp: abortMsg.timestamp, aborted: true, browserId });
    }
    return abortMsg;
  }

// [안전망] SIGKILL로 in-use 마커가 남은 오염 세션 .jsonl을 격리(rename). 삭제 아닌 rename이라 복원 가능.
function quarantinePoisonedSession(poisonedId: string): boolean {
  try {
    const root = join(homedir(), ".claude", "projects");
    if (!existsSync(root)) return false;
    for (const d of readdirSync(root)) {
      const pf = join(root, d, `${poisonedId}.jsonl`);
      if (existsSync(pf)) { renameSync(pf, `${pf}.poisoned`); console.warn(`[MyCrew] 오염 세션 격리: ${d}/${poisonedId}.jsonl → .poisoned`); return true; }
    }
  } catch (e) { console.warn("[MyCrew] 오염 세션 격리 실패:", e instanceof Error ? e.message : String(e)); }
  return false;
}

  // 세션 충돌 "already in use" — 두 가지 원인을 구분해 처리한다:
  //  (1) 살아있는 터미널 PTY가 같은 세션 점유 (뷰어 있음) → 일시적. 리셋 금지, 안내만.
  //  (2) 스테일 락 — 이전 claude가 SIGKILL(lease/watchdog)로 죽으며 남긴 in-use 마커.
  //      실제로 세션을 물고 있는 프로세스가 없다 → 영구 충돌. 새 세션으로 자동 복구(1회 재시도).
  //  (2)는 아난다라 폭주 때 워커 SIGKILL이 잦아지며 노출된 케이스(2026-07-13).
  if (!freshNotice && !result.success && /already in use/i.test(result.error ?? "")) {
    let ptyLive = false;
    try {
      const tw = await import("./terminal-ws.js");
      ptyLive = tw.isPtyReady() && tw.hasTerminalViewers();
    } catch { /* 조회 실패 시 보수적으로 스테일로 간주(복구 시도) */ }

    if (ptyLive) {
      console.warn("[MyCrew] 세션 충돌 — 활성 터미널 뷰어 존재. 리셋하지 않고 안내.");
      const busyMsg: ChatMessage = {
        id: randomUUID(),
        role: "genie",
        content: "지니 터미널이 세션을 사용 중이라 이 요청을 처리하지 못했습니다. 터미널 뷰를 닫거나 잠시 후 다시 보내주세요. (세션은 보존됨)",
        timestamp: new Date().toISOString(),
        ...(isInternal ? { internal: true } : {}),
      };
      history.push(busyMsg);
      appendToLog(busyMsg);
      if (!isInternal) emitGlobalEvent("chat", { id: busyMsg.id, role: "genie", content: busyMsg.content, timestamp: busyMsg.timestamp, browserId });
      return busyMsg;
    }

    // 스테일 락 — 새 세션으로 자동 복구 후 1회 재시도. 직전 맥락은 midResetContext로 이월.
    console.warn("[MyCrew] 스테일 세션 락 감지 (물고 있는 프로세스 없음) — 새 세션으로 자동 복구");
    const poisonedId = /Session ID ([0-9a-fA-F-]{36})/.exec(result.error ?? "")?.[1];
    if (poisonedId) quarantinePoisonedSession(poisonedId);
    midResetContext = buildMidResetContext();
    sessionId = undefined;
    saveSession();
    // ★ 덮어쓰기 전에 1차 시도 비용을 원장에 남긴다. 아래 재할당 후에는 2291 이
    //   «마지막 result» 만 보므로 실패한 1차 시도분이 조용히 사라진다(2026-08-23 시정).
    if (result.cost) logCost("genie", undefined, result.cost, `${genieCostSource}:attempt1`);
    result = await runAgent(getGenieAgent(), "chat", prompt, {
      // 새 세션 — resume 없음. midResetContext가 prompt에 이미 반영되진 않으므로 직접 앞에 덧댐.
      model: lightModel,
      partialStream: !isInternal,
      onText, onProgress, onSystemMessage,
      onSpawn: (pid) => { genieChildPid = pid; },
    });
    if (result.sessionId) { sessionId = result.sessionId; saveSession(); }
    // 복구 재시도도 실패하면 아래 일반 실패 경로로 흘러가 처리됨.
  }

  // 세션 만료 — 플러시 후 마이크루가 자고 있음
  // 단발 알림의 실패는 genie 세션과 무관 — 세션 만료로 오판해 대화 세션을 날리지 않는다.
  if (!freshNotice && !result.success && sessionId) {
    console.log("[MyCrew] 세션 만료 — 기억 플러시 후 마이크루가 잠듭니다");
    await flushSessionMemory();
    sessionId = undefined;
    saveSession();

    const sleepMsg: ChatMessage = {
    id: randomUUID(),
      role: "genie",
      content: `${getGenieName()}가 아직 자고 있습니다. 깨우시겠습니까?`,
      timestamp: new Date().toISOString(),
      ...(isInternal ? { internal: true } : {}),
    };
    history.push(sleepMsg);
    appendToLog(sleepMsg);
    return sleepMsg;
  }

  // 세션 ID 저장 (단발 알림의 새 세션 ID 는 저장하지 않는다 — genie 대화 세션 유지)
  if (result.sessionId && !freshNotice) {
    sessionId = result.sessionId;
    saveSession();
  }

  // 마이크루 비용 로깅 + 세션 토큰 추적
  // source: 이 발화가 «아난의 입력»인지 «시스템 자동 발화»인지 «잡 결과 처리»인지를
  //         원장에 남긴다. 이게 없어서 genie 행이 전부 한 덩어리였다(2026-08-23 시정).
  if (result.cost) {
    logCost("genie", undefined, result.cost, genieCostSource);
    if (result.cost.cacheReadTokens && !freshNotice) {
      try {
        const sd = existsSync(SESSION_FILE) ? JSON.parse(readFileSync(SESSION_FILE, "utf-8")) : {};
        if (!sd.baseTokens) sd.baseTokens = result.cost.cacheReadTokens;
        sd.lastTokens = result.cost.cacheReadTokens;
        writeFileSync(SESSION_FILE, JSON.stringify(sd));
      } catch (err) { swallow("unexpected", err); }
    }
  }

  // 비용 기반 세션 리셋 체크: cacheReadTokens가 maxCacheTokens 초과 시 다음 호출을 새 세션으로
  const genieMaxCache = getGenieAgent().maxCacheTokens ?? 0;
  if (genieMaxCache > 0 && result.cost?.cacheReadTokens && !freshNotice) {
    lastGenieCacheTokens = result.cost.cacheReadTokens;
    if (cacheCapExceeded(lastGenieCacheTokens, genieMaxCache) && sessionId) {
      console.log(`[MyCrew] 캐시 토큰 임계 초과 (${(lastGenieCacheTokens / 1_000_000).toFixed(1)}M > ${genieMaxCache / 1_000_000}M) → 다음 메시지에서 세션 리셋 예정`);
      auditLog("cache.reset", { agentId: "genie", cacheReadTokens: lastGenieCacheTokens, capTokens: genieMaxCache, path: "genie" });
      midResetContext = buildMidResetContext();
      sessionId = undefined;
      saveSession();
      addGenieMessage(`🔄 ${getGenieName()}가 피곤(토큰초과)해서 기분전환(세션리셋) 했습니다.`);
    }
  }

  let content = result.success
    ? result.output
    : "죄송해요, 잠시 문제가 생겼어요. 다시 말씀해주시겠어요?";

  // 태그 감지 로깅
  if (content.includes("<!--")) {
    console.log(`[MyCrew] 태그 감지됨: ${content.match(/<!--\s*\w+\s*:/g)?.join(", ") ?? "없음"}`);
  }
  if (/<!--\s*RESTART\s*-->/i.test(content) && !RESTART_RE().test(content)) {
    console.warn(`[MyCrew] RESTART 패턴 감지됐으나 라인 단독 조건 불충족 — content 앞 200자: ${content.slice(0, 200)}`);
  }

  // WIKI 태그 파싱 → 위키 업데이트
  const wikiMatches = content.matchAll(WIKI_RE());
  for (const match of wikiMatches) {
    try {
      const wikiData = JSON.parse(match[1]) as {
        page: string;
        content: string;
      };
      saveWikiPage(wikiData.page, wikiData.content);
    } catch (err) {
      swallow("위키 저장 지시 파싱", err);
    }
  }
  content = content.replace(WIKI_RE(), "").trim();

  // SCHEDULE 태그 파싱 → 스케줄 추가/수정/삭제
  for (const match of content.matchAll(SCHEDULE_RE())) {
    try {
      const entry = match[1].trim();
      if (entry) addScheduleEntry(entry);
    } catch (err) { swallow("unexpected", err); }
  }
  content = content.replace(SCHEDULE_RE(), "").trim();
  for (const match of content.matchAll(SCHEDULE_UPDATE_RE())) {
    try {
      const entry = match[1].trim();
      if (entry) updateScheduleEntry(entry);
    } catch (err) { swallow("unexpected", err); }
  }
  content = content.replace(SCHEDULE_UPDATE_RE(), "").trim();
  for (const match of content.matchAll(SCHEDULE_DELETE_RE())) {
    try {
      const id = match[1].trim();
      if (id) deleteScheduleEntry(id);
    } catch (err) { swallow("unexpected", err); }
  }
  content = content.replace(SCHEDULE_DELETE_RE(), "").trim();

  // CALENDAR 태그 파싱 → 캘린더 일정(schedules.json) 등록/수정/삭제
  // (SCHEDULE=schedule.md 알림과 별개 저장소. schedules.ts의 검증된 CRUD 재사용)
  for (const match of content.matchAll(CALENDAR_RE())) {
    try {
      const input = JSON.parse(match[1].trim());
      const r = createSchedule(input);
      if (r.ok) console.log(`[MyCrew] 캘린더 일정 등록 [${r.schedule.id}]: ${r.schedule.title}`);
      else console.warn(`[MyCrew] CALENDAR 등록 실패: ${r.error}`);
    } catch (err) { swallow("unexpected", err); }
  }
  content = content.replace(CALENDAR_RE(), "").trim();
  for (const match of content.matchAll(CALENDAR_UPDATE_RE())) {
    try {
      const { id, ...patch } = JSON.parse(match[1].trim());
      if (typeof id === "string" && id) {
        const r = updateSchedule(id, patch);
        if (r.ok) console.log(`[MyCrew] 캘린더 일정 수정 [${id}]`);
        else console.warn(`[MyCrew] CALENDAR_UPDATE 실패 id=${id}: ${r.error}`);
      } else console.warn("[MyCrew] CALENDAR_UPDATE: id 누락");
    } catch (err) { swallow("unexpected", err); }
  }
  content = content.replace(CALENDAR_UPDATE_RE(), "").trim();
  for (const match of content.matchAll(CALENDAR_DELETE_RE())) {
    try {
      const id = match[1].trim();
      if (id) {
        const r = deleteSchedule(id);
        if (r.ok) console.log(`[MyCrew] 캘린더 일정 삭제 [${id}]`);
        else console.warn(`[MyCrew] CALENDAR_DELETE 실패 id=${id}: ${r.error}`);
      }
    } catch (err) { swallow("unexpected", err); }
  }
  content = content.replace(CALENDAR_DELETE_RE(), "").trim();

  // TODO 태그 파싱 (자동연결 시 addedTodos 참조)
  const todoOrigin = isInternal ? "genie" : "user";
  const addedTodos: GenieTodo[] = [];
  for (const m of content.matchAll(TODO_ADD_RE())) {
    const text = m[1].trim();
    if (text) addedTodos.push(addTodo(todoOrigin, text));
  }
  content = content.replace(TODO_ADD_RE(), "").trim();
  for (const m of content.matchAll(TODO_DONE_RE())) {
    const id = m[1].trim();
    if (id) markTodoDone(id);
  }
  content = content.replace(TODO_DONE_RE(), "").trim();
  for (const m of content.matchAll(TODO_CANCEL_RE())) {
    const id = m[1].trim();
    if (id) cancelTodo(id);
  }
  content = content.replace(TODO_CANCEL_RE(), "").trim();
  for (const m of content.matchAll(TODO_DELETE_RE())) {
    const id = m[1].trim();
    if (id) deleteTodo(id);
  }
  content = content.replace(TODO_DELETE_RE(), "").trim();

  // APPROVAL 태그 파싱 → resolveApproval 호출 (source=genie)
  for (const match of content.matchAll(APPROVAL_RE())) {
    try {
      const data = JSON.parse(match[1]) as { id: string; decision: "allow" | "deny"; reason?: string };
      if (data.id && (data.decision === "allow" || data.decision === "deny")) {
        const r = resolveApproval(data.id, data.decision === "allow", "genie");
        if (r) console.log(`[MyCrew] 승인 ${data.decision}: ${data.id.slice(0, 8)} (${data.reason ?? "-"})`);
      }
    } catch (err) {
      console.error(`[MyCrew] APPROVAL JSON 파싱 실패: ${err instanceof Error ? err.message : err}; raw=${match[1].slice(0, 200)}`);
    }
  }
  content = content.replace(APPROVAL_RE(), "").trim();

  // 가드레일: 마이크루가 DelegateTask 툴을 호출하는 대신 <!--DELEGATE:{json}--> 태그를
  // 환각으로 내뱉는 경우(세션 행동 고착)에도 실제 위임이 생성되도록 /api/delegate로 라우팅.
  // 엔드포인트가 notePendingDelegateJob을 호출하므로 아래 pendingDelegateJobs 합류에 그대로 흡수된다.
  const delegatePort = process.env.PORT ?? "3456";
  for (const m of content.matchAll(DELEGATE_RE())) {
    let parsed: { request?: string } & Record<string, unknown>;
    try {
      parsed = JSON.parse(m[1]);
    } catch (err) {
      console.error(`[MyCrew] DELEGATE 태그 JSON 파싱 실패: ${err instanceof Error ? err.message : err}; raw=${m[1].slice(0, 200)}`);
      continue;
    }
    if (!parsed.request || typeof parsed.request !== "string" || !parsed.request.trim()) {
      console.warn(`[MyCrew] DELEGATE 태그에 request 누락 — 건너뜀: ${m[1].slice(0, 120)}`);
      continue;
    }
    try {
      const res = await fetch(`http://127.0.0.1:${delegatePort}/api/delegate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      if (!res.ok) {
        console.error(`[MyCrew] DELEGATE 태그 위임 실패 (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`);
      } else {
        const ack = await res.json() as { jobId?: string };
        console.log(`[MyCrew] DELEGATE 태그 → 실제 위임 라우팅 성공: job=${ack.jobId?.slice(0, 8)} agent=${String(parsed.agent ?? "auto")}`);
      }
    } catch (err) {
      console.error(`[MyCrew] DELEGATE 태그 위임 요청 오류: ${err instanceof Error ? err.message : err}`);
    }
  }
  content = content.replace(DELEGATE_RE(), "").trim();

  // DelegateTask로 생성된 잡들을 응답 jobs 배열에 합류
  const createdJobs: Array<{ id: string; request: string; agent?: string }> = [];
  createdJobs.push(...pendingDelegateJobs);
  pendingDelegateJobs.length = 0;

  // AUTO 태그 파싱 → 자동 진행 모드 토글
  const autoMatches = content.matchAll(AUTO_RE());
  for (const match of autoMatches) {
    setAutoContinuationMode(match[1].toLowerCase() === "on");
  }
  content = content.replace(AUTO_RE(), "").trim();

  // RESET 태그 파싱 → 세션 리셋
  const resetMatches = content.matchAll(RESET_RE());
  const busy = new Set(getBusyAgentIds());
  for (const match of resetMatches) {
    const target = match[1].trim().toLowerCase();
    if (target === "all") {
      const reset: string[] = [];
      for (const agent of getAllWorkerAgents()) {
        if (!busy.has(agent.id)) { clearPmSession(agent.id); reset.push(agent.name); }
      }
      if (reset.length) addGenieMessage(`🔄 ${reset.join(", ")} 기분전환(세션리셋)했습니다.`);
      console.log("[MyCrew] 전체 에이전트 세션 리셋 (idle만)");
    } else if (target === "genie") {
      // 마이크루 자신은 현재 대화 중이므로 다음 세션부터 적용
      sessionId = undefined;
      saveSession();
      addGenieMessage(`🔄 ${getGenieName()}가 기분전환(세션리셋)했습니다.`);
      console.log("[MyCrew] 마이크루 세션 리셋 예약");
    } else if (!busy.has(target)) {
      clearPmSession(target);
      const agent = getAllWorkerAgents().find(a => a.id === target);
      addGenieMessage(`🔄 ${agent?.name ?? target}이(가) 기분전환(세션리셋)했습니다.`);
      console.log(`[MyCrew] ${target} 세션 리셋`);
    } else {
      console.log(`[MyCrew] ${target} 작업 중 — 리셋 건너뜀`);
    }
  }
  content = content.replace(RESET_RE(), "").replace(CHECKIN_RE(), "").trim();

  // RESTART 태그 → 서버 재시작 (안전 검증 후)
  if (RESTART_RE().test(content)) {
    content = content.replace(RESTART_RE(), "").trim();
    // 마이크루 응답이 없으면 시스템이 대신 안내 (마이크루 응답은 스트리밍으로 이미 표시됨)
    if (!content.trim()) addGenieMessage("🔄 서버를 재시작할게요.");
    // 진행 중 워커 검사 — 부모 종료 시 자식 프로세스 강제 종료로 작업 손실 방지
    // (관련: feedback_failed-알림-누락-패턴 — 2026-04-27 리사 / 2026-04-29 잭키 동일 패턴)
    const restartBusy = getBusyAgentIds();
    if (restartBusy.length > 0) {
      console.warn(`[MyCrew] 재시작 보류 — 진행 중 워커: ${restartBusy.join(", ")}`);
      addGenieMessage(`⏸️ 재시작 보류: ${restartBusy.join(", ")} 작업 중. 작업 완료 후 다시 시도합니다.`);
      // content 비워서 정상 응답으로 처리되지 않게 (internal 플래그로 UI 렌더링 방지)
      return { id: randomUUID(), role: "genie", content: "", timestamp: new Date().toISOString(), internal: true };
    } else {
      console.log("[MyCrew] 재시작 요청 감지 — 안전 검증 시작");
      addGenieMessage("⏳ 안전 검증 중... (tsc → 빌드 → 임시 서버 테스트)");
      try {
        const gate = await runRestartSafetyGate();
        if (!gate.ok) {
          const label = gate.stage === "tsc" ? "타입 에러"
            : gate.stage === "client-build" ? "클라이언트 빌드 에러"
            : "임시 서버 검증 실패";
          console.error(`[MyCrew] 재시작 취소 — ${gate.stage}: ${gate.detail}`);
          addGenieMessage(`⚠️ 재시작 취소됨: ${label}.\n${gate.detail.slice(0, 300)}`);
        } else {
          console.log(`[MyCrew] 임시 서버 검증 통과 (${gate.detail}) — 재시작 진행`);
          // UI에 진행 신호 — 사장님이 "안전 검증 중"에서 멈춘 줄 알지 않도록.
          addGenieMessage("✅ 안전 검증 통과 — 서버를 재시작합니다.");
          // 재시작 전: 마이크루 응답에 후속 작업 언급이 있으면 TODO 자동 등록
          // 부팅 후 handleSelfRestart가 첫 항목을 sendMessage로 재발화, 나머지는 done 처리
          const restartContent = content.replace(/<!--.*?-->/gs, "").trim();
          if (restartContent.length > 10) {
            const summary = restartContent.slice(0, 200).replace(/\n/g, " ");
            addTodo("genie", `[재시작 후 이어가기] ${summary}`);
            console.log("[MyCrew] 재시작 전 후속 작업 TODO 등록");
          }
          const { restartSelf } = await import("./jobs.js");
          setTimeout(() => restartSelf().catch((e: unknown) => console.error("[Self] 재시작 실패:", e)), 1000);
        }
      } catch (e) {
        console.error("[MyCrew] 재시작 검증 실패:", e);
        addGenieMessage("⚠️ 재시작 취소됨: 검증 중 에러 발생.");
      }
      // RESTART 처리 완료 — 정상 응답 흐름 건너뜀 (internal 플래그로 UI 렌더링 방지)
      return { id: randomUUID(), role: "genie", content: "", timestamp: new Date().toISOString(), internal: true };
    }
  }

  // 단발 알림 처리 결과를 다이제스트에 한 줄 남긴다(다음 재개 턴에 1회 주입).
  if (freshNotice) {
    const jobNote = createdJobs.length ? ` [위임 ${createdJobs.length}건: ${createdJobs.map((j) => j.request.slice(0, 40)).join(" / ")}]` : "";
    const replyNote = result.success ? content : `(처리 실패: ${(result.error ?? "").slice(0, 80)})`;
    appendNoticeDigest(NOTICE_DIGEST_FILE, makeDigestEntry(options?.source ?? "internal", message, replyNote + jobNote));
  }

  // 태그 제거 후 무의미한 응답 필터링 (CHECKIN 등의 부산물)
  const stripped = content.replace(/[.\s!?·。，,;:·무시정상진행대기]/g, "").trim();
  if (!stripped && !createdJobs.length) {
    console.log(`[MyCrew] 무의미 응답 건너뜀: "${content.slice(0, 40)}"`);
    // 라이브 메시지가 남아있으면 제거
    if (liveMessageIdx >= 0) { history.splice(liveMessageIdx, 1); liveMessageIdx = -1; }
    return { id: randomUUID(), role: "genie", content: "", timestamp: new Date().toISOString(), internal: true };
  }

  // 마이크루 응답 저장
  // 라이브 메시지가 남아있으면 (도구 호출 없이 끝난 경우) → 교체
  // 도구 호출이 있었으면 (liveMessageIdx === -1) → 새 메시지 추가
  
  // 빈 content + jobs 없음 → 빈 말풍선 방지 (연속 도구호출 시)
  // 단, 특수 마커(APPROVAL, MEETING_RESULT 등)가 있으면 저장
  const hasSpecialMarker = content.includes('<!--APPROVAL') || content.includes('<!--MEETING_RESULT') || content.includes('<!--VIDEO_SUMMARY') || content.includes('<!--JOB_COMPLETE');
  if (!content.trim() && !createdJobs.length && !hasSpecialMarker) {
    console.log('[MyCrew] 빈 응답 건너뜀 (content 없음 + jobs 없음 + 특수 마커 없음)');
    // 라이브 메시지가 남아있으면 제거
    if (liveMessageIdx >= 0) {
      history.splice(liveMessageIdx, 1);
      liveMessageIdx = -1;
    }
    return { id: randomUUID(), role: "genie", content: "", timestamp: new Date().toISOString(), internal: true };
  }
  
  const genieMsg: ChatMessage = {
    id: randomUUID(),
    role: "genie",
    content,
    timestamp: new Date().toISOString(),
    jobs: createdJobs.length ? createdJobs : undefined,
    ...(isInternal ? { internal: true } : {}),
  };
  if (liveMessageIdx >= 0) {
    // 도구 호출 없이 응답 종료 → 라이브 메시지를 최종 버전으로 교체
    history[liveMessageIdx] = genieMsg;
    liveMessageIdx = -1;
  } else {
    history.push(genieMsg);
  }
  appendToLog(genieMsg);
  if (!isInternal) {
    archiveChatMessage("genie", content, createdJobs.length ? { jobs: createdJobs } : undefined);
  }
  // internal 응답 SSE 발화 가드 — [NOTIFY] 마커 있을 때만 화면 표시 (history.push는 무관 → 추적성 유지)
  const decision = decideInternalEmit(content, isInternal, notifyOnlyFromEnv());
  if (decision.warn) {
    console.warn(`[chat] internal reply without [NOTIFY] marker → emit skipped (browserId=${browserId ?? "-"})`);
  }
  // 동료 자동 회신 마커 — emit 여부와 무관하게 항상 처리
  if (content.includes("[REPLY_TO_PARTNER")) {
    import("./external-inbound.js").then((m) => m.processGenieReplyMarker(content)).catch(() => {});
  }
  // 텔레그램 회신 마커 — emit 여부와 무관하게 항상 처리
  if (content.includes("[REPLY_TO_TELEGRAM")) {
    import("./telegram.js").then((m) => m.processGenieTelegramReplyMarker(content)).catch(() => {});
  }
  // 디스코드 회신 마커 — emit 여부와 무관하게 항상 처리
  if (content.includes("[REPLY_TO_DISCORD")) {
    import("./discord.js").then((m) => m.processGenieDiscordReplyMarker(content)).catch(() => {});
  }
  if (decision.emit) {
    emitGlobalEvent("chat", { id: genieMsg.id, role: "genie", content: decision.emitContent, timestamp: genieMsg.timestamp, jobs: genieMsg.jobs, browserId });
  }

  return genieMsg;
}
