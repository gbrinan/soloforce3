import type { CSSProperties } from 'react';
import { btn } from '../../ui/controls';

// 미팅 드로어 공용 버튼 — 전사 컨트롤 규격(ui/controls.ts) sm 사이즈의 얇은 별칭.
// primary/danger도 파일 선택(neutral)과 완전히 동일한 규격·굵기(400) — 색만 다르다.
// (filled 배경 + bold 조합이 같은 행의 outline 버튼보다 커 보이는 문제 방지)
export const meetingBtn: Record<'primary' | 'danger' | 'neutral' | 'subtle' | 'dangerSubtle', CSSProperties> = {
  primary: btn('sm', 'primary', { fontWeight: 400 }),
  danger: btn('sm', 'danger', { fontWeight: 400 }),
  neutral: btn('sm', 'neutral'),
  subtle: btn('sm', 'subtle'),
  dangerSubtle: btn('sm', 'dangerSubtle'),
};
