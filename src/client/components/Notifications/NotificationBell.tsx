import { useEffect, useState } from 'react';
import { ActionIcon, Indicator } from '@mantine/core';
import { IconBell } from '@tabler/icons-react';
import NotificationCenter from './NotificationCenter';
import type { Notification } from '../../../shared/notifications';
import { useT } from '../../i18n/I18nProvider';

interface Props {
  items: Notification[];
  unreadCount: number;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onRemove: (id: string) => void;
  onOpenSettings: () => void;
  onDeepLink?: (item: Notification) => void;
}

// 헤더 우측(앱 런처 좌측) 알림 벨 — 클릭 시 FAB 대화창처럼 플로팅 팝업으로 알림 센터 표시.
// 앱 화면(viewMode 'photos')에서도 헤더가 항상 보이므로 어디서든 알림 확인 가능.
export default function NotificationBell({
  items, unreadCount, onMarkRead, onMarkAllRead, onRemove, onOpenSettings, onDeepLink,
}: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <Indicator disabled={unreadCount === 0} label={unreadCount > 99 ? '99+' : String(unreadCount)} size={16} color="red" offset={4}>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="lg"
          aria-label={t('notifications.title')}
          title={t('notifications.title')}
          onClick={() => setOpen((o) => !o)}
          style={{ marginRight: 4 }}
        >
          <IconBell size={20} stroke={1.5} />
        </ActionIcon>
      </Indicator>
      {open && (
        <div
          style={{
            position: 'fixed',
            top: 52,
            right: 12,
            zIndex: 60,
            width: 'min(420px, calc(100vw - 24px))',
            height: 'min(640px, calc(100vh - 72px))',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            background: 'var(--jarvis-surface-bg)',
            border: '1px solid var(--mantine-color-default-border)',
            borderRadius: 14,
            boxShadow: '0 24px 64px -24px rgba(0, 0, 0, 0.6)',
          }}
        >
          <NotificationCenter
            visible
            items={items}
            onMarkRead={onMarkRead}
            onMarkAllRead={onMarkAllRead}
            onRemove={onRemove}
            onOpenSettings={() => { setOpen(false); onOpenSettings(); }}
            onClose={() => setOpen(false)}
            onDeepLink={(item) => { setOpen(false); onDeepLink?.(item); }}
          />
        </div>
      )}
    </>
  );
}
