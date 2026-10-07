import React, { useEffect, useState } from 'react';
import {
  Box,
  Stack,
  Group,
  Text,
  ActionIcon,
  ScrollArea,
  Tabs,
  Menu,
  Button,
  Badge,
  Tooltip,
} from '@mantine/core';
import {
  IconSettings,
  IconDotsVertical,
  IconMailOpened,
  IconTrash,
  IconExternalLink,
  IconX,
} from '@tabler/icons-react';
import { loadNotificationSettings, visibleNotificationKinds, type Notification, type NotificationKind } from '../../../shared/notifications';
import { getManifests } from '../../utils/appRegistry';
import { useT } from '../../i18n/I18nProvider';
import { fetchMe } from '../../utils/api';

const KIND_EMOJI: Record<NotificationKind, string> = {
  partner_added: '🤝',
  schedule: '📅',
  mail: '✉️',
  booking: '📆',
  contract: '📝',
  workflow_approval: '📋',
  diary: '📔',
  update: '🆕',
  notice: '📢',
};

type FilterKind = 'all' | NotificationKind;

interface NotificationItemProps {
  item: Notification;
  onMarkRead: (id: string) => void;
  onRemove: (id: string) => void;
  onDeepLink?: (item: Notification) => void;
}

// 공지 본문 방어 새니타이즈(서버에서 1차 수행) — script·이벤트 핸들러·javascript: 제거
function sanitizeNoticeHtml(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
}

function NotificationItem({ item, onMarkRead, onRemove, onDeepLink }: NotificationItemProps) {
  const t = useT();
  // 공지(kind:notice)는 딥링크 이동 대신 인라인 펼침으로 본문을 보여준다
  const [expanded, setExpanded] = useState(false);
  const isUnread = !item.readAt;
  // Strip leading emoji from title — the kind emoji is already shown on the left.
  const displayTitle = item.title.replace(/^\s*(?:\p{Extended_Pictographic}\uFE0F?\s*)+/u, '') || item.title;
  const diffMin = Math.round((Date.now() - new Date(item.createdAt).getTime()) / 60000);
  const rtf = new Intl.RelativeTimeFormat('ko', { numeric: 'auto' });
  const timeStr =
    diffMin < 60 ? rtf.format(-diffMin, 'minute')
    : diffMin < 1440 ? rtf.format(-Math.floor(diffMin / 60), 'hour')
    : rtf.format(-Math.floor(diffMin / 1440), 'day');

  return (
    <Box
      px="md"
      py="xs"
      style={{
        borderBottom: '1px solid var(--mantine-color-default-border)',
        background: isUnread ? 'var(--mantine-color-blue-light)' : undefined,
        cursor: 'pointer',
      }}
      onClick={() => {
        if (isUnread) onMarkRead(item.id);
        if (item.kind === 'notice' && item.notice) {
          setExpanded((v) => !v);
          return;
        }
        if (item.deepLink) onDeepLink?.(item);
      }}
    >
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Group align="flex-start" gap="xs" style={{ flex: 1, minWidth: 0 }}>
          {isUnread && (
            <Box
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--mantine-color-blue-6)',
                flexShrink: 0,
                marginTop: 6,
              }}
            />
          )}
          <Text size="lg" style={{ flexShrink: 0 }}>
            {KIND_EMOJI[item.kind]}
          </Text>
          <Box style={{ minWidth: 0 }}>
            <Text size="sm" fw={isUnread ? 600 : 400} truncate>
              {displayTitle}
            </Text>
            {item.body && (
              <Text size="xs" c="dimmed" lineClamp={2}>
                {item.body}
              </Text>
            )}
            <Text size="xs" c="dimmed" mt={2}>
              {timeStr}
            </Text>
            {item.kind === 'notice' && item.notice && expanded && (
              <Box
                mt={10}
                pt={10}
                onClick={(e) => e.stopPropagation()}
                style={{
                  // 박스 대신 시간과 본문 사이 구분선
                  borderTop: '1px solid var(--mantine-color-default-border)',
                  fontSize: 13,
                  lineHeight: 1.6,
                  overflowX: 'auto',
                }}
              >
                <div
                  className="notice-body"
                  // 관리자 작성 HTML — 서버·클라이언트 이중 새니타이즈 후 렌더
                  dangerouslySetInnerHTML={{ __html: sanitizeNoticeHtml(item.notice.html) }}
                  style={{ wordBreak: 'break-word' }}
                />
                <style>{`.notice-body img { max-width: 100%; border-radius: 8px; }`}</style>
                {item.notice.button && (
                  <Box mt={10}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const b = item.notice!.button!;
                        if (b.targetType === 'url') {
                          if (b.newTab === false) window.location.href = b.target;
                          else window.open(b.target, '_blank', 'noopener,noreferrer');
                        } else if (b.targetType === 'app') {
                          onDeepLink?.({ ...item, deepLink: { panel: 'apps', appId: b.target } });
                        } else {
                          // 플러그인 패널 이동 — App.tsx 딥링크 핸들러가 panel 문자열로 사이드 패널을 연다
                          onDeepLink?.({ ...item, deepLink: { panel: b.target } as Notification['deepLink'] });
                        }
                      }}
                      style={{
                        background: 'var(--mantine-color-jarvis-filled, #6366F1)',
                        color: '#fff', border: 0, borderRadius: 8, padding: '7px 14px',
                        fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      }}
                    >
                      {item.notice.button.label} →
                    </button>
                  </Box>
                )}
              </Box>
            )}
          </Box>
        </Group>
        <Menu withinPortal position="bottom-end" shadow="md">
          <Menu.Target>
            <ActionIcon
              size="xs"
              variant="subtle"
              onClick={(e) => e.stopPropagation()}
              style={{ flexShrink: 0 }}
            >
              <IconDotsVertical size={14} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            {isUnread && (
              <Menu.Item
                leftSection={<IconMailOpened size={14} />}
                onClick={(e) => {
                  e.stopPropagation();
                  onMarkRead(item.id);
                }}
              >
                {t('notifications.open')}
              </Menu.Item>
            )}
            {item.deepLink && (
              <Menu.Item
                leftSection={<IconExternalLink size={14} />}
                onClick={(e) => {
                  e.stopPropagation();
                  onDeepLink?.(item);
                }}
              >
                {t('notifications.open')}
              </Menu.Item>
            )}
            <Menu.Item
              leftSection={<IconTrash size={14} />}
              color="red"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(item.id);
              }}
            >
              {t('notifications.delete')}
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
    </Box>
  );
}

interface Props {
  visible: boolean;
  items: Notification[];
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onRemove: (id: string) => void;
  onOpenSettings: () => void;
  onClose: () => void;
  onDeepLink?: (item: Notification) => void;
}

const ALL_KINDS: NotificationKind[] = ['partner_added', 'schedule', 'mail', 'booking', 'contract', 'workflow_approval', 'diary', 'update', 'notice'];

export default function NotificationCenter({
  visible,
  items,
  onMarkRead,
  onMarkAllRead,
  onRemove,
  onOpenSettings,
  onClose,
  onDeepLink,
}: Props) {
  const t = useT();
  const [filter, setFilter] = useState<FilterKind>('all');
  const [meEmail, setMeEmail] = useState<string | null>(null);

  useEffect(() => {
    fetchMe().then((me) => { if (me?.email) setMeEmail(me.email); }).catch(() => {});
  }, []);

  if (!visible) return null;

  // 설정(설정 > 알림)에서 OFF한 kind는 목록에서도 숨긴다. 미설정(undefined) kind는 노출 유지.
  const notifSettings = loadNotificationSettings();
  const userFiltered = items.filter((n) => {
    if (notifSettings.kinds[n.kind] === false) return false;
    const targetKey = (n.deepLink as Record<string, unknown> | undefined)?.targetUserKey as string | undefined;
    if (!targetKey) return true;
    return meEmail ? targetKey === meEmail : true;
  });
  // 앱 전용 kind 탭은 해당 앱이 설치돼 있을 때만 노출(앱 삭제 시 자동 숨김).
  const installedAppIds = new Set(getManifests().map((m) => m.id));
  const shownKinds = visibleNotificationKinds(ALL_KINDS, installedAppIds);
  const filtered = (filter === 'all' ? userFiltered : userFiltered.filter((n) => n.kind === filter))
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const unread = userFiltered.filter((n) => !n.readAt).length;

  return (
    <Stack gap={0} h="100%" style={{ overflow: 'hidden' }}>
      <Group
        justify="space-between"
        align="center"
        p="md"
        style={{ borderBottom: '1px solid var(--mantine-color-default-border)', flexShrink: 0 }}
      >
        <Group gap="xs" align="center">
          <Text fw={600} size="md">{t('notifications.title')}</Text>
          {unread > 0 && (
            <Badge size="sm" color="red" variant="filled">
              {unread}
            </Badge>
          )}
        </Group>
        <Group gap={4} align="center" wrap="nowrap">
          <Tooltip label={t('settings.notifications')}>
            <ActionIcon variant="subtle" color="gray" onClick={onOpenSettings}>
              <IconSettings size={16} stroke={1.5} />
            </ActionIcon>
          </Tooltip>
          <ActionIcon variant="subtle" color="gray" size={36} className="drawer-close" onClick={onClose} aria-label={t('common.close')}>
            <IconX size={18} stroke={1.5} />
          </ActionIcon>
        </Group>
      </Group>

      <Tabs
        value={filter}
        onChange={(v) => setFilter((v as FilterKind) ?? 'all')}
        style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}
      >
        <Tabs.List px="sm">
          <Tabs.Tab value="all">{t('notifications.filter.all')}</Tabs.Tab>
          {shownKinds.map((k) => (
            <Tabs.Tab key={k} value={k}>
              {KIND_EMOJI[k]}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>

      <ScrollArea style={{ flex: 1 }}>
        {filtered.length === 0 ? (
          <Text c="dimmed" ta="center" py="xl" size="sm">
            {t('notifications.empty')}
          </Text>
        ) : (
          filtered.map((item) => (
            <NotificationItem
              key={item.id}
              item={item}
              onMarkRead={onMarkRead}
              onRemove={onRemove}
              onDeepLink={onDeepLink}
            />
          ))
        )}
      </ScrollArea>

      {unread > 0 && (
        <Box
          p="sm"
          style={{
            borderTop: '1px solid var(--mantine-color-default-border)',
            flexShrink: 0,
          }}
        >
          <Button variant="light" fullWidth size="xs" onClick={onMarkAllRead}>
            {t('notifications.markAllRead')}
          </Button>
        </Box>
      )}
    </Stack>
  );
}
