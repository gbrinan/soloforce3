import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Group, Text, Stack } from '@mantine/core';
import type { Schedule } from '../../utils/api';
import { useT } from '../../i18n/I18nProvider';
import type { MessageKey } from '../../i18n/messages';

interface Props {
  anchor: Date;
  schedules: Schedule[];
  onCellClick: (day: Date) => void;
  onScheduleClick: (s: Schedule) => void;
  onScheduleUpdate?: (id: string, patch: { start: string; end: string }) => Promise<void> | void;
  friendNames?: Record<string, string>;
}

// 요일 헤더 — 월요일 시작 그리드 순서의 번역 키.
const WEEKDAY_KEYS: MessageKey[] = ['cal.mon', 'cal.tue', 'cal.wed', 'cal.thu', 'cal.fri', 'cal.sat', 'cal.sun'];
const CLICK_THRESHOLD_PX = 5;

// 멀티데이 연결 바 레이아웃 상수 (px).
const DAY_NUM_H = 22;        // 날짜 숫자 영역 높이 — 바는 이 아래부터 시작
const LANE_H = 16;           // 바 한 줄(레인) 높이
const LANE_GAP = 2;          // 레인 사이 간격
const LANE_TOTAL = LANE_H + LANE_GAP;
const OVERFLOW_RESERVE = 16; // 셀 하단 "+N" 표시를 위한 예약 높이
const DEFAULT_MAX_LANES = 3; // 셀 높이 측정 전 기본 레인 수

// 일정 카드 배경 — 토큰 게이지 수준의 밝은 포인트 컬러(고유 hue 유지). 게이지 동족 hue는 --color-point-* 재사용.
// 과거/미래 모두 같은 밝은 색을 쓰고, 과거는 opacity로만 살짝 흐리게 구분한다.
const COLOR_HEX_BRIGHT: Record<string, string> = {
  blue: '#4F47E6',   // 포인트 인디고
  green: '#34D399',  // 포인트 민트
  red: '#F97171',    // 포인트 코랄
  yellow: '#FBC024', // 포인트 옐로우
  violet: '#9775fa', // 선명한 보라
  orange: '#ff922b', // 선명한 주황
};

function startOfMonthGrid(anchor: Date): Date {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const dow = (first.getDay() + 6) % 7;
  return new Date(first.getFullYear(), first.getMonth(), 1 - dow);
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function dayOverlaps(s: Schedule, day: Date): boolean {
  const ds = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const de = ds + 24 * 60 * 60 * 1000;
  const ss = new Date(s.start).getTime();
  const se = new Date(s.end).getTime();
  return ss < de && se > ds;
}

interface DragState {
  scheduleId: string;
  startMs: number;
  endMs: number;
  originDayIdx: number;
  hoverDayIdx: number;
  startClientX: number;
  startClientY: number;
  moved: boolean;
}

// 한 주(week) 안에서의 이벤트 구간(segment).
interface BarSeg {
  s: Schedule;
  startCol: number;
  endCol: number;
  isStart: boolean;
  isEnd: boolean;
  lane: number;
}

interface WeekLayout {
  cols: Date[];
  segs: BarSeg[];
}

export default function MonthView({ anchor, schedules, onCellClick, onScheduleClick, onScheduleUpdate, friendNames }: Props) {
  const t = useT();
  const today = new Date();
  const days = useMemo(() => {
    const start = startOfMonthGrid(anchor);
    const arr: Date[] = [];
    for (let i = 0; i < 42; i++) {
      arr.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    }
    return arr;
  }, [anchor]);

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const cellRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  // 주 한 줄(row) 높이를 측정해 표시 가능한 레인 수를 동적으로 계산한다.
  const [rowH, setRowH] = useState(0);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? 0;
      setRowH(h / 6);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const maxLanes = rowH > 0
    ? Math.max(1, Math.floor((rowH - DAY_NUM_H - OVERFLOW_RESERVE) / LANE_TOTAL))
    : DEFAULT_MAX_LANES;

  // 6주 × 7일 그리드를 주 단위로 묶고, 각 주의 멀티데이 바 구간 + 레인을 계산한다.
  const weeks = useMemo<WeekLayout[]>(() => {
    const result: WeekLayout[] = [];
    for (let w = 0; w < 6; w++) {
      const cols = days.slice(w * 7, w * 7 + 7);
      const segs: BarSeg[] = [];
      for (const s of schedules) {
        let startCol = -1;
        let endCol = -1;
        for (let c = 0; c < 7; c++) {
          if (dayOverlaps(s, cols[c])) {
            if (startCol < 0) startCol = c;
            endCol = c;
          }
        }
        if (startCol < 0) continue;
        const isStart = !dayOverlaps(s, addDays(cols[startCol], -1));
        const isEnd = !dayOverlaps(s, addDays(cols[endCol], 1));
        segs.push({ s, startCol, endCol, isStart, isEnd, lane: 0 });
      }
      segs.sort((a, b) =>
        a.startCol - b.startCol ||
        (b.endCol - b.startCol) - (a.endCol - a.startCol) ||
        (new Date(a.s.start).getTime() - new Date(b.s.start).getTime()),
      );
      const lanes: Array<Array<[number, number]>> = [];
      for (const seg of segs) {
        let lane = 0;
        for (;;) {
          const occ = lanes[lane];
          if (!occ) {
            lanes[lane] = [[seg.startCol, seg.endCol]];
            break;
          }
          const conflict = occ.some(([a, b]) => seg.startCol <= b && seg.endCol >= a);
          if (!conflict) {
            occ.push([seg.startCol, seg.endCol]);
            break;
          }
          lane++;
        }
        seg.lane = lane;
      }
      result.push({ cols, segs });
    }
    return result;
  }, [days, schedules]);

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: MouseEvent) => {
      const cur = dragRef.current;
      if (!cur) return;
      const dx = e.clientX - cur.startClientX;
      const dy = e.clientY - cur.startClientY;
      const dist = Math.hypot(dx, dy);
      const moved = dist >= CLICK_THRESHOLD_PX;
      let hoverIdx = cur.hoverDayIdx;
      for (let i = 0; i < cellRefs.current.length; i++) {
        const el = cellRefs.current[i];
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom) {
          hoverIdx = i;
          break;
        }
      }
      setDrag({ ...cur, hoverDayIdx: hoverIdx, moved });
    };
    const onUp = (e: MouseEvent) => {
      const cur = dragRef.current;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (!cur) { setDrag(null); return; }
      const dx = e.clientX - cur.startClientX;
      const dy = e.clientY - cur.startClientY;
      const dist = Math.hypot(dx, dy);
      if (dist < CLICK_THRESHOLD_PX) {
        const s = schedules.find((x) => x.id === cur.scheduleId);
        if (s) onScheduleClick(s);
        setDrag(null);
        return;
      }
      const deltaDays = cur.hoverDayIdx - cur.originDayIdx;
      setDrag(null);
      if (onScheduleUpdate && deltaDays !== 0) {
        const newStartMs = cur.startMs + deltaDays * 86400000;
        const newEndMs = cur.endMs + deltaDays * 86400000;
        void onScheduleUpdate(cur.scheduleId, {
          start: new Date(newStartMs).toISOString(),
          end: new Date(newEndMs).toISOString(),
        });
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag !== null, onScheduleClick, onScheduleUpdate, schedules]);

  // 바를 잡은 위치(포인터)의 셀을 hit-test 하여 드래그 기준 셀을 정한다.
  const beginDrag = (e: React.MouseEvent, s: Schedule, fallbackIdx: number) => {
    if (s.owner !== 'me') return;
    if (e.button !== 0) return;
    e.stopPropagation();
    let originIdx = fallbackIdx;
    for (let i = 0; i < cellRefs.current.length; i++) {
      const el = cellRefs.current[i];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom) {
        originIdx = i;
        break;
      }
    }
    setDrag({
      scheduleId: s.id,
      startMs: new Date(s.start).getTime(),
      endMs: new Date(s.end).getTime(),
      originDayIdx: originIdx,
      hoverDayIdx: originIdx,
      startClientX: e.clientX,
      startClientY: e.clientY,
      moved: false,
    });
  };

  return (
    <Stack gap={0} style={{ flex: 1, minHeight: 0 }}>
      <Group gap={0} grow style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
        {WEEKDAY_KEYS.map((w, i) => (
          <Box key={w} p={4} style={{ textAlign: 'center', borderRight: i < 6 ? '1px solid var(--mantine-color-default-border)' : undefined }}>
            <Text size="xs" c={i === 5 ? 'blue.6' : i === 6 ? 'red.6' : 'dimmed'} fw={600}>{t(w)}</Text>
          </Box>
        ))}
      </Group>
      <Box
        ref={bodyRef}
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
          borderLeft: '1px solid var(--mantine-color-default-border)',
        }}
      >
        {weeks.map((week, wi) => (
          <Box key={wi} style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex' }}>
            {week.cols.map((d, ci) => {
              const gi = wi * 7 + ci;
              const inMonth = d.getMonth() === anchor.getMonth();
              const isToday = isSameDay(d, today);
              const isDragTarget = drag?.moved && drag.hoverDayIdx === gi;
              const hidden = week.segs.filter(
                (seg) => seg.lane >= maxLanes && seg.startCol <= ci && seg.endCol >= ci,
              ).length;
              return (
                <Box
                  key={ci}
                  ref={(el) => { cellRefs.current[gi] = el; }}
                  onClick={() => onCellClick(d)}
                  style={{
                    position: 'relative',
                    flex: 1,
                    minWidth: 0,
                    boxSizing: 'border-box',
                    borderRight: '1px solid var(--mantine-color-default-border)',
                    borderBottom: '1px solid var(--mantine-color-default-border)',
                    cursor: 'pointer',
                    background: isDragTarget
                      ? 'var(--mantine-color-blue-0, rgba(99,102,241,0.12))'
                      : isToday ? 'var(--mantine-color-jarvis-light)' : undefined,
                    outline: isDragTarget ? '2px solid var(--mantine-color-blue-5)' : undefined,
                    outlineOffset: isDragTarget ? '-2px' : undefined,
                    overflow: 'hidden',
                  }}
                >
                  <Text
                    size="xs"
                    fw={isToday ? 700 : 500}
                    c={d.getDay() === 0 ? 'red.6' : d.getDay() === 6 ? 'blue.6' : undefined}
                    style={{ padding: '4px 4px 0', opacity: inMonth ? 1 : 0.45 }}
                  >
                    {d.getDate()}
                  </Text>
                  {hidden > 0 && (
                    <Text c="dimmed" style={{ position: 'absolute', bottom: 1, left: 4, fontSize: 'var(--font-s)', lineHeight: 1 }}>
                      +{hidden}
                    </Text>
                  )}
                </Box>
              );
            })}

            <Box style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              {week.segs.filter((seg) => seg.lane < maxLanes).map((seg) => {
                const { s } = seg;
                const isFriend = s.owner !== 'me';
                const isDragging = drag?.scheduleId === s.id && drag.moved;
                const isPast = new Date(s.end).getTime() < Date.now();
                const leftInset = seg.isStart ? 2 : 0;
                const rightInset = seg.isEnd ? 2 : 0;
                const left = `calc(${(seg.startCol * 100) / 7}% + ${leftInset}px)`;
                const width = `calc(${((seg.endCol - seg.startCol + 1) * 100) / 7}% - ${leftInset + rightInset}px)`;
                const top = DAY_NUM_H + seg.lane * LANE_TOTAL;
                const showLabel = seg.isStart || seg.startCol === 0;
                const friendLabel = isFriend ? (friendNames?.[s.owner] ?? t('calendar.defaultFriendLabel')) : '';
                return (
                  <Box
                    key={s.id}
                    onMouseDown={(e) => beginDrag(e, s, wi * 7 + seg.startCol)}
                    onClick={(e) => { e.stopPropagation(); if (!drag) onScheduleClick(s); }}
                    title={isFriend ? `${friendLabel} — ${s.title}` : s.title}
                    style={{
                      position: 'absolute',
                      left,
                      width,
                      top,
                      height: LANE_H,
                      boxSizing: 'border-box',
                      background: isFriend ? '#9775fa' : COLOR_HEX_BRIGHT[s.color ?? 'blue'],
                      color: '#fff',
                      opacity: isDragging ? 0.4 : (isPast ? 0.4 : 1),
                      border: isFriend ? '1px dashed rgba(255,255,255,0.6)' : undefined,
                      borderTopLeftRadius: seg.isStart ? 3 : 0,
                      borderBottomLeftRadius: seg.isStart ? 3 : 0,
                      borderTopRightRadius: seg.isEnd ? 3 : 0,
                      borderBottomRightRadius: seg.isEnd ? 3 : 0,
                      padding: '0 4px',
                      fontSize: 'var(--font-s)',
                      lineHeight: `${LANE_H}px`,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      cursor: isFriend ? 'pointer' : (drag?.scheduleId === s.id ? 'grabbing' : 'grab'),
                      userSelect: 'none',
                      pointerEvents: 'auto',
                    }}
                  >
                    {showLabel ? (isFriend ? `👥 ${s.title}` : s.title) : ' '}
                  </Box>
                );
              })}
            </Box>
          </Box>
        ))}
      </Box>
    </Stack>
  );
}
