import React, { useMemo } from 'react';
import { Text, Box } from '@mantine/core';
import type { Todo } from '../../utils/api';
import { Timeline } from './Timeline';
import { STATE_LABEL_SHORT, todoStartMs, todoEndMs, TaskAggregateStatus } from './todoStatus';
import { useT } from '../../i18n/I18nProvider';

interface Props {
  todos: Todo[];
  onTodoClick: (t: Todo) => void;
  onTodoStageClick?: (t: Todo, stageIdx: number) => void;
  aggStatus?: TaskAggregateStatus;
}

interface TimeRange {
  totalStart: number;
  totalDuration: number;
  totalEnd: number;
}

// 자식들의 시작 시점 min → 완료(또는 now snapshot) max로 시간축 스케일 계산.
function computeTimeRange(todos: Todo[]): TimeRange {
  const now = Date.now();
  if (todos.length === 0) {
    return { totalStart: now, totalDuration: 1, totalEnd: now + 1 };
  }
  let s = Infinity;
  let e = -Infinity;
  for (const t of todos) {
    const ts = todoStartMs(t);
    const te = todoEndMs(t, now);
    if (ts < s) s = ts;
    if (te > e) e = te;
  }
  if (!Number.isFinite(s)) s = now;
  if (!Number.isFinite(e) || e <= s) e = s + 60_000; // 최소 1분 폭 보장
  return { totalStart: s, totalDuration: e - s, totalEnd: e };
}

// 시간축 위 막대 위치(%). 최소 폭 5% 보장 + 100% 초과 방지.
function computeBarPosition(t: Todo, range: TimeRange) {
  const ts = todoStartMs(t);
  const te = todoEndMs(t, range.totalEnd);
  const leftPct = Math.max(0, Math.min(100, ((ts - range.totalStart) / range.totalDuration) * 100));
  const rawWidth = ((te - ts) / range.totalDuration) * 100;
  const widthPct = Math.min(100 - leftPct, Math.max(5, rawWidth));
  return { leftPct, widthPct };
}

// 원형 숫자(1-based) — 유니코드 3개 구간으로 1~50 커버, 초과 시 "n." fallback.
//  ①~⑳(1~20): U+2460~U+2473 / ㉑~㉟(21~35): U+3251~U+325F / ㊱~㊿(36~50): U+32B1~U+32BF
function circledNumber(n: number): string {
  if (n >= 1 && n <= 20) return String.fromCharCode(0x2460 + (n - 1));
  if (n >= 21 && n <= 35) return String.fromCharCode(0x3251 + (n - 21));
  if (n >= 36 && n <= 50) return String.fromCharCode(0x32b1 + (n - 36));
  return `${n}.`;
}
function rowPrefix(i: number): string {
  return circledNumber(i + 1);
}

// 묶음 카드 펼침 시 자식 에이전트별 단계 게이지 목록 — 좌우 분리 레이아웃.
//  [좌측 패널: 에이전트명 + 상태 (고정, 스크롤 없음)] | [우측 패널: 트랙 위 absolute Timeline (단독 가로 스크롤)]
//  좌/우는 각각 height:40px 행을 같은 순서로 쌓아 행끼리 정렬. 우측만 overflow-x 스크롤이라
//  게이지가 물리적으로 좌측 영역에 나타날 수 없음 → stacking 충돌·겹침 원천 차단.
// now snapshot은 todos 변동 시에만 갱신 → 매 렌더 떨림 방지(상위 폴링 10초가 갱신).
export default function TaskGantt({ todos, onTodoClick, onTodoStageClick, aggStatus }: Props) {
  // 이 파일은 map 콜백에서 Todo 항목 변수명으로 `t`를 이미 사용하므로 번역 함수는 `tr`로 명명(충돌 회피).
  const tr = useT();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const range = useMemo(() => computeTimeRange(todos), [todos]);

  if (todos.length === 0) {
    return <Text size="xs" c="dimmed">{tr('todos.noSubtasks')}</Text>;
  }

  return (
    <Box className="task-gantt-split">
      {/* 좌측 패널: 고정, 스크롤 없음 */}
      <Box className="task-gantt-left-panel">
        {todos.map((t, i) => (
          <Box
            key={`left-${t.id}`}
            className="gantt-row-left"
            onClick={(e) => { e.stopPropagation(); onTodoClick(t); }}
            role="button"
          >
            <Text className="gantt-row-name" title={t.agentName ?? ''}>
              {rowPrefix(i)} {t.agentName ?? tr('todos.unassigned')}
            </Text>
            <Text className="gantt-row-state">{STATE_LABEL_SHORT[t.state] ?? t.state}</Text>
          </Box>
        ))}
      </Box>
      {/* 우측 패널: 이 컨테이너만 overflow-x:auto 가로 스크롤 */}
      <Box className="task-gantt-scroll">
        <Box className="task-gantt-inner">
          {todos.map((t) => {
            const { leftPct, widthPct } = computeBarPosition(t, range);
            return (
              <Box
                key={`right-${t.id}`}
                className="gantt-row-right"
                onClick={(e) => { e.stopPropagation(); onTodoClick(t); }}
                role="button"
              >
                <Box className="gantt-row-timeline">
                  <Box className="gantt-row-track" />
                  <Box
                    className="gantt-row-bar"
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                  >
                    <Timeline
                      todo={t}
                      slim
                      onStageClick={onTodoStageClick ? (idx) => onTodoStageClick(t, idx) : undefined}
                      forceCompleted={aggStatus === 'all-done'}
                    />
                  </Box>
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
