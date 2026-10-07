export type NotificationKind = 'partner_added' | 'schedule' | 'mail' | 'booking' | 'contract' | 'workflow_approval' | 'diary' | 'update' | 'notice';

export interface NotificationDeepLink {
  panel?: 'staff' | 'schedules' | 'inbox' | 'apps' | 'notifications' | 'settings';
  appId?: string;
  route?: string;
  targetUserKey?: string; // FE filters notifications by this key (undefined = broadcast)
}

export interface NotificationSource {
  appId?: string;
  refId?: string;
}

// 공지(kind:notice) 페이로드 — 알림 드로어에서 인라인 펼침으로 본문(HTML)·이동 버튼 렌더
export interface NoticePayload {
  html: string;
  button?: { label: string; targetType: 'url' | 'app' | 'plugin'; target: string; newTab?: boolean };
}

export interface Notification {
  id: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  createdAt: string;
  readAt?: string;
  deepLink?: NotificationDeepLink;
  source?: NotificationSource;
  expiresAt?: string;
  notice?: NoticePayload;
}

export interface NotificationEvent {
  type: 'created' | 'updated' | 'deleted';
  notification: Notification;
}

export interface NotificationSettings {
  kinds: Record<NotificationKind, boolean>;
  sound: boolean;
  toast: boolean;
  autoDeleteDays: 7 | 30 | null;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  kinds: {
    partner_added: true,
    schedule: true,
    mail: true,
    booking: true,
    contract: true,
    workflow_approval: true,
    diary: true,
    update: true,
    notice: true,
  },
  sound: false,
  toast: true,
  autoDeleteDays: 30,
};

const NOTIFICATION_SETTINGS_KEY = 'notification_settings';

export function loadNotificationSettings(): NotificationSettings {
  try {
    const raw = localStorage.getItem(NOTIFICATION_SETTINGS_KEY);
    if (!raw) return DEFAULT_NOTIFICATION_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<NotificationSettings>;
    return {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      ...parsed,
      kinds: { ...DEFAULT_NOTIFICATION_SETTINGS.kinds, ...(parsed.kinds ?? {}) },
    };
  } catch {
    return DEFAULT_NOTIFICATION_SETTINGS;
  }
}

export function saveNotificationSettings(s: NotificationSettings): void {
  localStorage.setItem(NOTIFICATION_SETTINGS_KEY, JSON.stringify(s));
}

// 앱에 종속된 알림 kind → 앱 id 매핑. 여기 없는 kind는 시스템/코어 알림으로 항상 노출된다.
// 매핑된 kind는 해당 앱이 설치돼 있을 때만 알림 설정·필터 탭에 표시한다(앱 삭제 시 자동 숨김).
export const KIND_TO_APP_ID: Partial<Record<NotificationKind, string>> = {
  mail: 'mail',
  booking: 'booking',
  diary: 'diary',
};

/** 설치된 앱 id 집합 기준으로 노출할 알림 kind 목록을 거른다(앱 전용 kind는 설치 시에만). */
export function visibleNotificationKinds(
  all: NotificationKind[],
  installedAppIds: Set<string>,
): NotificationKind[] {
  return all.filter((k) => {
    const appId = KIND_TO_APP_ID[k];
    return !appId || installedAppIds.has(appId);
  });
}
