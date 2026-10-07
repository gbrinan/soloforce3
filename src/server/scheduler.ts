import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { CronExpressionParser } from "cron-parser";
import { join } from "node:path";
import { getAllJobs, emitGlobalEvent, getUnreportedTerminalJobs, markJobReported, bumpReportAttempt, giveUpReporting } from "./jobs.js";
import { transitionTodosForJob } from "./todos.js";
import { runWatchdog } from "./watchdog.js";
import { maybeRunFriendSyncCycle, initFriendSyncState } from "./friend-sync.js";
import type { Job } from "../types.js";
import { addGenieMessage, runGenieAgent, runLibrarian, runWorkerLibrarian, resetGenieSession, sendMessage, waitForGenieIdle, isOnboardingNeeded, getGenieName, getLastUserMessageTime } from "./chat.js";
import { StateChangeBatcher, batchConfigFromEnv, decideStateChangeMode } from "./state-change-batch.js";
import { getOrCreateRoutineMaster, createRoutineInstance } from "./tasks.js";
import { checkLoops } from "./loops/index.js";
import { archiveWikiPage } from "./audit.js";
import { clearPmSession, PROTECTED_PAGE_NAMES, PROTECTED_PAGE_PREFIXES } from "./pm-memory.js";
import { HISTORY_DIR, getTodayKST, kstDaysAgo } from "../config.js";
import { getBusyAgentIds, logCost } from "./jobs.js";
import { getAllWorkerAgents } from "../agent-registry.js";
import { listInRange, type Schedule } from "./schedules.js";
import { resolveTier } from "./model-tiers.js";
import { summarize } from "./metrics.js";

const GENIE_DIR = join(HISTORY_DIR, "genie");
const WIKI_DIR = join(GENIE_DIR, "wiki");
const SCHEDULE_FILE = join(WIKI_DIR, "schedule.md");
const STATE_FILE = join(GENIE_DIR, "scheduler-state.json");

interface SchedulerState {
  lastCheck?: string;
  lastReset?: string;
  lastProactiveCheck?: string;
  lastDailyRun?: string;
  resetedAgents?: Record<string, string>;
  firedReminders?: string[];
  // 캘린더 일정 대화창 알림 중복 방지 — `${id}:${start}` 키 누적 (시작 지난 일정은 자동 정리)
  firedScheduleNotifs?: string[];
  // 모델 티어 성공률 급락 경보 중복 방지 — `${date}-${jobType}` 키. 날짜 prefix로 매일 자동 리셋(firedReminders와 동일 패턴).
  alertedJobTypes?: string[];
}

function loadState(): SchedulerState {
  if (!existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveState(state: SchedulerState): void {
  if (!existsSync(HISTORY_DIR)) mkdirSync(HISTORY_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// === 캘린더 일정 대화창 알림 ===
// notification.chat이 켜진 '내 일정'의 시작 minutesBefore분 전에 데어스가 대화창 안내.
// 매분 정각 실행 기준: triggerTime이 [now, now+60s)에 들면 발송. 틱 누락 시에도 시작 전까지는 발송(중복은 firedScheduleNotifs로 차단).

function fmtKstDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function buildScheduleNotifyMessage(s: Schedule, minutesBefore: number): string {
  const lines: string[] = [];
  lines.push(`📅 일정 알림: ${s.title}이(가) ${minutesBefore}분 후 시작됩니다.`);
  lines.push(`- 시작: ${fmtKstDateTime(s.start)}`);
  lines.push(`- 종료: ${fmtKstDateTime(s.end)}`);
  if (s.location && s.location.trim()) lines.push(`- 장소: ${s.location.trim()}`);
  if (s.description && s.description.trim()) lines.push(`- 설명: ${s.description.trim()}`);
  return lines.join("\n");
}

function checkScheduleNotifications(state: SchedulerState): void {
  const now = Date.now();
  const windowEnd = now + 60 * 1000;
  // 알림 후보: 지금~25시간 내 시작/진행 중인 내 일정 (minutesBefore 최대 1440분 + 여유)
  const horizonTo = new Date(now + 25 * 60 * 60 * 1000).toISOString();
  let candidates: Schedule[];
  try {
    candidates = listInRange(new Date(now).toISOString(), horizonTo, "me");
  } catch (err) {
    console.error("[Scheduler] 일정 알림 조회 실패:", err);
    return;
  }

  const fired = new Set(state.firedScheduleNotifs ?? []);
  const candidateKeys = new Set<string>();
  let changed = false;

  for (const s of candidates) {
    const startTs = new Date(s.start).getTime();
    if (isNaN(startTs)) continue;
    const key = `${s.id}:${s.start}`;
    candidateKeys.add(key);

    const n = s.notification;
    if (!n || !n.chat) continue;
    if (startTs <= now) continue; // 이미 시작한 일정은 알림 안 함
    const minutesBefore = typeof n.minutesBefore === "number" ? n.minutesBefore : 10;
    const triggerTs = startTs - minutesBefore * 60 * 1000;
    if (triggerTs >= windowEnd) continue; // 아직 알림 시점 전
    if (fired.has(key)) continue; // 이미 발송됨

    fired.add(key);
    changed = true;
    try {
      addGenieMessage(buildScheduleNotifyMessage(s, minutesBefore));
      console.log(`[Scheduler] 일정 알림 발송: "${s.title}" (${minutesBefore}분 전)`);
    } catch (err) {
      console.error("[Scheduler] 일정 알림 전송 실패:", err);
    }
  }

  // 시작이 지나 candidate에서 빠진 키 제거 — firedScheduleNotifs 무한 누적 방지
  const pruned = Array.from(fired).filter((k) => candidateKeys.has(k));
  if (changed || pruned.length !== (state.firedScheduleNotifs?.length ?? 0)) {
    state.firedScheduleNotifs = pruned;
    saveState(state);
  }
}

// === 모델 티어 다운그레이드(2026-07-06) 품질 회귀 감시 ===
// summarize().alerts(jobType별 성공률 급락 — metrics.ts computeSuccessRateAlerts)를 매분 체크해
// jobType별로 "오늘 첫 감지"에만 1회 대화창 알림. 스팸 방지를 위해 alertedJobTypes를 날짜 prefix
// 키(`${today}-${jobType}`)로 추적 — firedReminders와 동일하게 매일 자동 리셋(오래된 키는 자연 소멸).
function checkMetricsAlerts(state: SchedulerState): void {
  let alerts: ReturnType<typeof summarize>["alerts"];
  try {
    alerts = summarize().alerts;
  } catch (err) {
    console.error("[Scheduler] 지표 경보 조회 실패:", err);
    return;
  }
  if (!alerts || alerts.length === 0) return;

  const today = getToday();
  const alerted = new Set(state.alertedJobTypes ?? []);
  let changed = false;

  for (const alert of alerts) {
    const key = `${today}-${alert.jobType}`;
    if (alerted.has(key)) continue; // 오늘 이미 알림 발송됨 — 스팸 방지
    alerted.add(key);
    changed = true;

    const recentPct = Math.round(alert.recentSuccessRate * 100);
    const baselinePct = Math.round(alert.baselineSuccessRate * 100);
    const msg =
      `⚠️ **모델 티어 품질 경보**\n\n` +
      `직군 "${alert.jobType}"의 최근 성공률이 ${recentPct}%로, 임계치(${Math.round(alert.threshold * 100)}%) 밑으로 떨어졌습니다.\n` +
      `직전 구간 대비 하락: ${baselinePct}% → ${recentPct}% (최근 ${alert.recentCount}건 기준)\n\n` +
      `2026-07-06 모델 티어 다운그레이드 이후 품질 저하 가능성이 있습니다. Metrics 패널에서 상세 확인을 권장합니다.`;
    try {
      addGenieMessage(msg);
      console.log(`[Scheduler] 지표 경보 발송: jobType=${alert.jobType}, recent=${recentPct}%, baseline=${baselinePct}%`);
    } catch (err) {
      console.error("[Scheduler] 지표 경보 전송 실패:", err);
    }
  }

  // 날짜 prefix 기준 오늘 키만 유지 — firedReminders와 동일 패턴으로 무한 누적 방지.
  if (changed) {
    state.alertedJobTypes = Array.from(alerted).filter((k) => k.startsWith(today));
    saveState(state);
  }
}

function ensureScheduleFile(): string {
  if (!existsSync(SCHEDULE_FILE)) {
    if (!existsSync(WIKI_DIR)) mkdirSync(WIKI_DIR, { recursive: true });
    const defaultSchedule = `# ${getGenieName()} 스케줄

## 반복
(비어있음)

## 리마인더
(${getGenieName()}가 대화 중 추가합니다. 형식: - YYYY-MM-DD HH:MM: 내용)
`;
    writeFileSync(SCHEDULE_FILE, defaultSchedule);
    return defaultSchedule;
  }
  return readFileSync(SCHEDULE_FILE, "utf-8");
}

function getToday(): string {
  return getTodayKST();
}

function getNowHHMM(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

const schedulerMessages: Array<{ content: string; timestamp: string }> = [];

export function getSchedulerMessages() {
  return schedulerMessages.splice(0);
}

interface ScheduledTask {
  request: string;
  projectName?: string;
  agent?: string;
  cwd?: string;
  /** cron 매칭으로 생성된 task면 원본 cron expression — todo 메타로 전파. */
  cronExpr?: string;
  /** 미리 생성된 루틴 인스턴스 task ID — DelegateTask 호출 시 마이크루가 이 ID를 사용. */
  instanceTaskId?: string;
}

interface DueResult {
  items: string[];
  tasks: ScheduledTask[];
  linesToRemove: string[];
}

// schedule.md에서 지금 실행해야 할 항목 추출
function findDueItems(schedule: string, state: SchedulerState): DueResult {
  const today = getToday();
  const nowHHMM = getNowHHMM();
  const fired = new Set(state.firedReminders ?? []);
  const items: string[] = [];
  const tasks: ScheduledTask[] = [];
  const linesToRemove: string[] = [];

  const lines = schedule.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();

    // cron 예약 작업: "- [id] cron EXPR [TASK:프로젝트명]: 내용" → 유지 (반복)
    // cronMatch([^:]+)가 greedy하게 "[TASK]:" 앞까지 소비하므로 반드시 cronMatch보다 먼저 평가
    const cronTaskMatch = trimmed.match(/^- (?:\[[\w-]+\]\s+)?cron\s+([^[]+)\[TASK(?::([^\]]*))?\]:?\s+(.+)/);
    if (cronTaskMatch) {
      const [, expr, project, content] = cronTaskMatch;
      const key = `${today}-crontask-${expr.trim()}-${nowHHMM}`;
      if (!fired.has(key)) {
        try {
          const interval = CronExpressionParser.parse(expr.trim(), { tz: "Asia/Seoul" });
          const prev = interval.prev();
          const prevDate = prev.toDate();
          const now = new Date();
          if (Math.abs(now.getTime() - prevDate.getTime()) < 60_000) {
            // 루틴 마스터/인스턴스 task 미리 생성
            const master = getOrCreateRoutineMaster(content, expr.trim());
            const instance = createRoutineInstance(master.id, content);
            tasks.push({ request: content, projectName: project || undefined, cronExpr: expr.trim(), instanceTaskId: instance.id });
            fired.add(key);
          }
        } catch { /* 잘못된 cron 표현식 무시 */ }
      }
      continue;
    }

    // cron 표현식: "- [id] cron EXPR: 내용" 또는 "- cron EXPR: 내용" → 유지 (반복)
    const cronMatch = trimmed.match(/^- (?:\[[\w-]+\]\s+)?cron\s+([^:]+):\s+(.+)/);
    if (cronMatch) {
      const [, expr, content] = cronMatch;
      const key = `${today}-cron-${expr.trim()}-${nowHHMM}`;
      if (!fired.has(key)) {
        try {
          const interval = CronExpressionParser.parse(expr.trim(), { tz: "Asia/Seoul" });
          const prev = interval.prev();
          const prevDate = prev.toDate();
          const now = new Date();
          // prev가 현재 분 이내면 매칭 (60초 이내)
          if (Math.abs(now.getTime() - prevDate.getTime()) < 60_000) {
            items.push(content);
            fired.add(key);
          }
        } catch (err) { console.error("[Scheduler] cron 파싱 실패:", expr.trim(), err); }
      }
      continue;
    }

    // 반복 항목: "- [id] 매일 HH:MM: 내용" → 유지 (하위호환)
    const dailyMatch = trimmed.match(/^- (?:\[[\w-]+\]\s+)?매일 (\d{2}:\d{2}):?\s+(.+)/);
    if (dailyMatch) {
      const [, time, content] = dailyMatch;
      const key = `${today}-daily-${time}`;
      if (time === nowHHMM && !fired.has(key)) {
        items.push(content);
        fired.add(key);
      }
      continue;
    }

    // 일회성 리마인더: "- [id] YYYY-MM-DD HH:MM: 내용" → 실행 후 삭제
    const reminderMatch = trimmed.match(
      /^- (?:\[[\w-]+\]\s+)?(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}):?\s+(.+)/,
    );
    if (reminderMatch) {
      const [, date, time, content] = reminderMatch;
      const key = `${date}-${time}`;
      if (date === today && time === nowHHMM && !fired.has(key)) {
        items.push(content);
        fired.add(key);
        linesToRemove.push(trimmed);
      }
      continue;
    }

    // 예약 작업: "- [id] YYYY-MM-DD HH:MM [TASK:프로젝트명]: 내용" → 실행 후 삭제
    const taskMatch = trimmed.match(
      /^- (?:\[[\w-]+\]\s+)?(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) \[TASK(?::([^\]]*))?\]:?\s+(.+)/,
    );
    if (taskMatch) {
      const [, date, time, project, content] = taskMatch;
      const key = `${date}-${time}-task`;
      if (date === today && time === nowHHMM && !fired.has(key)) {
        tasks.push({ request: content, projectName: project || undefined });
        fired.add(key);
        linesToRemove.push(trimmed);
      }
      continue;
    }

    // 날짜만 있는 리마인더: "- [id] YYYY-MM-DD: 내용" → 실행 후 삭제
    const dateOnlyMatch = trimmed.match(/^- (?:\[[\w-]+\]\s+)?(\d{4}-\d{2}-\d{2}):?\s+(.+)/);
    if (dateOnlyMatch) {
      const [, date, content] = dateOnlyMatch;
      const key = `${date}-dateonly`;
      if (date === today && nowHHMM === "09:00" && !fired.has(key)) {
        items.push(content);
        fired.add(key);
        linesToRemove.push(trimmed);
      }
    }
  }

  state.firedReminders = Array.from(fired).filter((k) => k.startsWith(today));
  return { items, tasks, linesToRemove };
}

function removeScheduleLines(linesToRemove: string[]): void {
  const schedulePath = join(WIKI_DIR, "schedule.md");
  if (!existsSync(schedulePath) || linesToRemove.length === 0) return;

  try {
    let content = readFileSync(schedulePath, "utf-8");
    for (const line of linesToRemove) {
      content = content.replace(line, "").replace(/\n{3,}/g, "\n\n");
    }
    writeFileSync(schedulePath, content.trim() + "\n");
    console.log(`[Scheduler] 완료된 리마인더 ${linesToRemove.length}건 삭제`);
  } catch (err) {
    console.error("[Scheduler] 스케줄 파일 수정 실패:", err);
  }
}

function checkDailyReset(state: SchedulerState): void {
  if (isOnboardingNeeded()) return; // 온보딩 전이면 리셋 불필요
  const today = getToday();
  const ra = state.resetedAgents ??= {};
  const busy = new Set(getBusyAgentIds());

  const resetNames: string[] = [];

  // 마이크루 리셋 (바쁜 에이전트 없을 때) — silent로 호출 (합산 메시지에서 일괄 안내)
  if (ra["genie"] !== today && !busy.size) {
    resetGenieSession(true);
    ra["genie"] = today;
    resetNames.push(getGenieName());
    console.log("[Scheduler] 마이크루 세션 리셋");
  }

  // 각 워커 에이전트 개별 리셋 (놀고 있는 것만)
  const agents = getAllWorkerAgents();
  for (const agent of agents) {
    if (ra[agent.id] === today) continue;
    if (busy.has(agent.id)) continue;
    clearPmSession(agent.id);
    ra[agent.id] = today;
    resetNames.push(agent.name);
    console.log(`[Scheduler] ${agent.name} 세션 리셋`);
  }
  if (resetNames.length) {
    addGenieMessage(`🔄 ${resetNames.join(", ")}이(가) 기분전환(세션리셋) 했습니다. (일일 리셋)`);
  }

  // 전체 완료 확인
  const allDone = agents.every((a) => ra[a.id] === today) && ra["genie"] === today;
  if (allDone) state.lastReset = today;

  saveState(state);
}

export async function runScheduleCheck(): Promise<void> {
  // 매분 lease 만료 회수 + 큐 정체 정리 + stuck todo 감지 + PTY 좀비 정리 (watchdog 단일화, Phase 2)
  // runWatchdog = checkExpiredLeases + sweepStuckQueueOnBoot + sweepZombiePtys + runStuckCheck
  try {
    await runWatchdog();
  } catch (err) {
    console.error("[Scheduler] watchdog 실패:", err);
  }

  // 친구 presence + 일정 10분 주기 자동 동기화 (자체 디바운스로 매분 호출해도 10분에 1회만 실행)
  maybeRunFriendSyncCycle().catch((err) => console.error("[Scheduler] friend-sync 실패:", err));

  // 루프 엔진: cron 트리거 루프 체크 (fire-and-forget — 매분 tick을 블로킹하지 않음)
  checkLoops().catch((err) => console.error("[Scheduler] 루프 체크 실패:", err));

  const state = loadState();

  // 03:00 daily 작업 (매분 체크, 오늘 미실행이면 실행)
  const nowH = new Date().getHours();
  const todayStr = getTodayKST();
  if (nowH >= 3 && state.lastDailyRun !== todayStr) {
    state.lastDailyRun = todayStr;
    saveState(state);
    console.log(`[Scheduler] daily 작업 시작 (${todayStr})`);
    // 비동기로 실행 (매분 체크를 블로킹하지 않음)
    (async () => {
      try { await backupHistory(); } catch (e) { console.error("[Scheduler] Backup 실패:", e); }
      try { await generateDailySummaries(); } catch (e) { console.error("[Scheduler] DailySummary 실패:", e); }
      try { pruneOldDailies(); } catch (e) { console.error("[Scheduler] DailyPrune 실패:", e); }
      try { lintAgentIndexes(); } catch (e) { console.error("[Scheduler] IndexLint 실패:", e); }
      try { await compressOldArchives(); } catch (e) { console.error("[Scheduler] ArchiveCompress 실패:", e); }
      await Promise.allSettled([
        runLibrarian(),
        runWorkerLibrarian(),
      ]).then((results) => {
        results.forEach((r, i) => {
          if (r.status === "rejected") console.error(`[Scheduler] Librarian[${i}] 실패:`, r.reason);
        });
      });
    })();
  }

  // 일일 세션 리셋 (03:30 이후 — daily 작업 완료 후)
  const resetHour = new Date().getHours();
  const resetMinute = new Date().getMinutes();
  if (resetHour > 3 || (resetHour === 3 && resetMinute >= 30)) {
    checkDailyReset(state);
  }

  // 캘린더 일정 대화창 알림 (Claude 호출 없이 데어스 메시지 직접 주입)
  try {
    checkScheduleNotifications(state);
  } catch (err) {
    console.error("[Scheduler] 일정 알림 체크 실패:", err);
  }

  // 모델 티어 성공률 급락 경보 (Claude 호출 없이 데어스 메시지 직접 주입, jobType당 하루 1회)
  try {
    checkMetricsAlerts(state);
  } catch (err) {
    console.error("[Scheduler] 지표 경보 체크 실패:", err);
  }

  const schedule = ensureScheduleFile();

  // 시간 기반 체크 — Claude 호출 없이
  const { items, tasks, linesToRemove } = findDueItems(schedule, state);

  // 예약 작업 자동 위임 — 마이크루 채팅 흐름에 사용자 메시지처럼 태워 적절한 직원에게 위임 결정 유도.
  // 이전: createJob 직접 호출 + addTodo만. ScheduledTask에 agent 필드가 없어 createJob에는 항상 agent=undefined가
  //       전달되어 worker가 누구에게 위임할지 모르는 job이 큐에 쌓여 stuck → todo는 received 상태로만 잔존.
  // 변경: 자연어 지시를 sendMessage로 마이크루에게 전달 → 마이크루가 [TASK] 위임 패턴을 결정 → 흐름에서 createJob/todo 자동 생성.
  for (const task of tasks) {
    console.log(`[Scheduler] 예약 작업 트리거: "${task.request.slice(0, 60)}"`);
    // 루틴 인스턴스 task ID를 마커로 주입 — 마이크루가 DelegateTask 호출 시 이 taskId를 사용해야 함.
    const requestWithMarker = task.instanceTaskId
      ? `${task.request}\n\n<!-- ROUTINE_INSTANCE_TASK:${task.instanceTaskId} -->`
      : task.request;
    try {
      await sendMessage(requestWithMarker, undefined, undefined, { internal: true, source: "scheduler:trigger" });
    } catch (err) {
      if (err instanceof Error && (err.message === "genie_queued" || err.message === "genie_busy")) {
        console.log(`[Scheduler] 마이크루 큐잉: "${task.request.slice(0, 60)}" (${err.message})`);
      } else {
        console.error(`[Scheduler] sendMessage 실패:`, err);
      }
    }
    // 사장님 화면 알림용 짧은 미리보기 — 첫 줄 + 60자 cap (위임 본문 도배 방지).
    const firstLine = task.request.split("\n")[0].trim();
    const requestPreview = firstLine.length > 60 ? firstLine.slice(0, 60) + "…" : firstLine;
    addGenieMessage(`예약된 작업을 시작했어요: "${requestPreview}"`);
  }

  // 스케줄 항목 처리
  if (items.length > 0) {
    removeScheduleLines(linesToRemove);

    const context = items.map((item) => `- ${item}`).join("\n");
    const prompt = `아래 스케줄 항목이 지금 시점에 해당됩니다. 사용자에게 자연스럽게 알려주세요.

${context}

중요: 응답 첫 줄에 반드시 [NOTIFY]를 붙이세요. 없으면 사용자에게 표시되지 않습니다.
짧고 친근하게 말해주세요. TODO 태그는 사용하지 마세요 (스케줄 알림은 작업 지시가 아닙니다).`;

    // busy면 idle 대기 후 전달 (알림 유실 방지)
    await waitForGenieIdle();
    try {
      await sendMessage(prompt, undefined, undefined, { internal: true, source: "scheduler:notify" });
    } catch (err) {
      if (!(err instanceof Error && (err.message === "genie_queued" || err.message === "genie_busy"))) {
        console.error("[Scheduler] 스케줄 sendMessage 실패:", err);
      } else {
        console.log(`[Scheduler] 스케줄 알림 큐잉 (${(err as Error).message})`);
      }
    }
  }

  // 상태 변화 감지 → 변화 있을 때만 마이크루 호출
  await eventDrivenCheck(state);

  state.lastCheck = new Date().toISOString();
  saveState(state);
}

// --- 이벤트 기반 마이크루 호출 (매분 체크, Claude 호출은 변화 시에만) ---
// 영속 플래그(reportedToGenie) 기반. 재시작/tick누락 모두 디스크가 진실 소스.

interface DetectedChanges {
  jobEvents: Array<{ job: Job; message: string }>;
  idleEvent?: string;
}

function detectChanges(): DetectedChanges {
  const jobEvents: Array<{ job: Job; message: string }> = [];
  const allJobs = getAllJobs();
  const busy = new Set(getBusyAgentIds());
  const agents = getAllWorkerAgents();

  // 미보고 종결 작업 — 디스크 영속 플래그 기반
  for (const job of getUnreportedTerminalJobs()) {
    if (job.status === "completed") {
      jobEvents.push({
        job,
        message: `"${job.request.slice(0, 50)}" 작업이 완료됨`,
      });
    } else {
      const errInfo = job.error ? ` (에러: ${job.error.slice(0, 100)})` : "";
      jobEvents.push({
        job,
        message: `"${job.request.slice(0, 50)}" 작업이 실패함${errInfo}. 원인을 분석하고 다음 중 선택하세요: 1) 작업을 더 작게 분해하여 재위임 2) 다른 에이전트에게 재배정 3) 사용자에게 상황 보고`,
      });
    }
  }

  // 한가한 직원 + 대기 중 작업 감지 (in-memory OK — 매 tick 새로 계산되므로 휘발성 무관)
  const queued = allJobs.filter((j) => j.status === "queued");
  const idleAgents = agents.filter((a) => !busy.has(a.id));
  let idleEvent: string | undefined;
  if (queued.length > 0 && idleAgents.length > 0) {
    idleEvent = `대기 중 작업 ${queued.length}건, 한가한 직원: ${idleAgents.map((a) => a.name).join(", ")}`;
  }

  return { jobEvents, idleEvent };
}

const MAX_REPORT_ATTEMPTS = 5;

// genie 호출 진행 중이면 다음 tick 스킵 — 매분 직렬 호출이 사용자 메시지를 블로킹하지 않도록.
let eventDrivenInFlight = false;

// 상태 변화 적응형 배칭(state-change-batch.ts). 활동 중엔 실시간, 한가하면 BATCH_MS 마다 묶어 1회.
const stateBatchConfig = batchConfigFromEnv();
const stateBatcher = new StateChangeBatcher(stateBatchConfig.batchMs);
// «활동»으로 보는 진행 중 잡 상태. awaiting_approval 은 사람 대기라 활동으로 치지 않는다.
const ACTIVE_JOB_STATUSES: ReadonlySet<string> = new Set(["queued", "planning", "running"]);

async function eventDrivenCheck(state: SchedulerState): Promise<void> {
  if (eventDrivenInFlight) {
    console.log("[Scheduler] eventDrivenCheck 진행 중 — 이번 tick 스킵");
    return;
  }
  const { jobEvents, idleEvent } = detectChanges();
  if (jobEvents.length === 0 && !idleEvent) {
    // 보류 중이던 사건이 다른 경로로 전부 보고됐다 — 배칭 창을 닫는다.
    stateBatcher.markFlushed();
    return;
  }

  // 적응형 배칭: 미보고 잡이 디스크에 남아 있으므로 «보류 = 이번 tick 에 안 보냄»이면 충분하다.
  const nowMs = Date.now();
  const activeJobs = getAllJobs().filter((j) => ACTIVE_JOB_STATUSES.has(j.status as string)).length + getBusyAgentIds().length;
  const batchMode = decideStateChangeMode({
    nowMs,
    lastUserMessageMs: getLastUserMessageTime(),
    runningOrQueuedJobs: activeJobs,
    activeWindowMs: stateBatchConfig.activeWindowMs,
  });
  const batchDecision = stateBatcher.shouldSend(batchMode, nowMs);
  if (!batchDecision.send) {
    if (batchDecision.reason === "idle-buffer-start") {
      console.log(`[Scheduler] 한가 모드 — 상태 변화 ${jobEvents.length + (idleEvent ? 1 : 0)}건 보류(${Math.round(stateBatchConfig.batchMs / 1000)}초 단위 묶음)`);
    }
    return;
  }

  // 마지막 호출 후 최소 1분 대기 (너무 자주 호출 방지)
  if (state.lastProactiveCheck) {
    const elapsed = Date.now() - new Date(state.lastProactiveCheck).getTime();
    if (elapsed < 60 * 1000) return;
  }

  eventDrivenInFlight = true;
  // 이번 tick 이 보류분까지 한 번에 보낸다 — 배칭 창 종료(전송 실패 시 미보고 잡은 다음 tick 에 재검출).
  stateBatcher.markFlushed();
  if (batchDecision.reason !== "realtime") console.log(`[Scheduler] 상태 변화 묶음 발송 (${batchDecision.reason})`);
  state.lastProactiveCheck = new Date().toISOString();
  try {
  // throttle race 방지: sendMessage가 await으로 수십 초 걸리는 동안
  // 다음 setInterval tick이 옛 디스크 값을 읽어 throttle을 우회하지 않도록 즉시 영속화
  saveState(state);
  const allMessages = [...jobEvents.map((e) => e.message), ...(idleEvent ? [idleEvent] : [])];
  console.log(`[Scheduler] 상태 변화 감지: ${allMessages.join(", ")}`);

  let sendOk = false;
  let reply: Awaited<ReturnType<typeof sendMessage>> | null = null;
  // sendMessage가 영원히 settle되지 않으면 eventDrivenInFlight가 영구 stuck되어
  // 이후 모든 tick이 스킵된다 — 상한을 두고 강제 실패 처리.
  const SEND_TIMEOUT_MS = 5 * 60 * 1000;
  try {
    reply = await Promise.race([
      sendMessage(
      `[시스템 상태 변화 감지]\n${allMessages.map((e) => `- ${e}`).join("\n")}\n\n위 상황을 확인하고 필요한 조치를 취하세요. 사용자에게 알릴 게 있으면 알려주세요. 특별한 조치가 필요 없으면 아무것도 하지 마세요.\n\n사용자에게 알려야 할 변화가 있을 때만 응답 첫 줄에 [NOTIFY] 마커를 붙이세요. 예: "[NOTIFY] 데이브 작업 실패함". 마커 없는 응답은 사용자 화면에 표시되지 않습니다 (시스템 사고/태그 처리는 정상 동작). "무시", "정상", "확인" 같은 기록용 답변은 마커 없이.`,
      undefined,
      undefined,
      { internal: true, source: "scheduler:state-change" },
      ),
      new Promise<never>((_, reject) => {
        const t = setTimeout(() => reject(new Error(`sendMessage ${SEND_TIMEOUT_MS / 1000}초 초과`)), SEND_TIMEOUT_MS);
        t.unref?.();
      }),
    ]);
    sendOk = true;
  } catch (err) {
    console.error("[Scheduler] sendMessage 실패:", err);
  }

  // 마커 누락 시 사장님 보장 발화 — 영구 누락 방지 (잭키 진단 M-1).
  // sendOk=true이지만 reply.content에 [NOTIFY]/[REPORT] 마커 없으면 fallback 1회 발화 후 마킹.
  const replyHasMarker = !!reply && /^\[(NOTIFY|REPORT)\]\s*/i.test(reply.content);

  // terminal 전이는 sendMessage 성공 여부와 무관하게 보장.
  // job.status에 따라 done/failed 분기 — failed job을 done으로 마무리하면
  // todo가 자동 status=done이 되어 "대기 및 미완료" 탭에서 사라지는 버그 방지.
  for (const { job, message } of jobEvents) {
    const targetState = job.status === "completed" ? "done" : "failed";
    try {
      transitionTodosForJob(job.id, targetState, message);
    } catch (e) {
      console.error(`[Scheduler] ${targetState} 전이 실패 ${job.id.slice(0, 8)}:`, e);
    }
    if (sendOk) {
      if (!replyHasMarker) {
        addGenieMessage(`작업 알림: ${message}`);
      }
      try {
        markJobReported(job.id);
      } catch (e) {
        console.error(`[Scheduler] 보고 마킹 실패 ${job.id.slice(0, 8)}:`, e);
      }
      // 텔레그램·디스코드 알림 (fire-and-forget) — chat.js와의 순환 import를 피하기 위해 동적 import 사용.
      const summary = job.request.slice(0, 60);
      const agentLabel = job.agent ?? "미지정";
      const jobIdShort = job.id.slice(0, 8);
      const noticeCategory = job.status === "completed" ? "job-completed" : "job-failed";
      const noticeText = job.status === "completed"
        ? `[${agentLabel} · ${jobIdShort}] 📋 작업 완료: ${summary}`
        : `[${agentLabel} · ${jobIdShort}] ⚠️ 작업 실패: ${summary}`;
      import("./telegram.js")
        .then((m) => m.sendTelegramNoticeThrottled(noticeCategory, noticeText))
        .catch(() => {});
      import("./discord.js")
        .then((m) => m.sendDiscordNoticeThrottled(noticeCategory, noticeText))
        .catch(() => {});
    } else {
      const attempts = bumpReportAttempt(job.id);
      if (attempts >= MAX_REPORT_ATTEMPTS) {
        giveUpReporting(job.id, `sendMessage ${attempts}회 실패`);
      }
    }
  }
  } finally {
    eventDrivenInFlight = false;
  }
}

// 다음 실행 시점을 찾아서 정시 타이머 설정
let nextTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleNextExact(): void {
  if (nextTimer) clearTimeout(nextTimer);

  const schedule = ensureScheduleFile();
  const today = getToday();
  const now = new Date();
  const state = loadState();
  const fired = new Set(state.firedReminders ?? []);

  let nearestMs = Infinity;
  let nearestLabel = "";

  const lines = schedule.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();

    // cron / 매일 반복은 매분 폴링으로 처리 → scheduleNextExact에서는 일회성만 타이머 설정

    // 일회성: "- YYYY-MM-DD HH:MM: 내용"
    const reminderMatch = trimmed.match(
      /^- (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}):?\s+(.+)/,
    );
    if (reminderMatch) {
      const [, date, time, content] = reminderMatch;
      const key = `${date}-${time}`;
      if (fired.has(key)) continue;
      const target = new Date(`${date}T${time}:00`);
      if (isNaN(target.getTime())) continue;
      const diff = target.getTime() - now.getTime();
      if (diff > 0 && diff < nearestMs) {
        nearestMs = diff;
        nearestLabel = `${date} ${time}: ${content}`;
      }
    }
  }

  if (nearestMs < Infinity) {
    const mins = Math.round(nearestMs / 60000);
    console.log(`[Scheduler] 다음 정시 알림: ${nearestLabel} (${mins}분 후)`);
    nextTimer = setTimeout(() => {
      runScheduleCheck().catch((err) =>
        console.error("[Scheduler] 정시 체크 실패:", err),
      );
      scheduleNextExact();
    }, nearestMs);
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;

function msUntilNextMinute(): number {
  const now = new Date();
  return (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
}

// librarianTimerId 제거 — 매분 체크로 통합됨

// 일별 요약 생성 — 에이전트별로 그날 생성된 위키를 AI 요약 후 daily/ 에 저장
async function generateDailySummaries(): Promise<void> {
  const { readdirSync, renameSync } = await import("node:fs");
  const { runAgent } = await import("../agent.js");
  const agents = getAllWorkerAgents();
  const dateStr = kstDaysAgo(1);

  for (const agent of agents) {
    const wikiDir = join(HISTORY_DIR, "agents", agent.id, "wiki");
    if (!existsSync(wikiDir)) continue;

    const dailyDir = join(wikiDir, "daily");
    const dailyFile = join(dailyDir, `${dateStr}.md`);
    if (existsSync(dailyFile)) continue; // 이미 생성됨

    // 보호 대상 제외, 비보호 위키 페이지 수집
    const protectedFiles = [...PROTECTED_PAGE_NAMES].map((n) => n + ".md");
    const files = readdirSync(wikiDir).filter(
      (f: string) => f.endsWith(".md") && !protectedFiles.includes(f) && !PROTECTED_PAGE_PREFIXES.some((p) => f.startsWith(p)),
    );

    // 이미 daily 요약에 포함되지 않은 파일만 (mtime 기준 대신)
    const targetFiles = files.filter((_f: string) => true); // 비보호 전부 대상

    if (targetFiles.length === 0) continue;

    // 파일 내용 수집
    const pages = targetFiles.map((f: string) =>
      `--- ${f} ---\n${readFileSync(join(wikiDir, f), "utf-8")}`,
    ).join("\n\n");

    console.log(`[DailySummary] ${agent.name}: ${targetFiles.length}개 파일 요약 시작 (${dateStr})`);

    const config = {
      role: "orchestrator" as const,
      name: "DailySummary",
      systemPrompt: `당신은 하루 업무 요약 담당입니다. 주어진 위키 페이지들을 50줄 이내의 하루 요약으로 정리하세요. 핵심 결정사항, 작업 결과, 발견된 문제를 중심으로. 불필요한 세부사항은 제거.`,
      allowedTools: [] as string[],
      textOnly: true,
      maxTurns: 5,
      model: resolveTier("cheap"), // 저비용 티어 핀 — 프론티어 모델 불필요
    };

    const result = await runAgent(config, "daily-summary", `${agent.name}의 ${dateStr} 업무를 요약하세요.\n\n${pages}`);
    if (result.cost) logCost(agent.id, undefined, result.cost, "worker:daily-summary");
    if (!result.success || !result.output) {
      console.error(`[DailySummary] ${agent.name} 요약 실패`);
      continue;
    }

    // daily/ 폴더 생성 + 요약 저장
    if (!existsSync(dailyDir)) mkdirSync(dailyDir, { recursive: true });
    writeFileSync(dailyFile, `# ${agent.name} 업무 요약 (${dateStr})\n\n${result.output}`);

    // 원본 파일 삭제 (삭제 전 archiveWikiPage로 방어 — 생성 시 누락 대비)
    const { unlinkSync: ul } = await import("node:fs");
    for (const f of targetFiles) {
      try {
        archiveWikiPage(f.replace(/\.md$/, ""), readFileSync(join(wikiDir, f), "utf-8"), `pm-${agent.id}`);
        ul(join(wikiDir, f));
      } catch (err) {
        console.error(`[DailySummary] 원본 위키 아카이브/삭제 실패: ${join(wikiDir, f)}`, err);
      }
    }

    console.log(`[DailySummary] ${agent.name}: ${dateStr} 요약 완료 (${targetFiles.length}개 → daily/${dateStr}.md)`);
  }

  // 마이크루도 동일 처리 (마이크루 daily는 genie/daily/ 에 저장)
  const genieWikiDir = join(HISTORY_DIR, "genie", "wiki");
  if (existsSync(genieWikiDir)) {
    const dailyDir = join(HISTORY_DIR, "genie", "daily");
    const dailyFile = join(dailyDir, `${dateStr}.md`);
    if (!existsSync(dailyFile)) {
      const protectedFiles = [...PROTECTED_PAGE_NAMES].map((n) => n + ".md");
      const { readdirSync: rd, statSync: st, renameSync: rn } = await import("node:fs");
      const files = rd(genieWikiDir).filter(
        (f: string) => f.endsWith(".md") && !protectedFiles.includes(f) && !PROTECTED_PAGE_PREFIXES.some((p) => f.startsWith(p)),
      );
      const targetFiles = files.filter((_f: string) => true); // 비보호 전부 대상

      if (targetFiles.length > 0) {
        const pages = targetFiles.map((f: string) =>
          `--- ${f} ---\n${readFileSync(join(genieWikiDir, f), "utf-8")}`,
        ).join("\n\n");

        console.log(`[DailySummary] 마이크루: ${targetFiles.length}개 파일 요약 시작 (${dateStr})`);

        const config = {
          role: "orchestrator" as const,
          name: "DailySummary",
          systemPrompt: `당신은 하루 업무 요약 담당입니다. 주어진 위키 페이지들을 50줄 이내의 하루 요약으로 정리하세요. 핵심 결정사항, 작업 결과, 발견된 문제를 중심으로.`,
          allowedTools: [] as string[],
          textOnly: true,
          maxTurns: 5,
          model: resolveTier("cheap"), // 저비용 티어 핀 — 프론티어 모델 불필요
        };

        const result = await runAgent(config, "daily-summary-genie", `${getGenieName()}의 ${dateStr} 업무를 요약하세요.\n\n${pages}`);
        if (result.cost) logCost("genie", undefined, result.cost, "genie:daily-summary-wiki");
        if (result.success && result.output) {
          if (!existsSync(dailyDir)) mkdirSync(dailyDir, { recursive: true });
          writeFileSync(dailyFile, `# ${getGenieName()} 업무 요약 (${dateStr})\n\n${result.output}`);
          // 원본 삭제 (삭제 전 archiveWikiPage로 방어)
          const { unlinkSync: ul2 } = await import("node:fs");
          for (const f of targetFiles) {
            try {
              archiveWikiPage(f.replace(/\.md$/, ""), readFileSync(join(genieWikiDir, f), "utf-8"), "genie");
              ul2(join(genieWikiDir, f));
            } catch (err) {
              console.error(`[DailySummary] 마이크루 위키 아카이브/삭제 실패: ${join(genieWikiDir, f)}`, err);
            }
          }
          console.log(`[DailySummary] 마이크루: ${dateStr} 요약 완료`);
        }
      }
    }
  }
}

// 30일 경과 daily 요약을 index에서 제거 (파일은 유지)
function pruneOldDailies(): void {
  const cutoffStr = kstDaysAgo(30);

  const agentDirs = [
    ...getAllWorkerAgents().map((a) => join(HISTORY_DIR, "agents", a.id, "wiki")),
    join(HISTORY_DIR, "genie", "wiki"),
  ];

  for (const wikiDir of agentDirs) {
    const indexPath = join(wikiDir, "index.md");
    if (!existsSync(indexPath)) continue;
    let index = readFileSync(indexPath, "utf-8");
    const original = index;
    // daily/YYYY-MM-DD.md 형식의 항목 중 30일 초과분 제거
    index = index.replace(/- \[.*?\]\(daily\/(\d{4}-\d{2}-\d{2})\.md\)[^\n]*/g, (match, date) => {
      return date < cutoffStr ? "" : match;
    });
    // 빈 줄 정리
    index = index.replace(/\n{3,}/g, "\n\n").trim() + "\n";
    if (index !== original) {
      writeFileSync(indexPath, index);
      console.log(`[Scheduler] ${wikiDir}: 30일 경과 daily 항목 정리`);
    }
  }
}

// index lint: 위키 페이지 정합성 검사 (고아 항목 제거)
function lintAgentIndexes(): void {
  const agents = getAllWorkerAgents();
  const targets = agents.map((a) => ({ name: a.name, wikiDir: join(HISTORY_DIR, "agents", a.id, "wiki") }));
  targets.push({ name: getGenieName(), wikiDir: join(HISTORY_DIR, "genie", "wiki") });

  for (const { name, wikiDir } of targets) {
    const indexPath = join(wikiDir, "index.md");
    if (!existsSync(indexPath)) continue;
    let index = readFileSync(indexPath, "utf-8");
    const original = index;

    // index에 링크된 위키 파일이 실제 존재하는지 확인
    index = index.replace(/- \[.*?\]\(([^)]+)\)[^\n]*/g, (match, filePath) => {
      // 외부 경로(outputs 등)는 건너뜀
      if (filePath.includes("../")) return match;
      const fullPath = join(wikiDir, filePath);
      if (!existsSync(fullPath)) {
        console.log(`[IndexLint] ${name}: 고아 항목 제거 → ${filePath}`);
        return "";
      }
      return match;
    });

    index = index.replace(/\n{3,}/g, "\n\n").trim() + "\n";
    if (index !== original) {
      writeFileSync(indexPath, index);
    }

    // USE WHEN (미지정) 경고
    const unspecCount = (index.match(/USE WHEN: \(미지정\)/g) || []).length;
    if (unspecCount > 0) {
      console.warn(`[IndexLint] ${name}: USE WHEN (미지정) ${unspecCount}건 — 주요 산출물 설명을 채워주세요`);
    }
  }
}

// history/ 자동 백업 — 7일 보관 (archiver — cross-platform, tar 불필요)
async function backupHistory(): Promise<void> {
  const backupDir = join(HISTORY_DIR, "..", "history-backups");
  if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });

  const today = getTodayKST();
  const backupFile = join(backupDir, `history-${today}.tar.gz`);
  if (existsSync(backupFile)) return; // 오늘 이미 백업됨

  const { createWriteStream } = await import("node:fs");
  const { default: archiver } = await import("archiver");
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(backupFile);
    const arc = archiver("tar", { gzip: true });
    out.on("close", resolve);
    arc.on("error", reject);
    arc.pipe(out);
    arc.directory(HISTORY_DIR, "history");
    arc.finalize();
  });
  console.log(`[Backup] history 백업 완료: ${backupFile}`);

  // 7일 이전 백업 삭제
  const cutoffStr = kstDaysAgo(7);
  const oldBackups = readdirSync(backupDir).filter((f: string) => {
    const match = f.match(/history-(\d{4}-\d{2}-\d{2})\.tar\.gz/);
    return match && match[1] < cutoffStr;
  });
  for (const f of oldBackups) {
    const { unlinkSync: ul } = await import("node:fs");
    ul(join(backupDir, f));
    console.log(`[Backup] 오래된 백업 삭제: ${f}`);
  }
}

// 90일 이전 archive/wiki 날짜 폴더를 tar.gz 압축 후 삭제 (archiver — cross-platform)
async function compressOldArchives(): Promise<void> {
  const archiveWikiDir = join(HISTORY_DIR, "archive", "wiki");
  if (!existsSync(archiveWikiDir)) return;

  const cutoffStr = kstDaysAgo(90);

  const dirs = readdirSync(archiveWikiDir).filter((d: string) => d.match(/^\d{4}-\d{2}-\d{2}$/) && d < cutoffStr);
  for (const dir of dirs) {
    const fullPath = join(archiveWikiDir, dir);
    const tarPath = join(archiveWikiDir, `${dir}.tar.gz`);
    if (existsSync(tarPath)) continue; // 이미 압축됨
    try {
      const { createWriteStream } = await import("node:fs");
      const { default: archiver } = await import("archiver");
      await new Promise<void>((resolve, reject) => {
        const out = createWriteStream(tarPath);
        const arc = archiver("tar", { gzip: true });
        out.on("close", resolve);
        arc.on("error", reject);
        arc.pipe(out);
        arc.directory(fullPath, dir);
        arc.finalize();
      });
      // 압축 성공 시 원본 폴더 삭제
      const { rmSync } = await import("node:fs");
      rmSync(fullPath, { recursive: true });
      console.log(`[Archive] ${dir} → ${dir}.tar.gz 압축 완료`);
    } catch (err) {
      console.error(`[Archive] ${dir} 압축 실패:`, err);
    }
  }
}

// scheduleLibrarian 제거 — 03:00 daily 작업은 runScheduleCheck 매분 체크로 통합됨

function initRoutineMasters(): void {
  try {
    const raw = ensureScheduleFile();
    for (const line of raw.split('\n')) {
      const m = line.match(/^- (?:\[[\w-]+\]\s+)?cron\s+([^[]+)\[TASK(?::([^\]]*))?\]:?\s+(.+)/);
      if (m) {
        const [, expr, , content] = m;
        getOrCreateRoutineMaster(content.trim(), expr.trim());
      }
    }
    console.log('[Scheduler] 루틴 마스터 초기화 완료');
  } catch (e) {
    console.warn('[Scheduler] 루틴 마스터 초기화 실패:', e);
  }
}

export function startScheduler(_intervalMs?: number): void {
  console.log(`[Scheduler] 시작 (매분 0초 실행)`);

  // 부팅 시 friend-sync 디스크 상태 복구 — 재시작 직후 즉시 재실행 방지
  initFriendSyncState();
  initRoutineMasters();

  // 다음 분 0초에 첫 실행, 이후 60초 간격
  const waitMs = msUntilNextMinute();
  console.log(`[Scheduler] 첫 체크까지 ${Math.round(waitMs / 1000)}초`);

  setTimeout(() => {
    runScheduleCheck().catch((err) =>
      console.error("[Scheduler] 체크 실패:", err),
    );
    scheduleNextExact();

    intervalId = setInterval(() => {
      runScheduleCheck().catch((err) =>
        console.error("[Scheduler] 체크 실패:", err),
      );
      scheduleNextExact();
    }, 60 * 1000);
  }, waitMs);

  // 03:00 daily 작업은 runScheduleCheck 매분 체크로 통합됨 (별도 타이머 불필요)
}

export function stopScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
