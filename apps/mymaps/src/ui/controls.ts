import type { CSSProperties } from 'react';

// 마이크루 컨트롤 규격 (docs/design-tokens.md §6) — 사이즈 2종 × 변형 5종.
// src/client/ui/controls.ts와 동일 규격, CSS 변수만 mymaps 토큰(--bg-surface/--border/--accent/--danger)으로 조정.
// 커스텀 <button>/<a role=button> 인라인 스타일은 반드시 이 모듈을 사용한다.

export type BtnSize = 'sm' | 'md';
export type BtnVariant = 'primary' | 'danger' | 'neutral' | 'subtle' | 'dangerSubtle';

const SIZE: Record<BtnSize, CSSProperties> = {
  sm: { minHeight: 28, padding: '4px 12px', borderRadius: 6, fontSize: 12 },
  md: { minHeight: 36, padding: '8px 16px', borderRadius: 10, fontSize: 14 },
};

const VARIANT: Record<BtnVariant, CSSProperties> = {
  primary: { background: 'var(--accent)', border: '1px solid var(--accent)', color: '#fff', fontWeight: 600 },
  danger: { background: 'var(--danger)', border: '1px solid var(--danger)', color: '#fff' },
  neutral: { background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' },
  subtle: { background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)' },
  dangerSubtle: { background: 'transparent', border: '1px solid var(--border)', color: 'var(--danger)' },
};

const BASE: CSSProperties = {
  lineHeight: 1.2,
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  cursor: 'pointer',
  fontWeight: 400,
  textDecoration: 'none',
  whiteSpace: 'nowrap',
};

export function btn(size: BtnSize, variant: BtnVariant, extra?: CSSProperties): CSSProperties {
  return { ...BASE, ...SIZE[size], ...VARIANT[variant], ...extra };
}

// 아이콘 전용 정사각 버튼 (sm 28×28 / md 36×36)
export function iconBtn(size: BtnSize, variant: BtnVariant = 'subtle', extra?: CSSProperties): CSSProperties {
  const px = size === 'sm' ? 28 : 36;
  return { ...BASE, ...VARIANT[variant], width: px, height: px, minHeight: px, padding: 0, borderRadius: size === 'sm' ? 6 : 10, ...extra };
}
