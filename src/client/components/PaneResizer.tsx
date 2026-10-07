import React, { useState } from 'react';
import { useT } from '../i18n/I18nProvider';

interface Props {
  width: number;                 // 현재 좌측 패널 너비(px) — 드래그 시작 기준값
  onResize: (next: number) => void;
  min?: number;
  max?: number;
  ariaLabel?: string;
}

// 좌측 사이드바 ↔ 우측 콘텐츠 사이의 드래그 리사이저(내부 분할선).
// 레이아웃 차지폭은 6px(grid 트랙 / flex 슬롯과 정렬) 그대로 두되, 실제로 잡히는 히트영역은
// 트랙 밖으로 좌우 4px씩 넘쳐 ~14px → "너무 얇아 못 잡는" 문제를 없앤다.
// 델타 방식: 드래그 시작 시점의 너비/포인터X를 캡처해 이동량을 더하고 min/max로 클램프.
// 드래그마다 document 리스너를 새로 바인딩하므로 onResize/min/max stale closure 문제가 없다.
// 마우스 전용(데스크탑) — 모바일에서는 호출 측(isDesktop)에서 렌더하지 않는다.
export default function PaneResizer({ width, onResize, min = 160, max = 480, ariaLabel }: Props) {
  const t = useT();
  const [hover, setHover] = useState(false);
  const [dragging, setDragging] = useState(false);

  const start = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    setDragging(true);
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent) => {
      const next = Math.min(max, Math.max(min, startW + (ev.clientX - startX)));
      onResize(next);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setDragging(false);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const lit = hover || dragging;

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel ?? t('common.resizeSidebar')}
      onMouseDown={start}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        width: 6,
        flexShrink: 0,
        alignSelf: 'stretch',
        cursor: 'ew-resize',
        zIndex: 5,
        touchAction: 'none',
      }}
    >
      {/* 넓은 히트영역 — 6px 트랙 밖으로 좌우 4px씩 넘쳐 잡기 쉽다(레이아웃 차지폭은 6px 유지). */}
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: -4, right: -4, cursor: 'ew-resize' }} />
      {/* 가운데 시각 라인 — hover/드래그 시에만 강조 표시. */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 2,
          width: 2,
          background: lit ? 'var(--ring)' : 'transparent',
          transition: 'background 120ms ease',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
