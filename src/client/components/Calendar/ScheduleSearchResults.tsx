import React, { useMemo } from 'react';
import { Box, Group, Stack, Text, ScrollArea, UnstyledButton } from '@mantine/core';
import type { Schedule } from '../../utils/api';
import { COLOR_SWATCH_HEX } from '../../utils/colorLabels';
import { useI18n } from '../../i18n/I18nProvider';

interface Props {
  results: Schedule[];
  onSelect: (s: Schedule) => void;
  friendNames: Record<string, string>;
}

// 구글 캘린더 검색 결과 스타일 리스트 — 시간순 행 목록.
// 각 행: [시작일 큰 숫자] [YYYY년 M월, 요일] [컬러 점] [종일|시작~종료] [제목]
export default function ScheduleSearchResults({ results, onSelect, friendNames }: Props) {
  const { t, locale } = useI18n();

  // 시작 시각 오름차순 정렬 (내 일정 + 친구 일정 병합 후 재정렬)
  const sorted = useMemo(
    () => [...results].sort((a, b) => a.start.localeCompare(b.start)),
    [results],
  );

  const monthYearFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }),
    [locale],
  );
  const weekdayFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: 'short' }),
    [locale],
  );
  const timeFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }),
    [locale],
  );

  if (sorted.length === 0) {
    return (
      <Box p="xl" style={{ textAlign: 'center' }}>
        <Text size="sm" c="dimmed">{t('cal.searchNoResults')}</Text>
      </Box>
    );
  }

  return (
    <ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto">
      <Stack gap={0}>
        {sorted.map((s) => {
          const start = new Date(s.start);
          const end = new Date(s.end);
          const isFriend = s.owner !== 'me';
          const timeLabel = s.allDay
            ? t('cal.allDay')
            : `${timeFmt.format(start)} ~ ${timeFmt.format(end)}`;
          const swatch = COLOR_SWATCH_HEX[s.color ?? 'blue'];
          return (
            <UnstyledButton
              key={s.id}
              className="schedule-search-row"
              onClick={() => onSelect(s)}
              style={{
                display: 'block',
                width: '100%',
                padding: '10px 12px',
                borderBottom: '1px solid var(--mantine-color-default-border)',
              }}
            >
              <Group gap="sm" wrap="nowrap" align="flex-start">
                <Text fw={600} style={{ fontSize: 'var(--font-l)', lineHeight: 1, minWidth: 28, textAlign: 'center' }}>
                  {start.getDate()}
                </Text>
                <Box style={{ minWidth: 0, flex: 1 }}>
                  <Text size="xs" c="dimmed">
                    {monthYearFmt.format(start)}, {weekdayFmt.format(start)}
                  </Text>
                  <Group gap={6} wrap="nowrap" align="center" mt={2}>
                    <Box
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        background: swatch,
                        flexShrink: 0,
                      }}
                    />
                    <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>{timeLabel}</Text>
                    <Text size="sm" truncate="end" style={{ minWidth: 0 }}>
                      {s.title}
                      {isFriend && friendNames[s.owner] ? ` · ${friendNames[s.owner]}` : ''}
                    </Text>
                  </Group>
                </Box>
              </Group>
            </UnstyledButton>
          );
        })}
      </Stack>
    </ScrollArea>
  );
}
