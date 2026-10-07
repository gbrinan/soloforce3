import React from 'react';
import { Box } from '@mantine/core';

// 6px 원형 dot — Badge leftSection에서 사용.
export const BadgeDot = (
  <span
    style={{
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: 'currentColor',
      display: 'inline-block',
    }}
  />
);

// .todo-gauge-scroll + .todo-gauge-inner 박스 래퍼.
// 자식 카드 게이지가 좁은 viewport에서 가로 스크롤 가능하도록 감싸는 공용 래퍼.
export function TodoGaugeWrapper({ children, mt }: { children: React.ReactNode; mt?: number }) {
  return (
    <Box className="todo-gauge-scroll" mt={mt ?? 6}>
      <Box className="todo-gauge-inner">{children}</Box>
    </Box>
  );
}
