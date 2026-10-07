import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Stack, Group, Text, ActionIcon, Button, SegmentedControl, Box, Switch, ScrollArea,
  Collapse, UnstyledButton, TextInput,
} from '@mantine/core';
import {
  IconX, IconChevronLeft, IconChevronRight, IconPlus, IconShare,
  IconChevronDown, IconChevronUp, IconSearch,
} from '@tabler/icons-react';
import {
  fetchSchedules, fetchFriendSchedules, createSchedule, updateSchedule, deleteSchedule,
  fetchPartners, type Partner,
  type Schedule, type ScheduleInput,
} from '../../utils/api';
import { colorForPartner, FRIEND_COLOR_HEX, loadFriendToggles, saveFriendToggles, isFriendEnabled } from '../../utils/friendColor';
import { btn } from '../../ui/controls';
import MonthView from './MonthView';
import WeekView from './WeekView';
import DayView from './DayView';
import ScheduleModal from './ScheduleModal';
import FriendScheduleRequestModal from './FriendScheduleRequestModal';
import ScheduleSearchResults from './ScheduleSearchResults';
import { useI18n } from '../../i18n/I18nProvider';
import type { MessageKey, Locale } from '../../i18n/messages';

interface Props {
  visible: boolean;
  onClose: () => void;
}

type ViewMode = 'day' | 'week' | 'month';

// 요일 라벨 — 번역 키. KR_WEEK_LABELS는 getDay()(0=일)로, WEEK_LABELS는 월요일 시작 표시용.
const KR_WEEK_LABELS: MessageKey[] = ['cal.sun', 'cal.mon', 'cal.tue', 'cal.wed', 'cal.thu', 'cal.fri', 'cal.sat'];

const WEEK_LABELS: MessageKey[] = ['cal.mon', 'cal.tue', 'cal.wed', 'cal.thu', 'cal.fri', 'cal.sat', 'cal.sun'];

const FRIEND_COLLAPSED_KEY = 'schedules.friendSection.collapsed';

function loadFriendCollapsed(): boolean {
  try {
    const v = localStorage.getItem(FRIEND_COLLAPSED_KEY);
    return v == null ? true : v === '1';
  } catch {
    return true;
  }
}

function saveFriendCollapsed(v: boolean): void {
  try {
    localStorage.setItem(FRIEND_COLLAPSED_KEY, v ? '1' : '0');
  } catch {
    // ignore
  }
}

const MINI_CAL_COLLAPSED_KEY = 'schedules.miniCalendar.collapsed';

// 미니 캘린더(달력 그리드) 접힘 상태 — 저장값 없으면 펼친 상태(기본).
function loadMiniCalCollapsed(): boolean {
  try {
    return localStorage.getItem(MINI_CAL_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function saveMiniCalCollapsed(v: boolean): void {
  try {
    localStorage.setItem(MINI_CAL_COLLAPSED_KEY, v ? '1' : '0');
  } catch {
    // ignore
  }
}

// 월/연 헤더 — 로케일별 표기(2026년 5월 / May 2026 / 2026年5月)를 Intl로 생성.
function formatMonthYear(locale: Locale, anchor: Date): string {
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' })
    .format(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
}

function startOfMonthGrid(anchor: Date): Date {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const dow = (first.getDay() + 6) % 7;
  return new Date(first.getFullYear(), first.getMonth(), 1 - dow);
}

function startOfWeek(anchor: Date): Date {
  const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return d;
}

function rangeForView(anchor: Date, mode: ViewMode): { from: string; to: string } {
  if (mode === 'month') {
    const start = startOfMonthGrid(anchor);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 42);
    return { from: start.toISOString(), to: end.toISOString() };
  }
  if (mode === 'day') {
    const c = anchor;
    const start = new Date(c.getFullYear(), c.getMonth(), c.getDate() - 1);
    const end = new Date(c.getFullYear(), c.getMonth(), c.getDate() + 2);
    return { from: start.toISOString(), to: end.toISOString() };
  }
  const start = startOfWeek(anchor);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  return { from: start.toISOString(), to: end.toISOString() };
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// MonthView COLOR_HEX_BRIGHT와 동일 hex로 통일 — 미니 달력 인디케이터 색상이 월간 뷰와 일치하도록.
const MINI_COLOR_HEX: Record<string, string> = {
  blue: '#4F47E6',
  green: '#34D399',
  red: '#F97171',
  yellow: '#FBC024',
  violet: '#9775fa',
  orange: '#ff922b',
};

function dayOverlapsMini(s: Schedule, day: Date): boolean {
  const ds = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const de = ds + 24 * 60 * 60 * 1000;
  const ss = new Date(s.start).getTime();
  const se = new Date(s.end).getTime();
  return ss < de && se > ds;
}

interface MiniCalendarProps {
  anchor: Date;
  schedules: Schedule[];
  onSelect: (d: Date) => void;
}

function MiniCalendar({ anchor, schedules, onSelect }: MiniCalendarProps) {
  const { t } = useI18n();
  const today = new Date();
  const days = useMemo(() => {
    const start = startOfMonthGrid(anchor);
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [anchor]);
  return (
    <Stack gap={2}>
      <Box style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
        {WEEK_LABELS.map((w, i) => (
          <Text key={w} size="xs" ta="center" c={i === 5 ? 'blue.6' : i === 6 ? 'red.6' : 'dimmed'} style={{ fontSize: 'var(--font-s)' }}>{t(w)}</Text>
        ))}
        {days.map((d, i) => {
          const inMonth = d.getMonth() === anchor.getMonth();
          const isToday = isSameDay(d, today);
          const isAnchor = isSameDay(d, anchor);
          const dayItems = schedules.filter((s) => dayOverlapsMini(s, d));
          const myFirst = dayItems.find((s) => s.owner === 'me');
          const hasFriend = dayItems.some((s) => s.owner !== 'me');
          // 과거 날짜(그 날이 완전히 지난 경우) 언더바는 흐리게 — MonthView 과거/미래 구분과 동일 취지. 오늘은 미래 취급(end-of-day 기준).
          const isPastDay = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() <= Date.now();
          return (
            <Box
              key={i}
              onClick={() => onSelect(d)}
              style={{
                textAlign: 'center',
                cursor: 'pointer',
                opacity: inMonth ? 1 : 0.4,
                background: isAnchor ? 'var(--mantine-color-jarvis-light)' : isToday ? 'var(--mantine-color-default-hover)' : undefined,
                borderRadius: 4,
                padding: '2px 0 1px',
                fontSize: 'var(--font-s)',
                fontWeight: isToday ? 700 : 400,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 1,
              }}
            >
              <Box>{d.getDate()}</Box>
              {(myFirst || hasFriend) && (
                <Box style={{ display: 'flex', flexDirection: 'column', gap: 1, width: '70%' }}>
                  {myFirst && <Box style={{ height: 1, background: MINI_COLOR_HEX[myFirst.color ?? 'blue'], borderRadius: 1, opacity: isPastDay ? 0.4 : 1 }} />}
                  {hasFriend && <Box style={{ height: 1, background: '#9775fa', borderRadius: 1, opacity: isPastDay ? 0.4 : 1 }} />}
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
    </Stack>
  );
}

export default function SchedulesPanel({ visible, onClose }: Props) {
  const { t, locale } = useI18n();
  const [anchor, setAnchor] = useState<Date>(new Date());
  const [mode, setMode] = useState<ViewMode>('month');
  const [mySchedules, setMySchedules] = useState<Schedule[]>([]);
  const [friendSchedules, setFriendSchedules] = useState<Schedule[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [friendToggles, setFriendToggles] = useState<Record<string, boolean>>(() => loadFriendToggles());
  const [friendCollapsed, setFriendCollapsed] = useState<boolean>(() => loadFriendCollapsed());
  const [miniCalCollapsed, setMiniCalCollapsed] = useState<boolean>(() => loadMiniCalCollapsed());
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [defaultStart, setDefaultStart] = useState<Date | undefined>(undefined);
  const [friendReqOpen, setFriendReqOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchAll, setSearchAll] = useState<Schedule[]>([]);
  const [searchLoaded, setSearchLoaded] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const toggleFriendCollapsed = useCallback(() => {
    setFriendCollapsed((prev) => {
      const next = !prev;
      saveFriendCollapsed(next);
      return next;
    });
  }, []);

  const expandFriendSection = useCallback(() => {
    setFriendCollapsed(false);
    saveFriendCollapsed(false);
  }, []);

  const toggleMiniCalCollapsed = useCallback(() => {
    setMiniCalCollapsed((prev) => {
      const next = !prev;
      saveMiniCalCollapsed(next);
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    const range = rangeForView(anchor, mode);
    const [mine, friends, parts] = await Promise.all([
      fetchSchedules({ from: range.from, to: range.to, owner: 'me' }),
      fetchFriendSchedules({ from: range.from, to: range.to }),
      fetchPartners(),
    ]);
    setMySchedules(mine);
    setFriendSchedules(friends);
    setPartners(parts);
  }, [anchor, mode]);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  // 아난다라 교육 → 일정 수동 동기화 (자동은 서버가 하루 1회)
  const [anandaraSyncing, setAnandaraSyncing] = useState(false);
  const handleAnandaraSync = useCallback(async () => {
    setAnandaraSyncing(true);
    try {
      const res = await fetch('/api/anandara-sync', { method: 'POST' });
      const data = await res.json().catch(() => null) as { ok?: boolean; created?: number; updated?: number; deleted?: number; error?: string } | null;
      if (data?.ok) {
        window.alert(`교육 일정 동기화 완료: 추가 ${data.created ?? 0} · 갱신 ${data.updated ?? 0} · 삭제 ${data.deleted ?? 0}`);
      } else {
        window.alert(`동기화 실패: ${data?.error ?? '서버 오류'}`);
      }
    } catch {
      window.alert('동기화 요청 실패 — 네트워크를 확인해주세요.');
    } finally {
      setAnandaraSyncing(false);
      void load();
    }
  }, [load]);

  const friendNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of partners) map[p.id] = p.contactName || p.companyName || p.id.slice(0, 6);
    return map;
  }, [partners]);

  // 친구 일정에 친구 색상 override + 토글 OFF 친구 필터링.
  const visibleFriendSchedules = useMemo(() => {
    const out: Schedule[] = [];
    for (const s of friendSchedules) {
      if (!isFriendEnabled(friendToggles, s.owner)) continue;
      out.push({ ...s, color: colorForPartner(s.owner) });
    }
    return out;
  }, [friendSchedules, friendToggles]);

  const allSchedules = useMemo(() => [...mySchedules, ...visibleFriendSchedules], [mySchedules, visibleFriendSchedules]);

  // 검색은 현재 뷰 기간이 아니라 전체 일정 대상 — from/to 없이 전체 fetch 후 친구 토글/색상 가공.
  const loadAllForSearch = useCallback(async () => {
    const [mine, friends] = await Promise.all([
      fetchSchedules({ owner: 'me' }),
      fetchFriendSchedules({}),
    ]);
    const friendsVisible: Schedule[] = [];
    for (const s of friends) {
      if (!isFriendEnabled(friendToggles, s.owner)) continue;
      friendsVisible.push({ ...s, color: colorForPartner(s.owner) });
    }
    setSearchAll([...mine, ...friendsVisible]);
    setSearchLoaded(true);
  }, [friendToggles]);

  const handleSearchChange = (v: string) => {
    setSearchQuery(v);
    if (v.trim() && !searchLoaded) loadAllForSearch();
  };

  const searchBoxRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery('');
  }, []);

  // 검색창이 열려있을 때 외부 영역 클릭(또는 터치) 시 자동으로 닫고 검색어를 비운다.
  // 단, 검색 박스와 검색 결과 영역 내부 클릭은 제외(결과 선택이 닫힘으로 가로채지지 않도록).
  useEffect(() => {
    if (!searchOpen) return;
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (searchBoxRef.current && searchBoxRef.current.contains(target)) return;
      if (resultsRef.current && resultsRef.current.contains(target)) return;
      closeSearch();
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [searchOpen, closeSearch]);

  const searching = searchQuery.trim().length > 0;

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return searchAll.filter((s) =>
      s.title.toLowerCase().includes(q)
      || (s.description?.toLowerCase().includes(q) ?? false)
      || (s.location?.toLowerCase().includes(q) ?? false));
  }, [searchQuery, searchAll]);

  const setToggle = (partnerId: string, on: boolean) => {
    setFriendToggles((prev) => {
      const next = { ...prev, [partnerId]: on };
      saveFriendToggles(next);
      return next;
    });
  };

  const setAllToggles = (on: boolean) => {
    const next: Record<string, boolean> = {};
    for (const p of partners) next[p.id] = on;
    setFriendToggles(next);
    saveFriendToggles(next);
  };

  const move = (delta: number) => {
    const next = new Date(anchor);
    if (mode === 'month') next.setMonth(next.getMonth() + delta);
    else if (mode === 'week') next.setDate(next.getDate() + delta * 7);
    else next.setDate(next.getDate() + delta);
    setAnchor(next);
  };

  const goToday = () => setAnchor(new Date());

  const handleNew = () => {
    setEditing(null);
    setDefaultStart(new Date());
    setModalOpen(true);
  };

  const handleCellClickMonth = (d: Date) => {
    setEditing(null);
    const start = new Date(d);
    start.setHours(9, 0, 0, 0);
    setDefaultStart(start);
    setModalOpen(true);
  };

  const handleCellClickWeek = (d: Date, hour: number) => {
    setEditing(null);
    const start = new Date(d);
    start.setHours(hour, 0, 0, 0);
    setDefaultStart(start);
    setModalOpen(true);
  };

  const handleScheduleClick = (s: Schedule) => {
    setEditing(s);
    setDefaultStart(undefined);
    setModalOpen(true);
  };

  const handleSave = async (input: ScheduleInput, id?: string) => {
    if (id) await updateSchedule(id, input);
    else await createSchedule(input);
    await load();
    setSearchLoaded(false);
  };

  const handleDelete = async (id: string) => {
    await deleteSchedule(id);
    await load();
    setSearchLoaded(false);
  };

  const handleScheduleUpdate = async (id: string, patch: { start: string; end: string }) => {
    await updateSchedule(id, patch);
    await load();
  };

  if (!visible) return null;

  const headerLabel = mode === 'month'
    ? formatMonthYear(locale, anchor)
    : mode === 'day'
      ? t('cal.dateWithDow', { y: anchor.getFullYear(), m: anchor.getMonth() + 1, d: anchor.getDate(), dow: t(KR_WEEK_LABELS[anchor.getDay()]) })
      : (() => {
        const ws = startOfWeek(anchor);
        const we = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + 6);
        return `${ws.getMonth() + 1}/${ws.getDate()} – ${we.getMonth() + 1}/${we.getDate()}`;
      })();

  return (
    <Stack h="100%" gap={0}>
      <Group justify="space-between" align="center" p="md" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
        <Text fw={600} size="md">{t('nav.schedules')}</Text>
        <ActionIcon variant="subtle" color="gray" size={36} className="drawer-close" onClick={onClose} aria-label={t('common.close')}>
          <IconX size={18} stroke={1.5} />
        </ActionIcon>
      </Group>

      {!searching && (
      <Stack p="sm" gap="xs" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
        <Group gap={4} wrap="nowrap" align="center">
          <ActionIcon variant="subtle" color="gray" onClick={() => move(-1)} aria-label={t('common.prev')}><IconChevronLeft size={16} stroke={1.5} /></ActionIcon>
          <Text size="sm" fw={600} ta="center" style={{ flex: 1 }}>{headerLabel}</Text>
          <ActionIcon variant="subtle" color="gray" onClick={() => move(1)} aria-label={t('common.next')}><IconChevronRight size={16} stroke={1.5} /></ActionIcon>
        </Group>
        <Group justify="space-between" wrap="nowrap" align="center" gap="xs">
          <SegmentedControl
            size="xs"
            value={mode}
            onChange={(v) => setMode(v as ViewMode)}
            data={[
              { label: t('cal.viewDay'), value: 'day' },
              { label: t('cal.viewWeek'), value: 'week' },
              { label: t('cal.viewMonth'), value: 'month' },
            ]}
          />
          <Group gap="xs" wrap="nowrap" align="center">
            <Button size="compact-xs" variant="subtle" onClick={goToday}>{t('cal.today')}</Button>
            <Button
              size="compact-xs"
              variant="subtle"
              loading={anandaraSyncing}
              onClick={() => { void handleAnandaraSync(); }}
              title="아난다라 교육 일정 동기화 (자동은 하루 1회)"
            >교육 동기화</Button>
            <button style={btn('sm', 'neutral')} onClick={handleNew}><IconPlus size={14} stroke={1.5} />{t('cal.newSchedule')}</button>
          </Group>
        </Group>
      </Stack>
      )}

      <Box style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
        <Group justify="space-between" align="center" wrap="nowrap" gap="xs" px="sm" pt="sm" pb={(miniCalCollapsed || searching) ? 'sm' : 4}>
          <Group gap={2} align="center" wrap="nowrap" style={{ minWidth: 0, flexShrink: 1 }}>
            <Text size="xs" fw={600} c="dimmed" truncate="end" style={{ minWidth: 0 }}>{formatMonthYear(locale, anchor)}</Text>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              onClick={toggleMiniCalCollapsed}
              aria-expanded={!miniCalCollapsed}
              aria-label={miniCalCollapsed ? t('common.expand') : t('common.collapse')}
            >
              {miniCalCollapsed
                ? <IconChevronDown size={16} stroke={1.5} />
                : <IconChevronUp size={16} stroke={1.5} />}
            </ActionIcon>
          </Group>
          {searchOpen ? (
            <Box ref={searchBoxRef} style={{ flex: 1, minWidth: 0 }}>
              <TextInput
                size="xs"
                autoFocus
                style={{ width: '100%' }}
                placeholder={t('cal.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.currentTarget.value)}
                leftSection={<IconSearch size={14} stroke={1.5} />}
                rightSection={(
                  <ActionIcon variant="subtle" color="gray" size="sm" onClick={closeSearch} aria-label={t('common.close')}>
                    <IconX size={14} stroke={1.5} />
                  </ActionIcon>
                )}
              />
            </Box>
          ) : (
            <ActionIcon variant="subtle" color="gray" onClick={() => setSearchOpen(true)} aria-label={t('cal.searchPlaceholder')}>
              <IconSearch size={16} stroke={1.5} />
            </ActionIcon>
          )}
        </Group>
        {!searching && (
          <Collapse expanded={!miniCalCollapsed}>
            <Box px="sm" pb="sm">
              <MiniCalendar anchor={anchor} schedules={allSchedules} onSelect={(d) => setAnchor(d)} />
            </Box>
          </Collapse>
        )}
      </Box>

      <Box style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {searching ? (
          <Box ref={resultsRef} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <ScheduleSearchResults
              results={searchResults}
              onSelect={handleScheduleClick}
              friendNames={friendNames}
            />
          </Box>
        ) : mode === 'month' ? (
          <MonthView
            anchor={anchor}
            schedules={allSchedules}
            onCellClick={handleCellClickMonth}
            onScheduleClick={handleScheduleClick}
            onScheduleUpdate={handleScheduleUpdate}
            friendNames={friendNames}
          />
        ) : mode === 'week' ? (
          <WeekView
            anchor={anchor}
            schedules={allSchedules}
            onCellClick={handleCellClickWeek}
            onScheduleClick={handleScheduleClick}
            onScheduleUpdate={handleScheduleUpdate}
            friendNames={friendNames}
          />
        ) : (
          <DayView
            anchor={anchor}
            schedules={allSchedules}
            onCellClick={handleCellClickWeek}
            onScheduleClick={handleScheduleClick}
            onScheduleUpdate={handleScheduleUpdate}
            friendNames={friendNames}
          />
        )}
      </Box>

      <Box p="sm" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
        <Group justify="space-between" align="center" wrap="nowrap" gap={6}>
          <UnstyledButton
            onClick={toggleFriendCollapsed}
            style={{ flex: 1, minWidth: 0 }}
            aria-expanded={!friendCollapsed}
            aria-label={friendCollapsed ? t('cal.expandFriends') : t('cal.collapseFriends')}
          >
            <Group gap={4} align="center" wrap="nowrap">
              {friendCollapsed
                ? <IconChevronDown size={14} stroke={1.5} />
                : <IconChevronUp size={14} stroke={1.5} />}
              <Text size="xs" fw={600}>{t('cal.friendSchedules', { n: partners.length })}</Text>
            </Group>
          </UnstyledButton>
          <Group gap={4} wrap="nowrap">
            {!friendCollapsed && partners.length > 0 && (
              <>
                <Button size="compact-xs" variant="subtle" onClick={() => setAllToggles(true)}>{t('cal.allOn')}</Button>
                <Button size="compact-xs" variant="subtle" onClick={() => setAllToggles(false)}>{t('cal.allOff')}</Button>
              </>
            )}
            <Button
              size="compact-xs"
              variant="subtle"
              leftSection={<IconShare size={12} stroke={1.5} />}
              onClick={() => setFriendReqOpen(true)}
            >
              {t('cal.request')}
            </Button>
          </Group>
        </Group>
        <Collapse expanded={!friendCollapsed}>
          <Box mt={6}>
            {partners.length === 0 ? (
              <Text size="xs" c="dimmed">{t('cal.noFriends')}</Text>
            ) : (
              <ScrollArea.Autosize mah={140} type="auto">
                <Stack gap={2}>
                  {partners.map((p) => {
                    const enabled = isFriendEnabled(friendToggles, p.id);
                    const name = p.contactName || p.companyName || p.id.slice(0, 6);
                    return (
                      <Group key={p.id} justify="space-between" align="center" wrap="nowrap" gap={6}>
                        <Group gap={6} align="center" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
                          <Box
                            style={{
                              width: 10,
                              height: 10,
                              borderRadius: 999,
                              background: FRIEND_COLOR_HEX[colorForPartner(p.id)],
                              flexShrink: 0,
                            }}
                          />
                          <Text size="xs" truncate="end" style={{ flex: 1 }}>{name}</Text>
                        </Group>
                        <Switch
                          size="xs"
                          checked={enabled}
                          onChange={(e) => setToggle(p.id, e.currentTarget.checked)}
                          aria-label={t('cal.showFriendSchedule', { name })}
                        />
                      </Group>
                    );
                  })}
                </Stack>
              </ScrollArea.Autosize>
            )}
          </Box>
        </Collapse>
      </Box>

      <ScheduleModal
        opened={modalOpen}
        initial={editing}
        defaultStart={defaultStart}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
        onDelete={editing ? handleDelete : undefined}
      />

      <FriendScheduleRequestModal
        opened={friendReqOpen}
        defaultFrom={(() => { const r = rangeForView(anchor, mode); return new Date(r.from); })()}
        defaultTo={(() => { const r = rangeForView(anchor, mode); return new Date(r.to); })()}
        onClose={() => setFriendReqOpen(false)}
        onSent={() => { expandFriendSection(); }}
      />
    </Stack>
  );
}
