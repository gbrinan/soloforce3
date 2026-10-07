import { loadWorkerIdentity } from "./worker-identity.js";
import { randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, appendFileSync, statSync, realpathSync } from "node:fs";
import { atomicWriteFileSync, quarantineCorruptFile } from "./utils/atomic-write.js";
import { extractOutputPathsFromText } from "./utils/artifact-ext.js";
import {
  detectUpstreamLimit,
  detectUpstreamLimitFrom,
  formatResumeAt,
  UpstreamLimitError,
  MAX_DEFERRALS,
} from "./upstream-limit.js";
import { formatArtifactListForHandoff, formatQaTargetsWithStamp, isArtifactModifiedSince } from "./utils/path-normalize.js";
import { join, basename, dirname, isAbsolute, resolve as pathResolve } from "node:path";
import { tmpdir, homedir } from "node:os";
import type { AgentConfig, AgentResult, AgentCost, Job, JobStatus } from "../types.js";
import { addGenieMessage, runGenieAgent, sendMessage, waitForGenieIdle, isGenieBusy, getGenieTurnId } from "./chat.js";
import {
  loadPmSession,
  savePmSession,
  savePmSessionTokens,
  loadPmSessionInfo,
  markSessionStart,
  clearPmSession,
  loadPmWiki,
  savePmWikiPage,
  isProfileOversized,
  PROTECTED_PAGE_NAMES,
  PROTECTED_PAGE_PREFIXES,
} from "./pm-memory.js";
import { transitionTodosForJob, appendNoteForJob, advanceTodoStageForJob, linkJobToTodo, setTodoState, setTodoAgentNameForJob, getTodosByJobId } from "./todos.js";
import { PROJECTS_DIR, PROJECT_SELF_DIR, CLAUDE_BIN_DIR, HISTORY_DIR, TSX_BIN, TSX_CLI_ARGS } from "../config.js";
import { routeToAgent, getWorkerAgent, getDefaultAgent, getAllWorkerAgents, toAgentConfig, resolveWorkerRuntime, resolveNewWorkerId, type WorkerAgentDef } from "../agent-registry.js";

// AX: 중첩 프로젝트 경로 해석 — 최대 2단(예: "ax/australia-lng"), traversal 차단.
// SPEC-AX-NESTED-PROJECTS-001 R1/R3. 기존 1단 이름은 동일하게 동작한다.
export function resolveProjectCwd(projectName: string): string {
  const norm = projectName.replace(/\\/g, "/").replace(/\/+$/, "");
  const segs = norm.split("/").filter(Boolean);
  const valid = segs.length >= 1 && segs.length <= 2
    && !isAbsolute(norm)
    && segs.every((s) => s !== ".." && s !== "." && !s.includes(":"));
  if (!valid) throw new Error(`잘못된 프로젝트 경로: ${projectName}`);
  const abs = pathResolve(join(PROJECTS_DIR, ...segs));
  const root = pathResolve(PROJECTS_DIR);
  if (abs !== root && !abs.startsWith(root + "\\") && !abs.startsWith(root + "/")) {
    throw new Error(`프로젝트 경로 이탈: ${projectName}`);
  }
  return abs;
}
import { auditLog, archiveJob } from "./audit.js";
import { classifyExit } from "./jobs.classify.js";
import { classifyWorkerResultQuality } from "./job-result-quality.js";
import { getPolicyDisallowedTools } from "./service-policies.js";
import { getAdapter, type AgentAdapter } from "../adapters/index.js";
import { revokeRecentApprovals } from "./approvals.js";
import { appendDailyWikiEntry } from "./auto-wiki.js";
import { claudeSessionExists } from "./agent-pty.js";
import { buildSensitiveMatcher } from "../mcp/sensitive-paths.js";
import { isSelectiveRecallEnabled, getRecallBudgetChars, buildWikiIndex, buildToc, formatToc, recallRelevant } from "./memory/recall.js";
import { recordJobMetric } from "./metrics.js";
import { resolveTier, escalateTier } from "./model-tiers.js";
import { planStageModel } from "./worker-stage-model.js";
import { decideQa, newCodeChanges, pickQaModel } from "./qa-trigger-policy.js";
import { selectQaReview, qaVerificationInstructions } from "./qa-review-plan.js";
import { resolveEffort, normalizeEffort } from "./effort-policy.js";
import { buildCostEntry } from "./cost-entry.js";
import type { ModelTier } from "./loops/types.js";

import { withoutAnthropicKeys } from "./utils/safeChildEnv.js";
const folderName = basename(PROJECT_SELF_DIR);
const SELF_NAMES = new Set(["self", folderName, folderName.toLowerCase()]);

const MAX_JOB_HISTORY = 100;
const MAX_CONCURRENT = 3;
const MAX_RESUBMIT = 2; // 산출물 검증 FAIL 재제출 상한 — 초과 시 자동 중단 + genie 보고
// [타임아웃 감사 A/C] 천장 정렬: 응답한도(30분) < STUCK_AWAITER(31분) < 리스(32분).
// 기존 리스 15분 < 응답한도 30분 역전으로 정당한 장기 작업이 리스 리퍼에게 SIGKILL당했고,
// STUCK_AWAITER==리스(둘 다 15분) 동시발화로 "빈 출력 완료" vs "실패"가 비결정적이었다.
const LEASE_DURATION_MS = 32 * 60 * 1000;
const JOBS_FILE = join(HISTORY_DIR, "jobs.json");
const jobs = new Map<string, Job>();
const queue: string[] = [];
let runningCount = 0;

// === 재시도 가드 (작업 제목 해시 기반 24시간 슬라이딩 윈도우) ===
// 디스크 영속화: 메모리 전용이면 서버 재시작 시 카운터가 리셋되어 무한 재시도 보호가
// 무력화된다 (플랫폼 분석 2026-07-04 P0). 변경 시마다 저장, 부팅 시 로드.
const RETRY_GUARD_WINDOW_MS = 24 * 60 * 60 * 1000; // 24시간
const RETRY_GUARD_MAX_ATTEMPTS = 3;
const RETRY_GUARD_FILE = join(HISTORY_DIR, "retry-guard.json");
const retryAttempts = new Map<string, { count: number; firstFailedAt: number; lastFailedAt: number }>();

function persistRetryGuard(): void {
  try {
    writeFileSync(RETRY_GUARD_FILE, JSON.stringify(Object.fromEntries(retryAttempts)));
  } catch (err) {
    console.warn("[RetryGuard] 영속화 실패:", err instanceof Error ? err.message : err);
  }
}

// 테스트용 관측 훅 (scripts/retry-guard-persist-test.ts)
export function retryGuardSize(): number {
  return retryAttempts.size;
}

export function loadRetryGuard(): void {
  try {
    if (!existsSync(RETRY_GUARD_FILE)) return;
    const parsed = JSON.parse(readFileSync(RETRY_GUARD_FILE, "utf-8")) as Record<
      string,
      { count: number; firstFailedAt: number; lastFailedAt: number }
    >;
    const now = Date.now();
    for (const [hash, data] of Object.entries(parsed)) {
      // 만료 항목은 로드하지 않음 (윈도우 밖)
      if (now - data.lastFailedAt <= RETRY_GUARD_WINDOW_MS) retryAttempts.set(hash, data);
    }
    if (retryAttempts.size > 0) console.log(`[RetryGuard] ${retryAttempts.size}건 복원 (24h 윈도우 내 실패 이력)`);
  } catch (err) {
    console.warn("[RetryGuard] 로드 실패 — 빈 상태로 시작:", err instanceof Error ? err.message : err);
  }
}

/** resume 전 claude 세션 파일 존재 확인 — 없으면 undefined로 새 세션 시작 (No conversation found 예방) */
function liveSession(sid: string | undefined, cwd: string | undefined): string | undefined {
  return sid && claudeSessionExists(sid, cwd ?? process.cwd()) ? sid : undefined;
}

/** stream-json system/init 이벤트에서 session_id 추출 — 세션 조기 체크포인트용 순수 파서 (테스트 노출) */
export function extractInitSessionId(event: unknown): string | undefined {
  const ev = event as { type?: string; subtype?: string; session_id?: string } | null;
  if (ev && ev.type === "system" && ev.subtype === "init" && typeof ev.session_id === "string" && ev.session_id) {
    return ev.session_id;
  }
  return undefined;
}

// 세션 조기 체크포인트: 실행 시작 직후(init 이벤트) session_id를 즉시 영속화.
// 기존엔 결과 수신 후에만 savePmSession → SIGKILL(lease 만료)·크래시 시 진행분 세션이 유실돼
// 재시도가 처음부터 재실행됐다. 조기 저장하면 다음 시도가 --resume으로 진행분을 이어감.
// (세션 파일 미존재 시 liveSession 가드가 새 세션으로 폴백하므로 안전)
function makeSessionCheckpointer(agentId: string, jobId: string | undefined): (event: unknown) => void {
  return (event: unknown) => {
    const sid = extractInitSessionId(event);
    if (!sid) return;
    try {
      savePmSession(agentId, sid);
      if (jobId) {
        const j = jobs.get(jobId);
        if (j && j.sessionId !== sid) {
          j.sessionId = sid;
          saveJobs();
        }
      }
    } catch (e) {
      console.warn(`[Checkpoint] 세션 조기 저장 실패 (${agentId}):`, e instanceof Error ? e.message : e);
    }
  };
}

function hashTaskTitle(title: string): string {
  return createHash("sha1").update(title.trim()).digest("hex").slice(0, 12);
}

function pruneRetryCache(now: number): void {
  let changed = false;
  for (const [hash, data] of retryAttempts) {
    if (now - data.lastFailedAt > RETRY_GUARD_WINDOW_MS) {
      retryAttempts.delete(hash);
      changed = true;
    }
  }
  if (changed) persistRetryGuard();
}

export function checkRetryGuard(request: string): void { // 테스트 노출
  const now = Date.now();
  pruneRetryCache(now);
  
  const hash = hashTaskTitle(request);
  const data = retryAttempts.get(hash);
  
  if (!data) return; // 첫 시도 또는 24시간 경과 → 통과
  
  // 24시간 윈도우 체크
  if (now - data.firstFailedAt > RETRY_GUARD_WINDOW_MS) {
    // 윈도우 초과 → 리셋
    retryAttempts.delete(hash);
    return;
  }
  
  // 3회 실패 차단
  if (data.count >= RETRY_GUARD_MAX_ATTEMPTS) {
    const errorMsg = `[재시도 차단] 동일 작업이 24시간 내 ${data.count}회 실패했습니다. 반복 패턴 감지로 자동 차단. 작업: "${request.slice(0, 100)}"`;
    console.error(errorMsg);
    
    // Discord 알림 (fire-and-forget)
    import("./chat.js")
      .then((chat) => {
        chat.addGenieMessage(
          `⛔ **반복 실패 패턴 차단**\n\n동일 작업이 ${data.count}회 실패했습니다 (최초: ${new Date(data.firstFailedAt).toLocaleString("ko-KR")}):\n"${request.slice(0, 200)}"\n\n조치: 작업 내용을 재검토하거나 접근 방식을 변경하세요.`
        );
      })
      .catch((err) => console.error("[RetryGuard] Discord 알림 실패:", err));
    
    throw new Error(errorMsg);
  }
}

export function recordRetryAttempt(request: string, success: boolean): void { // 테스트 노출
  const hash = hashTaskTitle(request);
  const now = Date.now();
  
  if (success) {
    // 성공 시 카운트 리셋
    if (retryAttempts.delete(hash)) persistRetryGuard();
    return;
  }
  
  // 실패 시 카운트 증가
  const existing = retryAttempts.get(hash);
  if (existing) {
    existing.count++;
    existing.lastFailedAt = now;
  } else {
    retryAttempts.set(hash, {
      count: 1,
      firstFailedAt: now,
      lastFailedAt: now,
    });
  }
  persistRetryGuard();
}

// --- 영속화 (재시작 후에도 미보고 작업 추적 가능하도록) ---

// terminal 상태(completed/failed)는 최근 N건만 유지. non-terminal(queued/planning/awaiting_approval/running)은 전부 보존.
// archive(audit.ts:archiveJob)는 history/archive/jobs/에 별도 저장 — 본 slice와 무관.
const TERMINAL_JOB_STATUSES = new Set<JobStatus>(["completed", "outputs_missing", "failed"]);
// 2026-07-17: 저장(10)·로드(30) 상수 불일치로 저장이 항상 이겨 종료 잡이 10건으로 잘리던 것 통일.
const MAX_TERMINAL_JOBS = 30;

function saveJobs(): void {
  try {
    if (!existsSync(HISTORY_DIR)) mkdirSync(HISTORY_DIR, { recursive: true });
    const all = Array.from(jobs.values());
    const nonTerminal = all.filter((j) => !TERMINAL_JOB_STATUSES.has(j.status));
    // unreported는 slice에서 보호 (scheduler가 보고 시도 중인 잡 영구 누락 방지 — 2026-05-04 진단).
    // giveUpReporting(5회 실패 후) 자동 reported 마킹되므로 무한 누적 안 됨.
    const allTerminal = all.filter((j) => TERMINAL_JOB_STATUSES.has(j.status));
    const unreported = allTerminal.filter((j) => j.reportedToGenie !== true);
    const reported = allTerminal
      .filter((j) => j.reportedToGenie === true)
      .sort((a, b) => (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt))
      .slice(0, MAX_TERMINAL_JOBS);
    const terminal = [...unreported, ...reported];
    const toPersist = [...nonTerminal, ...terminal];
    // Map도 동기화: slice된 항목은 메모리에서도 제거 (UI getAllJobs 일관성)
    if (toPersist.length < all.length) {
      const keepIds = new Set(toPersist.map((j) => j.id));
      for (const id of jobs.keys()) {
        if (!keepIds.has(id)) jobs.delete(id);
      }
    }
    atomicWriteFileSync(JOBS_FILE, JSON.stringify(toPersist, null, 2));
  } catch (err) {
    console.error("[Jobs] 저장 실패:", err);
  }
}

export function loadJobs(): void {
  loadRetryGuard(); // 재시도 가드 이력 복원 (서버 재시작 시 카운터 리셋 방지)
  if (!existsSync(JOBS_FILE)) return;
  try {
    const arr = JSON.parse(readFileSync(JOBS_FILE, "utf-8")) as Job[];
    if (!Array.isArray(arr)) return;
    // 손상 데이터 필터링 — 필수 필드(id/request/status) 누락 시 제거
    const validated: Job[] = [];
    let dropped = 0;
    for (const raw of arr) {
      if (!raw || typeof raw !== "object") { dropped++; continue; }
      const c = raw as Partial<Job>;
      if (typeof c.id !== "string" || !c.id || typeof c.request !== "string" || !c.request || typeof c.status !== "string" || !c.status) {
        console.warn(`[Jobs] 필수 필드 누락 Job 제거: id=${typeof c.id === "string" ? c.id.slice(0, 8) : "<no-id>"}`);
        dropped++;
        continue;
      }
      validated.push(c as Job);
    }
    // 종료(terminal) 잡 prune — 최근 MAX_TERMINAL_JOBS건만 보존. 고아/실패 잡이 jobs.json에
    // 무한 누적되며 genie 재보고 노이즈를 내던 문제 정리 (2026-06-24). 비-터미널(running/queued)은 전부 보존.
    const terminal = validated.filter((j) => TERMINAL_JOB_STATUSES.has(j.status));
    if (terminal.length > MAX_TERMINAL_JOBS) {
      const ts = (j: Job) => Date.parse(j.completedAt || j.createdAt || "") || 0;
      const keep = new Set(
        [...terminal].sort((a, b) => ts(b) - ts(a)).slice(0, MAX_TERMINAL_JOBS).map((j) => j.id),
      );
      const prunedCount = terminal.length - keep.size;
      for (let i = validated.length - 1; i >= 0; i--) {
        const j = validated[i];
        if (TERMINAL_JOB_STATUSES.has(j.status) && !keep.has(j.id)) validated.splice(i, 1);
      }
      if (prunedCount > 0) console.log(`[Jobs] 종료 잡 prune: ${prunedCount}건 제거 (terminal ${terminal.length}→${MAX_TERMINAL_JOBS})`);
    }
    const now = Date.now();
    let orphaned = 0;
    let migrated = 0;
    let preserved = 0;
    let queuedRestored = 0;
    for (const job of validated) {
      // 마이그레이션: 종결 상태인데 reportedToGenie 필드 자체가 없으면 true로
      // (이전 작업은 재시작 전 이미 처리됐다고 가정 — 중복 보고 방지)
      if (
        TERMINAL_JOB_STATUSES.has(job.status) &&
        job.reportedToGenie === undefined
      ) {
        job.reportedToGenie = true;
        migrated++;
      }
      // 진행 중 상태: lease 유효성으로 판단
      if (
        job.status === "running" ||
        job.status === "planning" ||
        job.status === "awaiting_approval"
      ) {
        if (job.leaseUntilMs && job.leaseUntilMs > now) {
          // lease 아직 유효 — hot reload로 추정. 건드리지 않고 보존.
          // 자식 claude 프로세스가 살아있으면 계속 진행, 죽었으면 lease 만료 후 회수.
          // childPid는 stale (자식은 부모와 함께 죽었을 수 있음, 같은 PID 다른 프로세스 오인 사살 차단)
          job.childPid = undefined;
          preserved++;
          jobs.set(job.id, job);
          // in-memory leases Map 재구성 — 새 서버 부팅 후에도 checkExpiredLeases가
          // 만료를 감지해 자동 회수할 수 있게 (이게 없으면 영구 stale)
          try {
            const agentId = resolveAgent(job);
            if (agentId) {
              const agent = getAllWorkerAgents().find(a => a.id === agentId);
              leases.set(agentId, {
                agentId,
                jobId: job.id,
                acquiredAt: job.leaseUntilMs - LEASE_DURATION_MS,
                leaseUntilMs: job.leaseUntilMs,
                interactive: agent?.interactive ?? false,
              });
            } else {
              // 에이전트 해석 실패 시 leases에 미등록 — checkExpiredLeases 자동 회수가 불가능해지므로 반드시 흔적을 남긴다
              console.warn(`[Jobs] lease 재구성 스킵 ${job.id.slice(0, 8)} — 에이전트 해석 실패 (agent=${job.agent})`);
            }
          } catch (e) {
            console.warn(`[Jobs] lease 재구성 실패 ${job.id.slice(0, 8)}:`, e);
          }
          continue;
        }
        // lease 만료 또는 미설정 → orphan 처리
        job.status = "failed";
        job.error = (job.error ? job.error + " | " : "") + "서버 재시작으로 중단됨";
        if (!job.completedAt) job.completedAt = new Date().toISOString();
        job.reportedToGenie = false; // 마이크루에게 알릴 것
        job.leaseUntilMs = undefined;
        orphaned++;
      } else if (job.status === "queued") {
        // queued는 보존 + 큐에 다시 push해서 자동 픽업 (hot reload로 죽이지 않음)
        jobs.set(job.id, job);
        queue.push(job.id);
        queuedRestored++;
        continue;
      }
      jobs.set(job.id, job);
    }
    if (orphaned > 0 || migrated > 0 || preserved > 0 || queuedRestored > 0 || dropped > 0) {
      console.log(
        `[Jobs] 복원 ${validated.length}건 (preserved ${preserved}, queued복원 ${queuedRestored}, orphan→failed ${orphaned}, 마이그레이션 ${migrated}, dropped ${dropped})`,
      );
    }
    // 부팅 sweep: 디스크 잔존 stuck (선행 failed/outputs_missing이지만 후속 queued) 자동 cascade fail
    // callback 시점 cascade(P0/P1.1)는 라이브 발생만 처리 → 디스크에 남은 stuck은 본 sweep으로 정리
    const sweptCount = sweepStuckQueueOnBoot();
    if (orphaned > 0 || sweptCount > 0) saveJobs();
    if (queuedRestored > 0) {
      // 복원된 queued 작업 자동 시작 (fire-and-forget)
      processQueue();
    }
  } catch (err) {
    console.error("[Jobs] 로드 실패:", err);
    // 손상본을 다음 saveJobs가 빈 파일로 덮어쓰지 않도록 격리 (복구 가능성 보존)
    const q = quarantineCorruptFile(JOBS_FILE);
    if (q) console.error(`[Jobs] 손상 파일 격리: ${q}`);
  }
}

// 부팅 1회 stuck queue cleanup. transitive 포함 (worklist 패턴).
// 선행이 failed/outputs_missing 또는 누락 → 후속 queued 작업 cascade fail.
export function sweepStuckQueueOnBoot(): number {
  const FAILED_LIKE = new Set<JobStatus>(["failed", "outputs_missing"]);
  const cascadeQueue: string[] = [];

  for (const j of jobs.values()) {
    if (j.status === "queued" && j.afterJobId) {
      const dep = jobs.get(j.afterJobId);
      if (!dep || FAILED_LIKE.has(dep.status)) cascadeQueue.push(j.id);
    }
  }
  if (cascadeQueue.length === 0) return 0;

  const visited = new Set<string>();
  let cascaded = 0;
  while (cascadeQueue.length > 0) {
    const jobId = cascadeQueue.shift()!;
    if (visited.has(jobId)) continue;
    visited.add(jobId);
    const j = jobs.get(jobId);
    if (!j || j.status !== "queued") continue;

    const qIdx = queue.indexOf(j.id);
    if (qIdx !== -1) queue.splice(qIdx, 1);
    j.status = "failed";
    j.error = "선행 작업 실패로 자동 취소 (부팅 sweep)";
    j.completedAt = new Date().toISOString();
    cascaded++;
    auditLog("job.failed", { jobId: j.id, reason: "cascade_boot_sweep", parent: j.afterJobId });
    emitDone(j.id);
    emitGlobalEvent("job-update", { id: j.id, status: j.status, request: j.request });
    emitJobCompleteToast(j);

    // transitive: j를 dep로 가진 후속도 cascade 대상
    for (const k of jobs.values()) {
      if (k.status === "queued" && k.afterJobId === j.id && !visited.has(k.id)) {
        cascadeQueue.push(k.id);
      }
    }
  }
  if (cascaded > 0) {
    console.log(`[Jobs] 부팅 sweep: stuck queue ${cascaded}건 자동 cascade fail`);
  }
  return cascaded;
}

export function markJobReported(jobId: string): void {
  const job = jobs.get(jobId);
  if (!job) {
    console.warn(`[Jobs] markJobReported: id 없음 ${jobId}`);
    return;
  }
  job.reportedToGenie = true;
  job.reportAttempts = undefined; // 성공 시 카운터 리셋
  saveJobs();
  console.log(`[Jobs] 보고 마킹: ${jobId.slice(0, 8)}`);
}

export function bumpReportAttempt(jobId: string): number {
  const job = jobs.get(jobId);
  if (!job) return 0;
  job.reportAttempts = (job.reportAttempts ?? 0) + 1;
  saveJobs();
  return job.reportAttempts;
}

export function giveUpReporting(jobId: string, reason: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  // 무한 재시도 방지용 포기 마킹.
  // reportedToGenie=true로 두되 error에 사유 기록해 추적 가능하게.
  job.reportedToGenie = true;
  job.error = (job.error ? job.error + " | " : "") + `알림 포기: ${reason}`;
  saveJobs();
  console.warn(`[Jobs] 보고 포기: ${jobId.slice(0, 8)} (${reason})`);
}

// reportToGenie 진행 중인 job ID — scheduler 중복 방지 가드
const reportingInProgress = new Set<string>();

export function getUnreportedTerminalJobs(): Job[] {
  return Array.from(jobs.values()).filter(
    (j) =>
      TERMINAL_JOB_STATUSES.has(j.status) &&
      j.reportedToGenie !== true &&
      !reportingInProgress.has(j.id),
  );
}

// --- 에이전트 lease 관리 ---
// busy 상태를 단순 Set이 아닌 lease(만료 타임스탬프 포함)로 관리 →
// 워커 크래시/행 발생 시 자동 회수 가능
interface AgentLease {
  agentId: string;
  jobId: string;
  acquiredAt: number;
  leaseUntilMs: number;
  // PtyAdapter(claude-code) 워커는 childPid를 등록하지 않는 설계 → 즉시 만료 면제
  interactive: boolean;
  // childPid가 null로 관측되기 시작한 시각. 비-인터랙티브 워커는 bash 라운드/genie 검증 사이에
  // 정상적으로 childPid=null인 짧은 창이 있으므로, 이 창이 GRACE를 넘겨 지속될 때만 사망으로 판정.
  childNullSince?: number;
}

// childPid-null이 이 시간 이상 지속돼야 "워커 사망"으로 보고 즉시 만료. bash 라운드·genie 검증
// 사이의 정상 null 창(보통 수 초)에 멀쩡한 워커를 SIGKILL하던 회귀를 방지 (2026-06-24).
const CHILD_NULL_GRACE_MS = 90 * 1000;
const leases = new Map<string, AgentLease>(); // key: agentId

export function isIdle(): boolean {
  return runningCount === 0 && queue.length === 0;
}

export function getBusyAgentIds(): string[] {
  return Array.from(leases.keys());
}

function acquireLease(agentId: string, jobId: string, interactive = false): AgentLease {
  const now = Date.now();
  const job = jobs.get(jobId);
  // job.leaseSec override 시 해당 값(초→ms) 사용, 미지정/0 이하는 기본 LEASE_DURATION_MS
  const durationMs = job?.leaseSec && job.leaseSec > 0
    ? job.leaseSec * 1000
    : LEASE_DURATION_MS;
  const lease: AgentLease = {
    agentId,
    jobId,
    acquiredAt: now,
    leaseUntilMs: now + durationMs,
    interactive,
  };
  leases.set(agentId, lease);
  // lease를 job에 영속화 — hot reload 시 orphan 로직이 lease 유효성으로 판단
  if (job) {
    job.leaseUntilMs = lease.leaseUntilMs;
    // 자동 회수용 baseline: lease 시작 시점 outputs/{agent}/ 스냅샷 (multi-stage는 acquireLease마다 갱신)
    job.outputsBaseline = snapshotOutputsDir(agentId);
    // 2026-08-24: 자동 QA 를 «잡 범위» 코드 변경으로 판정하기 위한 기준선.
    // 여기서 찍는 이유: 워커가 실제로 손을 대기 직전이자, outputsBaseline 과 같은 생애주기다.
    // null 이면 판정 불가 — 종료 시 안전측(QA 수행)으로 간다.
    // ★ QA 2회차 P2-a 시정: outputsBaseline은 스테이지 전환마다 다시 찍는 게 맞다(자동 회수용,
    // 스테이지별 갱신이 정상 동작). 반대로 codeBaseline은 소비처가 "잡 종료 시점의 잡 전체 판정"
    // 하나뿐이라, 같은 자리에서 매 acquireLease마다 덮어쓰면 이전 스테이지의 변경이 기준선에
    // 흡수돼 사라진다 — 최초 1회(잡 최초 lease)만 세운다. assignCodeBaselineOnce로 뽑아 단위
    // 테스트 가능하게 한다(qa-trigger-policy-test.ts).
    job.codeBaseline = assignCodeBaselineOnce(job.codeBaseline, snapshotCodeChanges(job.cwd));
    saveJobs();
  }
  auditLog("lease.acquired", { agentId, jobId, leaseUntilMs: lease.leaseUntilMs });
  // busy 전이를 클라이언트 직원 배지에 즉시 반영 (App.tsx 'staff-change' 핸들러 → updateBusyStaff)
  emitGlobalEvent("staff-change", {});
  return lease;
}

// 자동 회수: outputs/{agent}/ 디렉토리 파일명 → mtime(epoch ms) 스냅샷.
// 디렉토리 부재 시 빈 객체 반환.
export function snapshotOutputsDir(agentId: string): Record<string, number> {
  const dir = join(HISTORY_DIR, "outputs", agentId);
  const out: Record<string, number> = {};
  try {
    if (!existsSync(dir)) return out;
    for (const name of readdirSync(dir)) {
      try {
        const st = statSync(join(dir, name));
        if (st.isFile()) out[name] = st.mtimeMs;
      } catch { /* 일시적 파일 사라짐 무시 */ }
    }
  } catch (e) {
    console.warn(`[Recovery] snapshotOutputsDir 실패 ${agentId}:`, e);
  }
  return out;
}

// 자식 PID 등록 콜백 생성 — adapter.execute 호출 시 spawn 직후 onSpawn으로 전달.
// jobId가 없으면 undefined (마이크루 직접 호출 등 jobId 부재 케이스에서 no-op).
function makeChildPidRegistrar(jobId: string | undefined): ((pid: number) => void) | undefined {
  if (!jobId) return undefined;
  return (pid: number) => {
    const j = jobs.get(jobId);
    if (!j) return;
    // terminal 상태에서 spawn callback 진입 → orphan 즉시 SIGKILL (사용자 cancel 후 추가 child execution 차단)
    if (TERMINAL_JOB_STATUSES.has(j.status)) {
      try { process.kill(pid, "SIGKILL"); } catch {}
      auditLog("job.killed", { jobId, pid, killed: true, status: j.status, reason: "orphan_after_terminal" });
      return;
    }
    j.childPid = pid;
    saveJobs();
  };
}

// SIGKILL 자식 프로세스 (lease 만료 + 자동 회수 불가 시 진입).
// PID stale 가드: ESRCH(이미 죽음) catch → 통계용 audit. EPERM은 이상 신호.
export function killChildIfAlive(pid: number | undefined): { killed: boolean; code?: string } {
  if (!pid) return { killed: false, code: "no_pid" };
  try {
    process.kill(pid, "SIGKILL");
    return { killed: true };
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException)?.code ?? "unknown";
    return { killed: false, code };
  }
}

// 자동 회수 판정: lease 만료 시점에 outputs/{agent}/ baseline 대비 신규/갱신된 파일 검사.
// 이중 가드: (1) baseline에 없는 신규 파일 또는 mtime > baseline 파일 ≥ 1건
//           (2) 해당 파일 mtime > job.startedAt (epoch ms 비교)
// baseline 부재 시(부팅 전 작업) fallback: mtime > job.startedAt 파일 ≥ 1건.
// 반환: { recovered, paths } — paths는 회수 근거 파일 목록 (audit/log용).
export function checkOutputsRecovered(job: Job, agentId: string): { recovered: boolean; paths: string[] } {
  const startedMs = job.startedAt ? new Date(job.startedAt).getTime() : 0;
  if (!startedMs) return { recovered: false, paths: [] };
  const current = snapshotOutputsDir(agentId);
  const baseline = job.outputsBaseline ?? {};
  const paths: string[] = [];
  for (const [name, mtime] of Object.entries(current)) {
    if (mtime <= startedMs) continue; // mtime 가드: 작업 시작 후 변경된 파일만
    const baseMtime = baseline[name];
    if (baseMtime === undefined || mtime > baseMtime) {
      paths.push(name); // 신규 파일 또는 mtime 갱신
    }
  }
  return { recovered: paths.length > 0, paths };
}

function releaseLease(agentId: string, reason: "completed" | "failed" | "expired"): void {
  const lease = leases.get(agentId);
  if (!lease) return;
  leases.delete(agentId);
  const job = jobs.get(lease.jobId);
  if (job) {
    job.leaseUntilMs = undefined;
    saveJobs();
  }
  auditLog("lease.released", { agentId, jobId: lease.jobId, reason });
  // busy 해제를 클라이언트 직원 배지에 즉시 반영
  emitGlobalEvent("staff-change", {});
}

// scheduler가 매분 호출 — 만료된 lease 회수 후 작업 실패 처리
export function checkExpiredLeases(): number {
  const now = Date.now();
  let expired = 0;
  for (const [agentId, lease] of leases.entries()) {
    // childPid 없으면 프로세스 죽은 것 → 즉시 만료. 단 인터랙티브 워커(PtyAdapter)는 면제.
    // ★회귀수정(2026-06-24): childPid=null은 bash 라운드·genie 검증 사이에도 정상 발생하므로
    //   즉시 죽이지 않고 CHILD_NULL_GRACE_MS(90s) 지속될 때만 사망 판정. childPid가 다시 생기면 리셋.
    const job_ = jobs.get(lease.jobId);
    if (job_ && job_.status === "running" && !lease.interactive && lease.leaseUntilMs > now) {
      if (!job_.childPid) {
        if (lease.childNullSince === undefined) {
          lease.childNullSince = now; // null 관측 시작 — 유예 시작
        } else if (now - lease.childNullSince >= CHILD_NULL_GRACE_MS) {
          console.log(`[Lease] ${agentId} childPid ${Math.round((now - lease.childNullSince) / 1000)}s 지속 null → 사망 판정, 즉시 만료 (job ${lease.jobId.slice(0, 8)})`);
          lease.leaseUntilMs = now;
        }
      } else if (lease.childNullSince !== undefined) {
        lease.childNullSince = undefined; // 자식 부활 → 유예 리셋
      }
    }
    if (lease.leaseUntilMs > now) continue;
    const job = jobs.get(lease.jobId);
    console.log(`[Lease] ${agentId} 만료 회수 (job ${lease.jobId})`);
    auditLog("lease.expired", {
      agentId,
      jobId: lease.jobId,
      acquiredAt: new Date(lease.acquiredAt).toISOString(),
    });
    leases.delete(agentId);
    // 2026-10-04: 게이트를 "running"에서 «비종결 전체»로 확장.
    // 구 게이트는 planning·awaiting_approval 상태의 잡을 회수 대상에서 제외했고,
    // 위에서 leases.delete가 이미 실행되므로 그 잡은 두 번 다시 이 루프에 들어오지 못했다.
    // → 프로세스는 죽었는데 상태는 활성(planning)으로 영구 잔류하는 좀비가 생기고,
    //   scheduler의 ACTIVE_JOB_STATUSES가 planning을 활성으로 세기 때문에
    //   QA 자동 사이클이 "핫픽스 잡이 아직 running" FAIL을 무한 반복했다(실측 6라운드+).
    if (job && !TERMINAL_JOB_STATUSES.has(job.status)) {
      // 자동 회수: outputs baseline diff로 산출물 작성 여부 확인 (lease 만료 직전 새 보고서 = 워커가 작업 마쳤지만 종료 신호 못 보낸 케이스)
      const recovery = checkOutputsRecovered(job, agentId);
      if (recovery.recovered) {
        job.status = "completed";
        job.completedAt = new Date().toISOString();
        job.leaseUntilMs = undefined;
        job.error = undefined;
        // fix B: 회수 케이스에서 PID는 클리어만 (자식 자연 종료 신뢰, SIGKILL skip)
        job.childPid = undefined;
        saveJobs();
        transitionTodosForJob(job.id, "reporting", `자동 회수 — 산출물: ${recovery.paths.slice(0, 3).join(", ")}`.slice(0, 200));
        auditLog("job.recovered", { jobId: job.id, agent: agentId, paths: recovery.paths.slice(0, 5), reason: "outputs_mtime_baseline_diff" });
        console.log(`[Recovery] ${job.id.slice(0, 8)} 자동 회수 — 보고서: ${recovery.paths.join(", ")}`);
        emitDone(job.id);
        emitGlobalEvent("job-update", { id: job.id, status: job.status, request: job.request });
        processCallback({
          jobId: job.id,
          status: "completed",
          output: `⚠️ 자동 회수 — 산출물 mtime 검사 (lease 만료 직전 새 보고서 감지): ${recovery.paths.slice(0, 3).join(", ")}`,
          completedAt: job.completedAt,
          agent: agentId,
          external: false,
        });
      } else {
        // fix B: 자동 회수 불가 → 자식 hang 의심, SIGKILL로 자원 회수
        if (job.childPid) {
          const killResult = killChildIfAlive(job.childPid);
          auditLog("job.killed", { jobId: job.id, agent: agentId, pid: job.childPid, killed: killResult.killed, code: killResult.code });
          console.log(`[Kill] ${job.id.slice(0, 8)} SIGKILL pid=${job.childPid} → ${killResult.killed ? "killed" : `failed(${killResult.code})`}`);
          job.childPid = undefined;
        }
        // 만료 메시지: 실제 적용된 lease 길이 기준 (job.leaseSec override 반영)
        const elapsedMin = Math.round((lease.leaseUntilMs - lease.acquiredAt) / 60000);
        job.status = "failed";
        job.error = `lease 만료 (${elapsedMin}분 초과)`;
        job.completedAt = new Date().toISOString();
        job.leaseUntilMs = undefined;
        saveJobs();
        transitionTodosForJob(job.id, "failed", `lease 만료 (${elapsedMin}분 초과)`);
        auditLog("job.failed", { jobId: job.id, reason: "lease_expired" });
        emitDone(job.id);
        emitGlobalEvent("job-update", { id: job.id, status: job.status, request: job.request });
        // v2 §3-5: lease 만료 시 자동 timeout callback (사장님 toast 자동 발생 — emitJobCompleteToast)
        processCallback({
          jobId: job.id,
          status: "timeout",
          error: job.error,
          completedAt: job.completedAt,
          agent: agentId,
          external: false,
        });
      }
      if (runningCount > 0) runningCount--;
    }
    expired++;
  }
  if (expired > 0) processQueue();
  return expired;
}

function pruneJobs(): void {
  if (jobs.size <= MAX_JOB_HISTORY) return;
  const sorted = Array.from(jobs.values())
    .filter((j) => TERMINAL_JOB_STATUSES.has(j.status))
    .sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));
  while (jobs.size > MAX_JOB_HISTORY && sorted.length > 0) {
    const old = sorted.shift()!;
    jobs.delete(old.id);
  }
}

type SSEWriter = { write: (data: string) => void; close: () => void };
const sseClients = new Map<string, Set<SSEWriter>>();

// --- 통합 SSE 이벤트 시스템 (이벤트 ID + 하트비트 + replay) ---

const globalSSEClients = new Set<SSEWriter>();
let sseEventId = 0;
const SSE_BUFFER_SIZE = 200; // 최근 N개 이벤트 보관 (replay용)
const sseEventBuffer: Array<{ id: number; payload: string }> = [];
const HEARTBEAT_INTERVAL = 15_000; // 15초 하트비트

// 하트비트 — 연결 유지 + 끊김 감지
setInterval(() => {
  for (const client of globalSSEClients) {
    try { client.write(`: heartbeat\n\n`); }
    catch { globalSSEClients.delete(client); }
  }
}, HEARTBEAT_INTERVAL);

export function addGlobalSSEClient(writer: SSEWriter): void {
  globalSSEClients.add(writer);
}

export function removeGlobalSSEClient(writer: SSEWriter): void {
  globalSSEClients.delete(writer);
}

// Last-Event-ID 이후 놓친 이벤트 replay
export function replaySSEEvents(writer: SSEWriter, lastEventId: number): void {
  for (const entry of sseEventBuffer) {
    if (entry.id > lastEventId) {
      try { writer.write(entry.payload); } catch { break; }
    }
  }
}

// 텔레그램발 위임(/일 명령, request에 마커 포함)의 종결을 텔레그램으로 회신.
// 모든 잡 상태 전이가 이 함수(job-update 이벤트)를 지나므로 단일 관문에서 감지한다.
const TELEGRAM_JOB_MARKER = "[텔레그램 지시]";
const telegramNotifiedJobs = new Set<string>();
function maybeNotifyTelegramJobDone(event: string, data: unknown): void {
  if (event !== "job-update") return;
  const d = data as { id?: string; status?: string };
  if (!d?.id || !d.status || !TERMINAL_JOB_STATUSES.has(d.status as JobStatus)) return;
  if (telegramNotifiedJobs.has(d.id)) return;
  const job = jobs.get(d.id);
  if (!job || !job.request.includes(TELEGRAM_JOB_MARKER)) return;
  telegramNotifiedJobs.add(d.id);
  const ok = job.status === "completed";
  const title = job.request.replace(TELEGRAM_JOB_MARKER, "").replace(/\n/g, " ").trim().slice(0, 70);
  const tail = ok
    ? (job.outputFiles?.length ? `\n산출물: ${job.outputFiles.slice(0, 3).join(", ").slice(0, 150)}` : "")
    : `\n사유: ${(job.error ?? "알 수 없음").slice(0, 150)}`;
  import("./telegram.js")
    .then((t) => t.sendTelegramNotice(`${ok ? "✅ 작업 완료" : "❌ 작업 실패"} (${getWorkerAgent(job.agent ?? "")?.name ?? job.agent ?? "미지정"}): ${title}${tail}`))
    .catch(() => { /* 텔레그램 미설정 시 무시 */ });
}

export function emitGlobalEvent(event: string, data: unknown): void {
  try { maybeNotifyTelegramJobDone(event, data); } catch { /* 알림 실패가 이벤트 전파를 막으면 안 됨 */ }
  sseEventId++;
  const payload = `id: ${sseEventId}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  // 버퍼에 저장 (replay용)
  sseEventBuffer.push({ id: sseEventId, payload });
  if (sseEventBuffer.length > SSE_BUFFER_SIZE) sseEventBuffer.shift();
  // 전송
  for (const client of globalSSEClients) {
    try {
      client.write(payload);
    } catch {
      globalSSEClients.delete(client);
    }
  }
}

// --- 알림 ---

interface GenieNotification {
  content: string;
  timestamp: string;
}
const genieMessages: GenieNotification[] = [];

export function getGenieMessages(): GenieNotification[] {
  return genieMessages.splice(0);
}

export function createJob(
  request: string,
  projectName?: string,
  attachments?: string[],
  agent?: string,
  cwd?: string,
  priority?: "high" | "normal" | "low",
  afterJobId?: string,
  selfRestart?: boolean,
  stages?: string[],
  stageAgents?: string[],
  skipPlanGate?: boolean,
  leaseSec?: number,
  maxTurns?: number,
  todoId?: string,
  effort?: string,
  skipOutput?: boolean,
): Job {
  agent = agent ? resolveNewWorkerId(agent) : undefined;
  stageAgents = stageAgents?.map(resolveNewWorkerId);
  // 미등록 agent id 거부 — 통과시키면 실행 시점에 조용히 자동 라우팅으로 폴백해
  // 엉뚱한 직원에게 배정된다(2026-08-08 "backend" 사고). 생성 시점에 막는 게 맞다.
  if (agent && !getWorkerAgent(agent)) {
    throw new Error(
      `unknown-agent: "${agent}" 는 등록되지 않은 직원 id입니다. `
      + `history/agents.json 또는 config/agents/<id>/meta.json을 확인하세요.`,
    );
  }

  // 재시도 가드 체크 (24시간 내 3회 실패 시 차단)
  checkRetryGuard(request);
  
  const job: Job = {
    id: randomUUID(),
    request,
    projectName,
    cwd,
    agent,
    priority: priority ?? "normal",
    afterJobId,
    status: "queued",
    createdAt: new Date().toISOString(),
    logs: [],
    attachments,
    reportedToGenie: false,
    genieTurnId: getGenieTurnId() || undefined, // 마이크루 턴 중 생성 시에만 값 있음
    selfRestart,
    skipPlanGate,
    skipOutput,
    ...(leaseSec !== undefined && leaseSec > 0 ? { leaseSec } : {}),
    ...(maxTurns !== undefined && maxTurns > 0 ? { maxTurns } : {}),
    // 모르는 값은 싣지 않는다 — 저장해 두면 나중에 "지정했는데 왜 안 먹지"로 오진된다.
    ...(normalizeEffort(effort) ? { effort: normalizeEffort(effort) as string } : {}),
    ...(stages && stages.length > 0 ? { stages, stageAgents, currentStage: 0, stageResults: [] } : {}),
  };

  jobs.set(job.id, job);
  // todo 사전 link + delegated 전이는 큐 push 전에 완료해야 함.
  // processQueue가 동기 즉시 픽업 → processJob → transitionTodosForJob("working")이 매칭 todo 찾을 수 있어야 함.
  // (race source fix 2026-05-04: 사전엔 routes.ts에서 createJob 후 link 호출 → working 전이가 no-op이 되어 todo 평생 delegated 잔류)
  if (todoId) {
    linkJobToTodo(todoId, job.id);
    setTodoState(todoId, "delegated", request.slice(0, 200));
  }
  // high 우선순위는 큐 앞에 삽입
  if (job.priority === "high") {
    queue.unshift(job.id);
  } else {
    queue.push(job.id);
  }
  saveJobs();
  auditLog("job.created", {
    jobId: job.id,
    request: job.request.slice(0, 200),
    projectName: job.projectName,
    agent: job.agent,
  });
  emitGlobalEvent("job-update", { id: job.id, status: job.status, request: job.request });
  processQueue();
  return job;
}

// routes.ts v2 호환 — Downloads 버전과의 인터페이스 갭 메움
export function getActiveJobIdForAgent(agentId: string): string | undefined {
  for (const j of jobs.values()) {
    if (j.status === "running" && j.agent === agentId) return j.id;
  }
  return undefined;
}
export function setJobSummary(jobId: string, summary: string): void {
  const j = jobs.get(jobId);
  if (j) { j.summary = summary; saveJobs(); }
}
export function setJobTaskMeta(jobId: string, taskId?: string, taskTitle?: string): void {
  const j = jobs.get(jobId);
  if (j) { j.taskId = taskId; j.taskTitle = taskTitle; saveJobs(); }
}
export function pauseJobForDeps(jobId: string, depIds: string[]): void {
  const j = jobs.get(jobId);
  if (!j) return;
  j.status = "paused";
  j.afterJobIds = depIds;
  const qIdx = queue.indexOf(jobId);
  if (qIdx >= 0) queue.splice(qIdx, 1);
  saveJobs();
}
export function activatePausedJobs(): number {
  let count = 0;
  for (const j of jobs.values()) {
    if (j.status !== "paused") continue;
    const deps = j.afterJobIds ?? (j.afterJobId ? [j.afterJobId] : []);
    const allDone = deps.every((id) => {
      const dj = jobs.get(id);
      if (!dj) return true;
      return dj.status === "completed" || dj.status === "done";
    });
    if (allDone) {
      j.status = "queued";
      if (!queue.includes(j.id)) queue.push(j.id);
      count++;
    }
  }
  if (count > 0) {
    saveJobs();
    processQueue();
  }
  return count;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function getAllJobs(): Job[] {
  return Array.from(jobs.values()).reverse();
}

export function cancelJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job) return false;
  if (TERMINAL_JOB_STATUSES.has(job.status)) return false;
  if (job.status === "queued") {
    const idx = queue.indexOf(id);
    if (idx !== -1) queue.splice(idx, 1);
    job.status = "failed";
    job.error = "사용자가 취소했습니다";
    job.completedAt = new Date().toISOString();
    saveJobs();
    processCallback({
      jobId: job.id,
      status: "failed",
      error: "user_cancelled",
      completedAt: job.completedAt,
      agent: resolveAgent(job),
      external: false,
    });
    emitDone(job.id);
    processQueue();
    return true;
  }
  if (job.status === "running") {
    const agentId = resolveAgent(job);
    if (job.childPid) {
      const killResult = killChildIfAlive(job.childPid);
      auditLog("job.killed", { jobId: job.id, agent: agentId, pid: job.childPid, killed: killResult.killed, code: killResult.code, reason: "user_cancelled" });
      job.childPid = undefined;
    }
    releaseLease(agentId, "failed");
    if (runningCount > 0) runningCount--;
    job.status = "failed";
    job.error = "사용자가 취소했습니다";
    job.completedAt = new Date().toISOString();
    saveJobs();
    processCallback({
      jobId: job.id,
      status: "failed",
      error: "user_cancelled",
      completedAt: job.completedAt,
      agent: agentId,
      external: false,
    });
    emitDone(job.id);
    processQueue();
    return true;
  }
  job.status = "failed";
  job.error = "사용자가 취소했습니다";
  job.completedAt = new Date().toISOString();
  saveJobs();
  emitDone(job.id);
  return true;
}

export function addSSEClient(jobId: string, writer: SSEWriter): void {
  if (!sseClients.has(jobId)) {
    sseClients.set(jobId, new Set());
  }
  sseClients.get(jobId)!.add(writer);
}

export function removeSSEClient(jobId: string, writer: SSEWriter): void {
  sseClients.get(jobId)?.delete(writer);
}

function emitLog(jobId: string, line: string): void {
  // 글로벌 SSE로 작업 진행 상황 전달
  emitGlobalEvent("job-log", { id: jobId, line, timestamp: new Date().toISOString() });

  const clients = sseClients.get(jobId);
  if (!clients) return;
  const data = JSON.stringify({ line, timestamp: new Date().toISOString() });
  for (const client of clients) {
    try {
      client.write(`data: ${data}\n\n`);
    } catch {
      clients.delete(client);
    }
  }
}

function emitDone(jobId: string): void {
  const clients = sseClients.get(jobId);
  if (!clients) return;
  for (const client of clients) {
    try {
      client.write(`event: done\ndata: {}\n\n`);
      client.close();
    } catch {
      // ignore
    }
  }
  sseClients.delete(jobId);
}

const WIKI_RE = () => /<!--WIKI:(.*?)-->/gs;
const BASH_RE = () => /<!--BASH:(.*?)-->/gs;
const PROGRESS_RE = () => /<!--PROGRESS:(.*?)-->/gs;
const STAGE_RE = () => /<!--STAGE:(\d+)-->/gs;

// 화이트리스트 — 바로 실행
const WHITELIST = [
  /^npm\s+(install|ci|run|test|build|start)/,
  /^npx\s+(?:-y\s+|--yes\s+)?(?:tsc|tsx|playwright|@playwright\/test|next|vite|vitest|jest|prettier|eslint|tailwindcss|serve|http-server)\b/,  // 알려진 dev 툴만 — 임의 패키지 실행은 genie (Vera 2026-06-23)
  /^git\s+(add|commit|status|log|diff|branch|checkout|merge|pull)/,
  /^ls\b/,
  /^cat\b/,
  /^mkdir\b/,
  /^cp\b/,
  /^mv\b/,
  /^tsc\b/,
  /^node\s+(?!-)/,  // node <file>만 — node -e/-r 등 임의코드 플래그는 genie (python3 -c 금지와 동일 원칙, Vera 2026-06-23)
  /^tsx\s+(?!-)/,
  /^curl\b(?=[^|;&]*\b(?:localhost|127\.0\.0\.1|\[::1\])\b)/,  // E2E health check만 — localhost 한정 (Vera 감사: SSRF·외부유출 차단)
  // 저위험 공통 추가 (전수조사: 압축·조회·정리 — rm -rf는 BLACKLIST, 쓰기경로는 writePaths 가드)
  /^tar\b/,
  /^gzip\b/,
  /^gunzip\b/,
  /^unzip\b/,
  /^lsof\b/,
  /^rm\b/,
  // 로컬 dev-ops (빌드·배포·재시작 사이클 자동화 — genie 무응답 시 자동거부 루프 제거, 2026-06-23)
  // 쓰기는 pathViolationInBash 가드, 위험명령은 BLACKLIST가 별도 차단 → 아래는 본인 머신 프로세스·포트 제어만
  /^cd\b/,
  /^pwd\b/,
  /^echo\b/,
  /^printf\b/,
  /^sleep\b/,
  /^which\b/,
  /^test\b/,
  /^\[\s/,
  /^true\b/,
  /^grep\b/,
  /^head\b/,
  /^tail\b/,
  /^wc\b/,
  /^sort\b/,
  /^uniq\b/,
  /^find\b/,
  /^ps\b/,
  /^pgrep\b/,
  /^kill\b/,
  /^pkill\b/,
  /^netstat\b/,
  /^id\b/,  // $(id -u) 등 안전 치환용
  // docker: 조회·로그·기존 컨테이너 라이프사이클만 (탐색→기동→확인 워크플로우). run/create/exec/build/cp/compose up은
  // genie(임의 이미지·코드 실행), 호스트탈출 플래그(--privileged/--pid=host/호스트 -v 마운트/cap-add)는 BLACKLIST (2026-06-23)
  /^docker\s+(?:ps|images|image\s+ls|logs|inspect|port|stats|version|info|top|events|start|stop|restart|kill|wait|pause|unpause)\b/,
  /^docker\s+compose\s+(?:ps|logs|top|version|start|stop|restart)\b/,
  // 자기 gui 도메인의 com.mycrew.* 서비스 재기동만 — system/·com.apple.·gui/0/·list 전역열거 차단 (감사 2026-06-23).
  // 분류 시 $(id -u)는 X로 치환되므로 uid 자리는 \d+ 또는 X 허용.
  /^launchctl\s+(?:kickstart(?:\s+-k)?|stop|start)\s+gui\/(?:\d+|X)\/com\.mycrew\.[\w.-]+\s*$/,
  // nohup/setsid 래퍼는 classifyBash가 벗겨 내부 명령을 재분류 → 화이트리스트 불필요
  // env/export/pm2/vercel은 WHITELIST 제외(genie 경로) — env주입·외부배포는 감사상 자동허용 부적합(2026-06-23)
  // python3는 WHITELIST 불가 — -c/setup.py 등 임의코드실행이 경로가드 우회(감사 Critical). genie 승인 경로 유지.
];

// 블랙리스트 — 절대 차단
const BLACKLIST = [
  /rm\s+-rf/,
  /rm\s+-r\s+\//,
  /sudo/,
  /chmod/,
  /chown/,
  /curl.*\|.*sh/,
  /wget.*\|.*sh/,
  /\/etc\//,
  /\/usr\//,
  /\/var\//,
  /\/System\//,
  // 민감 dotfile/dir만 차단 (이전 `~/.`·`/Users/*/.` 광범위 패턴은 .next/.git/.cache 등 빌드산출물까지
  // 막는 오탐이었음 — 2026-06-24 빌드검증 차단 사례). 주의: SENSITIVE_PATHS는 *쓰기*에만 적용되고
  // bash *읽기*(cat/grep)엔 미적용이므로(BASH_WRITE_RE 게이트), 읽기 시크릿 차단은 이 BLACKLIST가 유일 방어선.
  // → Vera 감사 2026-06-24: 열거 목록에 terraform/vault-token/databricks/gitconfig/shell history 추가(OLD 커버리지 회복).
  /(?:^|[\s'"/=])(?:~|\$HOME)?\/?\.(?:ssh|aws|gnupg|kube|docker|netrc|npmrc|pgpass|git-credentials|gitconfig|vault-token|terraform(?:\.d)?|databricks|bash_history|zsh_history|boto|s3cfg|pypirc|claude\/[^\s]*auth|config\/(?:gcloud|gh|claude))\b/,
  /\.(?:tfstate|tfstate\.backup)\b/,  // terraform 상태파일(평문 시크릿) — 경로 무관 차단
  // 키/인증서: .pem/.p12/.keychain-db + ssh 개인키. `.key`는 확장자 단독일 때만(`foo.key.ts` 등 소스 오탐 제외).
  /\.(?:pem|p12|keychain-db)\b/,
  /\bid_(?:rsa|dsa|ecdsa|ed25519)\b/,
  /(?<![\w.])[\w-]+\.key(?![\w.])/,
  /\btar\b[^|;&]*(--to-command|--use-compress-program|\s-I\b)/,  // tar 임의 프로그램 실행 차단 (Vera 감사)
  /\bpip3?\s+install/,  // pip 공급망 차단 — python3는 WHITELIST, pip install만 차단 (Vera 감사)
  /python3?\s+-m\s+pip\s+install/,
  /Library\/LaunchAgents\//,  // LaunchAgent 영속 주입 차단 (Vera P0: 비-닷 경로라 writePaths /** 우회)
  /Library\/LaunchDaemons\//,
  /\.plist\b/,
  // --- Vera 감사 2026-06-23: 화이트리스트 verb 인자 우회 차단 ---
  /\bfind\b[^|;&]*\s-(exec(?:dir)?|delete|ok(?:dir)?|fprint(?:f)?|fls)\b/,  // find 임의 실행/삭제
  /\b(?:NODE_OPTIONS|LD_PRELOAD|LD_LIBRARY_PATH|DYLD_INSERT_LIBRARIES|DYLD_LIBRARY_PATH|PYTHONSTARTUP|BASH_ENV|PERL5OPT|RUBYOPT)\s*=/,  // 코드주입 환경변수
  /\bkill\b[^|;&]*\s-\w+\s+-\d/,  // kill <sig> -1 등 음수 PID(프로세스그룹/전체) 광역 종료
  /\bpkill\b[^|;&]*\s-f\s+['"]?[./]+['"]?(\s|$)/,  // pkill -f . / -f / (전체 매칭)
  /\b(?:node|tsx|deno|bun)\b[^|;&]*\s-(?:e\b|-eval\b|p\b|-print\b|r\b|-require\b|-import\b|-loader\b|-experimental-loader\b)/,  // JS 임의코드 플래그 = python3 -c 동급 차단 (Vera 2026-06-23)
  // docker 호스트 탈출 차단 — sandbox 무력화 방지 (2026-06-23). /var/run/docker.sock은 기존 /\/var\// 가 별도 차단.
  /\bdocker\b[^|;&\n]*\s--privileged\b/,
  /\bdocker\b[^|;&\n]*\s--(?:pid|network|ipc|uts|userns)[ =]host\b/,
  /\bdocker\b[^|;&\n]*\s--cap-add\b/,
  /\bdocker\b[^|;&\n]*\s(?:-v|--volume)[ =]\s*\/[^:|;&\n]*:/,  // 호스트 절대경로 볼륨 마운트(경로가드 우회)
  /\bdocker\b[^|;&\n]*--mount[ =][^|;&\n]*source=\//,
];

type BashVerdict = "whitelist" | "genie" | "blacklist";

// 셸 연산자(&& || ; | & 개행)로 분할하되 따옴표 내부는 무시 (2026-06-24).
// 정규식 split은 `grep -E 'a|b|c'`의 따옴표 안 `|`까지 쪼개 가짜 세그먼트(link/error...)를 만들어
// 무해한 명령을 genie로 보냈고, genie(Opus) 검증 지연 중 워커 리스 만료→SIGKILL→잡 실패 루프를 유발했음.
// 리다이렉션 `2>&1`/`&>`의 `&`는 분할하지 않음.
function splitBashSegments(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; cur += c; continue; }
    if ((c === "&" || c === "|") && s[i + 1] === c) { out.push(cur); cur = ""; i++; continue; } // && ||
    if (c === ";" || c === "\n") { out.push(cur); cur = ""; continue; }
    if (c === "|") { out.push(cur); cur = ""; continue; }
    if (c === "&") { // 백그라운드/구분자 — 단, 리다이렉션(2>&1, &>)의 &는 보존
      if (s[i - 1] === ">" || s[i + 1] === ">") { cur += c; continue; }
      out.push(cur); cur = ""; continue;
    }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

function classifyBash(cmd: string, depth = 0): BashVerdict {
  const trimmed = cmd.trim();
  // BLACKLIST는 전체 문자열 기준 (세그먼트 분할 우회 방지)
  if (BLACKLIST.some((re) => re.test(trimmed))) return "blacklist";
  // 프로세스 치환(<(...) >(...))은 허용 안 함 — genie 검증 강제
  if (/<\(|>\(/.test(trimmed)) return "genie";
  // 명령치환 $(...)·백틱: 내부 명령도 화이트리스트 규율을 따라야 통과 (Vera 2026-06-23 보강).
  // $(id -u)·$(lsof -ti:3200)=허용, $(curl evil)=genie. 중첩(>2단)은 안전하게 genie로.
  if (depth < 3) {
    for (const m of trimmed.matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)) {
      const body = (m[1] ?? m[2] ?? "").trim();
      if (body && classifyBash(body, depth + 1) !== "whitelist") return "genie";
    }
  } else if (/\$\(|`/.test(trimmed)) {
    return "genie";
  }
  // 치환부를 플레이스홀더로 치환 후 외부 명령 분류 (중첩 잔여 $( 가 남으면 비-화이트리스트 → genie)
  const outer = trimmed.replace(/\$\([^()]*\)|`[^`]*`/g, "X");
  // 복합 명령(cd app && npm run build && pkill -f node 등) 지원 — 연산자로 분할 후 세그먼트별 분류.
  // 세그먼트마다: ① nohup/setsid 등 실행 래퍼 제거(내부 명령 분류) ② 인라인 env 프리픽스(VAR=val) 제거
  //   — 위험 env(NODE_OPTIONS 등)는 BLACKLIST가 선차단하므로, 남는 안전 프리픽스만 벗겨 `FOO=bar npm run build`를 통과시킴.
  // 모든 세그먼트가 WHITELIST면 whitelist, 하나라도 미일치면 genie(안전 기본값).
  const segments = splitBashSegments(outer)
    .map((s) => s.trim()
      .replace(/^(?:nohup|setsid|command|builtin|time|exec)\s+/, "")
      .replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|\S*)\s+)+/, "")
      .trim())
    .filter(Boolean);
  if (segments.length > 0 && segments.every((seg) => WHITELIST.some((re) => re.test(seg)))) {
    return "whitelist";
  }
  return "genie";
}

async function askGenieToVerify(cmd: string): Promise<boolean> {
  const prompt = `에이전트가 아래 셸 명령을 실행하려고 합니다. 안전한지 판단해주세요.

명령: ${cmd}

규칙:
- 프로젝트 작업에 필요한 명령이면 허용
- 시스템을 손상시키거나 프로젝트 밖에 영향을 주면 거부
- 판단 결과만 답하세요: "허용" 또는 "거부: 이유"`;

  const result = await runGenieAgent("verify", prompt, { freshSession: true });

  if (!result.success) return false;
  const answer = result.output.trim();
  console.log(`[MyCrew] 명령 검증: "${cmd}" → ${answer}`);
  return answer.startsWith("허용");
}

// bash 실행 파일 해석 — 이 머신(Windows)에는 bash가 PATH에 없어서 execFile("bash", ...)가
// 항상 `spawn bash ENOENT`로 죽었다. 그 결과 잡 post-validation(`[ -f tsconfig.json ] && npx tsc
// --noEmit`)이 실제 검증이 아니라 항상 실패로 끝났다 — chat.ts 재시작 게이트가 앓던 것과 같은 병이다.
// 명령이 POSIX 문법이라 cmd.exe로는 대체할 수 없으므로, Git for Windows가 함께 깔아주는 bash를 찾아 쓴다.
// System32\bash.exe(WSL)는 제외한다 — 파일시스템 뷰가 달라 C:\ 경로 cwd가 깨진다.
let bashPathCache: string | null = null;
function resolveBashPath(): string {
  if (bashPathCache) return bashPathCache;
  const candidates = [
    process.env.MYCREW_BASH_PATH,
    ...(process.platform === "win32"
      ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
         "C:\\Program Files (x86)\\Git\\bin\\bash.exe"]
      : ["/bin/bash", "/usr/bin/bash"]),
  ].filter((p): p is string => Boolean(p));
  for (const p of candidates) {
    try { if (existsSync(p)) { bashPathCache = p; return p; } } catch { /* 접근 불가 — 다음 후보 */ }
  }
  bashPathCache = "bash"; // 못 찾으면 ENOENT를 그대로 드러낸다(침묵 통과 금지)
  return bashPathCache;
}

async function execBash(cmd: string, cwd?: string, timeoutMs = 60000): Promise<string> {
  const { execFile } = await import("node:child_process");
  return new Promise((resolve) => {
    execFile(resolveBashPath(), ["-c", cmd], {
      maxBuffer: 5 * 1024 * 1024,
      timeout: timeoutMs,
      ...(cwd && { cwd }),
      // PATH 구분자는 플랫폼을 따른다 — Windows는 ';'. 여기만 ':'로 하드코딩돼 있어서
      // CLAUDE_BIN_DIR이 직전 PATH 항목 꼬리에 붙어버렸고(예: "...\System32:C:\...\bin"),
      // 그 결과 post-validation 명령이 claude 바이너리를 영영 못 찾았다.
      // agent.ts:572·terminal-ws.ts:199·worker-pty.ts:145는 이미 플랫폼 분기를 쓰고 있다.
      env: withoutAnthropicKeys({ ...process.env, PATH: `${process.env.PATH ?? ""}${process.platform === "win32" ? ";" : ":"}${CLAUDE_BIN_DIR}` }),
    }, (error, stdout, stderr) => {
      if (error) {
        resolve(`[에러] ${stderr || error.message}`);
      } else {
        resolve(stdout || "(완료)");
      }
    });
  });
}

function validationSkipReason(cwd: string | undefined, cmd: string): string | null {
  if (!cwd) return "cwd 미설정";
  if (!existsSync(cwd)) return `cwd 없음: ${cwd}`;
  if (cmd.includes("tsc") && !existsSync(join(cwd, "tsconfig.json"))) return "tsconfig.json 없음";
  return null;
}

// 쓰기 성격 Bash 명령 감지 — 읽기 전용이면 경로 가드 스킵
const BASH_WRITE_RE = /(\bsed\s+[^|;&]*-i\b|\btee\b|\bdd\s+[^|;&]*\bof=|\bcp\b|\bmv\b|\brm\b|\bmkdir\b|\btouch\b|\bln\b|\b(?:cat|echo|printf)\s+[^|;&]*>>?|>>?\s*\S|\bchmod\b|\bchown\b|\bcurl\b[^|;&]*\s-[oO]\b|\btar\b|\bunzip\b|\bgzip\b|\bgunzip\b)/;

function globToRegex(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const pat = esc.replace(/\*\*/g, "__GS__").replace(/\*/g, "[^/]*").replace(/__GS__/g, ".*");
  return new RegExp(`^${pat}$`);
}

function extractBashWriteTargets(cmd: string): string[] {
  const out: string[] = [];
  const unquote = (s: string) => s.replace(/^['"]|['"]$/g, "");
  // 리다이렉션: > path, >> path (2>, &> 등 포함)
  for (const m of cmd.matchAll(/(?:[12&]?>>?)\s*('[^']+'|"[^"]+"|\S+)/g)) out.push(unquote(m[1]));
  // curl -o FILE — writePaths 검사 우회 방지 (Vera 감사)
  for (const m of cmd.matchAll(/\bcurl\b[^|;&]*?\s-o\s+('[^']+'|"[^"]+"|\S+)/g)) out.push(unquote(m[1]));
  // tar -C DIR / --directory=DIR, unzip -d DIR — 추출 경로 writePaths 검사 (Vera 감사: 경로 우회 차단)
  for (const m of cmd.matchAll(/\btar\b[^|;&]*?\s(?:-C\s+|--directory(?:=|\s+))('[^']+'|"[^"]+"|\S+)/g)) out.push(unquote(m[1]));
  for (const m of cmd.matchAll(/\bunzip\b[^|;&]*?\s-d\s+('[^']+'|"[^"]+"|\S+)/g)) out.push(unquote(m[1]));
  // sed -i [spec] TARGET(s) — quoted spec(`'1i\\// x'`) 제거 후 남은 비-플래그 토큰만 target으로
  const sedM = cmd.match(/\bsed\s+(?:[^|;&]*?-i\s*(?:''|"")?\s*)(.+?)(?:\s*(?:\||;|&&|$))/);
  if (sedM) {
    const stripped = sedM[1].replace(/'[^']*'/g, " ").replace(/"[^"]*"/g, " ");
    for (const token of stripped.trim().split(/\s+/)) {
      if (!token || token.startsWith("-")) continue;
      out.push(unquote(token));
    }
  }
  // tee [-a] FILE...
  const teeM = cmd.match(/\btee\s+([^|;&]+?)(?:\s*(?:\||;|&&|$))/);
  if (teeM) for (const t of teeM[1].split(/\s+/)) { if (t && !t.startsWith("-")) out.push(unquote(t)); }
  // dd of=PATH
  for (const m of cmd.matchAll(/\bdd\s+[^|;&]*?\bof=('[^']+'|"[^"]+"|\S+)/g)) out.push(unquote(m[1]));
  // cp/mv [opts] ... DST — 마지막 인자
  for (const verb of ["cp", "mv"]) {
    const m = cmd.match(new RegExp(`\\b${verb}\\b\\s+([^|;&]+?)(?:\\s*(?:\\||;|&&|$))`));
    if (m) {
      const args = m[1].trim().split(/\s+/).filter((t) => !t.startsWith("-"));
      if (args.length > 0) out.push(unquote(args[args.length - 1]));
    }
  }
  // rm [opts] PATH...
  const rmM = cmd.match(/\brm\s+([^|;&]+?)(?:\s*(?:\||;|&&|$))/);
  if (rmM) for (const t of rmM[1].split(/\s+/)) { if (t && !t.startsWith("-")) out.push(unquote(t)); }
  return out;
}

// [bash] 경로용 민감경로 매처 — MCP SafeFS와 동일 SENSITIVE_PATHS(.env/.pem/history/agents.json 등)를
// bash-tag 경로에도 적용 (Vera P1: 레이어 비대칭 제거, writePaths /** 우회 차단)
const bashSensitiveMatchers = [PROJECT_SELF_DIR, homedir(), "/"].map((b) => buildSensitiveMatcher(b));

// symlink 우회 차단 — 존재하면 realpath, 없으면(쓰기 대상 신규) 부모 realpath + basename (safefs resolveReal 모델)
function resolveRealPath(p: string): string {
  try { return realpathSync(p); } catch { /* 파일 없음 */ }
  try { return join(realpathSync(dirname(p)), basename(p)); } catch { /* 상위도 없음 */ }
  return p;
}

// 파일을 읽어 내용을 노출하는 명령 — 인자(파일 경로)가 SENSITIVE면 차단해야 함.
// (BLACKLIST 열거의 누락을 패턴 기반 SENSITIVE_PATHS로 보완 — Vera 감사 2026-06-24 조건3 근본책:
//  쓰기/읽기 방어 비대칭 해소. SENSITIVE는 .env*/.ssh/**/credentials/*.pem 등을 패턴으로 포괄.)
const READ_CMD_RE = /\b(?:cat|bat|less|more|head|tail|tac|nl|grep|egrep|fgrep|rg|ag|strings|xxd|hexdump|od|base64|cut|awk|sed|sort|uniq|wc|md5|md5sum|shasum|sha\d*sum|openssl)\b/;
function readSensitiveTargets(cmd: string, cwd: string | undefined): string | null {
  if (!READ_CMD_RE.test(cmd)) return null;
  // 토큰 캡처 3종 (Vera 감사 2026-06-24):
  //  ① 슬래시 포함 경로(절대/상대/~/$HOME)  ② 선행 닷파일(.env 등)
  //  ③ cwd 루트의 bare-filename 시크릿 — 슬래시·선행닷 없어도 시크릿형 이름이면 캡처(잔여갭1).
  const TOKEN_RE = /(?:^|[\s'"=|&;(])((?:~|\$HOME)?\/?[\w.@~$-]*\/[\w./@~$-]*|\.[\w.-]+|[\w.-]*(?:secret|credential|password|passwd|token)[\w.-]*|[\w-]+\.(?:crt|cer|jks|pfx|p8|key|pem))/gi;
  for (const m of cmd.matchAll(TOKEN_RE)) {
    let tok = m[1].replace(/^['"]|['"]$/g, "").replace(/[;,]+$/, "");
    if (!tok || tok.startsWith("-") || tok === "/") continue;
    tok = tok.replace(/^~(?=\/|$)/, homedir()).replace(/^\$HOME(?=\/|$)/, homedir());
    const abs = resolveRealPath(isAbsolute(tok) ? tok : pathResolve(cwd || process.cwd(), tok));
    if (bashSensitiveMatchers.some((mm) => mm(abs))) return `민감경로 읽기 차단 [target=${m[1]}]`;
  }
  return null;
}

function pathViolationInBash(
  cmd: string,
  cwd: string | undefined,
  writePaths?: string[],
  denyPaths?: string[],
): string | null {
  // 읽기 명령의 민감경로 인자 차단 (쓰기 게이트와 독립 — 읽기에도 SENSITIVE 적용)
  const readViolation = readSensitiveTargets(cmd, cwd);
  if (readViolation) return readViolation;
  if (!BASH_WRITE_RE.test(cmd)) return null;
  // 민감경로 + 작업영역 밖 쓰기는 writePaths/denyPaths 설정과 무관하게 항상 차단 (Vera P1/P2)
  // 표준 버림/출력 디바이스는 쓰기 허용 (echo x > /dev/null 등 흔한 관용구 — 2026-06-24 오탐 수정)
  const DEV_SINKS = new Set(["/dev/null", "/dev/stdout", "/dev/stderr", "/dev/tty"]);
  for (const t of extractBashWriteTargets(cmd)) {
    const cleaned = t.replace(/;+$/, "");  // `> /dev/null;` 처럼 끝에 붙는 구분자 제거
    if (DEV_SINKS.has(cleaned)) continue;
    const abs = resolveRealPath(isAbsolute(cleaned) ? cleaned : pathResolve(cwd || process.cwd(), cleaned));
    if (bashSensitiveMatchers.some((m) => m(abs))) return `민감경로 쓰기 차단 [target=${t}]`;
    // P2: writePaths /** 무력화 보완 — 프로젝트/현재작업(cwd)/tmp 밖 절대경로 쓰기 차단
    const inArea = abs === PROJECT_SELF_DIR || abs.startsWith(PROJECT_SELF_DIR + "/")
      || (!!cwd && (abs === cwd || abs.startsWith(cwd + "/")))
      || abs.startsWith(tmpdir() + "/") || abs.startsWith("/tmp/")
      || abs.startsWith(homedir() + "/Library/Mobile Documents/");  // iCloud Obsidian Vault (글로벌 규칙 강제 산출물 경로, Vera P2)
    if (!inArea) return `작업영역(프로젝트/cwd/tmp/Obsidian) 밖 쓰기 차단 [target=${t}]`;
  }
  if (!writePaths?.length && !denyPaths?.length) return null;
  const norm = (p: string) => (p.startsWith("/") ? p.slice(1) : p);
  // target을 여러 "상대 기준"으로 후보 경로 생성 — cwd ≠ PROJECT_SELF_DIR 케이스 대응
  const candidates = (target: string): string[] => {
    const abs = isAbsolute(target) ? target : pathResolve(cwd || process.cwd(), target);
    const out: string[] = [abs];
    if (cwd && (abs === cwd || abs.startsWith(cwd + "/"))) out.push(abs.slice(cwd.length + 1));
    if (abs === PROJECT_SELF_DIR || abs.startsWith(PROJECT_SELF_DIR + "/")) out.push(abs.slice(PROJECT_SELF_DIR.length + 1));
    return [...new Set(out)];
  };
  const matchAny = (cands: string[], pat: string): boolean => {
    const rx = globToRegex(pat);
    const prefix = pat.replace(/\*\*$/, "").replace(/\/$/, "") + "/";
    for (const c of cands) {
      if (rx.test(c) || c.startsWith(prefix)) return true;
    }
    return false;
  };
  const rawTargets = extractBashWriteTargets(cmd);
  if (rawTargets.length === 0) return null;

  for (const t of rawTargets) {
    const cands = candidates(t);
    for (const dp of denyPaths ?? []) {
      if (matchAny(cands, norm(dp))) {
        return `denyPaths 매칭 [${dp}] target=${t}`;
      }
    }
  }
  if (writePaths?.length) {
    for (const t of rawTargets) {
      const cands = candidates(t);
      const inside = writePaths.some((wp) => matchAny(cands, norm(wp)));
      if (!inside) return `writePaths 밖 [target=${t}]`;
    }
  }
  return null;
}

async function execBashSafe(
  cmd: string,
  cwd?: string,
  writePaths?: string[],
  denyPaths?: string[],
): Promise<string> {
  const pathViolation = pathViolationInBash(cmd, cwd, writePaths, denyPaths);
  if (pathViolation) {
    console.log(`[Bash] 경로 차단: ${cmd} — ${pathViolation}`);
    return `[차단됨] 경로 권한 거부: ${pathViolation}`;
  }

  const verdict = classifyBash(cmd);

  if (verdict === "blacklist") {
    console.log(`[Bash] 차단: ${cmd}`);
    return `[차단됨] 위험한 명령입니다: ${cmd}`;
  }

  if (verdict === "genie") {
    console.log(`[Bash] 마이크루 검증 요청: ${cmd}`);
    const allowed = await askGenieToVerify(cmd);
    if (!allowed) {
      return `[거부됨] 마이크루가 안전하지 않다고 판단했습니다: ${cmd}`;
    }
  }

  // E2E 테스트(playwright/test 스위트)는 60초로 부족 — 5분으로 연장
  const isLongRunning = /\bplaywright\b|test:e2e|\bnpm\s+(?:run\s+(?:\S+\s+)?)?test\b/.test(cmd);
  return execBash(cmd, cwd, isLongRunning ? 300_000 : 60_000);
}

// --- git 백업 (폐기) ---
// stash는 워킹 디렉토리 전체를 가져가므로 외주/다른 주체의 uncommitted 변경까지 소실시킴.
// 2026-04-24 사장님 지시로 제거. 실패 시 원복은 git log + revert로 수동 대응.

// --- 통합 워커 에이전트 실행 ---

// 마지막 작업의 진행 메시지 (reportToGenie에서 참조)
const lastJobProgress = new Map<string, string[]>();

function parseProgress(output: string, jobId: string): string {
  const matches = output.matchAll(PROGRESS_RE());
  for (const m of matches) {
    const msg = m[1].trim();
    if (msg) {
      console.log(`[진행] ${msg}`);
      if (!lastJobProgress.has(jobId)) lastJobProgress.set(jobId, []);
      lastJobProgress.get(jobId)!.push(msg);
      // 연결된 todo의 working state note에 누적
      appendNoteForJob(jobId, msg, "working");
    }
  }
  return output.replace(PROGRESS_RE(), "");
}

function parseStage(output: string, jobId: string, agentName?: string): string {
  const matches = output.matchAll(STAGE_RE());
  for (const m of matches) {
    const stage = parseInt(m[1], 10);
    if (!isNaN(stage)) {
      console.log(`[단계] stage ${stage}${agentName ? ` (${agentName})` : ""}`);
      advanceTodoStageForJob(jobId, stage);
    }
  }
  return output.replace(STAGE_RE(), "");
}

// --- 비용 추적 ---

const COST_LOG_FILE = join(HISTORY_DIR, "cost-log.jsonl");

// source: 이 비용을 발생시킨 «발화/실행의 출처». 2026-08-23 신설.
// 생략하면 키 자체가 안 붙어 이전 형식과 동일하다(cost-entry.ts 하위호환 계약).
export function logCost(agentId: string, jobId: string | undefined, cost: AgentCost, source?: string): void {
  const entry = buildCostEntry(agentId, jobId, cost, source);
  try {
    appendFileSync(COST_LOG_FILE, JSON.stringify(entry) + "\n");
  } catch { /* ignore */ }
}

function addCostToJob(jobId: string, cost: AgentCost): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.costUsd = (job.costUsd || 0) + cost.costUsd;
  job.totalTokens = (job.totalTokens || 0) + cost.inputTokens + cost.outputTokens;
}

export function getCostLog(): Array<Record<string, unknown>> {
  if (!existsSync(COST_LOG_FILE)) return [];
  try {
    const lines = readFileSync(COST_LOG_FILE, "utf-8").trim().split("\n").filter(Boolean);
    const results: Array<Record<string, unknown>> = [];
    for (const line of lines) {
      try { results.push(JSON.parse(line)); } catch { /* 손상 라인 무시 */ }
    }
    return results;
  } catch { return []; }
}

function buildTagReminder(agentId: string): string {
  return `[태그 규칙]
기억 저장: <!--WIKI:{"page":"<실제 페이지명>","content":"<실제 내용>"}-->
기억 삭제(아카이브): <!--WIKI:{"page":"<실제 페이지명>","content":""}-->
산출물 파일명: 반드시 _${agentId} 를 확장자 앞에 붙이세요. 예: 보고서-2026-04-17_${agentId}.md
산출물 저장: 보고서/분석 등 산출물은 wiki가 아닌 history/outputs/${agentId}/ 에 직접 저장하세요 (wiki는 5KB 제한).
산출물 참조: 자주 참조하는 핵심 산출물(최대 5건)만 wiki/index.md의 "## 주요 산출물" 섹션에 등록하세요.
  형식: - [산출물명](../../../outputs/${agentId}/파일명.md) — USE WHEN: <언제 참조>; <1줄 요약>
  5건 초과 시 덜 중요한 것을 제거하세요. 나머지는 history/outputs/${agentId}/ 에서 Glob/Read로 탐색.

[기억 관리 규칙]
- 위키 정리: 오래된 작업 기록은 빈 content로 아카이브. ${[...PROTECTED_PAGE_NAMES].join(", ")}, ${PROTECTED_PAGE_PREFIXES.map((p) => p + "*").join(", ")}로 시작하는 페이지는 보호 대상.
- 연상 기억: 위키 저장 시 관련 있는 기존 페이지가 있으면 본문에 "관련: XX페이지 참조"로 언급하세요.
- 중요 기억: 절대 잊으면 안 되는 기억은 페이지명 앞에 !를 붙이세요. 예: !중요결정사항. !페이지는 정리 시 보호됩니다.
- 절차 기억: 반복 작업에서 패턴을 발견하면 procedure_작업유형 페이지로 저장하세요. 예: procedure_self-update, procedure_frontend-test.
- 기억 수정: 기존 위키와 모순되는 새 정보를 발견하면, 해당 페이지를 Read로 확인 후 수정된 WIKI 태그로 업데이트하세요.`
  + (isProfileOversized(agentId)
    ? `\n\n[⚠️ self-profile 정리 필요]\nself-profile이 3KB를 초과했습니다. 강점 3개, 약점 3개, 교훈 5개 이내로 정리하세요. 오래된 항목은 통합하거나 삭제하세요.`
    : "");
}

// --- 세션 시작용: 정체성 + 조직도 ---


// buildOrgChart 캐시: full=true 경로는 직원 N명의 role-directive.md를 매번 readFileSync.
// (selfId, mtimesHash) 키로 결과 캐시 — statSync만 매번 돌리고 변동 없으면 readFileSync 생략.
const orgChartCache = new Map<string, { result: string; mtimesHash: string }>();

function orgMtimesHash(agents: ReturnType<typeof getAllWorkerAgents>): string {
  const parts: string[] = [];
  for (const a of agents) {
    const rdPath = join(HISTORY_DIR, "agents", a.id, "wiki", "role-directive.md");
    let m = 0;
    try { m = statSync(rdPath).mtimeMs; } catch { /* 없음 */ }
    parts.push(`${a.id}:${m}`);
  }
  return parts.sort().join("|");
}

export function buildOrgChart(full: boolean, selfId?: string): string {
  const agents = getAllWorkerAgents();
  if (full) {
    const hash = orgMtimesHash(agents);
    const key = selfId ?? "__none__";
    const cached = orgChartCache.get(key);
    if (cached && cached.mtimesHash === hash) return cached.result;
    const lines = ["[우리 조직]"];
    for (const a of agents) {
      if (a.id === selfId) {
        lines.push(`\n--- ${a.name} (${a.id}) — ${a.team || "팀 없음"} --- (본인, 상세는 위 참조)`);
        continue;
      }
      const wikiDir = join(HISTORY_DIR, "agents", a.id, "wiki");
      lines.push(`\n--- ${a.name} (${a.id}) — ${a.team || "팀 없음"} ---`);
      const rdPath = join(wikiDir, "role-directive.md");
      if (existsSync(rdPath)) lines.push(readFileSync(rdPath, "utf-8"));
      // self-profile은 본인 세션에서만 로드 (타 직원 프롬프트에 불필요)
    }
    lines.push("\n[조직 끝]");
    const result = lines.join("\n");
    orgChartCache.set(key, { result, mtimesHash: hash });
    return result;
  }
  return `[조직] ${agents.map((a) => `${a.name}(${a.team || a.id})`).join(", ")}`;
}

// 직원 해시 관리 (변경 감지용, 디스크 영속)
const STAFF_HASH_FILE = join(HISTORY_DIR, "staff-hash.json");
let staffHashCache: Record<string, string> = {};

function loadStaffHashFile(): void {
  if (Object.keys(staffHashCache).length) return;
  try {
    if (existsSync(STAFF_HASH_FILE)) {
      staffHashCache = JSON.parse(readFileSync(STAFF_HASH_FILE, "utf-8"));
    }
  } catch { staffHashCache = {}; }
}

function saveStaffHashFile(): void {
  try {
    writeFileSync(STAFF_HASH_FILE, JSON.stringify(staffHashCache));
  } catch { /* ignore */ }
}

function currentStaffHash(): string {
  return getAllWorkerAgents().map((a) => a.id).sort().join(",");
}

export function checkStaffChange(agentId: string): boolean {
  loadStaffHashFile();
  const current = currentStaffHash();
  const saved = staffHashCache[agentId];
  if (saved && saved !== current) {
    return true;
  }
  return false;
}

// 직원 파일 mtime 변동 감지 (role-directive + project wiki)
const workerMtimes = new Map<string, number>();
function checkFileMtime(key: string, filepath: string): boolean {
  try {
    const mtime = statSync(filepath).mtimeMs;
    const prev = workerMtimes.get(key);
    workerMtimes.set(key, mtime);
    if (prev && mtime !== prev) return true;
  } catch { /* 파일 없음 */ }
  return false;
}

export function checkWorkerRdChange(agentId: string): boolean {
  return checkFileMtime(`rd:${agentId}`, join(HISTORY_DIR, "agents", agentId, "wiki", "role-directive.md"));
}

function checkProjectWikiChange(projectName?: string): boolean {
  if (!projectName) return false;
  const wikiDir = join(PROJECTS_DIR, projectName, ".wiki");
  if (!existsSync(wikiDir)) return false;
  try {
    // 디렉토리 mtime으로 파일 추가/수정 감지
    return checkFileMtime(`pw:${projectName}`, wikiDir);
  } catch { return false; }
}

export function saveStaffHash(agentId: string): void {
  loadStaffHashFile();
  staffHashCache[agentId] = currentStaffHash();
  saveStaffHashFile();
}

function loadProjectWiki(projectName?: string): string {
  if (!projectName) return "";
  try {
    const projWikiDir = join(PROJECTS_DIR, projectName, ".wiki");
    if (!existsSync(projWikiDir)) return "";
    const files = readdirSync(projWikiDir).filter((f) => f.endsWith(".md"));
    if (files.length === 0) return "";
    const MAX_PROJECT_WIKI_LINES = 100;
    const pages: string[] = [];
    for (const file of files) {
      pages.push(`--- ${file} ---\n${readFileSync(join(projWikiDir, file), "utf-8")}`);
    }
    const combined = pages.join("\n\n");
    const lines = combined.split("\n");
    if (lines.length <= MAX_PROJECT_WIKI_LINES) return combined;
    return lines.slice(0, MAX_PROJECT_WIKI_LINES).join("\n") + "\n...(이하 생략)";
  } catch { return ""; }
}

function saveProjectWiki(projectName: string, page: string, content: string): void {
  try {
    const projWikiDir = join(PROJECTS_DIR, projectName, ".wiki");
    if (!existsSync(projWikiDir)) mkdirSync(projWikiDir, { recursive: true });
    const filename = page.replace(/[^a-zA-Z0-9가-힣\-_]/g, "-") + ".md";
    writeFileSync(join(projWikiDir, filename), content);
    console.log(`[ProjectWiki] ${projectName}/${filename} 저장`);
  } catch (err) {
    console.error("[ProjectWiki] 저장 실패:", err);
  }
}

function loadRecentDailySummaries(agentId: string, days: number = 3): string {
  const dir = join(HISTORY_DIR, "agents", agentId, "wiki", "daily");
  if (!existsSync(dir)) return "";
  try {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .reverse()
      .slice(0, days);
    if (files.length === 0) return "";
    const parts = files.map((f) => `--- ${f.replace(".md", "")} ---\n${readFileSync(join(dir, f), "utf-8")}`);
    return `[최근 기억]\n${parts.join("\n\n")}\n[최근 기억 끝]`;
  } catch { return ""; }
}

// 워커가 자기 잡을 '타인의 동시 진행 잡'으로 오인하는 것을 막는다.
//
// 2026-08-08 실측: 워커는 자기 job id를 모른 채 history/jobs.json을 직접 읽는다. 그래서
// 거기 있는 자기 행을 타인으로 읽고 "backend가 같은 지시를 동시 실행 중"이라 판단해,
// 지시 1건을 '이미 남이 했다'며 건너뛰는 사고가 났다(3fce5e94). 같은 오인이 d38b6e93에서도
// 반복됐다 — 부주의가 아니라 식별 수단이 없어서 생기는 구조적 결함이다.
// 해결은 간단하다: 자기 id를 알려준다.
function buildJobIdBlock(jobId?: string): string {
  if (!jobId) return "";
  return `[현재 잡] 지금 당신이 수행 중인 잡의 ID는 ${jobId} 입니다.\n`
    + `history/jobs.json 등에서 활성 잡 목록을 볼 때 이 ID는 **당신 자신**입니다 — `
    + `타인의 동시 진행 잡으로 오인하지 마세요. 중복 위임을 판단하려면 이 ID를 먼저 제외하고 보세요.\n\n`;
}

function buildWorkerPrompt(
  agentDef: WorkerAgentDef,
  sessionId: string | undefined,
  body: string,
  projectName?: string,
  jobId?: string,
): string {
  const projWiki = loadProjectWiki(projectName);
  const projBlock = projWiki ? `[프로젝트 공유 메모]\n${projWiki}\n[공유 메모 끝]\n\n` : "";
  const tagReminder = buildTagReminder(agentDef.id);
  const orgShort = buildOrgChart(false) + "\n\n";
  // 잡마다 달라지는 값이라 resume 세션에도 매번 실어 보낸다(캐시된 정체성 블록에 넣을 수 없다).
  const jobBlock = buildJobIdBlock(jobId);

  if (sessionId) {
    // resume: 직원 변경, role-directive, 프로젝트 공유 메모 변경 감지
    if (checkStaffChange(agentDef.id) || checkWorkerRdChange(agentDef.id) || checkProjectWikiChange(projectName)) {
      clearPmSession(agentDef.id);
      console.log(`[${agentDef.id}] 변동 감지 → 세션 리셋`);
      return buildWorkerPrompt(agentDef, undefined, body, projectName, jobId);
    }
    // resume: 세션 컨텍스트에 조직도/태그/위키 이미 존재 → 작업 내용만 전달
    return jobBlock + body;
  }

  // 새 세션: 정체성 + 조직도(요약) + 위키 인덱스 + 3일 요약
  markSessionStart(agentDef.id);
  const identity = loadWorkerIdentity(agentDef.id, HISTORY_DIR);
  // [토큰 감사 #1] 동료 15명의 role-directive 전문(합계 ~43KB ≈ 12~16K토큰)을 매 fresh 세션마다
  // 주입하던 O(N²) 구조 제거 — 지니와 동일하게 요약 로스터만 주고, 특정 동료의 상세가 필요하면
  // SafeRead로 온디맨드 조회하게 안내한다. QA 재검(최대 3회)·리셋 폭풍과 곱해지던 최대 낭비원.
  const orgFull = buildOrgChart(false)
    + "\n(동료의 상세 역할이 필요하면 SafeRead로 history/agents/<id>/wiki/role-directive.md 를 조회)";
  const wiki = loadPmWiki(agentDef.id);
  const wikiBlock = wiki ? `[${agentDef.name}의 기억]\n${wiki}\n[기억 끝]\n\n` : "";
  const dailyBlock = loadRecentDailySummaries(agentDef.id);
  const dailySection = dailyBlock ? `${dailyBlock}\n\n` : "";
  saveStaffHash(agentDef.id);

  // 선별 회상(MEMORY_SELECTIVE_RECALL=1) — TOC + 작업 내용(body) 관련 상위 위키 페이지만 추가 주입.
  // 기본 OFF: 값 미설정 시 기존 동작(위 wikiBlock/dailySection만)과 완전히 동일.
  let recallSection = "";
  if (isSelectiveRecallEnabled()) {
    try {
      buildWikiIndex(agentDef.id);
      const toc = buildToc(agentDef.id);
      const tocText = formatToc(toc);
      const tocBlock = tocText ? `[${agentDef.name}의 위키 목차]\n${tocText}\n(개별 페이지가 필요하면 Read로 1~3개만 선택 로드)\n[목차 끝]\n\n` : "";
      const recall = recallRelevant(agentDef.id, body, getRecallBudgetChars());
      const recallBlock = recall.text
        ? `[관련 기억 회상]\n${recall.text}${recall.truncated ? "\n(예산 초과로 일부 생략됨 — 필요 시 Read로 전문 확인)" : ""}\n[관련 기억 회상 끝]\n\n`
        : "";
      recallSection = tocBlock + recallBlock;
    } catch (e) {
      console.error(`[${agentDef.id}] 선별 회상 실패(기존 동작으로 진행):`, e);
    }
  }

  return `${identity}\n\n${orgFull}\n\n${wikiBlock}${dailySection}${recallSection}${projBlock}${tagReminder}\n\n${jobBlock}${body}`;
}

function extractPlanText(output: string): string {
  const idx = output.indexOf("## 실행 계획");
  if (idx === -1) return output.trim();
  return output.slice(idx).trim();
}

async function reviewPlanWithGenie(
  plan: string,
  originalRequest: string,
  attempt: number,
): Promise<{ approved: boolean; feedback: string }> {
  const prompt = `직원이 다음 작업의 실행 계획을 세웠습니다. 검토 후 승인 또는 반려해주세요.

작업: ${originalRequest}

계획:
${plan}

다음 형식으로만 답하세요. 승인이면: 승인. 반려면: 반려: 구체적 이유와 수정 방향`;

  const result = await runGenieAgent(`plan-review-${attempt}`, prompt, { freshSession: true });

  if (!result.success) {
    const limitOnFail = detectUpstreamLimit(result.error);
    if (limitOnFail) throw new UpstreamLimitError(limitOnFail);
    return { approved: false, feedback: result.error ?? "마이크루 검토 실패" };
  }

  const answer = result.output.trim();
  if (answer.startsWith("승인")) return { approved: true, feedback: "" };
  if (answer.startsWith("반려")) {
    const feedback = answer.replace(/^반려[:：]?\s*/, "").trim();
    return { approved: false, feedback: feedback || "(사유 미제공)" };
  }
  // ★ 형식 오류로 반려하기 전에 상류 한도부터 판정한다.
  // 한도 통지("You've hit your session limit ...")를 '형식 오류'로 읽으면 반려 3회를 소모하고
  // 잡이 failed로 종결된다 (2026-08-17 c61e450f 실사고). 한도는 결함이 아니라 재시도 대상이다.
  const limit = detectUpstreamLimit(answer);
  if (limit) throw new UpstreamLimitError(limit);
  return {
    approved: false,
    feedback: `마이크루 응답 형식 오류: ${answer.slice(0, 200)}`,
  };
}

async function runPlanApprovalGate(
  agentDef: WorkerAgentDef,
  config: AgentConfig,
  adapter: AgentAdapter,
  request: string,
  jobId: string | undefined,
  cwd: string | undefined,
  onProgress: (msg: string) => void,
  initialSessionId: string | undefined,
  projectName?: string,
): Promise<string | undefined> {
  const agentId = agentDef.id;
  const MAX_PLAN_ATTEMPTS = 3;
  const PLAN_PREFIX =
    "[계획 수립 모드] 이 작업의 실행 계획만 세우세요. 절대 파일을 수정하거나 명령을 실행하지 마세요. Read/Glob/Grep만 허용. 마지막에 ## 실행 계획 섹션으로 단계별 정리해서 보고하세요.";
  const planConfig: AgentConfig = {
    ...config,
    allowedTools: ["Read", "Glob", "Grep"],
    // 2026-08-24: 계획 단계만 별도 모델(worker-stage-model.ts). runWorkerAgent 가 config.planModel 로
    // 계산해 넣어 준다. 미지정이면 실행 모델 그대로 = 기존 동작 불변.
    model: config.planModel ?? config.model,
  };

  const job = jobId ? jobs.get(jobId) : undefined;
  if (job) {
    job.planAttempts = 0;
    job.planHistory = [];
  }

  let sessionId = initialSessionId;
  let planPrompt = buildWorkerPrompt(agentDef, sessionId, `${PLAN_PREFIX}\n\n${request}`, projectName, jobId);

  for (let attempt = 1; attempt <= MAX_PLAN_ATTEMPTS; attempt++) {
    if (job) {
      job.status = "planning";
      job.planAttempts = attempt;
      emitGlobalEvent("job-update", { id: job.id, status: job.status, request: job.request });
      // multi-stage: '계획수립' stage로 advance
      if (job.stages) {
        const planIdx = job.stages.indexOf("계획수립", job.currentStage ?? 0);
        if (planIdx >= 0) { job.currentStage = planIdx; saveJobs(); advanceTodoStageForJob(job.id, planIdx); }
      }
    }
    console.log(`[Plan] 계획 수립 시도 ${attempt}/${MAX_PLAN_ATTEMPTS}`);

    let planResult = await adapter.execute(planConfig, jobId ?? `${agentId}-plan`, planPrompt, {
      resumeSessionId: liveSession(sessionId, cwd),
      cwd,
      onProgress,
      onSpawn: makeChildPidRegistrar(jobId),
      onSystemMessage: makeSessionCheckpointer(agentId, jobId),
    });

    // ★ 2026-08-23 신설 — 계획 수립 비용은 여태 cost-log 에 한 행도 안 남았다
    //   (finalizeWorkerResult 를 안 타는 유일한 adapter.execute 경로였다).
    //   otel-spans 로만 복원 가능했던 월 $404 가 여기서 장부 안으로 들어온다.
    if (planResult.cost) {
      logCost(agentId, jobId, planResult.cost, "worker:plan");
      if (jobId) addCostToJob(jobId, planResult.cost);
    }

    // 세션 만료 시 새 세션으로 재시도
    if (!planResult.success && sessionId) {
      console.log(`[Plan] 세션 만료, 새 세션으로 재시도`);
      clearPmSession(agentId);
      sessionId = undefined;
      planPrompt = buildWorkerPrompt(agentDef, undefined, `${PLAN_PREFIX}\n\n${request}`, projectName, jobId);
      planResult = await adapter.execute(planConfig, jobId ?? `${agentId}-plan`, planPrompt, {
        cwd,
        onProgress,
        onSpawn: makeChildPidRegistrar(jobId),
        onSystemMessage: makeSessionCheckpointer(agentId, jobId),
      });
      if (planResult.cost) {
        logCost(agentId, jobId, planResult.cost, "worker:plan-retry");
        if (jobId) addCostToJob(jobId, planResult.cost);
      }
    }

    if (planResult.sessionId) {
      sessionId = planResult.sessionId;
      savePmSession(agentId, sessionId);
    }

    if (!planResult.success) {
      throw new Error(planResult.error ?? "계획 수립 실패");
    }

    const planText = extractPlanText(planResult.output);
    if (job) {
      job.plan = planText;
      job.planHistory!.push(planText);
      job.status = "awaiting_approval";
      emitGlobalEvent("job-update", { id: job.id, status: job.status, request: job.request });
      // multi-stage: '승인대기' stage로 advance
      if (job.stages) {
        const awaitIdx = job.stages.indexOf("승인대기", job.currentStage ?? 0);
        if (awaitIdx >= 0) { job.currentStage = awaitIdx; saveJobs(); advanceTodoStageForJob(job.id, awaitIdx); }
      }
    }
    auditLog("plan.proposed", { jobId, attempt, agent: agentId });
    if (jobId) transitionTodosForJob(jobId, "plan_review", planText);
    addGenieMessage(`📋 DevPM이 계획을 제출했어요 (${attempt}/${MAX_PLAN_ATTEMPTS})`);
    console.log(`[Plan] 마이크루 검토 요청 (시도 ${attempt})`);

    const review = await reviewPlanWithGenie(planText, request, attempt);

    if (review.approved) {
      auditLog("plan.approved", { jobId, attempt, agent: agentId });
      if (jobId) transitionTodosForJob(jobId, "working", "작업 시작");
      addGenieMessage(`✅ 계획 승인`);
      console.log(`[Plan] 승인됨`);
      return sessionId;
    }

    auditLog("plan.rejected", {
      jobId,
      attempt,
      agent: agentId,
      feedback: review.feedback.slice(0, 300),
    });
    console.log(`[Plan] 반려: ${review.feedback.slice(0, 200)}`);

    if (attempt >= MAX_PLAN_ATTEMPTS) {
      auditLog("plan.exhausted", { jobId, agent: agentId });
      throw new Error(
        `계획 승인 실패 (${MAX_PLAN_ATTEMPTS}회 반려): ${review.feedback}`,
      );
    }

    addGenieMessage(`🔄 계획 반려 후 재시도(${attempt + 1}/${MAX_PLAN_ATTEMPTS})`);
    planPrompt = `[계획 반려] 사유: ${review.feedback}\n다시 계획을 세워주세요.`;
  }

  throw new Error("계획 승인 실패");
}

async function finalizeWorkerResult(
  agentDef: WorkerAgentDef,
  config: AgentConfig,
  adapter: AgentAdapter,
  initial: AgentResult,
  jobId: string | undefined,
  cwd: string | undefined,
  onProgress: (msg: string) => void,
  projectName?: string,
): Promise<string> {
  const agentId = agentDef.id;
  let result = initial;

  // 비용 기록
  if (result.cost) {
    logCost(agentId, jobId, result.cost, "worker:execute");
    if (jobId) addCostToJob(jobId, result.cost);
  }

  // PROGRESS + STAGE 파싱
  if (result.success && result.output && jobId) {
    result.output = parseProgress(result.output, jobId);
    result.output = parseStage(result.output, jobId, agentDef.name);
  }

  // BASH 태그 루프 (bashTagSupport가 true인 에이전트만)
  if (agentDef.bashTagSupport) {
    const MAX_BASH_LOOPS = 10;
    for (let loop = 0; loop < MAX_BASH_LOOPS; loop++) {
      if (!result.success || !result.output) break;

      const bashMatches = [...result.output.matchAll(BASH_RE())];
      if (bashMatches.length === 0) break;

      const bashResults: string[] = [];
      for (const match of bashMatches) {
        const cmd = match[1].trim();
        console.log(`[${agentId}] Bash 요청: ${cmd}`);
        const output = await execBashSafe(cmd, cwd, agentDef.writePaths, agentDef.denyPaths);
        console.log(`[${agentId}] Bash 결과: ${output.slice(0, 200)}`);
        bashResults.push(`$ ${cmd}\n${output}`);
      }

      const bashFeedback = `[Bash 실행 결과]\n${bashResults.join("\n\n")}\n[결과 끝]\n\n위 결과를 확인하고 작업을 계속하세요.`;
      result = await adapter.execute(config, jobId ?? `${agentId}-job`, bashFeedback, {
        resumeSessionId: liveSession(loadPmSession(agentId), cwd),
        cwd,
        onProgress,
        onSpawn: makeChildPidRegistrar(jobId),
        onSystemMessage: makeSessionCheckpointer(agentId, jobId),
      });

      if (result.cost) {
        logCost(agentId, jobId, result.cost, "worker:bash-feedback");
        if (jobId) addCostToJob(jobId, result.cost);
      }
      if (result.sessionId) {
        savePmSession(agentId, result.sessionId);
      }

      if (result.success && result.output && jobId) {
        result.output = parseProgress(result.output, jobId);
        result.output = parseStage(result.output, jobId, agentDef.name);
      }
    }
  }

  // WIKI 태그 파싱
  if (result.success && result.output) {
    const wikiMatches = result.output.matchAll(WIKI_RE());
    for (const match of wikiMatches) {
      try {
        const data = JSON.parse(match[1]) as { page: string; content: string };
        // project: 접두사면 프로젝트 공유 위키에 저장
        if (data.page.startsWith("project:") && projectName) {
          saveProjectWiki(projectName, data.page.slice(8), data.content);
        } else {
          savePmWikiPage(agentId, data.page, data.content);
        }
      } catch (err) {
        console.error(
          `[${agentId}] WIKI 태그 파싱 실패:`,
          err instanceof Error ? err.message : err,
          "| body:",
          match[1].slice(0, 200),
        );
      }
    }
  }

  if (!result.success) {
    throw new Error(result.error ?? `${agentDef.name} 작업 실패`);
  }

  return result.output
    .replace(WIKI_RE(), "")
    .replace(BASH_RE(), "")
    .replace(PROGRESS_RE(), "")
    .replace(STAGE_RE(), "")
    .trim();
}

// ★ 2026-08-24 — per-agent maxCacheTokens 상한 발동 조건. 두 실행 경로(planGate/direct)가 같은
// 식을 중복 작성하고 있어 하나로 모았다 — 단위 테스트 가능(cache-cap-test.ts).
// capTokens가 0/미설정이면 상한 없음(항상 false) — agents.json에 값이 없는 직원은 절대 안 걸린다.
export function cacheCapExceeded(cacheReadTokens: number | undefined, capTokens: number | undefined): boolean {
  return !!capTokens && capTokens > 0 && !!cacheReadTokens && cacheReadTokens > capTokens;
}

async function runWorkerAgent(
  agentDef: WorkerAgentDef,
  request: string,
  projectName?: string,
  jobId?: string,
  overrideCwd?: string,
): Promise<string> {
  const agentId = agentDef.id;
  const config = toAgentConfig(agentDef);
  // 서비스 정책 기반 MCP 도구 차단 — disabled 서비스 및 approval 정책 write 도구
  config.extraDisallowedTools = getPolicyDisallowedTools();
  // job.maxTurns override 시 모든 adapter.execute 호출(plan/execute/retry/stage)에 일관 적용
  const overrideJob = jobId ? jobs.get(jobId) : undefined;
  // effort 자동 승격의 비교 기준 — maxTurns 오버라이드를 덮어쓰기 **전**의 에이전트 정의 기본값.
  // 순서를 뒤집으면 항상 "같다"가 되어 승격이 영영 발동하지 않는다.
  const agentDefaultMaxTurns = config.maxTurns;
  if (overrideJob?.maxTurns && overrideJob.maxTurns > 0) {
    config.maxTurns = overrideJob.maxTurns;
  }
  // job.model override 시(호출자 명시 또는 티어 승격 해석값) 에이전트 기본 모델을 대체.
  // 미지정 시 toAgentConfig가 이미 설정한 값 그대로 — 기존 동작 불변.
  const overrideModel = (overrideJob as (Job & { model?: string }) | undefined)?.model;
  if (overrideModel) {
    config.model = overrideModel;
  }
  // 2026-08-24 단계별 모델 분리 — 계획 단계만 별도 모델로 승격(실행 모델은 위에서 확정된 값 유지).
  // 여기서 계산하는 이유: overrideModel 유무를 아는 유일한 자리다. runPlanApprovalGate 는 모른다.
  config.planModel = planStageModel({
    agentId,
    executeModel: config.model,
    hasJobModelOverride: !!overrideModel,
     configuredModel: agentDef.planModel,
  });
  if (config.planModel !== config.model) {
    // 조용히 바꾸지 않는다 — console.log 는 processJob 의 capture 훅을 타 job.logs 에 남는다.
    console.log(`[StageModel] ${agentDef.name} 계획=${config.planModel} / 실행=${config.model}`);
  }
  // effort — 잡 명시값 > 자동 승격(긴 lease·늘린 maxTurns) > 에이전트 기본 > low.
  // model/maxTurns와 같은 자리에서 config에 주입하므로 plan/execute/retry/stage 전 경로에 동일 적용된다.
  const effortDecision = resolveEffort({
    jobEffort: overrideJob?.effort,
    configEffort: config.effort,
    leaseSec: overrideJob?.leaseSec,
    jobMaxTurns: overrideJob?.maxTurns,
    agentMaxTurns: agentDefaultMaxTurns,
  });
  config.effort = effortDecision.effort;
  if (effortDecision.source === "auto") {
    // 조용히 올리지 않는다 — console.log는 processJob의 capture 훅을 타 job.logs에 그대로 남는다.
    console.log(`[Effort] ${agentDef.name} effort 자동 승격 → medium (${effortDecision.reason})`);
  }
  let sessionId = loadPmSession(agentId);

  const isSelf = projectName ? SELF_NAMES.has(projectName.toLowerCase()) : false;
  // cwd 결정: overrideCwd > self > projectName > PROJECT_SELF_DIR
  // MCP 전환 후 CLI deny glob 호환 불필요 — 외부 프로젝트는 PROJECTS_DIR/{name}이 cwd
  const cwd = overrideCwd
    ? overrideCwd
    : isSelf
      ? PROJECT_SELF_DIR
      : projectName
        ? resolveProjectCwd(projectName)
        : PROJECT_SELF_DIR;
  if (cwd && !isSelf && !overrideCwd) mkdirSync(cwd, { recursive: true });

  const onProgress = (msg: string) => console.log(`[진행] ${msg}`);
  // Claude 텍스트 출력 → 첫 줄만 로그에 (B수준: tool_use + 텍스트 요약)
  let lastTextLine = "";
  const onText = (chunk: string) => {
    // 줄바꿈 단위로 첫 의미있는 줄만 캡처
    const lines = chunk.split("\n").map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (line === lastTextLine) continue;
      if (line.length < 3) continue; // 너무 짧은 건 스킵
      // 태그, 마커 제거
      const clean = line.replace(/<!--[\s\S]*?-->/g, "").trim();
      if (!clean) continue;
      lastTextLine = clean;
      console.log(`[텍스트] ${clean.slice(0, 120)}`);
      break; // 청크당 1줄만
    }
  };
  const adapter = getAdapter(resolveWorkerRuntime(agentDef).adapter);

  // plan gate가 설정된 에이전트: 계획 승인 후 실행 (skipPlanGate로 건별 생략 가능)
  const job = jobId ? jobs.get(jobId) : undefined;
  if (agentDef.planGate && !job?.skipPlanGate) {
    const approvedSession = await runPlanApprovalGate(
      agentDef,
      config,
      adapter,
      request,
      jobId,
      cwd,
      onProgress,
      sessionId,
      projectName,
    );

    const job = jobId ? jobs.get(jobId) : undefined;
    if (job) {
      job.status = "running";
      emitGlobalEvent("job-update", { id: job.id, status: job.status, request: job.request });
    }

    // 계획 세션이 유실되면(리셋/파일 부재) "위 계획" 참조가 공허해진다 — 새 세션엔 원 요청을 함께 전달 (본문 미전달 재발 방지)
    const execResumeSid = liveSession(approvedSession, cwd);
    const executePrompt = execResumeSid
      ? buildJobIdBlock(jobId) + "[실행 모드] 위 계획이 승인됐습니다. 이제 계획대로 실행하세요. 모든 도구 사용 가능합니다."
      : buildWorkerPrompt(agentDef, undefined, `[실행 모드] 승인된 작업입니다. (계획 세션 유실로 원 요청을 직접 전달합니다)

원 요청:
${request}

위 요청을 지금 실행하세요. 모든 도구 사용 가능합니다.`, projectName, jobId);
    if (!execResumeSid) console.warn(`[${agentId}] 계획 세션 유실 → 원 요청 폴백으로 실행`);
    const executeResult = await adapter.execute(config, jobId ?? `${agentId}-job`, executePrompt, {
      resumeSessionId: execResumeSid,
      cwd,
      onProgress,
      onText,
      onSpawn: makeChildPidRegistrar(jobId),
      onSystemMessage: makeSessionCheckpointer(agentId, jobId),
    });

    if (executeResult.sessionId) {
      savePmSession(agentId, executeResult.sessionId);
    }
    if (executeResult.cost?.cacheReadTokens) {
      savePmSessionTokens(agentId, executeResult.cost.cacheReadTokens);
    }

    // 비용 기반 세션 리셋 (planGate 에이전트)
    const maxCachePG = agentDef.maxCacheTokens ?? 0;
    const cacheReadPG = executeResult.cost?.cacheReadTokens;
    if (cacheCapExceeded(cacheReadPG, maxCachePG)) {
      console.log(`[${agentId}] 캐시 토큰 임계 초과 (${(cacheReadPG! / 1_000_000).toFixed(1)}M > ${maxCachePG / 1_000_000}M) → 세션 리셋`);
      // 2026-08-24: 손익분기 기반 상한(cache-baseline-estimate) 발동 여부를 사후에 실측 가능하게
      // audit.jsonl에도 구조화 기록한다 — console.log는 job.logs에만 남아 집계가 번거롭다.
      auditLog("cache.reset", { agentId, jobId, cacheReadTokens: cacheReadPG, capTokens: maxCachePG, path: "planGate" });
      clearPmSession(agentId);
      addGenieMessage(`🔄 ${agentDef.name}이(가) 피곤(토큰초과)해서 기분전환(세션리셋) 했습니다.`);
    }

    return finalizeWorkerResult(
      agentDef,
      config,
      adapter,
      executeResult,
      jobId,
      cwd,
      onProgress,
      projectName,
    );
  }

  // 기타 워커: 기존 흐름 유지
  const prompt = buildWorkerPrompt(agentDef, sessionId, request, projectName, jobId);
  if (!sessionId) console.log(`[${agentId}] 새 세션으로 시작 (위키 로드됨)`);

  let result = await adapter.execute(config, jobId ?? `${agentId}-job`, prompt, {
    resumeSessionId: liveSession(sessionId, cwd),
    cwd,
    onProgress,
    onText,
    onSpawn: makeChildPidRegistrar(jobId),
    onSystemMessage: makeSessionCheckpointer(agentId, jobId),
  });

  // 세션 만료 시 재시도
  if (!result.success && sessionId) {
    console.log(`[${agentId}] 세션 만료, 새 세션으로 재시도`);
    // ★ 덮어쓰기 전에 1차 시도 비용을 남긴다. finalizeWorkerResult 는 «마지막 result» 만
    //   받으므로 재시도가 일어나면 1차분이 조용히 사라졌다(2026-08-23 시정).
    if (result.cost) {
      logCost(agentId, jobId, result.cost, "worker:execute-attempt1");
      if (jobId) addCostToJob(jobId, result.cost);
    }
    clearPmSession(agentId);
    sessionId = undefined;
    const retryPrompt = buildWorkerPrompt(agentDef, undefined, request, projectName, jobId);
    result = await adapter.execute(config, jobId ?? `${agentId}-job`, retryPrompt, {
      cwd,
      onProgress,
      onSpawn: makeChildPidRegistrar(jobId),
      onSystemMessage: makeSessionCheckpointer(agentId, jobId),
    });
  }

  if (result.sessionId) {
    savePmSession(agentId, result.sessionId);
  }
  if (result.cost?.cacheReadTokens) {
    savePmSessionTokens(agentId, result.cost.cacheReadTokens);
  }

  // 비용 기반 세션 리셋: maxCacheTokens 초과 시 다음 호출은 새 세션으로
  const maxCache = agentDef.maxCacheTokens ?? 0;
  const cacheReadDirect = result.cost?.cacheReadTokens;
  if (cacheCapExceeded(cacheReadDirect, maxCache)) {
    console.log(`[${agentId}] 캐시 토큰 임계 초과 (${(cacheReadDirect! / 1_000_000).toFixed(1)}M > ${maxCache / 1_000_000}M) → 세션 리셋`);
    auditLog("cache.reset", { agentId, jobId, cacheReadTokens: cacheReadDirect, capTokens: maxCache, path: "direct" });
    clearPmSession(agentId);
    addGenieMessage(`🔄 ${agentDef.name}이(가) 피곤(토큰초과)해서 기분전환(세션리셋) 했습니다.`);
  }

  return finalizeWorkerResult(agentDef, config, adapter, result, jobId, cwd, onProgress, projectName);
}

// --- 큐 처리 (같은 에이전트는 순차, 다른 에이전트끼리 병렬) ---

export function getAgentCurrentJob(agentId: string): { id: string; request: string } | undefined {
  const lease = leases.get(agentId);
  if (!lease) return undefined;
  const job = jobs.get(lease.jobId);
  if (!job) return undefined;
  return { id: job.id, request: job.request };
}

function resolveAgent(job: Job): string {
  // multi-stage: 현재 stage의 에이전트 반환
  if (job.stageAgents && job.stageAgents.length > 0) {
    const idx = job.currentStage ?? 0;
    return job.stageAgents[Math.min(idx, job.stageAgents.length - 1)];
  }
  if (job.agent) return job.agent;
  if (!job.request) {
    console.error(`[Jobs] resolveAgent: job.request 누락 — jobId=${job.id?.slice(0, 8) ?? "<no-id>"}`);
    return "unassigned";
  }
  const agent = routeToAgent(job.request, job.projectName);
  return agent?.id ?? "unassigned";
}

let queueProcessing = false;

export function triggerProcessQueue(): void {
  setTimeout(() => processQueue(), 0);
}

/**
 * 상류 한도로 지연된 잡인가 — 종결 처리(완료시각·보고·아카이브·자동진행)를 건너뛸 단일 기준.
 * 이 판정을 호출부마다 따로 쓰지 않는 이유: 기준이 갈라지면 어떤 경로는 지연 잡을 '완료'로 보고한다.
 */
export function isDeferredForLimit(job: Job): boolean { // 테스트 노출
  return job.status === "queued" && typeof job.deferredUntilMs === "number";
}

/**
 * 상류(Anthropic) 세션/사용 한도면 잡을 지연 재개 상태로 돌린다.
 * ★ 조립 지점을 하나로 모은다 — 계획 게이트·재시도 catch·성공 경로가 각자 판단하면 우선순위가 조용히 갈라진다.
 * @param source Error 또는 워커 결과 문자열 (어느 쪽이든 같은 판정)
 * @returns 지연시켰으면 true. false면 호출부는 기존 failed 경로를 그대로 탄다.
 */
export function deferJobForUpstreamLimit(job: Job, source: unknown, log: (line: string) => void): boolean { // 테스트 노출
  const hit = detectUpstreamLimitFrom(source);
  if (!hit) return false;

  const count = (job.deferCount ?? 0) + 1;
  if (count > MAX_DEFERRALS) {
    log(`[지연 상한] 상류 세션 한도 ${MAX_DEFERRALS}회 초과 — 기존대로 실패 처리합니다`);
    auditLog("job.defer_exhausted", { jobId: job.id, deferCount: count });
    return false;
  }

  job.deferCount = count;
  job.deferredUntilMs = hit.resumeAtMs;
  job.status = "queued";
  job.error = undefined;
  log(`[지연] 상류 세션 한도 — ${formatResumeAt(hit.resumeAtMs)} 이후 자동 재개 (${count}/${MAX_DEFERRALS}) · 원문: ${hit.message}`);
  auditLog("job.deferred", {
    jobId: job.id,
    resumeAt: new Date(hit.resumeAtMs).toISOString(),
    deferCount: count,
  });
  return true;
}

/** 지연된 잡을 큐로 되돌린다. 중복 적재를 막고, 종결 이벤트(emitDone) 없이 상태만 알린다. */
function requeueDeferredJob(job: Job): void {
  if (!queue.includes(job.id)) queue.push(job.id);
  job.childPid = undefined;
  saveJobs();
  emitGlobalEvent("job-update", { id: job.id, status: job.status, request: job.request });
}

async function processQueue(): Promise<void> {
  if (queueProcessing) return;
  queueProcessing = true;

  try {
    while (runningCount < MAX_CONCURRENT && queue.length > 0) {
      const idx = queue.findIndex((id) => {
        const j = jobs.get(id);
        if (!j) return false;
        // 상류 한도로 지연된 잡은 재개 시각 전까지 건너뜀 (한도 소진 = 재시도 대상)
        if (j.deferredUntilMs && j.deferredUntilMs > Date.now()) return false;
        // 에이전트가 바쁘면 건너뜀
        if (leases.has(resolveAgent(j))) return false;
        // 선행 작업이 완료되지 않았으면 건너뜀
        if (j.afterJobId) {
          const dep = jobs.get(j.afterJobId);
          if (!dep || dep.status !== "completed") return false;
        }
        return true;
      });
      if (idx === -1) break;

      const jobId = queue.splice(idx, 1)[0];
      const job = jobs.get(jobId);
      if (!job) continue;
      const agentId = resolveAgent(job);
      const agentDefForLease = getWorkerAgent(agentId);
      const isInteractiveLease = (agentDefForLease ? resolveWorkerRuntime(agentDefForLease).adapter : "claude-code") === "claude-code";
      acquireLease(agentId, jobId, isInteractiveLease);
      runningCount++;

      processJob(jobId).finally(() => {
        const finishedJob = jobs.get(jobId);
        const status = finishedJob?.status;
        const reason = status === "completed" ? "completed" as const : "failed" as const;
        // multi-stage: 마지막 stage의 에이전트 lease 해제
        const currentAgentId = finishedJob ? resolveAgent(finishedJob) : agentId;
        if (leases.get(currentAgentId)?.jobId === jobId) {
          releaseLease(currentAgentId, reason);
        }
        // 첫 에이전트와 다른 경우 첫 것도 정리 (안전장치)
        if (currentAgentId !== agentId && leases.get(agentId)?.jobId === jobId) {
          releaseLease(agentId, reason);
        }
        runningCount--;
        // 다음 tick에서 큐 처리 (queueProcessing 락 해제 후 실행 보장)
        setTimeout(() => processQueue(), 0);
      });
    }
  } finally {
    queueProcessing = false;
  }
}

function buildStageRequest(job: Job, stageIdx: number): string {
  const stages = job.stages!;
  const results = job.stageResults ?? [];
  const lines: string[] = [];
  lines.push(`[파이프라인 작업 — ${stages[stageIdx]} 단계 (${stageIdx + 1}/${stages.length})]`);
  lines.push(`원본 요청: ${job.request}`);
  lines.push("");
  if (results.length > 0) {
    lines.push("이전 단계 결과:");
    for (let i = 0; i < results.length; i++) {
      lines.push(`--- ${stages[i]} ---`);
      lines.push(results[i].slice(0, 3000));
      lines.push("");
    }
  }
  lines.push("위 결과를 바탕으로 이 단계의 작업을 수행하세요.");
  return lines.join("\n");
}

async function processJob(jobId: string): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) {
    console.error(`[Jobs] processJob: job not found — jobId=${jobId.slice(0, 8)}`);
    return;
  }

  job.status = "running";
  job.startedAt = new Date().toISOString();
  job.deferredUntilMs = undefined; // 재개했으므로 지연 마커 해제 (deferCount는 상한 관리를 위해 유지)
  const startedAgentId = resolveAgent(job);
  auditLog("job.started", { jobId: job.id, agent: startedAgentId });
  emitGlobalEvent("job-update", { id: job.id, status: "running", request: job.request });
  // 큐에서 꺼내 실행 시작 — 비-gate 워커도 즉시 working 전이
  transitionTodosForJob(job.id, "working", "작업 시작");
  // 담당 에이전트 표시명을 todo에 영구 저장 — jobs store 정리 후에도 "미배정"으로 안 떨어지게.
  if (startedAgentId && startedAgentId !== "unassigned") {
    const startedAgentName = getAllWorkerAgents().find((a) => a.id === startedAgentId)?.name || startedAgentId;
    setTodoAgentNameForJob(job.id, startedAgentName);
  }

  const originalLog = console.log;
  const originalError = console.error;

  const MAX_LOG_LINES = 500;
  const NOISE_PREFIXES = ["[Tunnel]", "[Scheduler]", "[MyCrew]", "[GenieQueue]", "[Server]", "[Conv]", "[Librarian]"];
  const capture = (original: typeof console.log, ...args: unknown[]) => {
    const line = args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ");
    // 서버 잡음만 제외, 나머지는 모두 로그에 저장
    if (!NOISE_PREFIXES.some(p => line.startsWith(p))) {
      job.logs.push(line);
      if (job.logs.length > MAX_LOG_LINES) job.logs.splice(0, job.logs.length - MAX_LOG_LINES);
      emitLog(job.id, line);
    }
    original.apply(console, args);
  };

  console.log = (...args: unknown[]) => capture(originalLog, ...args);
  console.error = (...args: unknown[]) =>
    capture(originalError, "[ERROR]", ...args);

  const MAX_RETRIES = 3;
  let lastError = "";
  // 상류 한도로 지연 재개 상태가 됐는가 — 종결 처리(분류·보고·아카이브)를 전부 건너뛰기 위한 플래그
  let deferred = false;

  try {
    // multi-stage 파이프라인: stageAgents가 있으면 단계별 에이전트 자동 교체
    if (job.stageAgents && job.stageAgents.length > 0 && job.stages && job.stages.length > 0) {
      if (!job.stageResults) job.stageResults = [];

      for (let stageIdx = job.currentStage ?? 0; stageIdx < job.stages.length; stageIdx++) {
        const stageAgentIdOrName = job.stageAgents[Math.min(stageIdx, job.stageAgents.length - 1)];
        // id 또는 이름으로 에이전트 찾기
        const effectiveAgent = getWorkerAgent(stageAgentIdOrName)
          || getAllWorkerAgents().find((a) => a.name === stageAgentIdOrName)
          || getDefaultAgent();
        if (!effectiveAgent) throw new Error("에이전트를 찾을 수 없습니다");
        const stageAgentId = effectiveAgent.id;

        // lease 교체: 다른 에이전트로 넘어갈 때만
        if (stageIdx > 0) {
          const prevIdOrName = job.stageAgents[Math.min(stageIdx - 1, job.stageAgents.length - 1)];
          const prevAgent = getWorkerAgent(prevIdOrName) || getAllWorkerAgents().find((a) => a.name === prevIdOrName);
          const prevAgentId = prevAgent?.id || prevIdOrName;
          if (prevAgentId !== stageAgentId) {
            releaseLease(prevAgentId, "completed");
            const isInteractiveStage = resolveWorkerRuntime(effectiveAgent).adapter === "claude-code";
            acquireLease(stageAgentId, jobId, isInteractiveStage);
          }
        }

        job.currentStage = stageIdx;
        saveJobs();
        advanceTodoStageForJob(job.id, stageIdx);

        // '계획수립'/'승인대기' stage는 UI 표시용 — 실제 실행은 다음 본 stage의 planGate에서 처리
        const stageName = job.stages[stageIdx];
        if (stageName === "계획수립" || stageName === "승인대기") {
          capture(originalLog, `[파이프라인] ${stageName} 단계 (시스템 자동)`);
          job.stageResults!.push(`(${stageName})`);
          continue;
        }

        capture(originalLog, `[파이프라인] ${stageName} 단계 → ${effectiveAgent.name}`);

        let stageRequest = stageIdx === 0 ? job.request : buildStageRequest(job, stageIdx);
        if (stageIdx === 0 && job.attachments?.length) {
          const paths = job.attachments.map((p: string) => `  - ${p}`).join("\n");
          stageRequest += `\n\n첨부된 이미지를 Read 도구로 확인하세요:\n${paths}`;
        }

        // 재시도 루프 (단계별)
        let stageResult = "";
        let stageFailed = false;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            transitionTodosForJob(job.id, "working", `[${job.stages[stageIdx]}] ${effectiveAgent.name} 작업 시작`);
            stageResult = await runWorkerAgent(effectiveAgent, stageRequest, job.projectName, job.id, job.cwd);
            // 워커가 '성공'으로 돌아왔지만 본문이 한도 통지뿐인 경우 (2026-08-17 cfdb89e6: result 전문 55자)
            const stageLimit = detectUpstreamLimit(stageResult);
            if (stageLimit) throw new UpstreamLimitError(stageLimit);

            // post-validation
            if (effectiveAgent.postValidation?.length) {
              const validationCwd = job.cwd
                || (job.projectName && SELF_NAMES.has(job.projectName.toLowerCase()) ? PROJECT_SELF_DIR : undefined)
                || (job.projectName ? resolveProjectCwd(job.projectName) : undefined);
              for (const cmd of effectiveAgent.postValidation) {
                capture(originalLog, `[검증] ${cmd}`);
                const skipReason = validationSkipReason(validationCwd, cmd);
                if (skipReason) {
                  capture(originalLog, `[검증 스킵] ${cmd} — ${skipReason}`);
                  continue;
                }
                const output = await execBash(cmd, validationCwd);
                if (output.includes("[에러]") || output.includes("error TS") || output.includes("ERR!") || output.includes("FAILED")) {
                  capture(originalLog, `[검증 실패] ${output.slice(0, 500)}`);
                  throw new Error(`post-validation 실패: ${cmd}\n${output.slice(0, 300)}`);
                }
                capture(originalLog, `[검증 통과] ${cmd}`);
              }
            }

            stageFailed = false;
            break;
          } catch (err) {
            lastError = err instanceof Error ? err.message : String(err);
            // 상류 한도는 작업 결함이 아니다 — 재시도를 소모하지 않고 즉시 지연 재개로 이탈
            if (deferJobForUpstreamLimit(job, err, (line) => capture(originalLog, line))) {
              deferred = true;
              break;
            }
            if (attempt === MAX_RETRIES) {
              stageFailed = true;
            }
          }
        }

        if (deferred) break;

        if (stageFailed) {
          job.status = "failed";
          job.error = `[${job.stages[stageIdx]}] ${lastError}`;
          auditLog("job.failed", { jobId: job.id, error: lastError.slice(0, 300), stage: stageIdx });
          transitionTodosForJob(job.id, "failed", `[${job.stages[stageIdx]}] ${lastError.slice(0, 50000)}`);
          break;
        }

        job.stageResults!.push(stageResult);
        capture(originalLog, `[파이프라인] ${job.stages[stageIdx]} 완료`);
      }

      // 모든 stage 성공
      if (!deferred && job.status !== "failed") {
        const finalResult = job.stageResults!.join("\n\n---\n\n");
        
        // QA 보고서 구조개선 ①: exit + stderr + stdout 종합 분류
        const classified = classifyExit(finalResult, job.logs, true, undefined, job.skipOutput === true); // agentSuccess=true (multi-stage 성공)
        job.status = classified.status;
        
        // Stage 1: 워커 결과 품질 검사 (delegation_only 감지)
        const quality = classifyWorkerResultQuality(finalResult);
        if (quality === "delegation_only") {
          capture(originalLog, `[워커 품질] delegation_only 감지 — 위임만 하고 실제 결과 미포함`);
          console.warn(`[잡 ${job.id.slice(0, 8)}] delegation_only: 워커가 위임만 하고 완료 보고를 누락했습니다`);
        } else if (quality === "empty") {
          capture(originalLog, `[워커 품질] empty 감지 — 빈 응답`);
          console.warn(`[잡 ${job.id.slice(0, 8)}] empty: 워커가 빈 응답을 반환했습니다`);
        }
        
        if (classified.reason) {
          capture(originalLog, `[분류] ${classified.status} — ${classified.reason}`);
        }
        
        if (job.status === "outputs_missing") {
          const note = `outputs_missing: ${classified.reason || "보고 형식 누락"}`;
          capture(originalLog, `[outputs_missing] ${note}`);
          console.warn(`[잡 ${job.id.slice(0, 8)}] ${note}`);
          auditLog("job.outputs_missing", { jobId: job.id, reason: classified.reason, stages: job.stages.length });
        } else if (job.status === "completed") {
          auditLog("job.completed", { jobId: job.id, stages: job.stages.length });
        } else if (job.status === "failed") {
          auditLog("job.failed", { jobId: job.id, reason: classified.reason, stages: job.stages.length });
        }
        
        job.fullResult = finalResult;
        capture(originalLog, `[결과] ${finalResult.slice(0, 8000)}`);
        transitionTodosForJob(job.id, "reporting", finalResult.slice(0, 50000));
      }
    } else {
      // 단일 에이전트 기존 경로
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          let request = job.request;
          if (job.attachments?.length) {
            const paths = job.attachments.map((p) => `  - ${p}`).join("\n");
            request += `\n\n첨부된 이미지를 Read 도구로 확인하세요:\n${paths}`;
          }
          if (attempt > 1) {
            request += `\n\n⚠️ 이전 시도(${attempt - 1}번째)가 실패했습니다.\n에러: ${lastError}\n이 문제를 스스로 해결하고 작업을 완료하세요.`;
            capture(
              originalLog,
              `[재시도 ${attempt}/${MAX_RETRIES}] ${lastError.slice(0, 100)}`,
            );
          }

          // 지정 id가 미등록이면 getWorkerAgent가 undefined를 주고 || 로 폴백해 엉뚱한 직원에게
          // 배정되는데, 로그는 '(지정)'이라 찍혀 지정대로 간 것처럼 오도했다.
          // (2026-08-08 잡 3fce5e94: agent="backend"(미등록) → AX컨설턴트 배정 → 워커가 자기 잡을
          //  '백엔드가 돌리는 다른 잡'으로 오인) 지정이 실제로 먹혔는지 구분해 남긴다.
          const pinnedAgent = job.agent ? getWorkerAgent(job.agent) : undefined;
          if (job.agent && !pinnedAgent) {
            capture(originalLog, `[라우팅] 경고: 지정 id "${job.agent}" 미등록 — 자동 라우팅으로 폴백`);
          }
          const agent = pinnedAgent
            || routeToAgent(request, job.projectName)
            || getDefaultAgent();
          if (!agent) throw new Error("에이전트를 찾을 수 없습니다 (agents.json 확인 필요)");
          const routeNote = pinnedAgent ? " (지정)" : job.agent ? ` (지정 "${job.agent}" 미등록 → 자동)` : "";
          capture(originalLog, `[라우팅] ${agent.name}에게 배정${routeNote}`);
          const agentT = agent as typeof agent & { modelTier?: ModelTier };
          const jobT = job as Job & { model?: string; escalatedTier?: boolean; escalatedFromModel?: string; escalatedToModel?: string };
          // 모델 티어 자동 승격: 첫 재시도(attempt===2)에서 1회만 적용 — jobT.escalatedTier로 상한 관리.
          // 대상: 호출자가 job.model을 명시하지 않았고(=DelegateTask model override 없음), 에이전트도
          // 하드코딩 model이 아닌 modelTier(cheap/standard)로 해석되는 경우만. 이미 frontier거나 명시적
          // model이면 승격할 여지가 없으므로 스킵(무한 승격 방지는 escalatedTier 플래그가 담당).
          if (attempt === 2 && !jobT.escalatedTier && !jobT.model && !agent.model && agentT.modelTier && agentT.modelTier !== "frontier") {
            const fromModel = resolveTier(agentT.modelTier);
            const escalated = escalateTier(agentT.modelTier);
            const toModel = resolveTier(escalated);
            jobT.model = toModel;
            jobT.escalatedTier = true;
            jobT.escalatedFromModel = fromModel;
            jobT.escalatedToModel = toModel;
            const note = `[ModelTier] ${agent.name} 작업 재시도 — ${agentT.modelTier}(${fromModel}) 실패 → ${escalated}(${toModel})으로 승격`;
            console.log(note);
            capture(originalLog, note);
          }

          transitionTodosForJob(job.id, "working", "작업 시작");
          const taskResult = await runWorkerAgent(agent, request, job.projectName, job.id, job.cwd);
          // 워커가 '성공'으로 돌아왔지만 본문이 한도 통지뿐인 경우 (2026-08-17 cfdb89e6: result 전문 55자)
          const taskLimit = detectUpstreamLimit(taskResult);
          if (taskLimit) throw new UpstreamLimitError(taskLimit);

          // post-validation gate
          if (agent.postValidation?.length) {
            const validationCwd = job.cwd
              || (job.projectName && SELF_NAMES.has(job.projectName.toLowerCase()) ? PROJECT_SELF_DIR : undefined)
              || (job.projectName ? resolveProjectCwd(job.projectName) : undefined);

            for (const cmd of agent.postValidation) {
              capture(originalLog, `[검증] ${cmd}`);
              const skipReason = validationSkipReason(validationCwd, cmd);
              if (skipReason) {
                capture(originalLog, `[검증 스킵] ${cmd} — ${skipReason}`);
                continue;
              }
              const output = await execBash(cmd, validationCwd);
              if (output.includes("[에러]") || output.includes("error TS") || output.includes("ERR!") || output.includes("FAILED")) {
                capture(originalLog, `[검증 실패] ${output.slice(0, 500)}`);
                throw new Error(`post-validation 실패: ${cmd}\n${output.slice(0, 300)}`);
              }
              capture(originalLog, `[검증 통과] ${cmd}`);
            }
          }

          {
            // QA 보고서 구조개선 ①: exit + stderr + stdout 종합 분류
            const classified = classifyExit(taskResult, job.logs, true, undefined, job.skipOutput === true); // agentSuccess=true (try 안 성공)
            job.status = classified.status;
            
            // Stage 1: 워커 결과 품질 검사 (delegation_only 감지)
            const quality = classifyWorkerResultQuality(taskResult);
            if (quality === "delegation_only") {
              capture(originalLog, `[워커 품질] delegation_only 감지 — 위임만 하고 실제 결과 미포함`);
              console.warn(`[잡 ${job.id.slice(0, 8)}] delegation_only: 워커가 위임만 하고 완료 보고를 누락했습니다`);
            } else if (quality === "empty") {
              capture(originalLog, `[워커 품질] empty 감지 — 빈 응답`);
              console.warn(`[잡 ${job.id.slice(0, 8)}] empty: 워커가 빈 응답을 반환했습니다`);
            }
            
            if (classified.reason) {
              capture(originalLog, `[분류] ${classified.status} — ${classified.reason}`);
            }
            
            if (job.status === "outputs_missing") {
              const note = `outputs_missing: ${classified.reason || "보고 형식 누락"}`;
              capture(originalLog, `[outputs_missing] ${note}`);
              console.warn(`[잡 ${job.id.slice(0, 8)}] ${note}`);
              auditLog("job.outputs_missing", { jobId: job.id, reason: classified.reason, attempt });
            } else if (job.status === "completed") {
              auditLog("job.completed", { jobId: job.id, attempt });
            } else if (job.status === "failed") {
              auditLog("job.failed", { jobId: job.id, reason: classified.reason, attempt });
            }
          }
          job.fullResult = taskResult;
          capture(originalLog, `[결과] ${taskResult.slice(0, 8000)}`);
          transitionTodosForJob(job.id, "reporting", taskResult.slice(0, 50000));
          break;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          // 상류 한도는 작업 결함이 아니다 — 재시도를 소모하지 않고 즉시 지연 재개로 이탈
          if (deferJobForUpstreamLimit(job, err, (line) => capture(originalLog, line))) {
            deferred = true;
            break;
          }
          if (attempt === MAX_RETRIES) {
            job.status = "failed";
            job.error = lastError;
            auditLog("job.failed", { jobId: job.id, error: lastError.slice(0, 300), attempts: MAX_RETRIES });
            transitionTodosForJob(job.id, "failed", lastError.slice(0, 50000));
          }
        }
      }
    }
  } finally {
    console.log = originalLog;
    console.error = originalError;
    if (isDeferredForLimit(job)) {
      // ★ 종결이 아니다. 완료시각·보고·아카이브·자동진행을 전부 건너뛰고 큐로 되돌린다.
      //   여기서 종결 처리를 태우면 지연 잡이 '실패'로 마이크루에 보고되어(processCallback status=failed)
      //   같은 오독(한도=결함)이 한 층 아래에서 재현된다.
      requeueDeferredJob(job);
    } else {
      await finalizeTerminalJob(job);
    }
  }
}

/**
 * 잡 종결 처리 — 완료시각 기록·지표·아카이브·콜백·자동 재시작·자동 진행.
 * processJob의 finally에서 분리했다: 상류 한도 지연(queued 복귀) 경로가 이 블록 전체를 건너뛰어야 하는데,
 * 개별 부작용마다 조건을 다는 방식은 하나만 빠뜨려도 지연 잡이 '완료/실패'로 새어나간다.
 */
async function finalizeTerminalJob(job: Job): Promise<void> {
  { // (블록 유지 — 아래 본문은 finally에서 그대로 옮겨온 것이라 들여쓰기·diff를 보존한다)
    job.completedAt = new Date().toISOString();
    job.childPid = undefined; // fix B: 정상 종료 → PID stale 방지
    saveJobs();
    emitDone(job.id);
    
    // 재시도 가드: 작업 결과 기록 (성공/실패)
    const success = job.status === "completed" || job.status === "outputs_missing";
    recordRetryAttempt(job.request, success);

    // 지표(metrics) 기록 — 모델 티어 변경 효과 측정용 (v1: approvalOverride는 값싼 연결 수단이 없어 "none" 고정).
    // status가 terminal 3종(completed/outputs_missing/failed) 외의 값(paused 등)으로 남는 경로는 없음 —
    // processJob 진입 시 이미 running으로 세팅되고, 위 로직이 반드시 셋 중 하나로 전이시킨다.
    if (job.status === "completed" || job.status === "outputs_missing" || job.status === "failed") {
      const jobT = job as Job & { model?: string; escalatedTier?: boolean; escalatedFromModel?: string; escalatedToModel?: string };
      const startedMs = job.startedAt ? Date.parse(job.startedAt) : NaN;
      const completedMs = job.completedAt ? Date.parse(job.completedAt) : Date.now();
      const metricAgentId = resolveAgent(job);
      // jobType은 에이전트 정의의 직군 카테고리(developer/researcher/qa/general)만 기록.
      // job.taskTitle은 사용자 자유 텍스트라 요청 원문이 새어들어감 — 지표는 이벤트만 남기고
      // 내용은 저장하지 않는다는 원칙(PIPA 대응)에 따라 절대 사용하지 않는다.
      const metricJobType = getWorkerAgent(metricAgentId)?.jobType ?? "general";
      recordJobMetric({
        jobId: job.id,
        agentId: metricAgentId,
        model: jobT.model,
        jobType: metricJobType,
        status: job.status,
        durationMs: Number.isNaN(startedMs) ? 0 : Math.max(0, completedMs - startedMs),
        costUsd: job.costUsd,
        // job.totalTokens는 addCostToJob()에서 input+output 합산으로만 누적되어 개별 값을 분리 보관하지 않음
        // (v1 한계 — 필요 시 jobs.ts의 addCostToJob에 job.inputTokens/outputTokens 필드를 추가해 분리 가능).
        // 여기서는 합산값을 totalTokens 필드 대신 inputTokens에 넣지 않고, summarize()의 비용/건수 지표가
        // 주요 판단 축이므로 토큰 필드는 0/0으로 두고 costUsd로 대체 근사한다.
        inputTokens: 0,
        outputTokens: 0,
        retried: (job.resubmitCount ?? 0) > 0,
        approvalOverride: "none",
        escalatedFrom: jobT.escalatedTier ? jobT.escalatedFromModel : undefined,
        escalatedTo: jobT.escalatedTier ? jobT.escalatedToModel : undefined,
      });
    }
    
    archiveJob(job);
    emitGlobalEvent("job-update", { id: job.id, status: job.status, request: job.request });

    // 산출물 파일 감지
    job.outputFiles = extractOutputFiles(job);
    if (job.outputFiles.length) saveJobs();

    // 완료 토스트 = task-notification 자동 생성 (callback 일원화 진입점)
    // 내부 작업은 processCallback 직접 호출 (HTTP self-call 회피, 외부와 동일 함수 일원화)
    processCallback({
      jobId: job.id,
      status: job.status === "completed"
        ? "completed"
        : job.status === "outputs_missing"
          ? "outputs_missing"
          : "failed",
      output: extractPreview(job),
      error: job.error,
      completedAt: job.completedAt ?? new Date().toISOString(),
      agent: job.agent,
      external: false,
    });

    // self 프로젝트 dev-pm 작업 완료 시 → 다음 자동 진행 직전 자동 RESTART pending
    // (관련: chat.ts setSelfRestartPending / tryAutoRestart — 2026-04-30 사장님 수동 재부팅 제거)
    const jobIsSelf = job.projectName
      ? SELF_NAMES.has(job.projectName.toLowerCase())
      : false;
    if (jobIsSelf && (job.agent === "dev-pm" || job.selfRestart === true) && (job.status === "completed" || job.status === "outputs_missing")) {
      try {
        const chat = await import("./chat.js");
        chat.setSelfRestartPending(true);
      } catch (err) {
        console.error("[Self] selfRestartPending 설정 실패:", err);
      }
    }

    // 자동 진행 모드: 마이크루를 재호출해서 다음 단계 이어가게 함
    setTimeout(async () => {
      try {
        const chat = await import("./chat.js");
        // 모드/한도 체크는 trigger 내부에서 수행 — 한도 도달 시 사용자 안내 발화 포함
        const status = job.status === "completed" ? "completed" : "failed";
        await chat.triggerGenieAutoContinuation(job.request, status);
      } catch (err) {
        console.error("[MyCrew] 자동 진행 실패:", err);
      }
    }, 1500);

    pruneJobs();
  }
}

// [2026-08-24 제거] looksLikeQaRequest — 요청문 어휘로 QA 를 발동하던 축.
//   정규식이 `\bQA\b|검증|테스트|점검|리뷰|review|verify|품질검사` 였는데 한국어 지시서 거의 전부에
//   「검증」이 들어간다. 사실상 상시 참이라 «조건»으로 기능하지 못했다.
//   명시 요청은 job.forceQa 로 받는다 — 어휘 추정이 아니라 호출자가 세우는 깃발이다.
//   (되살리려면 여기가 아니라 qa-trigger-policy.ts 에 넣고 음성 대조를 짝으로 짜라.)

// 자동 QA «표본» 시각 저장소 — 코드 변경 0건 잡도 주 1회는 돌린다(완전히 끄지 않는다).
// 에이전트별 마지막 표본 시각만 담는 작은 파일. 판정 자체는 qa-trigger-policy.ts 가 한다.
const QA_SAMPLE_FILE = join(HISTORY_DIR, "qa-sample-state.json");
function readQaSampleState(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(QA_SAMPLE_FILE, "utf-8")) as Record<string, string>;
  } catch {
    return {};
  }
}
function readQaSampleAt(agentId: string): string | null {
  return readQaSampleState()[agentId] ?? null;
}
function markQaSampled(agentId: string): void {
  try {
    const s = readQaSampleState();
    s[agentId] = new Date().toISOString();
    writeFileSync(QA_SAMPLE_FILE, JSON.stringify(s, null, 2), "utf-8");
  } catch (e) {
    console.error("[AutoQA] 표본 시각 저장 실패:", e);
  }
}

// 코드 변경 감지 — cwd 워킹트리의 «코드 파일 미커밋 변경 경로 집합»을 돌려준다.
//
// ★ 2026-08-24 정정. 이전 판은 boolean 을 돌려주는 hasCodeChanges 였고 «레포 전체»를 봤다.
//   그 잡이 무엇을 바꿨는지와 무관했다 — 이 레포에는 진단 스크립트 등 미추적 코드 파일이 상시
//   수십 개 있어 사실상 모든 잡에서 영구히 true 였다. 그래서 「코드 변경 0건」 잡에도 자동 QA 가
//   붙어 tsc·lint·unit 3항목을 N/A 로 처리하며 돌았다(2026-08-23 실측).
//   ⇒ 집합을 돌려주고, 잡 시작 시점 스냅샷과의 «차집합»으로 잡 범위 판정을 한다.
//   git 없거나 실패 시 null — 「변경 없음(빈 배열)」과 구분해야 한다. null 은 판정 불가이고,
//   판정 불가의 기본값은 안전측(QA 수행)이다. 빈 배열로 뭉개면 조용히 QA 가 꺼진다.
const CODE_CHANGE_RE = /\.(ts|tsx|js|jsx|mjs|cjs|py|css|scss|less|html|vue|svelte|go|rs|java|kt|swift|rb|php|sql|sh|json|yaml|yml)$/i;

// ★ QA 2회차 P2-a — codeBaseline "최초 1회만 고정" 계약. 이미 값이 있으면 손대지 않는다(undefined일
// 때만 채운다). acquireLease가 스테이지 전환마다 재호출돼도 이전 스테이지의 기준선이 보존된다.
export function assignCodeBaselineOnce(existing: string[] | undefined, snapshot: string[] | null): string[] | undefined {
  return existing ?? (snapshot ?? undefined);
}
// ★ 2026-08-24 QA 2회차 P1·P2-a·P3-b 시정. 경로 문자열만 비교하면 두 경로가 샌다:
//   R1) lease 시점에 이미 더러운 파일을 그 잡이 "더" 고쳐도 경로 집합은 그대로 → 차집합 0
//   R2) 그 잡이 고치고 커밋해 워킹트리에서 경로가 사라져도 → 차집합 0 (규율 있게 커밋할수록 QA를 피함)
//   ⇒ 경로 대신 "<path>\t<mtimeMs>\t<size>" 지문을 비교한다. 재수정(R1)은 mtime/size가 바뀌어 새 지문으로
//   잡히고, 커밋(R2)은 HEAD 센티널("\0HEAD\t<rev>")이 바뀌어 잡힌다. newCodeChanges는 문자열 집합 차집합만
//   하므로 이 지문 문자열도 그대로 통과한다(qa-trigger-policy.ts:110).
//   -c core.quotepath=false 는 P3-b(비ASCII 경로가 8진 이스케이프로 인용돼 정규식 $ 앵커를 놓치는 잠재
//   함정) 예방 — 현재 발현 사례는 0건이지만 QA가 잠재 함정으로 남긴 것을 여기서 막는다.
function snapshotCodeChanges(cwd: string | undefined): string[] | null {
  const dir = cwd || process.cwd();
  try {
    const head = spawnSync("git", ["-C", dir, "-c", "core.quotepath=false", "rev-parse", "HEAD"], {
      encoding: "utf-8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"],
    });
    if (head.status !== 0 || typeof head.stdout !== "string") return null;
    const out = spawnSync("git", ["-C", dir, "-c", "core.quotepath=false", "status", "--porcelain"], {
      encoding: "utf-8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"],
    });
    if (out.status !== 0 || typeof out.stdout !== "string") return null;
    const fingerprints: string[] = [`\0HEAD\t${head.stdout.trim()}`];
    for (const line of out.stdout.split("\n")) {
      // porcelain: "XY <path>" (rename은 "orig -> new") — 경로 부분만 추출해 확장자 검사
      const p = line.slice(3).trim().split(" -> ").pop() ?? "";
      if (!p || !CODE_CHANGE_RE.test(p)) continue;
      const abs = isAbsolute(p) ? p : join(dir, p);
      try {
        const st = statSync(abs);
        fingerprints.push(`${p}\t${st.mtimeMs}\t${st.size}`);
      } catch {
        // 삭제된 파일 등 stat 불가 — 경로만으로 지문화(그래도 상태 변화가 잡힘)
        fingerprints.push(`${p}\t-\t-`);
      }
    }
    return fingerprints.sort();
  } catch {
    return null;
  }
}

// [2026-08-10] 확장자 절단 결함 수정. 기존 정규식은 후행 경계가 없고 jsonl이 미등재라
//   seen.jsonl → seen.json, crew-post-*.json.posted → *.json 으로 잘려 디스크에 없는
//   유령 경로를 만들었다(.posted 26건 실재). 소비처가 표시·전달 4곳이라 링크가 깨지고
//   QA 핸드오프(§산출물 파일)를 stat하면 오탐 FAIL이 났다.
//   확장자 목록·경계 규약은 ./utils/artifact-ext.ts 단일 소스로 이관 — 08-08 qa-auto-judge.ts와 공유.
// [2026-10-05 핫픽스, 잡 938bbcb0] 읽기 전용 참조 경로가 '산출물'로 승격되는 결함 차단.
//   extractOutputPathsFromText는 라벨을 보지 않고 로그 본문에서 history/… 경로를 통째로 긁으므로
//   워커가 «읽기만» 한 경로도 산출물이 된다. 그게 QA «판정 대상 고정»으로 넘어가 4일 전 종결호를
//   피검체로 만들어 FAIL을 유발했다. 기전·근거는 isArtifactModifiedSince 주석에 전부 남겼다.
//   ⇒ 이 잡이 시작한 뒤 수정된 파일만 산출물로 인정한다(대응 검사).
function extractOutputFiles(job: Job): string[] {
  const files = new Set<string>();
  for (const log of job.logs) {
    for (const p of extractOutputPathsFromText(log)) files.add(p);
  }
  return [...files].filter((p) =>
    isArtifactModifiedSince(p, job.cwd || PROJECT_SELF_DIR, job.startedAt),
  );
}

function extractPreview(job: Job): string {
  const resultLine = job.logs.find((l) => l.startsWith("[결과]"));
  if (resultLine) {
    return resultLine.replace(/^\[결과\]\s*/, "").slice(0, 320);
  }
  const lastLog = job.logs.slice(-1)[0] ?? "";
  return lastLog.replace(/^\[.*?\]\s*/, "").slice(0, 320);
}

function emitJobCompleteToast(job: Job): void {
  const statusText = job.status === "failed" ? "실패" : "완료";
  const preview = extractPreview(job);
  const agentId = job.agent;
  const agentName = agentId ? getWorkerAgent(agentId)?.name : undefined;
  emitGlobalEvent("job-complete-toast", {
    id: job.id,
    status: job.status,
    request: job.request,
    preview,
    error: job.error,
    outputFiles: job.outputFiles,
    agentId,
    agentName,
  });
  // 대화 기록에만 저장 (SSE는 job-complete-toast가 처리, 리프레시 시 태그로 복원)
  const toastData = JSON.stringify({ id: job.id, status: job.status, request: job.request, preview, error: job.error, outputFiles: job.outputFiles });
  addGenieMessage(`<!--JOB_COMPLETE:${toastData}-->`, { internal: true, logOnly: true });
  // OpenViking 자기 진화 — 직원 Job 완료 시 daily 위키에 자동 누적 (fire-and-forget).
  void appendDailyWikiEntry(job).catch((e) => console.error("[AutoWiki] 실패:", e));
}

// === v2 위임 callback 일원화 (2026-04-29) ===
// task-notification 자동 생성 진입점. 내부/외부 모두 이 함수를 거쳐 일원화.
// - 내부: jobs.ts 작업 완료/lease 만료 → processCallback 직접 호출
// - 외부: POST /api/delegate/callback → routes.ts 핸들러 → processCallback 호출
const callbackProcessed = new Set<string>(); // jobId dedup (in-memory, selfRestart 후엔 첫 처리로 인식)

export function processCallback(payload: {
  jobId: string;
  status: "completed" | "failed" | "timeout" | "outputs_missing";
  output?: string;
  error?: string;
  completedAt: string;
  agent?: string;
  external?: boolean;
}): { dedup: boolean } {
  // jobId dedup
  if (callbackProcessed.has(payload.jobId)) {
    console.warn(`[Callback] 중복 callback 무시 (jobId=${payload.jobId.slice(0, 8)})`);
    return { dedup: true };
  }
  callbackProcessed.add(payload.jobId);
  // 1시간 후 dedup 키 정리 (메모리 누수 방지)
  setTimeout(() => callbackProcessed.delete(payload.jobId), 60 * 60 * 1000).unref?.();

  const job = jobs.get(payload.jobId);
  if (!job) {
    console.warn(`[Callback] jobId 없음: ${payload.jobId.slice(0, 8)} (외부 위임 또는 만료)`);
    // 외부/만료 작업: job 객체 없이도 task-notification 생성
    addGenieMessage(
      `<!--JOB_COMPLETE:${JSON.stringify({
        id: payload.jobId,
        status: payload.status,
        request: payload.output?.slice(0, 80) ?? "(외부 작업)",
        preview: payload.output?.slice(0, 320) ?? payload.error?.slice(0, 320) ?? "",
        error: payload.error,
      })}-->`,
      { internal: true, logOnly: true },
    );
    return { dedup: false };
  }

  // job 상태 update (timeout 등 외부 사유로 도달)
  if (job.status === "running" || job.status === "queued") {
    job.status = payload.status === "completed"
      ? "completed"
      : payload.status === "outputs_missing"
        ? "outputs_missing"
        : "failed";
    job.error = payload.error ?? (payload.status === "timeout" ? "lease 만료 (timeout)" : undefined);
    job.completedAt = payload.completedAt;
    saveJobs();
  }

  // 선행 실패 시 afterJobId 후속 자동 cancel (큐 stuck 방지)
  if (payload.status === "failed" || payload.status === "timeout" || payload.status === "outputs_missing") {
    let cascaded = 0;
    for (const j of jobs.values()) {
      if (j.afterJobId === payload.jobId && j.status === "queued") {
        const qIdx = queue.indexOf(j.id);
        if (qIdx !== -1) queue.splice(qIdx, 1);
        j.status = "failed";
        j.error = "선행 작업 실패로 자동 취소";
        j.completedAt = new Date().toISOString();
        cascaded++;
        auditLog("job.failed", { jobId: j.id, reason: "cascade", parent: payload.jobId });
        emitDone(j.id);
        emitGlobalEvent("job-update", { id: j.id, status: j.status, request: j.request });
        emitJobCompleteToast(j);
      }
    }
    if (cascaded > 0) saveJobs();

    // P1.4: 실패한 작업이 발급한 잔여 approval 자동 회수 (사장님 화면 stuck 방지)
    // jobId 매칭(P1.3)으로 필터. legacy approval(jobId 없음)은 자동 무시.
    try {
      const revokedIds = revokeRecentApprovals({ jobId: payload.jobId });
      if (revokedIds.length > 0) {
        console.log(`[Callback] 실패 작업 잔여 approval 회수: ${revokedIds.length}건 (jobId=${payload.jobId.slice(0, 8)})`);
      }
    } catch (err) {
      console.error("[Callback] approval 회수 실패:", err instanceof Error ? err.message : err);
    }
  }

  // task-notification = JOB_COMPLETE toast (사장님 시각 알림)
  emitJobCompleteToast(job);

  // 옵션 B — 직원 결과 즉시 표시 + 마이크루에게 비동기 알림 (2026-05-06 전환).
  // 사용자: 직원 요약을 바로 대시보드에 표시 (대기 없음).
  // 마이크루: 내부 메시지로 결과 전달 (응답 불필요, 후속 조치 판단용 컨텍스트).
  const resultLine = job.logs.find((l) => l.startsWith("[결과]"));
  const summary = (
    job.fullResult
    ?? (resultLine
      ? resultLine.replace(/^\[결과\]\s*/, "")
      : job.logs.slice(-3).join("\n"))
  ).slice(0, 4000);
  const firstLine = job.request.split("\n")[0].trim();
  const requestPreview = firstLine.length > 60 ? firstLine.slice(0, 60) + "…" : firstLine;
  const statusIcon = job.status === "completed" ? "📋" : "⚠️";
  const statusText = job.status === "completed" ? "완료" : "실패";

  // 1. 사용자에게 표시
  //    - 이 job을 만든 마이크루 턴이 아직 진행 중이면 대기 (순서 보장)
  //    - 다른 대화 중이면 즉시 표시 (불필요한 지연 방지)
  // 2. 마이크루에게 비동기 알림 (후속 조치 판단용)
  // 둘 다 async — 콜백 리턴을 블로킹하지 않음
  // 이 job을 만든 마이크루 턴이 아직 진행 중이면 대기, 아니면 즉시 표시
  const shouldWait = isGenieBusy() && job.genieTurnId === getGenieTurnId();
  (async () => {
    try {
      if (shouldWait) await waitForGenieIdle();
      addGenieMessage(`${statusIcon} "${requestPreview}" ${statusText}\n\n${summary}`);
      markJobReported(job.id);
      transitionTodosForJob(job.id, "done", `보고 완료: ${requestPreview}`);
    } catch (err) {
      console.error("[Job] 사용자 표시 실패:", err);
    }
    // 마이크루 알림 — 사용자 표시 후 순차 전달.
    // job-notify 게이팅(P2 토큰 절감, 2026-07-09): "할 일 없으면 응답하지 마세요" 지시를 지키기 위해서도
    // 지니는 풀 턴(캐시 재작성 포함, 실측 ~$1+/턴)을 소비한다. 실패/TODO연계/승인연계/에러 키워드 등
    // "항상 알려야 하는" 케이스는 그대로 즉시 통과시키고, 그 외 사소한 성공 잡은 저비용 사전 필터로 거른다.
    // 필터가 "알림 불필요"로 판단하면 지니 턴 자체를 생략(로그만 남김) — fail-safe는 항상 "알림" 쪽.
    void (async () => {
      try {
        const { decideJobNotify, enqueueBatchedNotify, formatBatchedGenieNotice, notifySourceForBatch } = await import("./job-notify-gate.js");
        const isTodoLinked = getTodosByJobId(job.id).length > 0;
        const approvalsMod = await import("./approvals.js") as { hasApprovalHistory?: (jobId: string) => boolean };
        const isApprovalGated = approvalsMod.hasApprovalHistory?.(job.id) ?? false;
        const decision = await decideJobNotify({
          jobId: job.id,
          status: job.status === "completed" ? "completed" : job.status === "outputs_missing" ? "outputs_missing" : "failed",
          agent: job.agent,
          summary,
          isTodoLinked,
          isApprovalGated,
        });

        if (!decision.notify) {
          // 침묵 처리 — 지니 턴을 생략하지만 감사 로그는 남긴다(디버그/추후 튜닝용).
          console.log(
            `[Job:NotifyGate] SKIP jobId=${job.id.slice(0, 8)} reason=${decision.reason} preview="${requestPreview}"`,
          );
          return;
        }

        console.log(
          `[Job:NotifyGate] NOTIFY jobId=${job.id.slice(0, 8)} reason=${decision.reason} preview="${requestPreview}"`,
        );

        // 배칭 — 짧은 시간 창(기본 7초) 내 여러 job이 완료되면 하나의 지니 턴으로 코일레싱.
        enqueueBatchedNotify(
          { jobId: job.id, requestPreview, statusText, summary, status: job.status },
          (items) => {
            const genieNotice = formatBatchedGenieNotice(items);
            // source 를 :ok / :fail 로 쪼개 모델 티어를 가른다(internal-source-tier.ts).
            // 배치 보수 판정 — 전건 completed 일 때만 :ok(cheap). 하나라도 섞이면 :fail(standard).
            const notifySource = notifySourceForBatch(items);
            sendMessage(genieNotice, undefined, undefined, { internal: true, source: notifySource })
              .catch((err) => {
                console.error("[Job] 마이크루 알림 실패 → scheduler 재시도 대기:", err);
                for (const it of items) {
                  const j = jobs.get(it.jobId);
                  if (j) j.reportedToGenie = false;
                }
                saveJobs();
              });
          },
        );
      } catch (err) {
        // 게이팅/배칭 로직 자체가 실패해도 fail-safe로 즉시 알림(기존 동작과 동일하게 유지).
        console.error("[Job:NotifyGate] 게이팅 처리 실패 → fail-safe 즉시 알림:", err);
        const genieNotice = `[시스템 알림] "${requestPreview}" 작업 ${statusText}. 결과: ${summary}

작업 결과는 이미 사용자에게 직접 표시되었습니다.
당신이 할 일:
1. 후속 조치가 필요하면 즉시 수행하세요 (위임, 체이닝 등).
2. 사용자에게 알릴 사항이 있으면 [REPORT]를 첫 줄에 붙여 1~2줄로 보고하세요.
   예: 후속 작업 진행 중, 특이사항 발견, 주의가 필요한 부분 등.
3. 특별히 알릴 것도 없고 후속 조치도 없으면 아무 응답 하지 마세요.
TODO 태그 사용 금지.`;
        sendMessage(genieNotice, undefined, undefined, { internal: true, source: job.status === "completed" ? "job:notify:ok" : "job:notify:fail" })
          .catch((sendErr) => {
            console.error("[Job] 마이크루 알림 실패 → scheduler 재시도 대기:", sendErr);
            const j = jobs.get(job.id);
            if (j) { j.reportedToGenie = false; saveJobs(); }
          });
      }
    })();
  })();

  // 자동 QA 트리거 — 코드 변경 태스크 또는 명시적 QA 요청 시에만 우즈(qa) 자동 검증 위임.
  // (토큰 절감: 이전엔 전 워커 완료마다 QA 스폰 → 비용 최대 소비처. 정책상 범위 축소.)
  // 정책:
  // - qa: 자기 자신 → 무한루프 방지를 위해 제외
  // - dev-pm: 메타·관리 작업은 QA 불필요
  // - agent 미지정(orchestrator/genie 자체): 제외
  // 발동 조건(둘 중 하나): 코드 변경 감지(hasCodeChanges) 또는 명시 요청(forceQa/요청문 키워드)
  // 옵트아웃: qaTriggered(재귀 차단) / skipQa(호출자 명시) 존중.
  // 환경변수: AUTO_QA_TRIGGER=false 시 완전 비활성.
  const AUTO_QA_TRIGGER = process.env.AUTO_QA_TRIGGER !== "false";
  // 2026-08-24 조건부화 — 판정은 qa-trigger-policy.ts(순수 모듈)로 옮겼다.
  // 신호: «잡 범위» 코드 변경(종료 스냅샷 − lease 시점 스냅샷). 레포 전체 더러움이 아니다.
  // looksLikeQaRequest 는 발동 축에서 뺐다 — `검증|테스트|점검|리뷰` 가 한국어 지시서 거의 전부에
  // 걸려 사실상 상시 참이었다. 명시 요청은 forceQa 로 받는다(호출자가 진짜 원할 때 세우는 깃발).
  const codeNow = snapshotCodeChanges(job.cwd);
  const jobScopedCodeChanges = codeNow === null ? null : newCodeChanges(job.codeBaseline, codeNow).length;
  const qaDecision = decideQa({
    jobScopedCodeChanges,
    forceQa: job.forceQa,
    skipQa: job.skipQa,
    qaTriggered: job.qaTriggered,
    agentId: job.agent,
    request: job.request,
    lastSampleAtIso: job.agent ? readQaSampleAt(job.agent) : null,
    nowIso: new Date().toISOString(),
  });
  // 조용히 끄지 않는다 — 판정 사유를 항상 남긴다. 「왜 QA 가 안 붙었지」를 로그로 답할 수 있어야 한다.
  console.log(`[AutoQA] ${job.agent ?? "-"} ${qaDecision.run ? "수행" : "생략"} — ${qaDecision.reason}`);
  if (qaDecision.run && qaDecision.isSample && job.agent) markQaSampled(job.agent);
  if (
    AUTO_QA_TRIGGER &&
    qaDecision.run &&
    job.status === "completed"
  ) {
    // 1단: precheckArtifacts — 산출물 파일 실존·mtime 검증 (거짓 보고 차단)
    void (async () => {
      try {
        const qaJudge = await import("./qa-auto-judge.js");
        // lookupJob 콜백 주입 — 재제출 체인일 때 원본 job.startedAt을 mtime 비교 기준으로 사용
        const precheck = qaJudge.precheckArtifacts(job, (id) => jobs.get(id));
        
        if (!precheck.pass) {
          // 산출물 미존재/재사용 감지 → 원작업자에게 재제출 요구 + QA 차단
          const currentResubmitCount = job.resubmitCount ?? 0;

          // 재제출 상한 초과 시 자동 중단 + genie 보고
          if (currentResubmitCount >= MAX_RESUBMIT) {
            const origTitle = job.request.split("\n")[0].trim().slice(0, 80).replace(/`/g, "'");
            const failureSummary = precheck.failures.slice(0, 3).join("; ");
            addGenieMessage(
              `[AutoQA] ⛔ 산출물 검증 재제출 ${currentResubmitCount}회 초과 — 자동 재제출을 중단합니다. 수동 확인 필요.\n` +
              `작업: \`${origTitle}\`\n실패 사유: ${failureSummary}`,
            );
            console.log(
              `[AutoQA] 재제출 상한(${MAX_RESUBMIT}회) 초과 → 자동 중단. agent=${job.agent}, job=${job.id.slice(0, 8)}`,
            );
            return;
          }

          const failureList = precheck.failures.map((f, i) => `${i + 1}. ${f}`).join("\n");
          const origTitle = job.request.split("\n")[0].trim().slice(0, 80);
          const resubmitRequest =
            `[산출물 검증 실패 — 재제출 요구]\n` +
            `작업: ${origTitle}\n\n` +
            `## 검증 실패 사유\n${failureList}\n\n` +
            `## 필수 조치\n` +
            `1. 명시한 파일 경로가 실제로 존재하는지 확인\n` +
            `2. 파일을 작업 시작 후 생성/수정했는지 확인 (작업 전 파일 재사용 금지)\n` +
            `3. 보고서에 정확한 산출물 경로 명시\n` +
            `4. 재작업 완료 후 5단 보고\n\n` +
            `이 메시지는 자동 생성되었습니다. QA 검증이 차단되었으므로 재제출 필수.`;
          
          const resubmitJob = createJob(
            resubmitRequest,
            job.projectName,
            undefined,
            job.agent,  // 원작업자에게 재위임
            job.cwd,
            "high",     // 우선순위 상향 (재작업)
            undefined,
            false,
          );
          // 재제출 체인 추적 — 원본 job.startedAt을 mtime 비교 기준으로 유지하여 무한 루프 차단.
          // 체인 평탄화: 이미 재제출된 job(originalJobId 보유)을 재제출하더라도 항상 최초 원본 ID 유지.
          resubmitJob.originalJobId = job.originalJobId ?? job.id;
          resubmitJob.resubmitCount = currentResubmitCount + 1;
          saveJobs();
          
          console.log(
            `[AutoQA] 산출물 검증 FAIL → QA 차단, 재제출 요구 #${resubmitJob.resubmitCount}: ` +
            `jobId=${resubmitJob.id.slice(0, 8)} (원작업=${resubmitJob.originalJobId.slice(0, 8)}, agent=${job.agent})\n` +
            `실패 사유: ${precheck.failures.join("; ")}`,
          );
          return; // QA 생성 건너뜀 (IIFE 내부 return — processCallback 전체 흐름은 계속)
        }
        
        const review = await selectQaReview({
          request: job.request, report: job.fullResult ?? '', codeChanges: jobScopedCodeChanges,
        });
        auditLog('qa.profile_selected', { jobId: job.id, ...review });
        // Jev 호출 비용을 원장에 남긴다(jev-decisions/docs/operations.md 3장 — 기록 안 되는 통합은 배포 금지).
        if (review.inputTokens !== undefined && review.costUsd !== undefined) {
          logCost("qa", job.id, {
            costUsd: review.costUsd, inputTokens: review.inputTokens, outputTokens: review.outputTokens ?? 0,
            cacheReadTokens: 0, cacheCreateTokens: 0, durationMs: review.elapsedMs, model: review.model,
          }, "jev:qa-profile");
        }
        if (job.status !== 'completed' || job.skipQa || process.env.AUTO_QA_TRIGGER === 'false') return;

        // PASS → 기존 QA 흐름 진행
        const origTitle = job.request.split("\n")[0].trim().slice(0, 80);
        const qaReport = (job.fullResult ?? job.logs.slice(-20).join("\n")).slice(0, 12000);
        // [2026-08-11 핫픽스, 잡 2c13109c] 유령 산출물 차단.
        //   extractOutputFiles는 로그 텍스트에서 라벨로 뽑을 뿐 실존을 보지 않는다. 잡 도중
        //   만들었다가 정직하게 삭제한 임시파일이 다음 워커에게 "산출물"로 광고됐고, 워커가
        //   그걸 근거로 거짓 주장을 [HARD] 위키에 등재했다(잭키 QA F1, P1).
        //   ★ 표시 지점에서만 거른다 — precheckArtifacts(판정기)는 건드리지 않는다(:2731-2734 전례).
        //   ★ .txt는 OUTPUT_EXT에 있지만 ARTIFACT_EXT에는 없어 판정기 관할 밖이다.
        //     즉 이 필터가 .txt 유령의 유일한 방어선이다(scripts/phantom-artifact-handoff-test.ts T9).
        const outputFilesList = formatArtifactListForHandoff(
          job.outputFiles ?? [],
          job.cwd || PROJECT_SELF_DIR,
        );
        // [2026-08-21 핫픽스, 잡 ff70ffb8] stale 판정 차단.
        //   QA FAIL #1이 이전 회차 산출물을 보고 지적 2건을 냈고 둘 다 정본에는 기재돼 있었다.
        //   상대경로만 주면 어느 회차를 열어도 지시 위반이 아니다 — 절대경로+mtime으로 대상을 못박는다.
        const qaTargets = formatQaTargetsWithStamp(
          job.outputFiles ?? [],
          job.cwd || PROJECT_SELF_DIR,
        );
      const qaRequest =
        `[자동 QA] ${origTitle}\n` +
        `워커(${job.agent}) 작업 완료. **실제 테스트 실행 + 검증** 필수.\n\n` +
        `## 원본 요청\n${job.request.slice(0, 500)}\n\n` +
        `## 워커 5단 보고/로그 (말미)\n${qaReport}\n\n` +
        `## 산출물 파일\n${outputFilesList}\n\n` +
        `## 🎯 판정 대상 고정 (이 경로·이 시각의 파일만 본다)\n${qaTargets}\n` +
        // [2026-10-05 핫픽스, 잡 938bbcb0] 산출물 0건 잡의 «검증 불가» 열화 차단.
        //   아래 3개 지시는 «판정 대상이 있다»를 전제한다. 산출물이 정당하게 0건인 잡
        //   (예: 인박스 비어서 처리 0건인 루프 표본)에 그대로 붙으면 QA가 피검체 부재를
        //   근거로 «검증 불가»를 낸다(procedure_qa-target-fixation-fails-…, 2026-10-03).
        //   읽기 전용 경로를 산출물에서 걷어내면서 이 분기에 들어오는 잡이 늘어나므로 같이 막는다.
        //   ★ 표본 QA 자체는 끄지 않는다 — «0건이었다»는 주장이 거짓일 수 있고, 그걸 감사하는
        //     것이 표본의 존재 이유다. 판정을 포기하지 말고 원천에서 확인하라고 지시만 바꾼다.
        ((job.outputFiles?.length ?? 0) === 0
          ? `- 산출물 0건은 **그 자체로 결함이 아니다.** 처리할 건이 없었다면 정상이다.\n` +
            `- 따라서 «피검체 없음»을 이유로 «검증 불가»를 내지 말 것. 대신 워커의 «처리 0건» 주장을\n` +
            `  **원천에서 직접 확인**해 판정하라(인박스 디렉터리·DB 건수·대상 API를 직접 조회).\n` +
            `- 원천에 처리할 건이 실제로 없었다면 합격이다. 있었는데 0건이라 보고했다면 불합격이다.\n\n`
          : `- 위 절대경로 **외의 파일로 판정하지 말 것.** 같은 주제의 구본이 다른 디렉터리에 남아 있을 수 있다.\n` +
            `- 지적하기 전에 그 문자열을 위 파일에 직접 grep해 부재를 확인할 것. 히트하면 그 지적은 이전 회차 대상(stale)이다.\n` +
            `- 지적이 전부 stale이어도 **결론 수치는 따로 검산**할 것 — 총계는 맞고 지목만 틀린 FAIL이 실제로 있었다(2026-08-21).\n\n`) +
        qaVerificationInstructions(review.profile);
      // 원본 Job의 Todo 찾기 — QA Job을 같은 Todo에 연결하여 Task 게이지에 표시
      const origTodos = getTodosByJobId(job.id);
      const origTodoId = origTodos.length > 0 ? origTodos[0].id : undefined;

      const qaJob = createJob(
        qaRequest,
        job.projectName,
        undefined,        // attachments
        "qa",
        job.cwd,
        job.priority,
        job.id,           // afterJobId: 원본 완료 후 실행 (체이닝)
        false,            // selfRestart
        undefined,        // stages
        undefined,        // stageAgents
        false,            // skipPlanGate
        undefined,        // leaseSec
        undefined,        // maxTurns
        origTodoId,       // todoId: 원본과 같은 Todo에 연결 (Task 게이지 표시용)
      );
      qaJob.qaTriggered = true;
      // QA 모델 티어: codex QA면 위험도에 따라 sol/terra (2026-09-28). 다른 실행기면 기본 모델 유지.
      {
        const qaModel = pickQaModel({ adapter: getWorkerAgent("qa")?.adapter, reason: qaDecision.reason, profile: review.profile });
        if (qaModel) (qaJob as Job & { model?: string }).model = qaModel;
        console.log(`[AutoQA] QA 모델: ${qaModel ?? "기본"} (사유 ${qaDecision.reason} · 유형 ${review.profile})`);
      }
      saveJobs();
      console.log(`[AutoQA] 워커 완료 → 우즈(qa) 자동 위임: jobId=${qaJob.id.slice(0, 8)} (after=${job.id.slice(0, 8)}, agent=${job.agent})`);
      } catch (err) {
        console.error("[AutoQA] qa 잡 생성 실패:", err);
      }
    })();
  }

  // #10 QA 자동 판정 연동: QA 잡 완료 시 verdict 감지 → FAIL이면 핫픽스+재검증 자동 위임
  if (job.agent === "qa" && (job.status === "completed" || job.status === "outputs_missing")) {
    void (async () => {
      try {
        const qaJudge = await import("./qa-auto-judge.js");
        qaJudge.handleQaJobComplete(job);
      } catch (err) {
        console.error("[QA-AutoJudge] 처리 실패:", err);
      }
    })();
  }

  return { dedup: false };
}
// === v2 callback 일원화 끝 ===

export async function summarizeJobToChat(jobId: string): Promise<boolean> {
  const job = jobs.get(jobId);
  if (!job) return false;
  if (!TERMINAL_JOB_STATUSES.has(job.status)) return false;
  try {
    await reportToGenie(job);
    return true;
  } catch (err) {
    console.error("[MyCrew] 보고 실패:", err);
    return false;
  }
}

async function reportToGenie(job: Job): Promise<void> {
  // 진행 메시지 수집
  const progress = lastJobProgress.get(job.id) ?? [];
  lastJobProgress.delete(job.id);
  const progressSummary = progress.length
    ? `\n진행 과정:\n${progress.map((p) => `- ${p}`).join("\n")}\n`
    : "";

  // 사장님 화면 알림용 짧은 미리보기 — 첫 줄 + 60자 cap (위임 본문 도배 방지).
  // 마이크루 프롬프트에는 job.request 전체 그대로 전달(컨텍스트 손실 방지).
  const firstLine = job.request.split("\n")[0].trim();
  const requestPreview = firstLine.length > 60 ? firstLine.slice(0, 60) + "…" : firstLine;

  // 로그에서 [결과] 라인을 우선 추출, 없으면 마지막 3줄. fullResult가 있으면 그것을 최우선.
  const resultLine = job.logs.find((l) => l.startsWith("[결과]"));
  const briefResult = (
    job.fullResult
    ?? (resultLine ?? job.logs.slice(-3).join("\n"))
  ).slice(0, 4000);
  // [2026-08-12 QA P2] 유령 산출물 차단을 이 지점에도 적용한다.
  // 여기는 마이크루(LLM)가 사장님께 보고할 때 읽는 프롬프트다 — d5cb689가 고친 QA 핸드오프(:3053)와
  // 같은 무검증 job.outputFiles를 광고하고 있었다. 잡 도중 만들었다 삭제한 임시파일이 "산출물"로
  // 실려 거짓 보고로 전파되는 경로가 그대로 살아 있었다.
  // baseDir은 :3053·qa-auto-judge.ts:124와 축자 동일하게 맞춘다(판정기/표시기 기준 불일치 방지).
  // basename 축약을 버리고 원본 경로를 넘기는 이유: bare 파일명은 광역 폴백(1레벨 전 폴더 스캔)을
  // 타서 타 폴더 동명 파일을 '실존'으로 오판할 수 있다. 스코프가 있는 원본 경로가 더 안전하다.
  const outputFiles = job.outputFiles?.length
    ? `\n산출물: ${formatArtifactListForHandoff(job.outputFiles, job.cwd || PROJECT_SELF_DIR)}`
    : "";

  let prompt: string;
  if (job.status === "completed") {
    prompt = `에이전트가 작업을 완료했습니다. 사용자에게 1~2줄로 간단히 알려주세요.

작업: ${job.request}
${progressSummary}
결과 요약: ${briefResult}${outputFiles}

중요: 응답 첫 줄에 반드시 [REPORT]를 붙이세요. 간결하게 핵심만 보고하세요. 상세 내용은 사용자가 "결과 보기"로 직접 확인합니다. TODO 태그는 사용하지 마세요.`;
  } else {
    prompt = `에이전트가 작업을 시도했지만 실패했습니다. 사용자에게 간단히 알려주세요.

작업: ${job.request}
${progressSummary}
에러: ${job.error}
최근 로그: ${briefResult}

중요: 응답 첫 줄에 반드시 [REPORT]를 붙이세요. 간결하게 문제와 해결 방향만 제안하세요. TODO 태그는 사용하지 마세요.`;
  }

  // 마이크루에게 보고 프롬프트 전달 — sendMessage 경유로 응답에 포함된 태그(TASK/RESTART 등) 자동 파싱
  reportingInProgress.add(job.id);
  try {
    const reply = await sendMessage(prompt, undefined, undefined, { internal: true, source: "job:report" });
    // 마커 누락(빈 응답·"확인" 등) 시 사장님 보장 발화 — 영구 누락 방지 (잭키 진단 M-2).
    const hasMarker = /^\[(NOTIFY|REPORT)\]\s*/i.test(reply.content);
    if (!hasMarker) {
      const fallback = job.status === "completed"
        ? `"${requestPreview}" 작업이 완료됐어요!`
        : `"${requestPreview}" 작업을 여러 번 시도했는데 해결이 안 됐어요. 같이 살펴볼까요?`;
      addGenieMessage(fallback);
    }
    // 성공 시 보고 마킹 → scheduler unreported에서 제외, 중복 알림 차단
    markJobReported(job.id);
    // TODO done 전이 — 즉시 보고 성공 시 스케줄러를 거치지 않으므로 여기서 직접 처리
    transitionTodosForJob(job.id, "done", `보고 완료: ${requestPreview}`);
  } catch (err) {
    // busy(genie_busy)는 scheduler 재시도 인프라가 받음 — 마킹하지 않음
    if (err instanceof Error && err.message === "genie_busy") {
      console.log(`[Job] 보고 보류 (busy): ${job.id.slice(0, 8)}`);
      return;
    }
    console.error("[Job] 보고 sendMessage 실패:", err);
    const fallback = job.status === "completed"
      ? `"${requestPreview}" 작업이 완료됐어요!`
      : `"${requestPreview}" 작업을 여러 번 시도했는데 해결이 안 됐어요. 같이 살펴볼까요?`;
    addGenieMessage(fallback);
    // fallback 발화했으니 마킹 (scheduler 중복 차단)
    markJobReported(job.id);
    // fallback도 사용자에게 전달됐으므로 TODO done 처리
    transitionTodosForJob(job.id, "done", `보고 완료(fallback): ${requestPreview}`);
  } finally {
    reportingInProgress.delete(job.id);
  }
}

export async function restartSelf(): Promise<void> {
  // 재시작 플래그 생성
  const flagPath = join(PROJECT_SELF_DIR, "history", ".self-restart");
  mkdirSync(join(PROJECT_SELF_DIR, "history"), { recursive: true });
  writeFileSync(flagPath, new Date().toISOString());

  const isSystemdManaged = Boolean(process.env.INVOCATION_ID || process.env.JOURNAL_STREAM);
  if (isSystemdManaged) {
    console.log("[Self] systemd supervisor에 재시작을 요청합니다");
    process.exit(75);
  }

  const { spawn } = await import("node:child_process");
  const { openSync } = await import("node:fs");
  const logPath = join(tmpdir(), "teamLGS.log");
  // .env에서 주석/삭제된 변수가 부모 process.env에 남아 상속되는 문제 방지
  // .env에 등장하는 모든 키를 제거 → 자식 index.ts가 .env를 새로 파싱
  const cleanEnv = { ...process.env };
  const envPath = join(PROJECT_SELF_DIR, ".env");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf-8").split("\n")) {
      const m = line.match(/^#?\s*([A-Z_][A-Z0-9_]*)=/);
      if (m) delete cleanEnv[m[1]];
    }
  }
    const child = spawn(process.execPath, [...TSX_CLI_ARGS, "src/index.ts"], {
    cwd: PROJECT_SELF_DIR,
    detached: true,
    stdio: ["ignore", openSync(logPath, "a"), openSync(logPath, "a")],
    env: cleanEnv,
  });
  let spawnError: Error | null = null;
  child.on("error", (err) => {
    spawnError = err;
    writeFileSync(
      join(PROJECT_SELF_DIR, "history", ".self-restart-failed.json"),
      JSON.stringify({ error: err.message, ts: new Date().toISOString() })
    );
    console.error("[Self] spawn 실패:", err.message);
  });
  child.unref();
  await new Promise(resolve => setTimeout(resolve, 150));
  if (spawnError) {
    console.error("[Self] 재시작 포기 — 서버 계속 실행");
    return;
  }
  console.log("[Self] 새 프로세스 시작됨 (node+tsx), 현재 프로세스 종료합니다");
  process.exit(0);
}

// 주의: loadJobs는 src/server/index.ts의 startServer 콜백(!isDryRun 분기)에서 호출.
// DRY_RUN=1 모드에서 Job 복원·processQueue→에이전트 spawn 연쇄가 발생하지 않게 하기 위함.
