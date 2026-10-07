// 캘린더 이벤트 색상의 사용자 정의 라벨 — localStorage 보관 (서버 비의존, 친구색 토글 패턴과 동일).
// 관련: friendColor.ts (동일한 localStorage JSON 맵 패턴)
import type { ScheduleColor } from './api';

const STORAGE_KEY = 'jarvis-schedule-color-labels';

// 선택 가능한 색상 — blue/orange는 선택 목록에서 제외(요청). 단 DEFAULT_COLOR_LABELS·COLOR_SWATCH_HEX에는
// 남겨 두어 기존에 blue/orange로 저장된 이벤트가 정상 표시(라벨/스와치)되도록 fallback 보장.
export const SCHEDULE_COLORS: ScheduleColor[] = ['green', 'red', 'yellow', 'violet'];

// 라벨 미설정 시 표시되는 기본 색상명.
export const DEFAULT_COLOR_LABELS: Record<ScheduleColor, string> = {
  blue: '파랑',
  green: '초록',
  red: '빨강',
  yellow: '노랑',
  violet: '보라',
  orange: '주황',
};

// 드롭다운 스와치 색 — MonthView COLOR_HEX_BRIGHT와 동일 hex 유지.
export const COLOR_SWATCH_HEX: Record<ScheduleColor, string> = {
  blue: '#4F47E6',
  green: '#34D399',
  red: '#F97171',
  yellow: '#FBC024',
  violet: '#9775fa',
  orange: '#ff922b',
};

export type ColorLabelMap = Partial<Record<ScheduleColor, string>>;

export function loadColorLabels(): ColorLabelMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as ColorLabelMap : {};
  } catch {
    return {};
  }
}

export function saveColorLabels(map: ColorLabelMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* localStorage 불가 환경은 무시 */
  }
}

// 커스텀 라벨이 있으면 그것을, 없으면 기본 색상명을 반환.
export function colorLabel(color: ScheduleColor, labels: ColorLabelMap): string {
  const custom = labels[color]?.trim();
  return custom || DEFAULT_COLOR_LABELS[color];
}
