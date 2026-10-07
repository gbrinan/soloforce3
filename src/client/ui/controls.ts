import type { CSSProperties } from 'react';

// 마이크루 컨트롤 규격 (docs/design-tokens.md §6) — 사이즈 2종 × 변형 5종.
// 커스텀 <button>/<a role=button> 인라인 스타일은 반드시 이 모듈을 사용한다.

export type BtnSize = 'sm' | 'md';
export type BtnVariant = 'primary' | 'danger' | 'neutral' | 'subtle' | 'dangerSubtle';

const SIZE: Record<BtnSize, CSSProperties> = {
  sm: { minHeight: 28, padding: '4px 12px', borderRadius: 6, fontSize: 'var(--font-s)' },
  md: { minHeight: 36, padding: '8px 16px', borderRadius: 10, fontSize: 'var(--font-m)' },
};

const VARIANT: Record<BtnVariant, CSSProperties> = {
  primary: { background: 'var(--ring)', border: '1px solid var(--ring)', color: '#fff', fontWeight: 600 },
  danger: { background: 'var(--accent-danger)', border: '1px solid var(--accent-danger)', color: 'var(--accent-on-fill)' },
  neutral: { background: 'var(--bg-canvas)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' },
  subtle: { background: 'transparent', border: '1px solid var(--border-default)', color: 'var(--text-muted)' },
  dangerSubtle: { background: 'transparent', border: '1px solid var(--border-default)', color: 'var(--accent-danger)' },
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
