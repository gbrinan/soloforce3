import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Stack, Group, Text, Card, Button, ActionIcon, Modal, ScrollArea, Badge, Code, Box, Tabs, UnstyledButton, Loader,
} from '@mantine/core';
import { IconX, IconChevronDown, IconChevronRight, IconPlayerPlay, IconRepeat } from '@tabler/icons-react';
import { fetchTodos, fetchTaskTree } from '../../utils/api';
import type { Todo, TaskWithTodos } from '../../utils/api';
import TaskCard, { aggregateTaskStatus } from './TaskCard';
import { Timeline, getDefaultStages, historyForStage } from './Timeline';
import { timeAgo } from '../../utils/format';
import { renderMarkdown } from '../../utils/markdown';
import { cronToKorean } from '../../utils/cron';
import { uiConfirm } from '../Dialog/dialog';
import { useT } from '../../i18n/I18nProvider';
import { btn } from '../../ui/controls';
import DrawerSubHeader from '../DrawerSubHeader';
import CancelButton from './CancelButton';
import { BadgeDot, TodoGaugeWrapper } from './TodoGauge';
import {
  STATE_LABEL,
  badgeColor,
  PROGRESS_STATES,
  WAITING_STATES,
} from './todoStatus';

interface Props {
  visible: boolean;
  onClose: () => void;
  onStartTodo?: (instruction: string) => void;
  onJobClick?: (jobId: string) => void;
  onOpenNote?: (noteId: string) => void;   // 관련 노트 클릭 시 노트 패널 열기 (Phase C: 태스크→노트 역참조)
}

interface RelatedNote { id: string; title: string }

// localStorage(jarvis:notes)에서 [[task:<todoId>]] 링크를 포함한 노트를 스캔 (태스크→노트 역참조).
// 노트 본문은 마크다운 단일 진실 소스이므로 [[task:<id>] 부분문자열로 매칭(라벨 유무 무관).
function findNotesLinkingTask(todoId: string): RelatedNote[] {
  if (!todoId) return [];
  try {
    const raw = localStorage.getItem('jarvis:notes');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const needle = `[[task:${todoId}`;
    return parsed
      .filter((n): n is { id: string; title: string; content: string } =>
        !!n && typeof n.id === 'string' && typeof n.content === 'string')
      .filter((n) => n.content.includes(needle))
      .map((n) => ({ id: n.id, title: typeof n.title === 'string' ? n.title : '' }));
  } catch {
    return [];
  }
}

// "진행 및 완료" 탭: 진행 중(working/reporting) + 완료(done은 status=done으로 분류)
// "대기 및 미완료" 탭: 위임 전/대기/실패/멈춤/취소 + 자연어 캡처(state=received)
// PROGRESS_STATES / WAITING_STATES 는 todoStatus.ts 단일 정의.

function CronMeta({ cronExpr }: { cronExpr?: string }) {
  if (!cronExpr) return null;
  return (
    <Text size="xs" c="dimmed" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      <IconRepeat size={10} stroke={1.5} /> {cronToKorean(cronExpr)}
    </Text>
  );
}

function formatHHMM(iso: string): string {
  const d = new Date(iso);
  return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
}

function JobLogSection({ jobId, active, onCancel }: { jobId: string; active: boolean; onCancel?: () => void }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    if (!expanded || !active) return;
    let cancelled = false;
    const fetchLogs = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data.logs)) {
          setLines(data.logs.slice(-20));
        }
      } catch { /* ignore */ }
    };
    fetchLogs();
    const iv = setInterval(fetchLogs, 5000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [expanded, active, jobId]);

  return (
    <Box style={{ borderLeft: '2px solid var(--mantine-color-default-border)', paddingLeft: 10, marginBottom: 8, marginTop: 4 }}>
      <Group justify="space-between" align="center" gap="xs">
        <Group
          gap={2}
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          style={{ cursor: 'pointer', userSelect: 'none' }}
        >
          {expanded ? <IconChevronDown size={12} stroke={1.5} /> : <IconChevronRight size={12} stroke={1.5} />}
          <Text size="xs" c="jarvis.4">
            {lines.length > 0 ? t('todo.jobLogLines', { n: lines.length }) : t('todo.jobLog')}
          </Text>
        </Group>
        {expanded && onCancel && (
          <Button
            size="compact-xs"
            color="jarvis.7"
            className="cancel-btn-emphasis"
            onClick={async (e) => {
              e.stopPropagation();
              if (await uiConfirm({
                title: t('todo.cancelTitle.active'),
                description: t('todo.cancelDesc'),
                variant: 'danger',
                confirmLabel: t('todo.confirmCancelWork'),
                cancelLabel: t('todo.continueWork'),
              })) onCancel();
            }}
          >
            {t('todo.jobCancel')}
          </Button>
        )}
      </Group>
      {expanded && (
        <Code
          block
          mt={4}
          style={{ maxHeight: 200, overflowY: 'auto', fontSize: 'var(--font-s)', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
        >
          {lines.length === 0 ? t('todo.noLog') : lines.join('\n')}
        </Code>
      )}
    </Box>
  );
}

function HistoryEntry({ entry, jobId, isWorking, onCancel }: { entry: { state: string; at: string; note?: string }; jobId?: string; isWorking?: boolean; onCancel?: () => void }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const hasLong = !!entry.note && entry.note.length > 150;
  const showLog = entry.state === 'working' && isWorking && jobId;

  return (
    <Box style={{ borderLeft: '2px solid var(--mantine-color-default-border)', paddingLeft: 10, marginBottom: 8 }}>
      <Text size="xs" c="dimmed">
        {formatHHMM(entry.at)} · {STATE_LABEL[entry.state] || entry.state}
      </Text>
      {entry.note && (
        <Text size="sm" mt={2}>
          {expanded || !hasLong ? entry.note : entry.note.slice(0, 150) + '...'}
          {hasLong && (
            <Text
              component="span"
              size="xs"
              c="jarvis.4"
              ml={4}
              onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
              style={{ cursor: 'pointer' }}
            >
              {expanded ? t('common.collapse') : t('common.expand')}
            </Text>
          )}
        </Text>
      )}
      {showLog && (
        <Box mt={4}>
          <JobLogSection jobId={jobId} active={true} onCancel={onCancel} />
        </Box>
      )}
    </Box>
  );
}

// 루틴 판정: cronExpr이 부여됐거나, todo 자체 또는 소속 task의 instruction이 `[루틴·`으로 시작.
// 봄봄 식단처럼 task.instruction이 `[루틴·평일 매일] 봄봄 구로디지털단지점`이고
// 자식 todo의 instruction은 단순 내용(예: "봄봄 구로디지털단지점")만 들어가는 케이스 누락 방지 — 부모 task까지 검사.
function isRoutineTodo(t: Todo, tasks?: TaskWithTodos[]): boolean {
  if (t.cronExpr) return true;
  const ti = (t.instruction || '').trimStart();
  if (/^\[루틴[·.\s]/.test(ti)) return true;
  if (tasks) {
    for (const task of tasks) {
      const taskIns = (task.instruction || '').trimStart();
      if (task.todoIds.includes(t.id) && /^\[루틴[·.\s]/.test(taskIns)) return true;
    }
  }
  return false;
}

// Task 자체가 [루틴...]로 시작하면 루틴 task — routine 섹션에 TaskCard로 고정 표시.
// 봄봄 식단(id 8cd87686)처럼 Task 레벨에 루틴 마커가 있는 항목을 잡기 위한 헬퍼.
// 가운뎃점·일반 점·공백 등 다양한 구분자 변형을 모두 매칭하여 누락 방지.
function isRoutineTask(task: TaskWithTodos): boolean {
  const s = (task.instruction || '').trimStart();
  return /^\[루틴[·.\s]/.test(s);
}

// === TodoListItem ===
// 기존 active / done / waiting 카드 3종 + 루틴 1종을 통합. mode로 분기.
//   active  — 취소 버튼 + 상태 Badge
//   done    — opacity 0.7 + 완료 Badge (취소 없음)
//   waiting — 시작 버튼(선택) + 취소 버튼 + 상태 Badge
//   routine — 취소/시작 버튼 없음 + 🔁 반복 Badge (완료 처리 불가, 항상 표시)

type ItemMode = 'active' | 'done' | 'waiting' | 'routine';

interface TodoListItemProps {
  todo: Todo;
  mode: ItemMode;
  onSelect: (todo: Todo, stageIdx?: number) => void;
  onReload: () => void;
  onStartTodo?: (instruction: string) => void;
}

function TodoListItem({ todo, mode, onSelect, onReload, onStartTodo }: TodoListItemProps) {
  const t = useT();
  const dimmed = mode === 'done';
  const showCancel = mode !== 'done';  // 루틴도 취소 버튼 표시 (루틴 종료)
  const showStart = mode === 'waiting' && !!onStartTodo;

  return (
    <Card
      withBorder
      padding="sm"
      onClick={() => onSelect(todo)}
      style={{ cursor: 'pointer', ...(dimmed ? { opacity: 0.7 } : {}) }}
    >
      <Group justify="space-between" align="flex-start" gap="xs" wrap="nowrap">
        <Text size="sm" style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {todo.instruction}
        </Text>
        {(showStart || showCancel) && (
          <Group gap={4} wrap="nowrap">
            {showStart && (
              <Button
                size="compact-xs"
                color="jarvis.3"
                radius="sm"
                h={24}
                leftSection={<IconPlayerPlay size={10} stroke={2} />}
                onClick={(e) => {
                  e.stopPropagation();
                  onStartTodo!(t('todos.delegateInstruction', { instruction: todo.instruction }));
                }}
              >
                {t('todo.start')}
              </Button>
            )}
            {showCancel && (
              <CancelButton
                h={24}
                title={mode === 'routine' ? t('todos.routineEndTitle') : mode === 'waiting' ? t('todo.cancelTitle.waiting') : t('todo.cancelTitle.active')}
                description={mode === 'routine' ? t('todos.routineEndDesc') : mode === 'active' ? t('todo.cancelDesc') : undefined}
                confirmLabel={mode === 'routine' ? t('todos.routineEndTitle') : mode === 'active' ? t('todo.confirmCancelWork') : t('common.cancel')}
                onCancel={async () => {
                  await fetch(`/api/todos/${todo.id}/cancel`, { method: 'POST' });
                  onReload();
                }}
              />
            )}
          </Group>
        )}
      </Group>
      {mode !== 'routine' && (
        <TodoGaugeWrapper>
          <Timeline
            todo={todo}
            onStageClick={mode === 'done' ? undefined : (idx) => onSelect(todo, idx)}
            forceCompleted={todo.status === 'done'}
          />
        </TodoGaugeWrapper>
      )}
      {todo.agentName && <Text size="xs" c="dimmed" mt={4}>{t('todo.assignee', { name: todo.agentName })}</Text>}
      <Group justify="space-between" align="center" mt={6}>
        <Group gap={6} wrap="nowrap">
          <Text size="xs" c="dimmed">{timeAgo(todo.createdAt)}</Text>
          <CronMeta cronExpr={todo.cronExpr} />
        </Group>
        {mode !== 'routine' && (
          <Badge
            size="xs"
            leftSection={BadgeDot}
            color={mode === 'done' ? 'var(--accent-success)' : badgeColor(todo.state)}
          >
            {mode === 'done' ? t('todo.stateDone') : (STATE_LABEL[todo.state] || todo.state)}
          </Badge>
        )}
      </Group>
    </Card>
  );
}

// === StageDetailModal ===

function StageDetailModal({
  todo,
  stageIdx,
  onClose,
}: {
  todo: Todo | null;
  stageIdx: number | null;
  onClose: () => void;
}) {
  const t = useT();
  const stageEntry = todo && stageIdx !== null
    ? (todo.stateHistory?.[stageIdx] ?? historyForStage(todo, stageIdx))
    : null;
  const stages = todo?.stages?.length ? todo.stages : getDefaultStages(t);
  const stageState = stageEntry?.state;
  const stageName: string = stageState
    ? (STATE_LABEL[stageState] ?? stageState)
    : (todo && stageIdx !== null ? (stages[stageIdx] ?? t('todo.stage', { n: stageIdx + 1 })) : '');

  return (
    <Modal
      opened={!!todo && stageIdx !== null}
      onClose={onClose}
      title={`${stageName}${stageEntry?.at ? ` · ${formatHHMM(stageEntry.at)}` : ''}`}
      size="lg"
      centered
      overlayProps={{ backgroundOpacity: 0.8, blur: 2 }}
    >
      {stageEntry?.note ? (
        <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(stageEntry.note) }} />
      ) : (
        <Text c="dimmed">{t('todo.noContent')}</Text>
      )}
    </Modal>
  );
}

// === TodoDetailView ===

function TodoDetailView({ todo, onBack, onSelectStage, onReload, onOpenNote }: {
  todo: Todo;
  onBack: () => void;
  onSelectStage: (idx: number) => void;
  onReload: () => void;
  onOpenNote?: (noteId: string) => void;
}) {
  const t = useT();
  // 관련 노트 — 이 태스크(todoId)를 [[task:..]]로 링크한 노트. 노트 패널이 닫혀도 localStorage에서 스캔.
  const relatedNotes = useMemo(() => findNotesLinkingTask(todo.id), [todo.id]);
  return (
    <Stack h="100%" gap={0}>
      <DrawerSubHeader title={t('todo.detailTitle')} onBack={onBack} />
      <ScrollArea style={{ flex: 1 }} p="md">
        <Stack gap="md">
          <Text fw={600} size="sm" style={{ whiteSpace: 'pre-wrap' }}>{todo.instruction}</Text>
          {onOpenNote && relatedNotes.length > 0 && (
            <Stack gap={4}>
              <Text size="xs" fw={600} c="dimmed">{t('todo.relatedNotes')} ({relatedNotes.length})</Text>
              {relatedNotes.map((n) => (
                <UnstyledButton key={n.id} onClick={() => onOpenNote(n.id)}>
                  <Text size="xs" c="blue.5" truncate="end">{n.title.trim() || t('notes.untitled')}</Text>
                </UnstyledButton>
              ))}
            </Stack>
          )}
          <Group gap="xs">
            <Badge size="sm" leftSection={BadgeDot} color={badgeColor(todo.state)}>
              {STATE_LABEL[todo.state] || todo.state}
            </Badge>
            <Text size="xs" c="dimmed">{timeAgo(todo.createdAt)}</Text>
          </Group>
          <Timeline todo={todo} onStageClick={onSelectStage} forceCompleted={todo.status === 'done'} />
          {todo.stateHistory?.length ? (
            <Stack gap={4}>
              <Text size="xs" fw={600} c="dimmed">{t('todo.history')}</Text>
              {todo.stateHistory.map((h, i) => (
                <HistoryEntry
                  key={i}
                  entry={h}
                  jobId={todo.relatedJobIds?.[0]}
                  isWorking={todo.state === 'working'}
                  onCancel={todo.state === 'working' && todo.relatedJobIds?.[0] ? async () => {
                    for (const jid of todo.relatedJobIds!) {
                      try { await fetch(`/api/jobs/${jid}/cancel`, { method: 'POST' }); } catch { /* */ }
                    }
                    onReload();
                  } : undefined}
                />
              ))}
            </Stack>
          ) : null}
          {todo.relatedJobIds?.length ? (
            <Group gap={4} wrap="wrap">
              {todo.relatedJobIds.map((id) => (
                <Badge key={id} size="xs" color="gray" style={{ fontFamily: 'monospace' }}>
                  {id.slice(0, 8)}
                </Badge>
              ))}
            </Group>
          ) : null}
        </Stack>
      </ScrollArea>
    </Stack>
  );
}

// === 분류 헬퍼 ===

interface Classified {
  taskInProgress: TaskWithTodos[];
  taskDone: TaskWithTodos[];
  taskWaiting: TaskWithTodos[];
  routineMasters: TaskWithTodos[];   // TODO 탭 상시 잔존 (cron 메타, 진행률 바 없음)
  routineInstances: TaskWithTodos[]; // 진행/완료 탭 (aggregateTaskStatus 기준)
  progressActive: Todo[];
  progressDone: Todo[];
  waitingList: Todo[];
  routineList: Todo[];
}

function classify(todos: Todo[], tasks: TaskWithTodos[]): Classified {
  const taskOwnedIds = new Set<string>();
  for (const task of tasks) for (const id of task.todoIds) taskOwnedIds.add(id);

  // 루틴 task 분류:
  //   마스터(routineType='master'): TODO 탭 상시 잔존. todo 없음, 진행률 바 없음.
  //   인스턴스(routineType='instance'): aggregateTaskStatus 기준으로 진행/완료 탭 분류.
  //   구형 호환(routineType 없음 + isRoutineTask): 기존 routineInstances로 처리.
  const routineMasters: TaskWithTodos[] = [];
  const routineInstances: TaskWithTodos[] = [];
  const routineTaskIds = new Set<string>();
  const routineTaskTodoIds = new Set<string>();
  for (const task of tasks) {
    if (task.routineType === 'master') {
      routineMasters.push(task);
      routineTaskIds.add(task.id);
      for (const id of task.todoIds) routineTaskTodoIds.add(id);
    } else if (task.routineType === 'instance' || isRoutineTask(task)) {
      routineInstances.push(task);
      routineTaskIds.add(task.id);
      for (const id of task.todoIds) routineTaskTodoIds.add(id);
    }
  }

  const orphanTodos = todos.filter((t) => !taskOwnedIds.has(t.id));

  const taskInProgress: TaskWithTodos[] = [];
  const taskDone: TaskWithTodos[] = [];
  const taskWaiting: TaskWithTodos[] = [];
  for (const task of tasks) {
    if (routineTaskIds.has(task.id)) continue;
    const agg = aggregateTaskStatus(task);
    if (agg === 'all-done' || agg === 'cancelled') taskDone.push(task);
    else if (agg === 'in-progress') taskInProgress.push(task);
    else if (agg === 'failed' || agg === 'pending') taskWaiting.push(task);
  }

  // 루틴 todo — task 소속 여부 무관 분류. 단, 루틴 task의 자식은 task 안에 노출되니 routineList에서 제외(중복 방지).
  const routineList = todos.filter((t) => isRoutineTodo(t, tasks) && !routineTaskTodoIds.has(t.id) && t.status !== 'done');
  const routineIds = new Set(routineList.map((t) => t.id));
  const normalOrphans = orphanTodos.filter((t) => !routineIds.has(t.id));

  const progressActive = normalOrphans.filter(
    (t) => t.status !== 'done' && PROGRESS_STATES.has(t.state ?? '') && t.state !== 'done',
  );
  const progressDone = normalOrphans.filter((t) => t.status === 'done');
  const waitingList = normalOrphans.filter(
    (t) =>
      t.status !== 'done' &&
      WAITING_STATES.has(t.state ?? 'received') &&
      !PROGRESS_STATES.has(t.state ?? 'received'),
  );

  return { taskInProgress, taskDone, taskWaiting, routineMasters, routineInstances, progressActive, progressDone, waitingList, routineList };
}

// === TodoPanel ===

export default function TodoPanel({ visible, onClose, onStartTodo, onOpenNote }: Props) {
  const t = useT();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [tasks, setTasks] = useState<TaskWithTodos[]>([]);
  const [selected, setSelected] = useState<Todo | null>(null);
  const [selectedStageIdx, setSelectedStageIdx] = useState<number | null>(null);
  const [tab, setTab] = useState<'progress' | 'waiting'>('progress');
  // 목록 스크롤 위치 복원: 상세 진입 시 현재 탭 ScrollArea viewport의 scrollTop을 저장,
  // 뒤로가기로 목록 재마운트 시 복원. 탭별로 별도 보관.
  const progressViewportRef = useRef<HTMLDivElement>(null);
  const waitingViewportRef = useRef<HTMLDivElement>(null);
  const scrollPos = useRef<{ progress: number; waiting: number }>({ progress: 0, waiting: 0 });

  const load = useCallback(async () => {
    const [todoData, taskData] = await Promise.all([fetchTodos(), fetchTaskTree()]);
    setTodos(todoData);
    setTasks(taskData);
  }, []);

  useEffect(() => {
    if (!visible) return;
    load();
    const iv = setInterval(load, 10000);
    return () => clearInterval(iv);
  }, [visible, load]);

  // 목록이 보일 때(상세 닫힘/탭 전환) 저장된 스크롤 위치 복원. DOM 렌더 후 rAF로 적용.
  useEffect(() => {
    if (selected) return;
    const vp = tab === 'progress' ? progressViewportRef.current : waitingViewportRef.current;
    const target = scrollPos.current[tab];
    if (!vp || target <= 0) return;
    const raf = requestAnimationFrame(() => {
      if (vp) vp.scrollTop = target;
    });
    return () => cancelAnimationFrame(raf);
  }, [selected, tab]);

  // 완료 정리 진행 상태 (null이면 유휴). 수백 건 삭제가 수십 초 걸려 진행 표시 필수.
  const [cleanup, setCleanup] = useState<{ done: number; total: number } | null>(null);

  const handleDeleteAll = async () => {
    if (cleanup) return;
    const taskOwned = new Set<string>();
    for (const task of tasks) for (const id of task.todoIds) taskOwned.add(id);
    // 루틴 todo는 영구 노출 대상 → "완료 정리"로 삭제 금지.
    const completedOrphan = todos.filter(
      (t) => t.status === 'done' && !taskOwned.has(t.id) && !isRoutineTodo(t, tasks),
    );
    // 카운트(doneCleanupCount)와 동일 기준: task.status 필드가 아니라 자식 todo 집계로 판정.
    // task.status는 전부 완료돼도 'active'로 남는 경우가 있어 status 필드 기준이면 0건 삭제됨.
    const closedTasks = tasks.filter((task) => {
      if (task.routineType === 'master' || task.routineType === 'instance' || isRoutineTask(task)) return false;
      const agg = aggregateTaskStatus(task);
      return agg === 'all-done' || agg === 'cancelled';
    });
    const targets = [
      ...completedOrphan.map((t) => `/api/todos/${t.id}/delete`),
      ...closedTasks.map((task) => `/api/tasks/${task.id}/delete`),
    ];
    setCleanup({ done: 0, total: targets.length });
    try {
      // 1건씩 순차 요청은 수백 건에서 수십 초 소요 → 10건 병렬 배치로 삭제.
      const BATCH = 10;
      for (let i = 0; i < targets.length; i += BATCH) {
        await Promise.all(
          targets.slice(i, i + BATCH).map((url) => fetch(url, { method: 'POST' }).catch(() => {})),
        );
        setCleanup({ done: Math.min(i + BATCH, targets.length), total: targets.length });
      }
    } finally {
      setCleanup(null);
      load();
    }
  };

  if (!visible) return null;

  const c = classify(todos, tasks);

  const selectTodo = (t: Todo, idx?: number) => {
    // 상세 진입 전 현재 탭 목록의 스크롤 위치 저장 (viewport 언마운트 전).
    const vp = tab === 'progress' ? progressViewportRef.current : waitingViewportRef.current;
    if (vp) scrollPos.current[tab] = vp.scrollTop;
    setSelected(t);
    setSelectedStageIdx(idx ?? null);
  };

  const stageModal = (
    <StageDetailModal
      todo={selected}
      stageIdx={selectedStageIdx}
      onClose={() => setSelectedStageIdx(null)}
    />
  );

  if (selected) {
    return (
      <>
        {stageModal}
        <TodoDetailView
          todo={selected}
          onBack={() => setSelected(null)}
          onSelectStage={setSelectedStageIdx}
          onReload={load}
          onOpenNote={onOpenNote}
        />
      </>
    );
  }

  // 루틴 인스턴스는 진행/완료 탭, 마스터는 TODO 탭에 표시
  const progressCount = c.progressActive.length + c.progressDone.length + c.taskInProgress.length + c.taskDone.length + c.routineInstances.length;
  const waitingCount = c.waitingList.length + c.taskWaiting.length + c.routineList.length + c.routineMasters.length;
  const doneCleanupCount = c.progressDone.length + c.taskDone.length;

  // 진행/완료 카드를 task·todo 통합 후 createdAt 내림차순(최신순) 정렬.
  type ActiveItem = { kind: 'task'; data: TaskWithTodos } | { kind: 'todo'; data: Todo };
  const byCreatedDesc = (a: ActiveItem, b: ActiveItem) =>
    new Date(b.data.createdAt).getTime() - new Date(a.data.createdAt).getTime();
  const activeItems: ActiveItem[] = [
    ...c.taskInProgress.map((t): ActiveItem => ({ kind: 'task', data: t })),
    ...c.progressActive.map((t): ActiveItem => ({ kind: 'todo', data: t })),
  ].sort(byCreatedDesc);
  const doneItems: ActiveItem[] = [
    ...c.taskDone.map((t): ActiveItem => ({ kind: 'task', data: t })),
    ...c.progressDone.map((t): ActiveItem => ({ kind: 'todo', data: t })),
  ].sort(byCreatedDesc);

  return (
    <>
      {stageModal}
      <Stack h="100%" gap={0}>
        <Group justify="space-between" align="center" p="md" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
          <Text fw={600} size="md">{t('nav.todos')}</Text>
          <Group gap="xs">
            {tab === 'progress' && (doneCleanupCount > 0 || cleanup) && (
              <button
                onClick={handleDeleteAll}
                disabled={!!cleanup}
                style={btn('sm', 'neutral', cleanup ? { cursor: 'not-allowed', opacity: 0.6 } : undefined)}
              >
                {cleanup && <Loader size={12} color="var(--text-muted)" />}
                {cleanup
                  ? `${t('todo.cleaning')} ${cleanup.done}/${cleanup.total}`
                  : `${t('todo.cleanup')} (${doneCleanupCount})`}
              </button>
            )}
            <ActionIcon variant="subtle" color="gray" size={36} className="drawer-close" onClick={onClose} aria-label={t('common.close')}>
              <IconX size={18} stroke={1.5} />
            </ActionIcon>
          </Group>
        </Group>
        <Tabs value={tab} onChange={(v) => setTab((v as 'progress' | 'waiting') || 'progress')} keepMounted={false}>
          <Tabs.List grow>
            <Tabs.Tab value="progress">{t('todo.tab.progress')} ({progressCount})</Tabs.Tab>
            <Tabs.Tab value="waiting">{t('todo.tab.todo')} ({waitingCount})</Tabs.Tab>
          </Tabs.List>
        </Tabs>
        {tab === 'progress' ? (
          <ScrollArea style={{ flex: 1 }} p="sm" viewportRef={progressViewportRef}>
            <Stack gap="xs">
              {c.progressActive.length === 0 && c.progressDone.length === 0
                && c.taskInProgress.length === 0 && c.taskDone.length === 0
                && c.routineInstances.length === 0 && (
                <Text c="dimmed" ta="center" py="lg">{t('todo.empty.progress')}</Text>
              )}
              {activeItems.map((it) => it.kind === 'task' ? (
                <TaskCard
                  key={it.data.id}
                  task={it.data}
                  onTodoClick={(t) => selectTodo(t)}
                  onTodoStageClick={(t, idx) => selectTodo(t, idx)}
                  onReload={load}
                />
              ) : (
                <TodoListItem
                  key={it.data.id}
                  todo={it.data}
                  mode="active"
                  onSelect={selectTodo}
                  onReload={load}
                />
              ))}
              {doneItems.map((it) => it.kind === 'task' ? (
                <TaskCard
                  key={it.data.id}
                  task={it.data}
                  defaultExpanded={false}
                  onTodoClick={(t) => selectTodo(t)}
                  onTodoStageClick={(t, idx) => selectTodo(t, idx)}
                  onReload={load}
                />
              ) : (
                <TodoListItem
                  key={it.data.id}
                  todo={it.data}
                  mode="done"
                  onSelect={selectTodo}
                  onReload={load}
                />
              ))}
              {(c.routineList.length + c.routineInstances.length) > 0 && (
                <Box className="routine-section">
                  <Text size="xs" fw={600} c="dimmed" mb={6}>
                    {t('todo.routineSection', { n: c.routineList.length + c.routineInstances.length })}
                  </Text>
                  <Stack gap="xs">
                    {c.routineInstances.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        isRoutine
                        onTodoClick={(t) => selectTodo(t)}
                        onTodoStageClick={(t, idx) => selectTodo(t, idx)}
                        onReload={load}
                      />
                    ))}
                    {c.routineList.map((t) => (
                      <TodoListItem
                        key={t.id}
                        todo={t}
                        mode="routine"
                        onSelect={selectTodo}
                        onReload={load}
                      />
                    ))}
                  </Stack>
                </Box>
              )}
            </Stack>
          </ScrollArea>
        ) : (
          <ScrollArea style={{ flex: 1 }} p="sm" viewportRef={waitingViewportRef}>
            <Stack gap="xs">
              {c.waitingList.length === 0 && c.taskWaiting.length === 0
                && c.routineList.length === 0 && c.routineMasters.length === 0 && (
                <Text c="dimmed" ta="center" py="lg">{t('todo.empty.todo')}</Text>
              )}
              {c.taskWaiting.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onTodoClick={(t) => selectTodo(t)}
                  onTodoStageClick={(t, idx) => selectTodo(t, idx)}
                  onReload={load}
                />
              ))}
              {c.waitingList.map((t) => (
                <TodoListItem
                  key={t.id}
                  todo={t}
                  mode="waiting"
                  onSelect={selectTodo}
                  onReload={load}
                  onStartTodo={onStartTodo}
                />
              ))}
              {/* 루틴 마스터 섹션 — 스케줄 정의 카드 상시 표시. 인스턴스는 진행 탭으로 이동. */}
              {(c.routineList.length + c.routineMasters.length) > 0 && (
                <Box className="routine-section">
                  <Text size="xs" fw={600} c="dimmed" mb={6}>
                    {t('todo.routineSection', { n: c.routineList.length + c.routineMasters.length })}
                  </Text>
                  <Stack gap="xs">
                    {c.routineMasters.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        isRoutine
                        onTodoClick={(t) => selectTodo(t)}
                        onTodoStageClick={(t, idx) => selectTodo(t, idx)}
                        onReload={load}
                      />
                    ))}
                    {c.routineList.map((t) => (
                      <TodoListItem
                        key={t.id}
                        todo={t}
                        mode="routine"
                        onSelect={selectTodo}
                        onReload={load}
                      />
                    ))}
                  </Stack>
                </Box>
              )}
            </Stack>
          </ScrollArea>
        )}
      </Stack>
    </>
  );
}
