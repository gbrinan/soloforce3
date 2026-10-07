import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HISTORY_DIR } from "../config.js";
import type { GenieTask, GenieTaskStatus } from "../types.js";
import { emitGlobalEvent, getJob, cancelJob } from "./jobs.js";
import { getTodoById, setTodoState } from "./todos.js";
import { sendMessage } from "./chat.js";

// Task = 사용자 지시 1건. Todo들의 상위 묶음. (2계층 모델 — Task 1 ──< Todo 1 ──1 Job)
const TASKS_FILE = join(HISTORY_DIR, "genie-tasks.json");
const tasks = new Map<string, GenieTask>();

// prefix 매칭: 8자리 단축 ID도 허용 (todos.ts resolveTodoId와 동일 패턴)
function resolveTaskId(idOrPrefix: string): string | undefined {
  const trimmed = idOrPrefix.trim();
  if (tasks.has(trimmed)) return trimmed;
  for (const key of tasks.keys()) {
    if (key.startsWith(trimmed)) return key;
  }
  return undefined;
}

export function loadTasks(): void {
  if (!existsSync(TASKS_FILE)) return;
  try {
    const arr = JSON.parse(readFileSync(TASKS_FILE, "utf-8")) as GenieTask[];
    if (!Array.isArray(arr)) return;
    for (const t of arr) {
      if (!t.todoIds) t.todoIds = [];
      tasks.set(t.id, t);
    }
    console.log(`[Tasks] 복원 ${arr.length}건`);
  } catch (err) {
    console.error("[Tasks] 로드 실패:", err);
  }
}

function saveTasks(): void {
  try {
    if (!existsSync(HISTORY_DIR)) mkdirSync(HISTORY_DIR, { recursive: true });
    writeFileSync(TASKS_FILE, JSON.stringify(Array.from(tasks.values()), null, 2));
  } catch (err) {
    console.error("[Tasks] 저장 실패:", err);
  }
}

type TaskUpdateAction = "added" | "todo-linked" | "done" | "cancelled";

function emitUpdate(task: GenieTask, action: TaskUpdateAction): void {
  try {
    emitGlobalEvent("task-update", { action, task });
  } catch {
    // emit 실패는 무시 — 본 작업 차단 금지
  }
}

export function createTask(origin: string, instruction: string): GenieTask {
  const task: GenieTask = {
    id: randomUUID(),
    origin,
    instruction,
    createdAt: new Date().toISOString(),
    status: "active",
    todoIds: [],
  };
  tasks.set(task.id, task);
  saveTasks();
  emitUpdate(task, "added");
  console.log(`[Tasks] add (${origin}): ${instruction.slice(0, 60)}`);
  return task;
}

export function getTask(idOrPrefix: string): GenieTask | undefined {
  const resolved = resolveTaskId(idOrPrefix);
  return resolved ? tasks.get(resolved) : undefined;
}

// 마이크루 한 응답(turn) 내 다중 DelegateTask 자동 그룹핑용 캐시.
// 키: genie turnId. 값: { taskId, createdAt }.
// 만료: 1시간 + 최대 200 entries (LRU). 메모리 누수 차단.
const turnTaskCache = new Map<string, { taskId: string; createdAt: number }>();
const TURN_CACHE_TTL_MS = 60 * 60 * 1000;
const TURN_CACHE_MAX = 200;

function pruneTurnCache(): void {
  const now = Date.now();
  for (const [k, v] of turnTaskCache) {
    if (now - v.createdAt > TURN_CACHE_TTL_MS) turnTaskCache.delete(k);
  }
  while (turnTaskCache.size > TURN_CACHE_MAX) {
    const firstKey = turnTaskCache.keys().next().value;
    if (firstKey === undefined) break;
    turnTaskCache.delete(firstKey);
  }
}

/** 마이크루 한 응답 내 DelegateTask 자동 그룹핑 헬퍼.
 *  - explicitTaskId가 유효하면 그 Task 반환 (재작업·명시 그룹핑)
 *  - turnId가 빈 문자열이면 그룹핑 skip — 매번 신규 Task (워커 호출 등 turn 컨텍스트 없을 때)
 *  - turnId 캐시 hit + Task 살아있으면 재사용
 *  - miss/dead → createTask 후 캐시 등록 */
export function getOrCreateTaskForTurn(
  turnId: string,
  instruction: string,
  explicitTaskId?: string,
): GenieTask {
  if (explicitTaskId) {
    const existing = getTask(explicitTaskId);
    if (existing) return existing;
  }
  if (!turnId) return createTask("genie", instruction);
  pruneTurnCache();
  const cached = turnTaskCache.get(turnId);
  if (cached) {
    const t = tasks.get(cached.taskId);
    if (t && t.status !== "cancelled") return t;
    turnTaskCache.delete(turnId);
  }
  const t = createTask("genie", instruction);
  turnTaskCache.set(turnId, { taskId: t.id, createdAt: Date.now() });
  return t;
}

export function getTasks(filter?: { status?: GenieTaskStatus }): GenieTask[] {
  let arr = Array.from(tasks.values());
  if (filter?.status) arr = arr.filter((t) => t.status === filter.status);
  return arr;
}

// Todo를 Task에 연결 (중복 추가 방지)
export function addTodoToTask(taskId: string, todoId: string): void {
  const task = getTask(taskId);
  if (!task) return;
  if (!task.todoIds.includes(todoId)) {
    task.todoIds.push(todoId);
    // 완료된 Task에 새 작업단위가 붙으면(검증 실패 후 재작업 등) 다시 active로 복귀
    if (task.status === "done") {
      task.status = "active";
      task.doneAt = undefined;
      task.doneSummary = undefined;
      console.log(`[Tasks] 재오픈 (재작업 추가): ${task.instruction.slice(0, 60)}`);
    }
    saveTasks();
    emitUpdate(task, "todo-linked");
  }
}

// Task 마지막 phase 정상 완료 시 — 시스템이 자동으로 Task done 처리(병목 해소) +
// 마이크루에게 [Task 완료] 보고 알림. 마이크루는 사용자 [REPORT]만 (done은 자동이라 부담 없음).
// 마이크루가 결과를 보고 잘못됐다 판단하면 같은 taskId로 재작업 위임 → Task 자동 재오픈.
export function reportTaskToGenie(taskId: string): void {
  const task = getTask(taskId);
  if (!task || task.status !== "active") return;
  const lines: string[] = [];
  for (const todoId of task.todoIds) {
    const todo = getTodoById(todoId);
    if (!todo) continue;
    const job = todo.relatedJobIds?.[0] ? getJob(todo.relatedJobIds[0]) : undefined;
    const result = (job?.summary?.trim() || job?.content || "(결과 없음)").replace(/\s+/g, " ").slice(0, 300);
    lines.push(`- ${todo.instruction.replace(/\s+/g, " ").slice(0, 40)}: ${result}`);
  }
  // 자동 done — 마이크루 병목과 무관하게 Task를 닫는다 (적체 방지).
  declareTaskDone(task.id);
  const prompt = `[Task 완료] "${task.instruction.replace(/\s+/g, " ").slice(0, 60)}" 모든 작업단위가 끝나 자동 완료됐습니다.

작업단위별 결과:
${lines.join("\n")}

당신이 할 일 (조율자):
1. 사용자에게 [REPORT]로 전체 결과를 1~3줄 보고하세요.
2. 결과가 미흡하다고 판단되면 → 같은 taskId(${task.id.slice(0, 8)})로 재작업 위임 (Task가 자동 재오픈됨, 기존 결과는 보존되고 재작업이 뒤로 붙음). 필요하면 재검증 phase도 포함.
- 부담되면 알바(Agent 도구)에 위임해도 됩니다.
- 보고서 파일은 사용자가 명시 요청한 경우만.`;
  void sendMessage(prompt, undefined, undefined, { internal: true, source: "task:report" })
    .catch((e) => console.error("[Tasks] Task 완료 보고 실패:", e));
}

// 마이크루의 Task 완료 선언 — 소속 Todo도 함께 done 처리 (manage_task done 명시 호출 경로)
// 자동 완료 폐기 (조율자 원칙): Task done은 마이크루가 사용자에게 최종 보고 후 명시 호출.
export function declareTaskDone(idOrPrefix: string, summary?: string): boolean {
  const task = getTask(idOrPrefix);
  if (!task || task.status !== "active") return false;
  task.status = "done";
  task.doneAt = new Date().toISOString();
  if (summary) task.doneSummary = summary;
  saveTasks();
  for (const todoId of task.todoIds) {
    const todo = getTodoById(todoId);
    if (todo) setTodoState(todo.id, "closed");
  }
  emitUpdate(task, "done");
  console.log(`[Tasks] done by 마이크루: ${task.instruction.slice(0, 60)}`);
  return true;
}

// 모든 작업단위(Todo)가 done인데 reportTaskToGenie를 안 거치는 분기(예: QA FAIL 판정 →
// 마이크루 판단 대기)에서 Task가 active로 남는 사각지대 방지. 종료된 작업단위만 남으면 Task를 닫는다.
// 실패(failed) todo는 status가 done이 아니므로 제외 → 실패 잔존 Task는 마이크루 판단까지 active 유지.
// 마이크루가 같은 taskId로 재작업 위임하면 Task는 기존 로직대로 자동 재오픈됨.
export function autoCompleteTaskIfDone(taskId: string): boolean {
  const task = getTask(taskId);
  if (!task || task.status !== "active" || task.todoIds.length === 0) return false;
  const allDone = task.todoIds.every((id) => { const s = getTodoById(id)?.state; return s === "closed" || s === "cancelled"; });
  if (!allDone) return false;
  declareTaskDone(task.id);
  console.log(`[Tasks] 자동 완료 (모든 작업단위 done): ${task.instruction.slice(0, 60)}`);
  return true;
}

export function cancelTask(idOrPrefix: string): boolean {
  const task = getTask(idOrPrefix);
  if (!task || task.status !== "active") return false;
  // 진행중(running/planning)인 작업단위만 실제 중단 — cancelJob이 워커 ESC/Kill + lease 회수 + 알림.
  // 이미 끝났거나(terminal) 아직 시작 전(queued/paused)인 작업은 정보성으로 보존 → 건드리지 않음.
  // cascade:false → 진행중 job 중단 시 그 job의 '대기중 후속'까지 자동취소하지 않도록(시작 전 보존).
  // 순차·병렬 무관: 각 job의 현재 상태로만 판단.
  for (const todoId of task.todoIds) {
    const todo = getTodoById(todoId);
    if (!todo) continue;
    for (const jid of todo.relatedJobIds ?? []) {
      const job = getJob(jid);
      if (job && job.status === "running") {
        cancelJob(jid);
        setTodoState(todoId, "cancelled", "Task 취소");
      }
    }
  }
  task.status = "cancelled";
  saveTasks();
  emitUpdate(task, "cancelled");
  return true;
}

export function deleteTask(idOrPrefix: string): { ok: boolean; todoIds: string[] } {
  const task = getTask(idOrPrefix);
  if (!task) return { ok: false, todoIds: [] };
  const todoIds = [...task.todoIds];
  tasks.delete(task.id);
  saveTasks();
  return { ok: true, todoIds };
}

/** 루틴 마스터를 영구 삭제.
 *  마스터 task + 동일 masterTaskId 인스턴스 모두 제거하고,
 *  schedule.md에서 해당 cron 라인도 삭제해 다음 cron 발화를 차단한다.
 */
export function deleteRoutineMaster(idOrPrefix: string): { ok: boolean; deletedCount: number } {
  const master = getTask(idOrPrefix);
  if (!master || master.routineType !== "master") return { ok: false, deletedCount: 0 };

  let deletedCount = 0;
  for (const [id, task] of tasks.entries()) {
    if (task.masterTaskId === master.id) {
      tasks.delete(id);
      deletedCount++;
    }
  }
  tasks.delete(master.id);
  deletedCount++;
  saveTasks();

  if (master.cronExpr) {
    try {
      const scheduleFile = join(HISTORY_DIR, "genie", "wiki", "schedule.md");
      if (existsSync(scheduleFile)) {
        const escaped = master.cronExpr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const cleaned = readFileSync(scheduleFile, "utf-8")
          .split("\n")
          .filter((line) => !new RegExp(`cron\\s+${escaped}`).test(line))
          .join("\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim() + "\n";
        writeFileSync(scheduleFile, cleaned);
        console.log(`[Tasks] 루틴 마스터 삭제: schedule.md cron 라인 제거 (${master.cronExpr})`);
      }
    } catch (e) {
      console.error("[Tasks] schedule.md 루틴 라인 제거 실패:", e);
    }
  }

  console.log(`[Tasks] 루틴 마스터 영구 삭제: ${master.instruction.slice(0, 60)} (인스턴스 ${deletedCount - 1}건)`);
  return { ok: true, deletedCount };
}

// === 루틴 마스터/인스턴스 ===

/** 루틴 마스터 task 조회/생성.
 *  cronExpr + instruction으로 식별 — 같은 루틴은 한 번만 생성됨.
 *  마스터는 todo 없이 cron 메타만 보유 (TODO 탭 상시 잔존).
 */
export function getOrCreateRoutineMaster(
  instruction: string,
  cronExpr: string,
): GenieTask {
  for (const task of tasks.values()) {
    if (task.routineType === "master" && task.cronExpr === cronExpr) {
      return task;
    }
  }
  const task: GenieTask = {
    id: randomUUID(),
    origin: "schedule",
    instruction,
    createdAt: new Date().toISOString(),
    status: "active",
    todoIds: [],
    routineType: "master",
    cronExpr,
  };
  tasks.set(task.id, task);
  saveTasks();
  emitUpdate(task, "added");
  console.log(`[Tasks] 루틴 마스터 생성: ${instruction.slice(0, 60)}`);
  return task;
}

/** 루틴 인스턴스 task 신규 생성. 트리거마다 1개 — 실제 위임(todo)을 누적.
 *  인스턴스는 aggregateTaskStatus에 따라 진행/완료 탭에 표시됨.
 */
export function createRoutineInstance(
  masterTaskId: string,
  instruction: string,
): GenieTask {
  const master = getTask(masterTaskId);
  const task: GenieTask = {
    id: randomUUID(),
    origin: "schedule",
    instruction,
    createdAt: new Date().toISOString(),
    status: "active",
    todoIds: [],
    routineType: "instance",
    masterTaskId,
    ...(master?.cronExpr ? { cronExpr: master.cronExpr } : {}),
  };
  tasks.set(task.id, task);
  saveTasks();
  emitUpdate(task, "added");
  console.log(`[Tasks] 루틴 인스턴스 생성: ${instruction.slice(0, 60)}`);
  return task;
}

/**
 * 루틴 인스턴스(또는 임의 task)에 모델 힌트를 저장한다.
 * 루프 엔진이 step.model_tier를 실제 모델 ID로 해석해 여기 저장해두면,
 * DelegateTask 핸들러가 호출자가 model을 명시하지 않았을 때 이 값을 job에 적용한다.
 */
export function setTaskModel(taskId: string, model: string): void {
  const task = tasks.get(taskId);
  if (!task) return;
  (task as GenieTask & { model?: string }).model = model;
  saveTasks();
}
