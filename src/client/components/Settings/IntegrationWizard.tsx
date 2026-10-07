import React, { useState, useEffect, useCallback } from 'react';
import {
  Stack, Group, Text, Card, Badge, Button, Drawer, Stepper,
  PasswordInput, TextInput, Alert, Anchor, List, Loader,
} from '@mantine/core';
import { IconPlugConnected, IconExternalLink, IconCheck, IconAlertCircle } from '@tabler/icons-react';
import type { IntegrationStatus } from '../../utils/api';
import { fetchAppIntegrations, saveAppIntegration, restartIntegrationApp } from '../../utils/api';
import { useI18n } from '../../i18n/I18nProvider';

// 앱 외부 서비스 연동 마법사 — 안내(발급) → 키 입력 → 저장·재시작 3단계.
// 정의·상태는 서버(/api/app-integrations)가 소유하고 이 컴포넌트는 렌더만 담당.

function WizardDrawer({
  integration, onClose, onDone,
}: {
  integration: IntegrationStatus;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [restarted, setRestarted] = useState<null | 'ok' | 'fail'>(null);

  const requiredMissing = integration.fields.some(
    (f) => f.required && !f.hasValue && !(values[f.envName] ?? '').trim(),
  );
  const hasInput = Object.values(values).some((v) => v.trim() !== '');

  const handleSave = async () => {
    setSaving(true);
    setError('');
    const payload: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v.trim() !== '') payload[k] = v.trim();
    }
    const saveRes = await saveAppIntegration(integration.appId, payload);
    if (!saveRes.ok) {
      setError(saveRes.error ?? t('settings.integration.saveFailed'));
      setSaving(false);
      return;
    }
    const restartRes = await restartIntegrationApp(integration.appId);
    setRestarted(restartRes.ok ? 'ok' : 'fail');
    setSaving(false);
    setStep(2);
    onDone();
  };

  return (
    <Drawer opened onClose={onClose} position="right" size="lg"
      title={<Group gap="xs"><IconPlugConnected size={18} /><Text fw={600}>{t('settings.integration.wizardTitle', { appName: integration.appName })}</Text></Group>}>
      <Stepper active={step} onStepClick={(i) => i < 2 && setStep(i)} size="sm" mb="md">
        <Stepper.Step label={t('settings.integration.stepIssueLabel')} description={t('settings.integration.stepIssueDesc')} />
        <Stepper.Step label={t('settings.integration.stepInputLabel')} description={t('settings.integration.stepInputDesc')} />
        <Stepper.Step label={t('settings.integration.stepDoneLabel')} description={t('settings.integration.stepDoneDesc')} />
      </Stepper>

      {step === 0 && (
        <Stack gap="sm">
          <Text size="sm" c="dimmed">{integration.summary}</Text>
          <List type="ordered" size="sm" spacing="xs">
            {integration.steps.map((s, i) => <List.Item key={i}>{s}</List.Item>)}
          </List>
          {integration.note && (
            <Alert icon={<IconAlertCircle size={16} />} color="yellow" variant="light">{integration.note}</Alert>
          )}
          <Anchor href={integration.docsUrl} target="_blank" rel="noreferrer" size="sm">
            <Group gap={4}><IconExternalLink size={14} />{t('settings.integration.openIssuePage')}</Group>
          </Anchor>
          <Group justify="flex-end" mt="md">
            <Button onClick={() => setStep(1)}>{t('settings.integration.nextToInput')}</Button>
          </Group>
        </Stack>
      )}

      {step === 1 && (
        <Stack gap="sm">
          {integration.fields.map((f) => {
            const Input = f.secret ? PasswordInput : TextInput;
            return (
              <Input
                key={f.envName}
                label={f.label}
                description={f.hasValue ? t('settings.integration.currentlySet', { masked: f.masked }) : undefined}
                placeholder={f.placeholder ?? (f.required ? t('settings.integration.required') : t('settings.integration.optional'))}
                required={f.required && !f.hasValue}
                value={values[f.envName] ?? ''}
                onChange={(e) => setValues((prev) => ({ ...prev, [f.envName]: e.currentTarget.value }))}
              />
            );
          })}
          {error && <Alert color="red" variant="light">{error}</Alert>}
          <Group justify="space-between" mt="md">
            <Button variant="default" onClick={() => setStep(0)}>{t('common.prev')}</Button>
            <Button onClick={handleSave} loading={saving} disabled={!hasInput || requiredMissing}>
              {t('settings.integration.saveAndRestart')}
            </Button>
          </Group>
        </Stack>
      )}

      {step === 2 && (
        <Stack gap="sm" align="center" py="lg">
          <IconCheck size={40} color="var(--mantine-color-green-6)" />
          <Text fw={600}>{t('settings.integration.saveDoneTitle')}</Text>
          <Text size="sm" c="dimmed" ta="center">
            {restarted === 'ok'
              ? t('settings.integration.restartOk')
              : t('settings.integration.restartFailHint', { appName: integration.appName })}
          </Text>
          <Button variant="default" onClick={onClose}>{t('common.close')}</Button>
        </Stack>
      )}
    </Drawer>
  );
}

export default function IntegrationWizard() {
  const { t } = useI18n();
  const [items, setItems] = useState<IntegrationStatus[] | null>(null);
  const [active, setActive] = useState<IntegrationStatus | null>(null);

  const refresh = useCallback(() => {
    void fetchAppIntegrations().then(setItems);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  if (items === null) return <Group justify="center" py="md"><Loader size="sm" /></Group>;

  return (
    <Stack gap="xs" mt="lg">
      <Group gap="xs">
        <IconPlugConnected size={18} />
        <Text fw={600}>{t('settings.integration.sectionTitle')}</Text>
      </Group>
      <Text size="xs" c="dimmed">
        {t('settings.integration.sectionDesc')}
      </Text>
      {items.map((it) => (
        <Card key={it.appId} withBorder padding="sm" radius="md">
          <Group justify="space-between">
            <div>
              <Group gap="xs">
                <Text fw={600} size="sm">{it.appName}</Text>
                <Badge size="xs" color={it.configured ? 'green' : 'gray'} variant="light">
                  {it.configured ? t('settings.integration.connected') : t('settings.integration.notConfigured')}
                </Badge>
              </Group>
              <Text size="xs" c="dimmed">{it.summary}</Text>
            </div>
            <Button size="xs" variant={it.configured ? 'default' : 'light'} onClick={() => setActive(it)}>
              {it.configured ? t('settings.integration.change') : t('settings.integration.connect')}
            </Button>
          </Group>
        </Card>
      ))}
      {active && (
        <WizardDrawer
          integration={active}
          onClose={() => setActive(null)}
          onDone={refresh}
        />
      )}
    </Stack>
  );
}
