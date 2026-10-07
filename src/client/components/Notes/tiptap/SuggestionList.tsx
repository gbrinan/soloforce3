import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { Paper, Stack, UnstyledButton, Text, Group } from '@mantine/core';
import type { SuggestionProps } from '@tiptap/suggestion';

// 위키링크/태그/슬래시 제안에 공통으로 쓰는 아이템 형태.
// - id/label: Mention 기본 command가 노드 attrs로 사용 (위키링크·태그)
// - run: 슬래시 커맨드가 선택 시 실행할 동작
export interface SuggestionItem {
  id?: string;
  label: string;
  hint?: string;
  run?: (editor: import('@tiptap/core').Editor, range: import('@tiptap/core').Range) => void;
}

export interface SuggestionListHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

// ReactRenderer가 마운트하는 제안 목록. 화살표/Enter 키 내비게이션을 ref로 노출.
const SuggestionList = forwardRef<SuggestionListHandle, SuggestionProps<SuggestionItem>>(
  ({ items, command }, ref) => {
    const [index, setIndex] = useState(0);

    // 아이템 목록이 바뀌면 선택 인덱스를 초기화.
    useEffect(() => setIndex(0), [items]);

    const select = (i: number) => {
      const item = items[i];
      if (item) command(item);
    };

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (items.length === 0) return false;
        if (event.key === 'ArrowUp') {
          setIndex((i) => (i + items.length - 1) % items.length);
          return true;
        }
        if (event.key === 'ArrowDown') {
          setIndex((i) => (i + 1) % items.length);
          return true;
        }
        if (event.key === 'Enter') {
          select(index);
          return true;
        }
        return false;
      },
    }), [items, index]);

    if (items.length === 0) return null;

    return (
      <Paper
        shadow="md"
        withBorder
        p={4}
        style={{ minWidth: 160, maxWidth: 280, maxHeight: 260, overflowY: 'auto' }}
      >
        <Stack gap={1}>
          {items.map((item, i) => (
            <UnstyledButton
              key={`${item.id ?? item.label}-${i}`}
              // mousedown 기본동작(blur) 방지 — 에디터 포커스를 유지한 채 선택.
              onMouseDown={(e) => { e.preventDefault(); select(i); }}
              onMouseEnter={() => setIndex(i)}
              style={{
                padding: '4px 8px',
                borderRadius: 4,
                background: i === index ? 'var(--mantine-color-default-hover)' : undefined,
              }}
            >
              <Group justify="space-between" gap={8} wrap="nowrap">
                <Text size="xs" truncate="end">{item.label}</Text>
                {item.hint && <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>{item.hint}</Text>}
              </Group>
            </UnstyledButton>
          ))}
        </Stack>
      </Paper>
    );
  },
);

SuggestionList.displayName = 'SuggestionList';

export default SuggestionList;
