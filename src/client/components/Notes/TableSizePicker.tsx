import React, { useState } from 'react';
import { Box, Text } from '@mantine/core';

interface Props {
  onPick: (rows: number, cols: number) => void;
  max?: number;             // 한 변의 최대 칸 수(기본 8)
}

// 표 삽입용 N×M 크기 선택 그리드 — 호버로 크기 미리보기, 클릭으로 확정(Notion/구글 문서 패턴).
// 마우스 전용(데스크탑). 빠른 3×3 삽입은 슬래시 커맨드(/표)가 별도로 제공.
export default function TableSizePicker({ onPick, max = 8 }: Props) {
  const [hover, setHover] = useState<{ r: number; c: number }>({ r: 0, c: 0 });

  const cells: React.ReactNode[] = [];
  for (let r = 0; r < max; r++) {
    for (let c = 0; c < max; c++) {
      const active = r <= hover.r && c <= hover.c;
      cells.push(
        <Box
          key={`${r}-${c}`}
          onMouseEnter={() => setHover({ r, c })}
          onClick={() => onPick(r + 1, c + 1)}
          style={{
            width: 16,
            height: 16,
            borderRadius: 4,
            cursor: 'pointer',
            border: '1px solid var(--mantine-color-default-border)',
            background: active ? 'var(--mantine-color-jarvis-5)' : 'var(--mantine-color-body)',
          }}
        />,
      );
    }
  }

  return (
    <Box>
      <Box
        style={{ display: 'grid', gridTemplateColumns: `repeat(${max}, 16px)`, gap: 3 }}
        onMouseLeave={() => setHover({ r: 0, c: 0 })}
      >
        {cells}
      </Box>
      <Text size="xs" ta="center" mt={6} c="dimmed">{hover.r + 1} × {hover.c + 1}</Text>
    </Box>
  );
}
