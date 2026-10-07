import React from 'react';
import { useMantineColorScheme, useComputedColorScheme } from '@mantine/core';
import { IconSun, IconMoon } from '@tabler/icons-react';
import { useT } from '../i18n/I18nProvider';

export default function ColorSchemeToggle() {
  const t = useT();
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme('dark', { getInitialValueInEffect: true });
  const isDark = computed === 'dark';
  const label = isDark ? t('common.switchToLight') : t('common.switchToDark');

  return (
    <button
      className="header-btn"
      style={{ width: 28, height: 28, minHeight: 28, padding: 0, justifyContent: 'center', borderRadius: '50%' }}
      onClick={() => setColorScheme(isDark ? 'light' : 'dark')}
      aria-label={label}
      title={label}
    >
      {isDark ? <IconSun size={16} stroke={1.5} /> : <IconMoon size={16} stroke={1.5} />}
    </button>
  );
}
