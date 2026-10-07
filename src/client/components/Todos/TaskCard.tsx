import React, { useState } from 'react';
import { Group, Text, Card, Badge, Box, Collapse } from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconRepeat } from '@tabler/icons-react';
import type { Todo, TaskWithTodos } from '../../utils/api';
import { timeAgo } from '../../utils/format';
import { cronToKorean } from '../../utils/cron';
import TaskGantt from './TaskGantt';
import { Timeline } from './Timeline';
import CancelButton from './CancelButton';
import { BadgeDot, TodoGaugeWrapper } from './TodoGauge';
import { useT } from '../../i18n/I18nProvider';
import {
  STATE_LABEL,
  cellColor,
  aggregateTaskStatus,
  aggregateBadgeColor,
  aggregateLabel,
  TaskAggregateStatus,
} from './todoStatus';

// TodoPanel이 기존 경로(`./TaskCard`)로 import 중 — 호환성 위해 re-export.
export { aggregateTaskStatus };

interface TaskCardProps {
  task: TaskWithTodos;
  onTodoClick: (todo: Todo) => void;
  onTodoStageClick?: (todo: Todo, stageIdx: number) => void;
  defaultExpanded?: boolean;
  onReload: () => void;
  isRoutine?: boolean;
}

function TaskHeader({ task, expanded, doneCount, total }: {
  task: TaskWithTodos;
  expanded: boolean;
  doneCount: number;
  total: number;
}) {
  const aggStatus = aggregateTaskStatus(task);
  return (
    <>
      <Group gap={6} align="flex-start" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
        <Box pt={2}>
          {expanded ? <IconChevronDown size={14} stroke={1.5} /> : <IconChevronRight size={14} stroke={1.5} />}
        </Box>
        <Text size="sm" fw={600} style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          📋 {task.instruction}
        </Text>
      </Group>
      {aggStatus !== 'all-done' && aggStatus !== 'cancelled' && (
        <Badge size="xs" leftSection={BadgeDot} color={aggregateBadgeColor(aggStatus)}>
          {aggregateLabel(aggStatus, total, doneCount)}
        </Badge>
      )}
    </>
  );
}

function TaskGauge({ todos }: { todos: Todo[] }) {
  const t = useT();
  return (
    <Group gap={2} mt={8} wrap="nowrap" aria-label={t('todos.progressGaugeAria')}>
      {todos.map((t) => (
        <Box
          key={`gauge-${t.id}`}
          style={{ flex: 1, height: 4, borderRadius: 4, background: cellColor(t.state) }}
        />
      ))}
    </Group>
  );
}

// 루틴 카드 표시용 이름 추출: "[루틴 보강 실행] 봄봄..." → "봄봄..." (40자 제한)
function routineLabel(instruction: string): string {
  const m = instruction.trimStart().match(/^(?:\[루틴[^\]]*\]|루틴\s+\[[^\]]*\])\s*(.+)/);
  const content = m ? m[1].split('\n')[0] : instruction.split('\n')[0];
  return content.length > 40 ? content.slice(0, 40) + '…' : content;
}

function SingleChildBody({ todo, onTodoClick, onTodoStageClick, aggStatus }: {
  todo: Todo;
  onTodoClick: (todo: Todo) => void;
  onTodoStageClick?: (todo: Todo, stageIdx: number) => void;
  aggStatus?: TaskAggregateStatus;
}) {
  return (
    <Box>
      <TodoGaugeWrapper mt={4}>
        <Timeline
          todo={todo}
          onStageClick={onTodoStageClick ? (idx) => onTodoStageClick(todo, idx) : undefined}
          forceCompleted={aggStatus === 'all-done'}
        />
      </TodoGaugeWrapper>
      <Text
        size="sm"
        mt={4}
        onClick={(e) => { e.stopPropagation(); onTodoClick(todo); }}
        style={{ cursor: 'pointer', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
      >
        📋 {todo.instruction}
      </Text>
    </Box>
  );
}

export default function TaskCard({
  task,
  onTodoClick,
  onTodoStageClick,
  defaultExpanded = true,
  onReload,
  isRoutine = false,
}: TaskCardProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const aggStatus = aggregateTaskStatus(task);
  const doneCount = task.todos.filter((t) => t.state === 'done' || t.state === 'closed').length;
  const total = task.todos.length;
  // 종결 판정 — task.status뿐 아니라 aggStatus도 확인.
  // 자식 todo가 모두 done이지만 서버가 task.status를 'active'로 둔 케이스(=aggStatus 'all-done')에서도
  // 취소 버튼/상호작용 가드를 유지하기 위함. cancelled 집계 결과도 동일하게 종결로 처리.
  const isClosed = task.status !== 'active' || aggStatus === 'all-done' || aggStatus === 'cancelled';
  // 자식 1개일 때는 부모 헤더(📋 instruction)를 생략하고 자식 카드 형태로 단순 표시 — 기존 단독 카드 UX 보존.
  const singleChild = task.todos.length === 1;
  const dimmed = !isRoutine && (aggStatus === 'all-done' || aggStatus === 'cancelled');

  return (
    <Card withBorder padding="sm" style={{ opacity: dimmed ? 0.75 : 1 }}>
      {!singleChild && (
        <Group
          justify="space-between"
          align="flex-start"
          gap="xs"
          wrap="nowrap"
          onClick={() => setExpanded((v) => !v)}
          style={{ cursor: 'pointer', userSelect: 'none' }}
        >
          <TaskHeader task={task} expanded={expanded} doneCount={doneCount} total={total} />
        </Group>
      )}

      {!singleChild && task.todos.length > 0 && <TaskGauge todos={task.todos} />}

      {singleChild && task.todos.length > 0 && !isRoutine && (
        <Text size="xs" c="dimmed" mt={4}>
          {STATE_LABEL[task.todos[0].state] ?? task.todos[0].state}
          {task.todos[0].agentName ? ` · ${task.todos[0].agentName}` : ''}
        </Text>
      )}

      <Collapse expanded={singleChild || expanded}>
        <Box mt={singleChild ? 0 : 8}>
          {singleChild ? (
            isRoutine ? (
              // 루틴 마스터/인스턴스 카드: Timeline 없음, 이름 한 줄만 표시
              <Text size="sm" truncate style={{ color: 'var(--mantine-color-default-color)' }}>
                {routineLabel(task.instruction)}
              </Text>
            ) : (
              <SingleChildBody
                todo={task.todos[0]}
                onTodoClick={onTodoClick}
                onTodoStageClick={onTodoStageClick}
                aggStatus={aggStatus}
              />
            )
          ) : (
            <TaskGantt todos={task.todos} onTodoClick={onTodoClick} onTodoStageClick={onTodoStageClick} aggStatus={aggStatus} />
          )}
        </Box>
      </Collapse>

      <Group justify="space-between" align="center" mt={8}>
        <Text size="xs" c="dimmed" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          {isRoutine && (task.cronExpr || task.todos[0]?.cronExpr)
            ? <><IconRepeat size={10} stroke={1.5} /> {cronToKorean(task.cronExpr ?? task.todos[0]?.cronExpr ?? '')}</>
            : timeAgo(task.createdAt)}
        </Text>
        {(!isClosed || isRoutine) ? (
          task.routineType === 'master' ? (
            <CancelButton
              label={t('common.delete')}
              title={t('todos.routineDeleteTitle')}
              description={t('todos.routineDeleteDesc')}
              confirmLabel={t('common.delete')}
              cancelLabel={t('common.cancel')}
              onCancel={async () => {
                await fetch(`/api/tasks/${task.id}/delete-routine`, { method: 'POST' });
                onReload();
              }}
            />
          ) : (
            <CancelButton
              title={t('todos.bundleCancelTitle')}
              description={t('todos.bundleCancelDesc')}
              confirmLabel={t('todos.bundleCancelConfirm')}
              onCancel={async () => {
                await fetch(`/api/tasks/${task.id}/cancel`, { method: 'POST' });
                onReload();
              }}
            />
          )
        ) : aggStatus === 'all-done' ? (
          // 완료 상태에서도 하단 우측 영역에 상태 표시를 노출해 진행/대기/완료 카드의 푸터 레이아웃 일관성 유지.
          // 헤더 Badge와 동일 스타일(BadgeDot + aggregateBadgeColor)로 통일.
          <Badge size="xs" leftSection={BadgeDot} color={aggregateBadgeColor('all-done')}>{t('todo.stateDone')}</Badge>
        ) : aggStatus === 'cancelled' ? (
          <Badge size="xs" leftSection={BadgeDot} color={aggregateBadgeColor('cancelled')}>{t('todos.cancelledLabel')}</Badge>
        ) : null}
      </Group>
    </Card>
  );
}
