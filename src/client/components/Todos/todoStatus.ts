import type { Todo, TaskWithTodos } from '../../utils/api';

// 자식 Todo state → 한국어 라벨 (풀 라벨). 단일 카드 상태 텍스트·History 패널 등에서 사용.
export const STATE_LABEL: Record<string, string> = {
  received: '접수',
  delegated: '위임됨',
  plan_review: '계획검토',
  working: '작업중',
  reporting: '보고중',
  done: '완료',
  failed: '실패',
  stuck: '멈춤',
  cancelled: '취소',
  closed: '완료',
};

// 간트 행 좌측 짧은 라벨. 세 상태 그룹(대기·진행중·완료/종결)로 축약.
export const STATE_LABEL_SHORT: Record<string, string> = {
  received: '대기',
  delegated: '대기',
  plan_review: '대기',
  working: '진행중',
  reporting: '진행중',
  done: '완료',
  closed: '완료',
  failed: '실패',
  stuck: '멈춤',
  cancelled: '취소',
};

export const TERMINAL_STATES = new Set(['done', 'closed', 'cancelled', 'failed', 'stuck']);

// TodoPanel 탭 분류용. 진행/완료 vs 대기.
// delegated·plan_review는 실질적으로 진행 중이므로 PROGRESS에 포함.
// failed는 재시도 대상이라 '대기' 탭에 두면 재시도 후 신규 todo와 분리돼 고아가 됨 — PROGRESS에 포함해
// 실패→재진행→완료 흐름 동안 같은 탭에 유지(상태배지로 실패 표기). server TERMINAL_STATES는 [done,cancelled].
export const PROGRESS_STATES = new Set(['delegated', 'plan_review', 'working', 'reporting', 'failed', 'done']);
export const WAITING_STATES = new Set(['received', 'stuck', 'cancelled']);

// state → 색 토큰 단일화. 용도(kind)별로 호출.
//   'cell'  : TaskCard 게이지(작은 셀). default border = 미진입(접수/대기).
//   'badge' : Mantine Badge color 인자(jarvis.* 또는 var(--...)). cellColor와 같은 의미를 다른 표기법으로 받음.
//   'stage' : Timeline 단계바 — isDone/isCurrent 플래그 의존(아래 stageColor 사용).
export function cellColor(state: string): string {
  if (state === 'done' || state === 'closed') return 'var(--accent-success)';
  if (state === 'working' || state === 'reporting') return 'var(--mantine-color-jarvis-5)';
  if (state === 'failed' || state === 'stuck') return 'var(--mantine-color-jarvis-8)';
  if (state === 'cancelled') return 'var(--mantine-color-gray-5)';
  return 'var(--mantine-color-default-border)';
}

// Badge color (Mantine `color` prop) — failed/stuck/cancelled/working/done 등 구분.
export function badgeColor(state: string): string {
  if (state === 'done' || state === 'closed') return 'var(--accent-success)';
  if (state === 'failed') return 'jarvis.8';
  if (state === 'stuck') return 'jarvis.4';
  if (state === 'cancelled') return 'gray';
  return 'jarvis.5';
}

// Timeline 단계바 색. isDone/isCurrent에 따라 분기.
// cancelled는 isDone 앞에 먼저 체크 — stage가 isDone=true여도 초록이 아닌 회색으로 표시.
export function stageColor(state: string, isDone: boolean, isCurrent: boolean): string {
  if (state === 'cancelled') return 'var(--mantine-color-gray-5)';
  if (isDone || state === 'done') return 'var(--accent-success)';
  if (state === 'failed') return 'var(--mantine-color-jarvis-8)';
  if (state === 'stuck') return 'var(--mantine-color-jarvis-4)';
  if (isCurrent) return 'var(--mantine-color-jarvis-5)';
  return 'var(--mantine-color-gray-3)';
}

// 시작: working 진입 시점 우선 → 첫 stateHistory 진입 → createdAt fallback.
export function todoStartMs(t: Todo): number {
  const workingEntry = t.stateHistory?.find((h) => h.state === 'working');
  if (workingEntry) return Date.parse(workingEntry.at);
  const first = t.stateHistory?.[0]?.at;
  return first ? Date.parse(first) : Date.parse(t.createdAt);
}

// 완료: 종결 상태면 stateHistory 마지막 at, 아니면 now snapshot.
export function todoEndMs(t: Todo, nowMs: number): number {
  if (TERMINAL_STATES.has(t.state) && t.stateHistory?.length) {
    return Date.parse(t.stateHistory[t.stateHistory.length - 1].at);
  }
  return nowMs;
}

// === Task(묶음) 집계 ===

export type TaskAggregateStatus = 'all-done' | 'in-progress' | 'pending' | 'failed' | 'cancelled';

export function aggregateTaskStatus(task: TaskWithTodos): TaskAggregateStatus {
  if (task.status === 'cancelled') return 'cancelled';
  if (task.status === 'done') return 'all-done';
  const states = task.todos.map((t) => t.state);
  if (states.length === 0) return 'pending';
  if (states.some((s) => s === 'failed' || s === 'stuck')) return 'failed';
  if (states.some((s) => s === 'delegated' || s === 'plan_review' || s === 'working' || s === 'reporting')) return 'in-progress';
  if (states.every((s) => s === 'done' || s === 'closed' || s === 'cancelled')) return 'all-done';
  return 'pending';
}

export function aggregateBadgeColor(status: TaskAggregateStatus): string {
  switch (status) {
    case 'all-done': return 'var(--accent-success)';
    case 'in-progress': return 'jarvis.5';
    case 'failed': return 'jarvis.8';
    case 'cancelled': return 'gray';
    default: return 'jarvis.3';
  }
}

export function aggregateLabel(status: TaskAggregateStatus, total: number, doneCount: number): string {
  switch (status) {
    case 'all-done': return '완료';
    case 'in-progress': return `진행 중 (${doneCount}/${total})`;
    case 'failed': return '실패';
    case 'cancelled': return '취소';
    default: return `대기 (${doneCount}/${total})`;
  }
}
