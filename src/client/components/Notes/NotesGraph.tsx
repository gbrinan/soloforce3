import React, { useMemo, useState } from 'react';
import { Box, Text } from '@mantine/core';
import { parseWikiTargets } from './tiptap/backlinks';
import { useT } from '../../i18n/I18nProvider';

// 위키링크([[제목]]) 그래프 뷰 — open-knowledge UX 차용, 자체 구현 (의존성 없는 소형 포스 레이아웃).
// 노드 = 노트, 엣지 = 본문 [[제목]]이 다른 노트 제목과 일치. 클릭 시 해당 노트 열기.

interface NoteLite {
  id: string;
  title: string;
  content: string;
}

interface Props {
  notes: NoteLite[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

interface LayoutNode {
  id: string;
  title: string;
  x: number;
  y: number;
  degree: number;
}

const W = 800;
const H = 600;

// 결정적 의사난수 — 렌더마다 배치가 튀지 않게 노드 인덱스 기반 초기 위치.
function seeded(i: number, salt: number): number {
  const v = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

function computeLayout(notes: NoteLite[]): { nodes: LayoutNode[]; edges: Array<[number, number]> } {
  const byTitle = new Map<string, number>();
  notes.forEach((n, i) => { const t = n.title.trim().toLowerCase(); if (t) byTitle.set(t, i); });

  const edgeSet = new Set<string>();
  const edges: Array<[number, number]> = [];
  notes.forEach((n, i) => {
    for (const target of parseWikiTargets(n.content)) {
      const j = byTitle.get(target.toLowerCase());
      if (j === undefined || j === i) continue;
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (edgeSet.has(key)) continue;
      edgeSet.add(key);
      edges.push(i < j ? [i, j] : [j, i]);
    }
  });

  const degree = new Array(notes.length).fill(0);
  for (const [a, b] of edges) { degree[a]++; degree[b]++; }

  // 소형 포스 레이아웃 — 반발(쿨롱) + 엣지 스프링 + 중심 인력, 고정 반복 후 정지 상태 렌더.
  const xs = notes.map((_, i) => W / 2 + (seeded(i, 1) - 0.5) * W * 0.8);
  const ys = notes.map((_, i) => H / 2 + (seeded(i, 2) - 0.5) * H * 0.8);
  const N = notes.length;
  const REPULSE = 22000;
  const SPRING = 0.02;
  const SPRING_LEN = 140;
  const CENTER = 0.012;
  for (let iter = 0; iter < 260; iter++) {
    const cool = 1 - iter / 260;
    const fx = new Array(N).fill(0);
    const fy = new Array(N).fill(0);
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        let dx = xs[i] - xs[j];
        let dy = ys[i] - ys[j];
        const d2 = dx * dx + dy * dy || 1;
        const d = Math.sqrt(d2);
        const f = REPULSE / d2;
        dx /= d; dy /= d;
        fx[i] += dx * f; fy[i] += dy * f;
        fx[j] -= dx * f; fy[j] -= dy * f;
      }
      fx[i] += (W / 2 - xs[i]) * CENTER;
      fy[i] += (H / 2 - ys[i]) * CENTER;
    }
    for (const [a, b] of edges) {
      const dx = xs[b] - xs[a];
      const dy = ys[b] - ys[a];
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = SPRING * (d - SPRING_LEN);
      fx[a] += (dx / d) * f; fy[a] += (dy / d) * f;
      fx[b] -= (dx / d) * f; fy[b] -= (dy / d) * f;
    }
    for (let i = 0; i < N; i++) {
      xs[i] += Math.max(-14, Math.min(14, fx[i])) * cool;
      ys[i] += Math.max(-14, Math.min(14, fy[i])) * cool;
      xs[i] = Math.max(30, Math.min(W - 30, xs[i]));
      ys[i] = Math.max(26, Math.min(H - 26, ys[i]));
    }
  }

  return {
    nodes: notes.map((n, i) => ({
      id: n.id,
      title: n.title.trim() || '(제목 없음)',
      x: xs[i],
      y: ys[i],
      degree: degree[i],
    })),
    edges,
  };
}

export default function NotesGraph({ notes, selectedId, onSelect }: Props) {
  const t = useT();
  const [hovered, setHovered] = useState<string | null>(null);
  const { nodes, edges } = useMemo(() => computeLayout(notes), [notes]);

  if (notes.length === 0) {
    return (
      <Box p="xl" style={{ textAlign: 'center' }}>
        <Text size="sm" c="dimmed">{t('notes.graphEmpty')}</Text>
      </Box>
    );
  }

  // hover 노드와 직접 연결된 노드/엣지 하이라이트
  const hoverIdx = hovered ? nodes.findIndex((n) => n.id === hovered) : -1;
  const linked = new Set<number>();
  if (hoverIdx >= 0) {
    for (const [a, b] of edges) {
      if (a === hoverIdx) linked.add(b);
      if (b === hoverIdx) linked.add(a);
    }
  }

  return (
    <Box style={{ flex: 1, minHeight: 0, overflow: 'auto' }} p="xs">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: '100%', minHeight: 360, display: 'block' }}
        role="img"
        aria-label={t('notes.graphAriaLabel')}
      >
        {edges.map(([a, b], i) => {
          const active = hoverIdx >= 0 && (a === hoverIdx || b === hoverIdx);
          return (
            <line
              key={i}
              x1={nodes[a].x} y1={nodes[a].y}
              x2={nodes[b].x} y2={nodes[b].y}
              stroke={active ? 'var(--ring)' : 'var(--border-default)'}
              strokeWidth={active ? 1.8 : 1}
              opacity={hoverIdx >= 0 && !active ? 0.25 : 0.9}
            />
          );
        })}
        {nodes.map((n, i) => {
          const r = 6 + Math.min(8, n.degree * 2);
          const isSelected = n.id === selectedId;
          const dimmed = hoverIdx >= 0 && i !== hoverIdx && !linked.has(i);
          return (
            <g
              key={n.id}
              transform={`translate(${n.x},${n.y})`}
              style={{ cursor: 'pointer' }}
              opacity={dimmed ? 0.3 : 1}
              onClick={() => onSelect(n.id)}
              onMouseEnter={() => setHovered(n.id)}
              onMouseLeave={() => setHovered(null)}
            >
              <circle
                r={r}
                fill={n.degree > 0 ? 'var(--ring)' : 'var(--bg-elevated)'}
                stroke={isSelected ? 'var(--text-primary)' : 'var(--border-default)'}
                strokeWidth={isSelected ? 2 : 1}
              />
              <text
                y={r + 13}
                textAnchor="middle"
                style={{ fontSize: 11, fill: 'var(--text-primary)', pointerEvents: 'none', userSelect: 'none' }}
              >
                {n.title.length > 16 ? `${n.title.slice(0, 15)}…` : n.title}
              </text>
            </g>
          );
        })}
      </svg>
    </Box>
  );
}
