import React from 'react';
import { Group, Text, Box } from '@mantine/core';
import type { Todo } from '../../utils/api';
import { stageColor } from './todoStatus';
import { useT } from '../../i18n/I18nProvider';

// 기본 2단계 게이지: 진행중 → 완료. Job/Todo에 stages가 있으면 그걸 우선 사용.
// 모듈 상수는 컴포넌트 밖이라 훅 사용 불가 — 렌더 지점(Timeline/TodoPanel)에서 t()로 매핑.
export function getDefaultStages(t: ReturnType<typeof useT>): string[] {
  return [t('todos.stageInProgress'), t('todo.stateDone')];
}

// 호환성 re-export — 기존 외부 import 보호용. 내부 사용은 stageColor 권장.
export const stageBg = stageColor;

// done/closed/completed/cancelled → 마지막 단계. 그 외 → 0(진행중).
// stages 배열 길이가 가변(외부 stages prop 주입)이라도 동일 로직 — 완료/취소=끝, 그 외=시작.
export function mapStateToStageIdx(state: string, stagesLen: number): number {
  const isDone = state === 'done' || state === 'closed' || state === 'completed' || state === 'cancelled';
  return isDone ? Math.max(0, stagesLen - 1) : 0;
}

type StateHistoryEntry = NonNullable<Todo['stateHistory']>[number];

export function historyForStage(todo: Todo, stageIdx: number): StateHistoryEntry | null {
  const history = todo.stateHistory;
  if (!history?.length) return null;
  // 기본 2단계 매핑: 0=진행중(working 진입 시점), 1=완료(done 진입 시점).
  // todo.stages가 있으면 단계별 history(working/reporting/delegated)를 순서대로 매핑.
  if (!todo.stages?.length) {
    const targetState = stageIdx === 0 ? 'working' : 'done';
    return history.find((h) => h.state === targetState) ?? null;
  }
  const stageHistories = history.filter((h) =>
    h.state === 'working' || h.state === 'reporting' || h.state === 'delegated',
  );
  return stageHistories[stageIdx] ?? null;
}

interface StageCellProps {
  todo: Todo;
  stage: string;
  idx: number;
  isDone: boolean;
  isCurrent: boolean;
  slim: boolean;
  onStageClick?: (idx: number) => void;
}

function StageCell({ todo, stage, idx, isDone, isCurrent, slim, onStageClick }: StageCellProps) {
  const bg = stageColor(todo.state, isDone, isCurrent);
  const hasHistory = !!historyForStage(todo, idx);
  const clickable = hasHistory && !!onStageClick;
  return (
    <Box
      style={{
        flex: 1,
        // flex item 기본 min-width:auto면 nowrap 텍스트가 셀을 content 폭 이하로 못 줄여
        // bar 폭을 초과해도 텍스트가 보임. minWidth:0 + overflow:hidden으로 셀이 bar 폭 내로 축소·클리핑.
        minWidth: 0,
        overflow: 'hidden',
        textAlign: 'center',
        cursor: clickable ? 'pointer' : 'default',
      }}
      onClick={(e) => {
        if (clickable) {
          e.stopPropagation();
          onStageClick!(idx);
        }
      }}
    >
      <Box style={{ height: 4, borderRadius: 4, background: bg, marginBottom: 4 }} />
      <Text
        size="xs"
        c={isDone || isCurrent ? undefined : 'dimmed'}
        style={{
          fontSize: 'var(--font-s)',
          lineHeight: 1.2,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {stage}
      </Text>
      {!slim && (
        <Text
          size="xs"
          c="dimmed"
          style={{ fontSize: 'var(--font-s)', lineHeight: 1.2, minHeight: '1em' }}
        >
          {todo.stageAgents?.[idx] || ' '}
        </Text>
      )}
    </Box>
  );
}

interface TimelineProps {
  todo: Todo;
  onStageClick?: (stageIdx: number) => void;
  // slim=true: 4px 바 + 단계 라벨만 표시 (단계별 담당 에이전트 라벨 숨김).
  //   간트 차트 행 내부처럼 행 좌측에 이미 agentName이 있어 stageAgents 중복을 피해야 하는 컨텍스트.
  // slim=false(기본): 4px 바 + 단계 라벨 + 단계별 담당 에이전트 라벨. 단독 카드·TODO 목록·상세 화면 등.
  slim?: boolean;
  // stages: 외부에서 단계 배열을 명시 주입. 우선순위 = 명시 stages > todo.stages > DEFAULT_STAGES.
  stages?: string[];
  // forceCompleted: 부모 task가 done이지만 자식 todo.state가 비종결인 케이스에 100% 완료로 표시.
  forceCompleted?: boolean;
}

export function Timeline({ todo, onStageClick, slim = false, stages: stagesProp, forceCompleted = false }: TimelineProps) {
  const t = useT();
  const externalStages = stagesProp?.length ? stagesProp : todo.stages;
  const isCancelled = todo.state === 'cancelled';
  const baseStages = externalStages?.length ? externalStages : getDefaultStages(t);
  // cancelled + 기본 2단계일 때 마지막 라벨을 '취소됨'으로 교체.
  const stages = (isCancelled && !externalStages?.length)
    ? [...baseStages.slice(0, -1), t('todos.cancelledLabel')]
    : baseStages;
  const currentIdx = externalStages?.length
    ? (todo.currentStage ?? 0)
    : mapStateToStageIdx(forceCompleted ? 'done' : todo.state, stages.length);

  return (
    <Group gap={2} mt={slim ? 0 : 'xs'} wrap="nowrap" align="flex-start">
      {stages.map((stage, i) => {
        const isDone = i < currentIdx || todo.state === 'done' || isCancelled || forceCompleted;
        const isCurrent = i === currentIdx && todo.state !== 'done' && !isCancelled && !forceCompleted;
        return (
          <StageCell
            key={i}
            todo={todo}
            stage={stage}
            idx={i}
            isDone={isDone}
            isCurrent={isCurrent}
            slim={slim}
            onStageClick={onStageClick}
          />
        );
      })}
    </Group>
  );
}
