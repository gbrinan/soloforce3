import React from 'react';
import {
  Modal, Stack, Group, Text, Badge, Button, Anchor, List, Alert, Divider, Code,
} from '@mantine/core';
import { IconExternalLink, IconInfoCircle, IconPlugConnected } from '@tabler/icons-react';
import type { AppManifestClient } from '../utils/appRegistry';
import { useI18n } from '../i18n/I18nProvider';

// 스토어 설치 앱 최초 실행 온보딩 — 매니페스트 setupGuide(단계·환경변수·외부 서비스·문서)를
// 모달로 안내한다. 닫는 순간 호출부(App.tsx)가 bootstrap을 마킹해 1회만 표시된다.
export default function AppSetupGuideModal({
  app, onClose, onOpenIntegrations,
}: {
  app: AppManifestClient;
  onClose: () => void;
  onOpenIntegrations: () => void;
}) {
  const { t } = useI18n();
  const guide = app.setupGuide;
  if (!guide) return null;

  return (
    <Modal
      opened
      onClose={onClose}
      title={
        <Group gap="xs">
          <span>{app.icon ?? '🧩'}</span>
          <Text fw={600}>{t('appSetup.title', { appName: app.name })}</Text>
        </Group>
      }
      size="lg"
      centered
    >
      <Stack gap="sm">
        {guide.intro && (
          <Alert icon={<IconInfoCircle size={16} />} color="blue" variant="light">
            {guide.intro}
          </Alert>
        )}

        <Text fw={600} size="sm">{t('appSetup.stepsTitle')}</Text>
        <List type="ordered" size="sm" spacing="xs">
          {guide.steps.map((s, i) => (
            <List.Item key={i}>
              <Text size="sm" fw={500} component="span">{s.title}</Text>
              {s.detail && <Text size="xs" c="dimmed">{s.detail}</Text>}
            </List.Item>
          ))}
        </List>

        {guide.envVars && guide.envVars.length > 0 && (
          <>
            <Divider />
            <Text fw={600} size="sm">{t('appSetup.envTitle')}</Text>
            <Stack gap={4}>
              {guide.envVars.map((v) => (
                <Group key={v.name} gap="xs" wrap="nowrap">
                  <Code>{v.name}</Code>
                  <Badge size="xs" color={v.required ? 'red' : 'gray'} variant="light">
                    {v.required ? t('appSetup.required') : t('appSetup.optional')}
                  </Badge>
                  {v.label && <Text size="xs" c="dimmed">{v.label}</Text>}
                </Group>
              ))}
            </Stack>
          </>
        )}

        {guide.services && guide.services.length > 0 && (
          <>
            <Divider />
            <Text fw={600} size="sm">{t('appSetup.servicesTitle')}</Text>
            <Stack gap={4}>
              {guide.services.map((s) => (
                <Group key={s.url} gap="xs" wrap="nowrap">
                  <Anchor href={s.url} target="_blank" rel="noreferrer" size="sm">
                    <Group gap={4} wrap="nowrap"><IconExternalLink size={14} />{s.name}</Group>
                  </Anchor>
                  {s.desc && <Text size="xs" c="dimmed">{s.desc}</Text>}
                </Group>
              ))}
            </Stack>
          </>
        )}

        {guide.docsUrl && (
          <Anchor href={guide.docsUrl} target="_blank" rel="noreferrer" size="sm">
            <Group gap={4}><IconExternalLink size={14} />{t('appSetup.docs')}</Group>
          </Anchor>
        )}

        <Group justify="space-between" mt="md">
          <Button variant="default" onClick={onClose}>{t('appSetup.dismiss')}</Button>
          <Button leftSection={<IconPlugConnected size={16} />} onClick={onOpenIntegrations}>
            {t('appSetup.openIntegrations')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
