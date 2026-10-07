import React, { useEffect, useState } from 'react';
import {
  Modal, Stack, Group, Text, Button, ThemeIcon, Badge, Card,
  SegmentedControl, Tabs, Code, Collapse, Alert, Divider,
  ScrollArea, ActionIcon, Loader, Center,
} from '@mantine/core';
import {
  IconCheck, IconAlertTriangle, IconCode, IconChevronUp,
  IconCircleCheck, IconInfoCircle, IconArrowUp,
} from '@tabler/icons-react';
import { useI18n } from '../../i18n/I18nProvider';

// ─── 타입 ────────────────────────────────────────────────────────────────────

interface SyncConflict {
  file: string;
  base: string;
  incoming: string;
  working: string;
  diffPreview: string;
}

interface SyncResult {
  autoApplied: Array<{ file: string }>;
  conflicts: SyncConflict[];
  skipped: Array<{ file: string; reason: string }>;
}

type ConflictChoice = 'keep' | 'accept';
type Step = 'loading' | 'review' | 'applying' | 'done' | 'error';

// ─── 유틸 ────────────────────────────────────────────────────────────────────

function getDiffType(conflict: SyncConflict): 'text' | 'json' | 'binary' {
  if (conflict.diffPreview === '(binary/unknown format)') return 'binary';
  if (conflict.diffPreview.startsWith('JSON conflicts:')) return 'json';
  return 'text';
}

function parseJsonConflictKeys(diffPreview: string): string[] {
  const after = diffPreview.replace('JSON conflicts: ', '');
  return after.split(', ').filter(Boolean);
}

// ─── DiffViewer ──────────────────────────────────────────────────────────────

function DiffViewer({ conflict }: { conflict: SyncConflict }) {
  const { t } = useI18n();
  const type = getDiffType(conflict);

  if (type === 'binary') {
    return (
      <Alert icon={<IconInfoCircle size={16} />} color="gray" mt="xs">
        {t('genie.updateModal.binaryFile')}
      </Alert>
    );
  }

  if (type === 'json') {
    return (
      <Group mt="xs" gap="xs" wrap="wrap">
        <Text size="xs" c="dimmed">{t('genie.updateModal.conflictKeys')}</Text>
        {parseJsonConflictKeys(conflict.diffPreview).map((k) => (
          <Badge key={k} size="xs" variant="outline" color="yellow">{k}</Badge>
        ))}
      </Group>
    );
  }

  return (
    <Tabs variant="pills" radius="sm" defaultValue="working" mt="sm">
      <Tabs.List>
        <Tabs.Tab value="working" size="xs">{t('genie.updateModal.tabWorking')}</Tabs.Tab>
        <Tabs.Tab value="incoming" size="xs">{t('genie.updateModal.tabIncoming')}</Tabs.Tab>
        <Tabs.Tab value="base" size="xs">{t('genie.updateModal.tabBase')}</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="working" pt="xs">
        <Code block p="sm" style={{ fontSize: 'var(--font-s)', maxHeight: 240, overflow: 'auto' }}>
          {conflict.working}
        </Code>
      </Tabs.Panel>
      <Tabs.Panel value="incoming" pt="xs">
        <Code block p="sm" style={{ fontSize: 'var(--font-s)', maxHeight: 240, overflow: 'auto' }}>
          {conflict.incoming}
        </Code>
      </Tabs.Panel>
      <Tabs.Panel value="base" pt="xs">
        <Code block p="sm" style={{ fontSize: 'var(--font-s)', maxHeight: 240, overflow: 'auto' }}>
          {conflict.base}
        </Code>
      </Tabs.Panel>
    </Tabs>
  );
}

// ─── ConflictCard ─────────────────────────────────────────────────────────────

function ConflictCard({
  conflict,
  choice,
  onChoose,
}: {
  conflict: SyncConflict;
  choice: ConflictChoice | undefined;
  onChoose: (v: ConflictChoice) => void;
}) {
  const { t } = useI18n();
  const [diffOpen, setDiffOpen] = useState(false);
  const resolved = choice !== undefined;

  return (
    <Card
      withBorder
      radius="md"
      p="md"
      style={{
        borderColor: resolved ? 'var(--border-default)' : 'var(--accent-warning, #FBBF24)',
        backgroundColor: resolved
          ? 'var(--bg-card)'
          : 'rgba(251,191,36,0.10)',
      }}
    >
      <Group justify="space-between" mb="xs">
        <Group gap="xs">
          <ThemeIcon color="yellow" variant="light" size="sm" radius="xl">
            <IconAlertTriangle size={12} />
          </ThemeIcon>
          <Text fw={600} size="sm">{conflict.file}</Text>
        </Group>
        <ActionIcon
          size="sm"
          variant="subtle"
          onClick={() => setDiffOpen((v) => !v)}
          aria-label={t('genie.updateModal.viewDiff')}
        >
          {diffOpen ? <IconChevronUp size={14} /> : <IconCode size={14} />}
        </ActionIcon>
      </Group>

      <Divider mb="xs" />

      <SegmentedControl
        fullWidth
        size="xs"
        value={choice ?? ''}
        onChange={(v) => { if (v === 'keep' || v === 'accept') onChoose(v); }}
        data={[
          { label: t('genie.updateModal.keepMine'), value: 'keep' },
          { label: t('genie.updateModal.acceptNew'), value: 'accept' },
        ]}
        color={choice === 'accept' ? 'green' : 'jarvis'}
      />

      <Collapse expanded={diffOpen}>
        <DiffViewer conflict={conflict} />
      </Collapse>
    </Card>
  );
}

// ─── UpdateModal ──────────────────────────────────────────────────────────────

interface Props {
  opened: boolean;
  onClose: () => void;
}

export default function UpdateModal({ opened, onClose }: Props) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>('loading');
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [choices, setChoices] = useState<Map<string, ConflictChoice>>(new Map());
  const [applyResult, setApplyResult] = useState<{ autoApplied: number; userApplied: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 모달 열릴 때 diff 조회
  useEffect(() => {
    if (!opened) return;
    setStep('loading');
    setSyncResult(null);
    setChoices(new Map());
    setApplyResult(null);
    setError(null);
    fetch('/api/genie/update-diff')
      .then(async (r) => {
        if (!r.ok) {
          // HTTP/2(터널 경유)는 statusText가 비어 "Error"만 남으므로 상태코드+서버 메시지로 구성
          const detail = await r.json().then((j: { error?: string }) => j.error).catch(() => null);
          throw new Error(`HTTP ${r.status}${detail ? ` — ${detail}` : ''}`);
        }
        return r.json();
      })
      .then((result: SyncResult) => { setSyncResult(result); setStep('review'); })
      .catch((e) => { setError(String(e)); setStep('error'); });
  }, [opened]);

  const handleApply = async () => {
    if (!syncResult) return;
    setStep('applying');
    const acceptIncoming = syncResult.conflicts
      .filter((c) => choices.get(c.file) === 'accept').map((c) => c.file);
    const keepWorking = syncResult.conflicts
      .filter((c) => choices.get(c.file) === 'keep').map((c) => c.file);
    try {
      const res = await fetch('/api/genie/update-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acceptIncoming, keepWorking }),
      }).then((r) => { if (!r.ok) throw new Error(r.statusText); return r.json(); });
      setApplyResult(res);
      setStep('done');
    } catch (e) {
      setError(String(e));
      setStep('review');
    }
  };

  const handleSkip = async () => {
    setStep('applying');
    await fetch('/api/genie/update-apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acceptIncoming: [], keepWorking: [] }),
    });
    onClose();
  };

  const setChoice = (file: string, v: ConflictChoice) => {
    setChoices((prev) => new Map(prev).set(file, v));
  };

  const allResolved = (syncResult?.conflicts ?? []).every((c) => choices.has(c.file));
  const isApplying = step === 'applying';

  const body = () => {
    if (step === 'loading') {
      return (
        <Center py="xl">
          <Stack align="center" gap="sm">
            <Loader size="sm" />
            <Text size="sm" c="dimmed">{t('genie.updateModal.loading')}</Text>
          </Stack>
        </Center>
      );
    }

    if (step === 'error') {
      return (
        <Stack gap="md">
          <Alert icon={<IconInfoCircle size={16} />} color="red" title={t('genie.updateModal.errorTitle')}>
            {error}
          </Alert>
          <Button variant="subtle" color="gray" onClick={onClose}>{t('common.close')}</Button>
        </Stack>
      );
    }

    if (step === 'done' && applyResult) {
      return (
        <Stack align="center" py="xl" gap="sm">
          <ThemeIcon size="xl" color="green" variant="light" radius="xl">
            <IconCircleCheck size={28} />
          </ThemeIcon>
          <Text fw={600} size="md">
            {t('genie.updateModal.filesUpdated', { n: applyResult.autoApplied + applyResult.userApplied })}
          </Text>
          <Text size="sm" c="dimmed">{t('genie.updateModal.restarting')}</Text>
          <Button variant="filled" color="jarvis" onClick={onClose}>{t('genie.updateModal.confirm')}</Button>
        </Stack>
      );
    }

    const result = syncResult;
    if (!result) return null;

    const isEmpty =
      result.autoApplied.length === 0 &&
      result.conflicts.length === 0 &&
      result.skipped.length === 0;

    if (isEmpty) {
      return (
        <Stack align="center" py="xl" gap="sm">
          <ThemeIcon size="xl" color="green" variant="light" radius="xl">
            <IconCircleCheck size={28} />
          </ThemeIcon>
          <Text fw={600} size="md">{t('genie.updateModal.allUpToDate')}</Text>
          <Text size="sm" c="dimmed">{t('genie.updateModal.nothingToUpdate')}</Text>
        </Stack>
      );
    }

    return (
      <Stack gap="lg">
        {error && (
          <Alert icon={<IconInfoCircle size={16} />} color="red" withCloseButton onClose={() => setError(null)}>
            {t('genie.updateModal.applyFailed', { error })}
          </Alert>
        )}

        {/* 자동 적용 섹션 */}
        {result.autoApplied.length > 0 && (
          <Stack gap="xs">
            <Group gap="xs">
              <ThemeIcon color="green" variant="light" size="sm" radius="xl">
                <IconCheck size={12} />
              </ThemeIcon>
              <Text fw={600} size="sm">{t('genie.updateModal.autoApplied', { n: result.autoApplied.length })}</Text>
            </Group>
            <Stack gap={2} pl="lg">
              {result.autoApplied.map((item) => (
                <Text key={item.file} size="xs" c="dimmed">✓ {item.file}</Text>
              ))}
            </Stack>
          </Stack>
        )}

        {/* 충돌 섹션 */}
        {result.conflicts.length > 0 && (
          <Stack gap="xs">
            <Group gap="xs">
              <ThemeIcon color="yellow" variant="light" size="sm" radius="xl">
                <IconAlertTriangle size={12} />
              </ThemeIcon>
              <Text fw={600} size="sm">{t('genie.updateModal.conflictsNeedChoice', { n: result.conflicts.length })}</Text>
            </Group>
            <Stack gap="sm">
              {result.conflicts.map((c) => (
                <ConflictCard
                  key={c.file}
                  conflict={c}
                  choice={choices.get(c.file)}
                  onChoose={(v) => setChoice(c.file, v)}
                />
              ))}
            </Stack>
          </Stack>
        )}

        {/* 건너뜀 섹션 */}
        {result.skipped.length > 0 && (
          <Stack gap="xs">
            <Text fw={600} size="sm" c="dimmed">{t('genie.updateModal.skipped', { n: result.skipped.length })}</Text>
            {result.skipped.map((item) => (
              <Group key={item.file} gap="xs">
                <Text size="sm" c="dimmed" style={{ flex: 1 }}>{item.file}</Text>
                <Badge variant="outline" color="gray" size="xs">{item.reason}</Badge>
              </Group>
            ))}
          </Stack>
        )}

        {/* Footer */}
        <Divider />
        <Group justify="space-between">
          <Button variant="subtle" color="gray" onClick={handleSkip} loading={isApplying}>
            {t('genie.updateModal.skipButton')}
          </Button>
          <Button
            variant="filled"
            color="jarvis"
            disabled={!allResolved || result.conflicts.length === 0}
            loading={isApplying}
            onClick={handleApply}
          >
            {t('genie.updateModal.applyButton')}
          </Button>
        </Group>
      </Stack>
    );
  };

  return (
    <Modal
      opened={opened}
      onClose={isApplying ? () => {} : onClose}
      closeOnEscape={!isApplying}
      closeOnClickOutside={!isApplying}
      size="xl"
      radius="lg"
      scrollAreaComponent={ScrollArea.Autosize}
      title={
        <Group gap="xs">
          <ThemeIcon color="jarvis" variant="light" size="sm" radius="xl">
            <IconArrowUp size={12} />
          </ThemeIcon>
          <Text fw={600} size="md">{t('genie.updateModal.title')}</Text>
        </Group>
      }
    >
      <Stack gap="md" p="xs" style={{ maxHeight: '70vh' }}>
        {body()}
      </Stack>
    </Modal>
  );
}
