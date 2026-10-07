import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { HISTORY_DIR } from "../config.js";
import { atomicWriteFileSync, quarantineCorruptFile } from "./utils/atomic-write.js";
import type { GenieTodo, GenieTodoState } from "../types.js";
import { emitGlobalEvent, cancelJob } from "./jobs.js";

const TODOS_FILE = join(HISTORY_DIR, "genie-todos.json");
const todos = new Map<string, GenieTodo>();

// prefix 매칭: 8자리 단축 ID도 허용 (시스템 상황 표시와 일관)
function resolveTodoId(idOrPrefix: string): string | undefined {
  const trimmed = idOrPrefix.trim();
  if (todos.has(trimmed)) return trimmed;
  // prefix 매칭
  for (const key of todos.keys()) {
    if (key.startsWith(trimmed)) return key;
  }
  return undefined;
}

// terminal 상태: status를 'done'으로 자동 전이 → pending 필터에서 제외됨
// failed는 제외: 마이크루가 재시도/취소 등 조치해야 하므로 pending 유지 필요
const TERMINAL_STATES = new Set<GenieTodoState>(["done", "cancelled"]);

// active 상태: UI 업무 드로어에서 "진행 중"으로 표시되는 상태들.
// failed에서 이 상태로의 되돌림 전이는 stale·late PTY 이벤트로 간주해 차단한다.
// (재위임은 신규 todo로 처리되므로 원본 failed todo가 다시 active로 갈 정상 경로 없음.)
const ACTIVE_STATES = new Set<GenieTodoState>([
  "received",
  "delegated",
  "plan_review",
  "working",
  "reporting",
  "stuck",
]);

// drift2 자동 전이 폐기 (2026-04-24): "마이크루업무에 멈춘 업무가 없을 것" 원칙.
// 기계 임의 전이 금지 — 마이크루가 todo-monitor 알림을 받아 능동적으로 판단·조치.
// reconcileTodoStatus(terminal↔status 정합성)만 유지.

export function loadTodos(): void {
  if (!existsSync(TODOS_FILE)) return;
  try {
    const arr = JSON.parse(readFileSync(TODOS_FILE, "utf-8")) as GenieTodo[];
    if (!Array.isArray(arr)) return;
    let migrated = 0;
    for (const t of arr) {
      if (!t.relatedJobIds) t.relatedJobIds = [];
      // state 마이그레이션: 기존 데이터 호환
      if (!t.state) {
        const jobIds = t.relatedJobIds ?? [];
        if (t.status === "done") t.state = "done";
        else if (jobIds.length === 0) t.state = "received";
        else t.state = "working"; // jobs 상세 조회 없이 느슨 추정
        migrated++;
      }
      if (!t.stateHistory || t.stateHistory.length === 0) {
        t.stateHistory = [{ state: t.state, at: t.createdAt }];
      }
      todos.set(t.id, t);
    }
    console.log(
      `[Todos] 복원 ${arr.length}건${migrated > 0 ? ` (state 마이그레이션 ${migrated})` : ""}`,
    );
  } catch (err) {
    console.error("[Todos] 로드 실패:", err);
    const q = quarantineCorruptFile(TODOS_FILE);
    if (q) console.error(`[Todos] 손상 파일 격리: ${q}`);
  }
}

function saveTodos(): void {
  try {
    if (!existsSync(HISTORY_DIR)) mkdirSync(HISTORY_DIR, { recursive: true });
    const arr = Array.from(todos.values());
    atomicWriteFileSync(TODOS_FILE, JSON.stringify(arr, null, 2));
  } catch (err) {
    console.error("[Todos] 저장 실패:", err);
  }
}

type TodoUpdateAction =
  | "added"
  | "done"
  | "linked"
  | "state-changed"
  | "stage-changed"
  | "confirmed"
  | "reconciled";

function emitUpdate(todo: GenieTodo, action: TodoUpdateAction): void {
  try {
    emitGlobalEvent("todo-update", { action, todo });
  } catch {
    // emit 실패는 무시 — 본 작업 차단 금지
  }
}

export function addTodo(origin: string, instruction: string, stages?: string[], cronExpr?: string): GenieTodo {
  const now = new Date().toISOString();
  const todo: GenieTodo = {
    id: randomUUID(),
    origin,
    instruction,
    createdAt: now,
    status: "pending",
    state: "received",
    stateHistory: [{ state: "received", at: now }],
    relatedJobIds: [],
    ...(stages && stages.length > 0 ? { stages } : {}),
    ...(cronExpr ? { cronExpr } : {}),
  };
  todos.set(todo.id, todo);
  saveTodos();
  emitUpdate(todo, "added");
  console.log(`[Todos] add (${origin}): ${instruction.slice(0, 60)}${cronExpr ? ` [cron: ${cronExpr}]` : ""}`);
  return todo;
}

// 마이크루 자발 닫기용 (TODO:done 태그 경로). 사용자 수동 확인은 confirmTodo 사용.
export function markTodoDone(id: string): void {
  const resolved = resolveTodoId(id);
  const todo = resolved ? todos.get(resolved) : undefined;
  if (!todo) {
    console.warn(`[Todos] markTodoDone: id 없음 ${id}`);
    return;
  }
  if (todo.status === "done") return;
  todo.status = "done";
  todo.reportedAt = new Date().toISOString();
  // state도 done으로 맞춤
  if (todo.state !== "done") {
    todo.state = "done";
    if (!todo.stateHistory) todo.stateHistory = [];
    todo.stateHistory.push({ state: "done", at: todo.reportedAt });
  }
  saveTodos();
  emitUpdate(todo, "done");
  console.log(`[Todos] done: ${todo.instruction.slice(0, 60)}`);
}

// 사용자 수동 확인 — state='done'일 때만 허용 (안전장치)
export function confirmTodo(id: string): { ok: boolean; error?: string } {
  const todo = todos.get(id);
  if (!todo) return { ok: false, error: "id 없음" };
  if (todo.state !== "done") {
    return { ok: false, error: `현재 상태는 ${todo.state ?? "received"}` };
  }
  if (todo.status === "done") return { ok: true };
  todo.status = "done";
  todo.reportedAt = new Date().toISOString();
  saveTodos();
  emitUpdate(todo, "confirmed");
  console.log(`[Todos] confirmed: ${todo.instruction.slice(0, 60)}`);
  return { ok: true };
}

export function setTodoStages(todoId: string, stages: string[], stageAgents?: string[]): void {
  const todo = todos.get(todoId);
  if (!todo) return;
  todo.stages = stages;
  if (stageAgents) todo.stageAgents = stageAgents;
  saveTodos();
}

export function setTodoRoutineInfo(todoId: string, routineType: 'master' | 'instance', masterTaskId?: string, cronExpr?: string): void {
  const todo = todos.get(todoId);
  if (!todo) return;
  todo.routineType = routineType;
  if (masterTaskId) todo.masterTaskId = masterTaskId;
  if (cronExpr) todo.cronExpr = cronExpr;
  saveTodos();
}

export function setTodoCurrentStage(todoId: string, stage: number): void {
  const todo = todos.get(todoId);
  if (!todo) return;
  todo.currentStage = stage;
  saveTodos();
  emitUpdate(todo, "stage-changed");
}

// job에 연결된 모든 todo에 담당 에이전트 표시명을 영구 저장.
// processJob(작업 시작) 시 호출 — jobs store가 만료/정리돼도 DB todo 레코드에 이름이 남아
// 읽기 경로(/api/todos)에서 "미배정"으로 떨어지지 않게 한다.
export function setTodoAgentNameForJob(jobId: string, agentName: string): void {
  if (!agentName) return;
  let changed = false;
  for (const t of Array.from(todos.values())) {
    if (t.relatedJobIds?.includes(jobId) && t.agentName !== agentName) {
      t.agentName = agentName;
      changed = true;
      console.log(`[Todos] agentName 저장: ${t.id.slice(0, 8)} → ${agentName}`);
    }
  }
  if (changed) saveTodos();
}

export function advanceTodoStageForJob(jobId: string, stage: number): void {
  for (const t of Array.from(todos.values())) {
    if (t.relatedJobIds?.includes(jobId)) {
      t.currentStage = stage;
      saveTodos();
      emitUpdate(t, "stage-changed");
      break;
    }
  }
}

export function linkJobToTodo(todoId: string, jobId: string): void {
  const todo = todos.get(todoId);
  if (!todo) {
    console.warn(`[Todos] linkJobToTodo: todo 없음 ${todoId}`);
    return;
  }
  if (!todo.relatedJobIds) todo.relatedJobIds = [];
  if (todo.relatedJobIds.includes(jobId)) return;
  todo.relatedJobIds.push(jobId);
  saveTodos();
  emitUpdate(todo, "linked");
}

export function setTodoState(
  id: string,
  newState: GenieTodoState,
  note?: string,
): void {
  const todo = todos.get(id);
  if (!todo) return;
  const prev = todo.state ?? "received";
  if (prev === newState) return; // idempotent
  // terminal 상태에서는 전이 금지 (race 방지)
  if (TERMINAL_STATES.has(prev)) return;
  // failed에서 active 상태로 되돌리는 stale·late 전이 차단.
  // failed → done/cancelled/closed(종결 방향)는 허용 유지.
  if (prev === "failed" && ACTIVE_STATES.has(newState)) return;
  todo.state = newState;
  if (!todo.stateHistory) todo.stateHistory = [];
  const entry: { state: GenieTodoState; at: string; note?: string } = {
    state: newState,
    at: new Date().toISOString(),
  };
  if (note) entry.note = note;
  todo.stateHistory.push(entry);
  // terminal state 진입 시 todo.status도 자동 'done' 전이 (drift 방지 — source fix)
  if (TERMINAL_STATES.has(newState) && todo.status !== "done") {
    todo.status = "done";
    if (!todo.reportedAt) todo.reportedAt = entry.at;
  }
  saveTodos();
  emitUpdate(todo, "state-changed");
  console.log(`[Todos] state ${id.slice(0, 8)}: ${prev} → ${newState}`);
}

export function getTodoById(id: string): GenieTodo | undefined {
  return todos.get(id);
}

export function getTodosByJobId(jobId: string): GenieTodo[] {
  return Array.from(todos.values()).filter((t) =>
    t.relatedJobIds?.includes(jobId),
  );
}


export function transitionTodosForJob(
  jobId: string,
  newState: GenieTodoState,
  note?: string,
): void {
  for (const t of getTodosByJobId(jobId)) {
    setTodoState(t.id, newState, note);
    // done 전이 시 타임라인을 마지막 단계로 이동
    if (newState === "done" && t.stages && t.stages.length > 0) {
      t.currentStage = t.stages.length - 1;
      saveTodos();
      emitUpdate(t, "stage-changed");
    }
  }
}

// 현재 state(stateHistory의 마지막 엔트리)의 note에 줄바꿈 + extra 누적.
// PROGRESS 태그 등 working 중 진행 메시지 수집용.
export function appendCurrentStateNote(
  todoId: string,
  extra: string,
): void {
  const todo = todos.get(todoId);
  if (!todo || !todo.stateHistory || todo.stateHistory.length === 0) return;
  const last = todo.stateHistory[todo.stateHistory.length - 1];
  last.note = last.note ? last.note + "\n" + extra : extra;
  saveTodos();
  emitUpdate(todo, "state-changed");
}

// job에 연결된 모든 todo의 현재 state note에 append.
// onlyState 지정 시 해당 state인 todo에만 적용 (예: working 중 PROGRESS).
export function appendNoteForJob(
  jobId: string,
  extra: string,
  onlyState?: GenieTodoState,
): void {
  for (const t of getTodosByJobId(jobId)) {
    if (onlyState && t.state !== onlyState) continue;
    appendCurrentStateNote(t.id, extra);
  }
}

// stuck 감지 전용 — stuckNotifiedAt 기록 (알림 스팸 방지)
// countRenotify=true면 renotifyCount 증가 (재알림 상한/백오프 판정용).
export function markStuckNotified(id: string, countRenotify = false): void {
  const todo = todos.get(id);
  if (!todo) return;
  todo.stuckNotifiedAt = new Date().toISOString();
  if (countRenotify) todo.renotifyCount = (todo.renotifyCount ?? 0) + 1;
  saveTodos();
}

export function cancelTodo(id: string): { ok: boolean; error?: string } {
  const resolved = resolveTodoId(id);
  const todo = resolved ? todos.get(resolved) : undefined;
  if (!todo) return { ok: false, error: "id 없음" };
  if (TERMINAL_STATES.has(todo.state ?? "received")) {
    return { ok: false, error: `이미 종료 상태: ${todo.state}` };
  }
  setTodoState(id, "cancelled", "취소됨");
  todo.status = "done"; // API 호환 (pending/done만 존재)
  // 연결된 job들도 취소
  if (todo.relatedJobIds) {
    for (const jobId of todo.relatedJobIds) {
      cancelJob(jobId);
    }
  }
  saveTodos();
  emitUpdate(todo, "state-changed");
  console.log(`[Todos] cancelled: ${todo.instruction.slice(0, 60)}`);
  return { ok: true };
}

// 영구 삭제 — done/cancelled/failed 등 완료 항목을 Map에서 제거 (복구 불가)
export function deleteTodo(id: string): { ok: boolean; error?: string } {
  const resolved = resolveTodoId(id);
  const todo = resolved ? todos.get(resolved) : undefined;
  if (!todo || !resolved) return { ok: false, error: "id 없음" };
  todos.delete(resolved);
  saveTodos();
  emitGlobalEvent("todo-update", { id, action: "deleted" });
  console.log(`[Todos] deleted: ${todo.instruction.slice(0, 60)}`);
  return { ok: true };
}

export function getTodos(filter?: {
  origin?: string;
  status?: "pending" | "done";
}): GenieTodo[] {
  let arr = Array.from(todos.values());
  if (filter?.status) arr = arr.filter((t) => t.status === filter.status);
  if (filter?.origin) arr = arr.filter((t) => t.origin === filter.origin);
  arr.sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
  return arr;
}

// 주의: loadTodos와 startTodoReconcile은 src/server/index.ts의 startServer 콜백(!isDryRun 분기)에서 호출.
// DRY_RUN=1 모드에서 Todo 복원·reconcile 타이머(saveTodos 쓰기 경합)가 발생하지 않게 하기 위함.

// drift reconciliation: state=terminal(done/failed/cancelled)인데 status!=='done'인 todo를 보정.
// setTodoState 내부 자동 전이가 source fix이나, 구버전 데이터·수동 JSON 조작·재시작 직후 방어선으로 1회 + 60s 주기.
export function reconcileTodoStatus(): number {
  let count = 0;
  const now = new Date().toISOString();
  for (const todo of todos.values()) {
    if (todo.status !== "done" && todo.state && TERMINAL_STATES.has(todo.state)) {
      todo.status = "done";
      if (!todo.reportedAt) todo.reportedAt = now;
      emitUpdate(todo, "reconciled");
      count++;
    }
  }
  if (count > 0) {
    saveTodos();
    console.log(`[Todos] reconcile: ${count}건 drift 자동 정리 (status=pending+state=terminal)`);
  }
  return count;
}

// 기계 자동 전이 없음. 멈춘 업무는 todo-monitor가 알림을 보내 마이크루가 능동 판단.
export function startTodoReconcile(): void {
  setTimeout(reconcileTodoStatus, 5_000);
  setInterval(reconcileTodoStatus, 60_000);
}
