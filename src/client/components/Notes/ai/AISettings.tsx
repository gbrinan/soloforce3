// AI 설정 모달 — 카드 선택 UI(Claude CLI/Ollama/Grok/WebLLM) + 제공자별 설정 + 사용 토글 게이트.
// 설정 완료된 제공자만 토글 ON 가능, 토글 ON 상태여야 저장 버튼 활성화.
import { useEffect, useState } from 'react';
import {
  Modal, Stack, SimpleGrid, UnstyledButton, Group, Text, Select, PasswordInput, TextInput,
  Button, Switch, Alert, Box, ThemeIcon,
} from '@mantine/core';
import { IconSparkles, IconDeviceDesktop, IconBolt, IconWorld, IconCheck } from '@tabler/icons-react';
import { useI18n } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/messages';
import { detectOllama } from './ollama';
import { detectClaude, type ClaudeDetect } from './claudeClient';
import type { AIConfig, AIProvider } from './aiConfig';

interface Props {
  opened: boolean;
  onClose: () => void;
  config: AIConfig;
  onSave: (c: AIConfig) => void;
}

const PROVIDER_CARDS: Array<{ value: AIProvider; icon: typeof IconSparkles; titleKey: MessageKey; descKey: MessageKey }> = [
  { value: 'claude', icon: IconSparkles, titleKey: 'notes.ai.cardClaude', descKey: 'notes.ai.cardClaudeDesc' },
  { value: 'ollama', icon: IconDeviceDesktop, titleKey: 'notes.ai.cardOllama', descKey: 'notes.ai.cardOllamaDesc' },
  { value: 'grok', icon: IconBolt, titleKey: 'notes.ai.cardGrok', descKey: 'notes.ai.cardGrokDesc' },
  { value: 'webllm', icon: IconWorld, titleKey: 'notes.ai.cardWebllm', descKey: 'notes.ai.cardWebllmDesc' },
];

export default function AISettings({ opened, onClose, config, onSave }: Props) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<AIConfig>(config);
  const [ollamaModels, setOllamaModels] = useState<string[] | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [claudeStatus, setClaudeStatus] = useState<ClaudeDetect | null>(null);
  const [claudeChecking, setClaudeChecking] = useState(false);

  // 모달을 열 때마다 현재 설정으로 draft 동기화 + 감지 상태 초기화.
  useEffect(() => {
    if (opened) { setDraft(config); setOllamaModels(null); setClaudeStatus(null); }
  }, [opened, config]);

  const checkClaude = async () => {
    setClaudeChecking(true);
    const st = await detectClaude();
    setClaudeStatus(st);
    setClaudeChecking(false);
  };

  // Claude 카드 선택 시 자동 감지(미감지 상태일 때 1회).
  useEffect(() => {
    if (opened && draft.provider === 'claude' && claudeStatus === null && !claudeChecking) {
      void checkClaude();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, draft.provider]);

  const detect = async () => {
    setDetecting(true);
    const models = await detectOllama();
    setOllamaModels(models);
    setDetecting(false);
    if (models && models.length > 0) setDraft((d) => ({ ...d, ollamaModel: d.ollamaModel || models[0] }));
  };

  // 제공자별 설정 완료 여부.
  const isConfigured = (() => {
    switch (draft.provider) {
      case 'webllm': return true;                        // 브라우저 로컬 — 런타임 WebGPU 검사
      case 'ollama': return !!draft.ollamaModel;
      case 'claude': return claudeStatus?.installed === true;
      case 'grok': return !!draft.grokKey.trim();
      default: return false;
    }
  })();

  // 설정 미완료로 떨어지면 토글 강제 OFF(저장 버튼 비활성과 일관).
  useEffect(() => {
    if (!isConfigured && draft.enabled) setDraft((d) => ({ ...d, enabled: false }));
  }, [isConfigured, draft.enabled]);

  const selectProvider = (p: AIProvider) => setDraft((d) => ({ ...d, provider: p, enabled: false }));

  return (
    <Modal opened={opened} onClose={onClose} title={t('notes.ai.settings')} size="md" centered>
      <Stack gap="sm">
        <SimpleGrid cols={2} spacing="xs">
          {PROVIDER_CARDS.map((p) => {
            const active = draft.provider === p.value;
            const Icon = p.icon;
            return (
              <UnstyledButton
                key={p.value}
                onClick={() => selectProvider(p.value)}
                style={{
                  position: 'relative',
                  border: `2px solid ${active ? 'var(--mantine-color-grape-5)' : 'var(--border-default)'}`,
                  background: 'var(--bg-surface)',
                  borderRadius: 'var(--mantine-radius-md)',
                  padding: 'var(--mantine-spacing-sm)',
                  transition: 'border-color 0.15s',
                }}
              >
                {active && (
                  <ThemeIcon size="xs" radius="xl" color="grape" style={{ position: 'absolute', top: 6, right: 6 }}>
                    <IconCheck size={12} stroke={2.5} />
                  </ThemeIcon>
                )}
                <Group gap="xs" wrap="nowrap" align="flex-start">
                  <ThemeIcon variant={active ? 'filled' : 'light'} color="grape" size="md" radius="md">
                    <Icon size={16} stroke={1.5} />
                  </ThemeIcon>
                  <Box style={{ minWidth: 0 }}>
                    <Text size="sm" fw={600}>{t(p.titleKey)}</Text>
                    <Text size="xs" c="dimmed" lineClamp={2}>{t(p.descKey)}</Text>
                  </Box>
                </Group>
              </UnstyledButton>
            );
          })}
        </SimpleGrid>

        {draft.provider === 'webllm' && (
          <Text size="xs" c="dimmed">{t('notes.ai.localHint')}</Text>
        )}

        {draft.provider === 'claude' && (
          <Group gap="xs" align="center">
            <Button size="compact-xs" variant="light" loading={claudeChecking} onClick={() => void checkClaude()}>
              {t('notes.ai.claudeRecheck')}
            </Button>
            {claudeChecking ? (
              <Text size="xs" c="dimmed">{t('notes.ai.claudeDetecting')}</Text>
            ) : claudeStatus ? (
              claudeStatus.installed ? (
                <Text size="xs" c="teal">
                  {t('notes.ai.claudeInstalled')}
                  {claudeStatus.version ? ` (${claudeStatus.version})` : ''}
                  {' '}
                  {claudeStatus.authenticated ? t('notes.ai.claudeAuthed') : t('notes.ai.claudeNotAuthed')}
                </Text>
              ) : (
                <Text size="xs" c="red">{t('notes.ai.claudeNotInstalled')}</Text>
              )
            ) : null}
          </Group>
        )}

        {draft.provider === 'ollama' && (
          <Stack gap={6}>
            <Group gap="xs" align="center">
              <Button size="compact-xs" variant="light" loading={detecting} onClick={detect}>
                {t('notes.ai.ollamaDetect')}
              </Button>
              {ollamaModels !== null && (
                <Text size="xs" c={ollamaModels.length ? 'teal' : 'red'}>
                  {ollamaModels.length ? t('notes.ai.ollamaFound') : t('notes.ai.ollamaNotFound')}
                </Text>
              )}
            </Group>
            {ollamaModels && ollamaModels.length > 0 && (
              <Select
                size="xs"
                label={t('notes.ai.modelLabel')}
                data={ollamaModels}
                value={draft.ollamaModel || null}
                onChange={(v) => setDraft((d) => ({ ...d, ollamaModel: v ?? '' }))}
              />
            )}
          </Stack>
        )}

        {draft.provider === 'grok' && (
          <Stack gap={6}>
            <Alert color="orange" variant="light" p="xs">
              <Text size="xs">{t('notes.ai.grokExternalNote')}</Text>
            </Alert>
            <PasswordInput
              size="xs"
              label={t('notes.ai.grokKey')}
              value={draft.grokKey}
              onChange={(e) => setDraft((d) => ({ ...d, grokKey: e.currentTarget.value }))}
            />
            <TextInput
              size="xs"
              label={t('notes.ai.modelLabel')}
              placeholder="grok-2-latest"
              value={draft.grokModel}
              onChange={(e) => setDraft((d) => ({ ...d, grokModel: e.currentTarget.value }))}
            />
            <Text size="xs" c="dimmed">{t('notes.ai.grokKeyHint')}</Text>
          </Stack>
        )}

        <Switch
          size="sm"
          mt="xs"
          label={t('notes.ai.enable')}
          checked={draft.enabled}
          disabled={!isConfigured}
          onChange={(e) => setDraft((d) => ({ ...d, enabled: e.currentTarget.checked }))}
        />
        {!isConfigured && <Text size="xs" c="dimmed">{t('notes.ai.notConfigured')}</Text>}

        <Group justify="flex-end" mt="xs">
          <Button size="xs" variant="default" onClick={onClose}>{t('notes.ai.cancel')}</Button>
          <Button size="xs" disabled={!draft.enabled} onClick={() => { onSave(draft); onClose(); }}>{t('notes.ai.save')}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
