// 상단 메뉴 바 순서·표시 설정 — 설정 화면에서 편집, App 헤더가 읽어 렌더.
// localStorage 'jarvis:navSettings'에 영속. 저장 시 'nav-settings-changed' 이벤트를 발화해
// 열려 있는 헤더/설정 화면이 즉시 동기화하도록 한다. (noteViewSettings 패턴 미러)
import type { MessageKey } from '../i18n/messages';

// 패널 식별자 — App.tsx의 activePanel / togglePanel(id)과 1:1 대응.
export type PanelId = 'todos' | 'schedules' | 'meeting' | 'notes' | 'files' | 'inbox' | 'staff' | 'costs' | 'contacts' | 'notifications';

// 메뉴 항목 단일 소스(canonical 순서 = 현재 헤더 기본 순서). 라벨은 i18n 키로 해석.
export const NAV_ITEMS: { id: PanelId; labelKey: MessageKey }[] = [
  { id: 'inbox', labelKey: 'nav.friends' },
  { id: 'notifications', labelKey: 'nav.notifications' },
  { id: 'todos', labelKey: 'nav.todos' },
  { id: 'schedules', labelKey: 'nav.schedules' },
  { id: 'meeting', labelKey: 'nav.meeting' },
  { id: 'notes', labelKey: 'nav.notes' },
  { id: 'files', labelKey: 'nav.files' },
  { id: 'staff', labelKey: 'nav.staff' },
  { id: 'costs', labelKey: 'nav.tokens' },
  { id: 'contacts', labelKey: 'nav.contacts' },
];

const ALL_IDS: PanelId[] = NAV_ITEMS.map((i) => i.id);
const LABEL_BY_ID: Record<PanelId, MessageKey> = Object.fromEntries(
  NAV_ITEMS.map((i) => [i.id, i.labelKey]),
) as Record<PanelId, MessageKey>;

export interface NavSettings {
  order: PanelId[];     // 표시 순서(숨김 항목 포함한 전체 순서)
  hidden: PanelId[];    // 상단 바에서 숨길 항목
}

export const DEFAULT_NAV_SETTINGS: NavSettings = { order: [...ALL_IDS], hidden: [] };

// 항상 표시 고정 패널 — 업무(todos)/자료실(files)/직원(staff)/알림(notifications)/토큰(costs).
// hidden에 저장돼 있어도 무시하고 강제 표시, 설정 화면에서 ON/OFF 토글을 제거한다.
// 순서 변경(드래그)은 여전히 가능. (스토어 FIXED_PLUGIN_IDS와 미러 유지)
export const FIXED_PANELS: PanelId[] = ['todos', 'files', 'staff', 'notifications', 'costs'];

const STORAGE_KEY = 'jarvis:navSettings';
export const NAV_SETTINGS_CHANGED_EVENT = 'nav-settings-changed';

function isPanelId(v: unknown): v is PanelId {
  return typeof v === 'string' && (ALL_IDS as string[]).includes(v);
}

// 저장값 로드 — 메뉴 증감(앱 업데이트)에 대비해 머지 방어:
//  - 저장 order 중 유효 id만 유지 → canonical에 있으나 누락된 id를 뒤에 append (신규 메뉴 자동 노출)
//  - hidden은 유효 id로만 필터.
export function loadNavSettings(): NavSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_NAV_SETTINGS, order: [...ALL_IDS], hidden: [] };
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return { order: [...ALL_IDS], hidden: [] };
    const savedOrder: PanelId[] = Array.isArray(o.order) ? o.order.filter(isPanelId) : [];
    const seen = new Set<PanelId>(savedOrder);
    const order: PanelId[] = [...savedOrder, ...ALL_IDS.filter((id) => !seen.has(id))];
    const rawHidden: PanelId[] = Array.isArray(o.hidden) ? o.hidden.filter(isPanelId) : [];
    // 고정 패널이 과거에 hidden으로 저장돼 있으면 제거(항상 표시 보장).
    const hidden = rawHidden.filter((id) => !FIXED_PANELS.includes(id));
    return { order, hidden };
  } catch {
    return { order: [...ALL_IDS], hidden: [] };
  }
}

export function saveNavSettings(v: NavSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {
    // ignore (quota/비활성)
  }
  try {
    window.dispatchEvent(new Event(NAV_SETTINGS_CHANGED_EVENT));
  } catch {
    // ignore (SSR/비브라우저)
  }
}

// 헤더 렌더용 — 숨김 제외한 표시 항목을 순서대로 반환. 고정 패널은 hidden 여부와 무관하게 항상 표시.
export function resolveVisibleItems(s: NavSettings): { id: PanelId; labelKey: MessageKey }[] {
  const hidden = new Set(s.hidden);
  return s.order
    .filter((id) => FIXED_PANELS.includes(id) || !hidden.has(id))
    .map((id) => ({ id, labelKey: LABEL_BY_ID[id] }));
}

// 설정 화면 리스트용 — 전체 항목을 순서대로 + 표시 여부 + 고정 여부(토글 제거 대상).
export function resolveAllItems(s: NavSettings): { id: PanelId; labelKey: MessageKey; visible: boolean; fixed: boolean }[] {
  const hidden = new Set(s.hidden);
  return s.order.map((id) => ({
    id,
    labelKey: LABEL_BY_ID[id],
    visible: FIXED_PANELS.includes(id) || !hidden.has(id),
    fixed: FIXED_PANELS.includes(id),
  }));
}
