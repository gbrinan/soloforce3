import React from 'react';
import { Group, Text, ActionIcon } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { useT } from '../i18n/I18nProvider';

interface Props {
  title: string;
  onBack: () => void;
  rightSlot?: React.ReactNode;
}

export default function DrawerSubHeader({ title, onBack, rightSlot }: Props) {
  const t = useT();
  return (
    <Group
      justify="space-between"
      align="center"
      p="md"
      style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}
    >
      <Group gap="xs" align="center" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
        <ActionIcon variant="subtle" color="gray" onClick={onBack} aria-label={t('common.back')}>
          <IconArrowLeft size={16} stroke={1.5} />
        </ActionIcon>
        <Text fw={600} size="md" truncate>{title}</Text>
      </Group>
      {rightSlot}
    </Group>
  );
}
