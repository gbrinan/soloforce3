import type { ScheduleColor } from './api';

const PALETTE: readonly ScheduleColor[] = ['blue', 'green', 'red', 'yellow', 'violet', 'orange'] as const;

// DJB2 hash — 동일 partnerId는 항상 동일 색상.
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

export function colorForPartner(partnerId: string): ScheduleColor {
  if (!partnerId) return 'blue';
  return PALETTE[hash(partnerId) % PALETTE.length];
}

export const FRIEND_COLOR_HEX: Record<ScheduleColor, string> = {
  blue: 'var(--mantine-color-blue-6)',
  green: 'var(--mantine-color-green-6)',
  red: 'var(--mantine-color-red-6)',
  yellow: 'var(--mantine-color-yellow-6)',
  violet: 'var(--mantine-color-violet-6)',
  orange: 'var(--mantine-color-orange-6)',
};

const TOGGLE_KEY = 'jarvis:calendar:friend-toggle';

export function loadFriendToggles(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(TOGGLE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, boolean>;
  } catch { /* */ }
  return {};
}

export function saveFriendToggles(map: Record<string, boolean>): void {
  try {
    localStorage.setItem(TOGGLE_KEY, JSON.stringify(map));
  } catch { /* */ }
}

// 키가 없는 친구는 default ON.
export function isFriendEnabled(map: Record<string, boolean>, partnerId: string): boolean {
  return map[partnerId] !== false;
}
