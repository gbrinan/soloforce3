import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Group, Text, Stack, ScrollArea } from '@mantine/core';
import type { Schedule } from '../../utils/api';
import { useT } from '../../i18n/I18nProvider';
import type { MessageKey } from '../../i18n/messages';

interface Props {
  anchor: Date;
  schedules: Schedule[];
  onCellClick: (day: Date, hour: number) => void;
  onScheduleClick: (s: Schedule) => void;
  onScheduleUpdate?: (id: string, patch: { start: string; end: string }) => Promise<void> | void;
  days?: Date[];
  friendNames?: Record<string, string>;
}

// 요일 헤더 — getDay()(0=일) 인덱스 기반 번역 키.
const DOW_KEYS: MessageKey[] = ['cal.sun', 'cal.mon', 'cal.tue', 'cal.wed', 'cal.thu', 'cal.fri', 'cal.sat'];
const DISPLAY_HOUR_START = 8;
const DISPLAY_HOUR_END = 24;
const HOURS = Array.from({ length: DISPLAY_HOUR_END - DISPLAY_HOUR_START }, (_, i) => i + DISPLAY_HOUR_START);
const HOUR_HEIGHT = 56;
const SNAP_MIN = 30;
const CLICK_THRESHOLD_PX = 5;
const MS_HOUR = 60 * 60 * 1000;
const MS_DAY = 24 * MS_HOUR;

const COLOR_HEX: Record<string, string> = {
  blue: 'var(--mantine-color-blue-6)',
  green: 'var(--mantine-color-green-6)',
  red: 'var(--mantine-color-red-6)',
  yellow: 'var(--mantine-color-yellow-6)',
  violet: 'var(--mantine-color-violet-6)',
  orange: 'var(--mantine-color-orange-6)',
};

function startOfWeek(anchor: Date): Date {
  const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return d;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function eventBoundsForDay(s: Schedule, day: Date): { top: number; height: number } | null {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const gridStart = dayStart + DISPLAY_HOUR_START * MS_HOUR;
  const gridEnd = dayStart + DISPLAY_HOUR_END * MS_HOUR;
  const ss = new Date(s.start).getTime();
  const se = new Date(s.end).getTime();
  if (se <= gridStart || ss >= gridEnd) return null;
  const visStart = Math.max(ss, gridStart);
  const visEnd = Math.min(se, gridEnd);
  const top = ((visStart - gridStart) / MS_HOUR) * HOUR_HEIGHT;
  const height = Math.max(((visEnd - visStart) / MS_HOUR) * HOUR_HEIGHT, 18);
  return { top, height };
}

function dayOverlapsRange(s: Schedule, day: Date): boolean {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const dayEnd = dayStart + MS_DAY;
  const ss = new Date(s.start).getTime();
  const se = new Date(s.end).getTime();
  return ss < dayEnd && se > dayStart;
}

function isEarlyOnly(s: Schedule, day: Date): boolean {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const gridStart = dayStart + DISPLAY_HOUR_START * MS_HOUR;
  const se = new Date(s.end).getTime();
  return se <= gridStart && dayOverlapsRange(s, day);
}

function isLateOnly(s: Schedule, day: Date): boolean {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const gridEnd = dayStart + DISPLAY_HOUR_END * MS_HOUR;
  const ss = new Date(s.start).getTime();
  return ss >= gridEnd && dayOverlapsRange(s, day);
}

// Google Calendar 스타일 중첩 폭 분할.
// 시작 시각 정렬 → 겹치는 클러스터 → 각 일정에 가장 작은 비어있는 컬럼 할당 →
// 클러스터 내 총 컬럼 수 N 결정되면 left=col/N, width=1/N로 균등 분할.
interface DayLayout {
  scheduleId: string;
  col: number;
  cols: number;
  top: number;
  height: number;
}

function layoutDayEvents(list: Schedule[], day: Date): DayLayout[] {
  const items = list
    .map((s) => {
      const b = eventBoundsForDay(s, day);
      if (!b) return null;
      return { s, top: b.top, bottom: b.top + b.height, height: b.height };
    })
    .filter((x): x is { s: Schedule; top: number; bottom: number; height: number } => x !== null)
    .sort((a, b) => a.top - b.top || a.bottom - b.bottom);

  const result: DayLayout[] = [];
  let cluster: typeof items = [];
  let clusterMaxBottom = -Infinity;

  const flush = () => {
    if (cluster.length === 0) return;
    const colBottoms: number[] = [];
    const assigned: number[] = [];
    for (const it of cluster) {
      let col = colBottoms.findIndex((b) => b <= it.top);
      if (col === -1) {
        col = colBottoms.length;
        colBottoms.push(it.bottom);
      } else {
        colBottoms[col] = it.bottom;
      }
      assigned.push(col);
    }
    const cols = colBottoms.length;
    for (let i = 0; i < cluster.length; i++) {
      result.push({
        scheduleId: cluster[i].s.id,
        col: assigned[i],
        cols,
        top: cluster[i].top,
        height: cluster[i].height,
      });
    }
    cluster = [];
    clusterMaxBottom = -Infinity;
  };

  for (const it of items) {
    if (cluster.length > 0 && it.top >= clusterMaxBottom) {
      flush();
    }
    cluster.push(it);
    if (it.bottom > clusterMaxBottom) clusterMaxBottom = it.bottom;
  }
  flush();
  return result;
}

function formatHHMM(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

interface DragState {
  scheduleId: string;
  startMs: number;
  endMs: number;
  originDayIdx: number;
  startClientX: number;
  startClientY: number;
  colWidth: number;
  deltaDays: number;
  deltaMin: number;
  moved: boolean;
}

export default function WeekView({ anchor, schedules, onCellClick, onScheduleClick, onScheduleUpdate, days: daysProp, friendNames }: Props) {
  const t = useT();
  const today = new Date();
  const computedDays = useMemo(() => {
    const start = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [anchor]);
  const days = daysProp ?? computedDays;
  const numCols = days.length;

  const allDayBuckets = useMemo(() => days.map((d) => schedules.filter((s) => {
    if (!s.allDay) return false;
    return dayOverlapsRange(s, d);
  })), [days, schedules]);

  const timedSchedules = useMemo(() => schedules.filter((s) => !s.allDay), [schedules]);

  const earlyByDay = useMemo(() => days.map((d) => timedSchedules.filter((s) => isEarlyOnly(s, d))), [days, timedSchedules]);
  const lateByDay = useMemo(() => days.map((d) => timedSchedules.filter((s) => isLateOnly(s, d))), [days, timedSchedules]);
  const hasAnyEarly = earlyByDay.some((b) => b.length > 0);
  const hasAnyLate = lateByDay.some((b) => b.length > 0);

  const gridRef = useRef<HTMLDivElement | null>(null);
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  useEffect(() => {
    const vp = scrollViewportRef.current;
    if (!vp) return;
    const now = new Date();
    const hours = now.getHours() + now.getMinutes() / 60;
    const target = hours >= DISPLAY_HOUR_START && hours < DISPLAY_HOUR_END
      ? Math.max(DISPLAY_HOUR_START, hours - 1)
      : DISPLAY_HOUR_START;
    vp.scrollTop = (target - DISPLAY_HOUR_START) * HOUR_HEIGHT;
  }, []);

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: MouseEvent) => {
      const cur = dragRef.current;
      if (!cur) return;
      const dx = e.clientX - cur.startClientX;
      const dy = e.clientY - cur.startClientY;
      const dist = Math.hypot(dx, dy);
      const moved = dist >= CLICK_THRESHOLD_PX;
      const colWidth = cur.colWidth || 1;
      const rawDeltaDays = Math.round(dx / colWidth);
      const maxLeft = -cur.originDayIdx;
      const maxRight = (numCols - 1) - cur.originDayIdx;
      const deltaDays = Math.max(maxLeft, Math.min(maxRight, rawDeltaDays));
      const rawMin = (dy / HOUR_HEIGHT) * 60;
      const deltaMin = Math.round(rawMin / SNAP_MIN) * SNAP_MIN;
      setDrag({ ...cur, deltaDays, deltaMin, moved });
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
      const newStartMs = cur.startMs + cur.deltaDays * MS_DAY + cur.deltaMin * 60000;
      const newEndMs = cur.endMs + cur.deltaDays * MS_DAY + cur.deltaMin * 60000;
      setDrag(null);
      if (onScheduleUpdate && (cur.deltaDays !== 0 || cur.deltaMin !== 0)) {
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
  }, [drag !== null, onScheduleClick, onScheduleUpdate, schedules, numCols]);

  const beginDrag = (e: React.MouseEvent, s: Schedule, dayIdx: number) => {
    if (s.owner !== 'me') return;
    if (e.button !== 0) return;
    e.stopPropagation();
    const grid = gridRef.current;
    let colWidth = 80;
    if (grid) {
      const rect = grid.getBoundingClientRect();
      colWidth = (rect.width - 40) / numCols;
    }
    setDrag({
      scheduleId: s.id,
      startMs: new Date(s.start).getTime(),
      endMs: new Date(s.end).getTime(),
      originDayIdx: dayIdx,
      startClientX: e.clientX,
      startClientY: e.clientY,
      colWidth,
      deltaDays: 0,
      deltaMin: 0,
      moved: false,
    });
  };

  const handleOutOfRangeClick = (e: React.MouseEvent, list: Schedule[]) => {
    e.stopPropagation();
    if (list.length > 0) onScheduleClick(list[0]);
  };

  return (
    <Stack gap={0} style={{ flex: 1, minHeight: 0 }}>
      <Group gap={0} grow style={{ borderBottom: '1px solid var(--mantine-color-default-border)', paddingLeft: 40 }}>
        {days.map((d, i) => {
          const isToday = isSameDay(d, today);
          return (
            <Box key={i} p={4} style={{ textAlign: 'center', borderRight: i < numCols - 1 ? '1px solid var(--mantine-color-default-border)' : undefined, background: isToday ? 'var(--mantine-color-jarvis-light)' : undefined }}>
              <Text size="xs" c={d.getDay() === 0 ? 'red.6' : d.getDay() === 6 ? 'blue.6' : 'dimmed'}>{t(DOW_KEYS[d.getDay()])}</Text>
              <Text size="sm" fw={isToday ? 700 : 600}>{d.getMonth() + 1}/{d.getDate()}</Text>
            </Box>
          );
        })}
      </Group>
      {hasAnyEarly && (
        <Group gap={0} grow style={{ borderBottom: '1px solid var(--mantine-color-default-border)', paddingLeft: 40, minHeight: 20, alignItems: 'stretch', background: 'var(--mantine-color-default-hover)' }}>
          {earlyByDay.map((list, i) => (
            <Box
              key={i}
              onClick={(e) => handleOutOfRangeClick(e, list)}
              style={{
                borderRight: i < numCols - 1 ? '1px solid var(--mantine-color-default-border)' : undefined,
                padding: '1px 4px',
                fontSize: 'var(--font-s)',
                color: 'var(--mantine-color-dimmed)',
                cursor: list.length > 0 ? 'pointer' : 'default',
                textAlign: 'center',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={list.length > 0 ? list.map((s) => `${s.title} (${new Date(s.start).getHours()}:${String(new Date(s.start).getMinutes()).padStart(2,'0')})`).join('\n') : ''}
            >
              {list.length > 0 ? `↑ ${t('calendar.itemCount', { n: list.length })}` : ''}
            </Box>
          ))}
        </Group>
      )}
      {allDayBuckets.some((b) => b.length > 0) && (
        <Group gap={0} grow style={{ borderBottom: '1px solid var(--mantine-color-default-border)', paddingLeft: 40, minHeight: 24, alignItems: 'stretch' }}>
          {allDayBuckets.map((bucket, i) => (
            <Box key={i} p={2} style={{ borderRight: i < numCols - 1 ? '1px solid var(--mantine-color-default-border)' : undefined, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {bucket.map((s) => {
                const isFriend = s.owner !== 'me';
                const friendLabel = isFriend ? (friendNames?.[s.owner] ?? t('calendar.defaultFriendLabel')) : '';
                const isPast = new Date(s.end).getTime() < Date.now();
                return (
                  <Box
                    key={s.id}
                    onClick={(e) => { e.stopPropagation(); onScheduleClick(s); }}
                    style={{
                      background: COLOR_HEX[s.color ?? 'blue'],
                      color: '#fff',
                      opacity: isPast ? 0.5 : 1,
                      filter: isPast ? 'saturate(0.5)' : undefined,
                      border: isFriend ? '1px dashed rgba(255,255,255,0.6)' : undefined,
                      borderRadius: 4,
                      padding: '1px 4px',
                      fontSize: 'var(--font-s)',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                    title={isFriend ? `${friendLabel} — ${s.title}` : s.title}
                  >
                    {isFriend ? `👥 ${s.title}` : s.title}
                  </Box>
                );
              })}
            </Box>
          ))}
        </Group>
      )}
      <ScrollArea style={{ flex: 1 }} viewportRef={scrollViewportRef}>
        <Box ref={gridRef} style={{ display: 'grid', gridTemplateColumns: `40px repeat(${numCols}, 1fr)`, position: 'relative' }}>
          <Box>
            {HOURS.map((h) => (
              <Box key={h} style={{ height: HOUR_HEIGHT, borderBottom: '1px solid var(--mantine-color-default-border)', textAlign: 'right', paddingRight: 4 }}>
                <Text size="xs" c="dimmed" style={{ fontSize: 'var(--font-s)' }}>{t('calendar.hourLabel', { h })}</Text>
              </Box>
            ))}
          </Box>
          {days.map((d, di) => (
            <Box key={di} style={{ position: 'relative', borderRight: di < numCols - 1 ? '1px solid var(--mantine-color-default-border)' : undefined }}>
              {HOURS.map((h) => (
                <Box
                  key={h}
                  onClick={() => onCellClick(d, h)}
                  style={{ height: HOUR_HEIGHT, borderBottom: '1px solid var(--mantine-color-default-border)', cursor: 'pointer' }}
                />
              ))}
              {(() => {
                const layouts = layoutDayEvents(timedSchedules, d);
                const byId = new Map(timedSchedules.map((s) => [s.id, s]));
                return layouts.map((L) => {
                  const s = byId.get(L.scheduleId);
                  if (!s) return null;
                  const isFriend = s.owner !== 'me';
                  const isDragging = drag?.scheduleId === s.id && drag.moved;
                  const isPast = new Date(s.end).getTime() < Date.now();
                  const friendLabel = isFriend ? (friendNames?.[s.owner] ?? t('calendar.defaultFriendLabel')) : '';
                  const widthPct = 100 / L.cols;
                  const leftPct = (L.col * 100) / L.cols;
                  const startLabel = formatHHMM(new Date(s.start));
                  return (
                    <Box
                      key={s.id}
                      onMouseDown={(e) => beginDrag(e, s, di)}
                      onClick={(e) => { e.stopPropagation(); if (!drag) onScheduleClick(s); }}
                      style={{
                        position: 'absolute',
                        top: L.top,
                        left: `calc(${leftPct}% + 1px)`,
                        width: `calc(${widthPct}% - 2px)`,
                        height: L.height,
                        background: COLOR_HEX[s.color ?? 'blue'],
                        color: '#fff',
                        opacity: isDragging ? 0.4 : (isPast ? 0.5 : 1),
                        filter: isPast && !isDragging ? 'saturate(0.5)' : undefined,
                        border: isFriend ? '1px dashed rgba(255,255,255,0.6)' : undefined,
                        borderRadius: 4,
                        padding: '2px 4px',
                        fontSize: 'var(--font-s)',
                        lineHeight: 1.2,
                        cursor: isFriend ? 'pointer' : (drag?.scheduleId === s.id ? 'grabbing' : 'grab'),
                        overflow: 'hidden',
                        boxShadow: 'var(--shadow-sm)',
                        userSelect: 'none',
                        whiteSpace: 'nowrap',
                        textOverflow: 'ellipsis',
                        zIndex: 1,
                      }}
                      title={`${startLabel} ${isFriend ? `${friendLabel} — ` : ''}${s.title}`}
                    >
                      <span style={{ opacity: 0.85, marginRight: 4 }}>{startLabel}</span>
                      {isFriend ? `👥 ${s.title}` : s.title}
                    </Box>
                  );
                });
              })()}
              {drag && drag.moved && (() => {
                const ghostDayIdx = drag.originDayIdx + drag.deltaDays;
                if (ghostDayIdx !== di) return null;
                const s = schedules.find((x) => x.id === drag.scheduleId);
                if (!s) return null;
                const newStartMs = drag.startMs + drag.deltaMin * 60000;
                const newEndMs = drag.endMs + drag.deltaMin * 60000;
                const ghostDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
                const b = eventBoundsForDay({ ...s, start: new Date(newStartMs).toISOString(), end: new Date(newEndMs).toISOString() }, ghostDay);
                if (!b) return null;
                return (
                  <Box
                    key="ghost"
                    style={{
                      position: 'absolute',
                      top: b.top,
                      left: 2,
                      right: 2,
                      height: b.height,
                      border: '2px dashed var(--mantine-color-blue-4)',
                      borderRadius: 4,
                      background: 'rgba(99, 102, 241, 0.15)',
                      pointerEvents: 'none',
                      zIndex: 5,
                    }}
                  />
                );
              })()}
            </Box>
          ))}
        </Box>
      </ScrollArea>
      {hasAnyLate && (
        <Group gap={0} grow style={{ borderTop: '1px solid var(--mantine-color-default-border)', paddingLeft: 40, minHeight: 20, alignItems: 'stretch', background: 'var(--mantine-color-default-hover)' }}>
          {lateByDay.map((list, i) => (
            <Box
              key={i}
              onClick={(e) => handleOutOfRangeClick(e, list)}
              style={{
                borderRight: i < numCols - 1 ? '1px solid var(--mantine-color-default-border)' : undefined,
                padding: '1px 4px',
                fontSize: 'var(--font-s)',
                color: 'var(--mantine-color-dimmed)',
                cursor: list.length > 0 ? 'pointer' : 'default',
                textAlign: 'center',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={list.length > 0 ? list.map((s) => `${s.title} (${new Date(s.start).getHours()}:${String(new Date(s.start).getMinutes()).padStart(2,'0')})`).join('\n') : ''}
            >
              {list.length > 0 ? `↓ ${t('calendar.itemCount', { n: list.length })}` : ''}
            </Box>
          ))}
        </Group>
      )}
    </Stack>
  );
}
