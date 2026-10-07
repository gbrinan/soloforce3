import { Menu, Avatar, Text } from '@mantine/core';
import { IconSettings, IconLogout, IconUser } from '@tabler/icons-react';
import { useT } from '../i18n/I18nProvider';

// 우측 상단 구글 프로필 UI.
// 아바타 클릭 → 드롭다운(이름·이메일 + 설정 + 로그아웃). 로그아웃은 서버 /auth/logout이
// 세션 파기 후 /auth/google(로그인 화면)로 리디렉트한다.
export default function ProfileMenu({
  name,
  email,
  picture,
  onOpenSettings,
  showLogout = true,
}: {
  name?: string | null;
  email?: string | null;
  picture?: string | null;
  onOpenSettings: () => void;
  showLogout?: boolean;
}) {
  const t = useT();
  const initial = (name || email || '').trim().slice(0, 1).toUpperCase();
  return (
    <Menu shadow="md" width={248} position="bottom-end" withArrow radius="md">
      <Menu.Target>
        <Avatar
          src={picture || undefined}
          alt={name || email || 'profile'}
          radius="xl"
          size={32}
          color="jarvis"
          style={{ cursor: 'pointer' }}
          title={email || undefined}
        >
          {initial || <IconUser size={16} stroke={1.5} />}
        </Avatar>
      </Menu.Target>
      <Menu.Dropdown>
        <div style={{ padding: '8px 12px 6px' }}>
          <Text size="sm" fw={600} style={{ lineHeight: 1.3 }}>
            {name || t('profile.noName')}
          </Text>
          {email && (
            <Text size="xs" c="dimmed" style={{ wordBreak: 'break-all', marginTop: 2 }}>
              {email}
            </Text>
          )}
        </div>
        <Menu.Divider />
        <Menu.Item
          leftSection={<IconSettings size={14} stroke={1.5} />}
          onClick={onOpenSettings}
        >
          {t('profile.settings')}
        </Menu.Item>
        {showLogout && (
          <Menu.Item
            color="red"
            leftSection={<IconLogout size={14} stroke={1.5} />}
            onClick={() => {
              window.location.href = '/auth/logout';
            }}
          >
            {t('profile.logout')}
          </Menu.Item>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}
