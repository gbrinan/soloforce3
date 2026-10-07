import React, { useState, useEffect, useRef } from 'react';
import {
  Stack, Group, Text, Card, ActionIcon, Badge, Button, Drawer,
  PasswordInput, Progress, Alert,
} from '@mantine/core';
import {
  IconEye, IconEyeOff, IconCopy, IconPencil, IconTrash, IconCheck, IconKey,
} from '@tabler/icons-react';
import type { KeyEntry } from '../../utils/api';
import { fetchKeys, saveKey, deleteKey } from '../../utils/api';
import { uiConfirm } from '../Dialog/dialog';
import IntegrationWizard from './IntegrationWizard';
import { useI18n } from '../../i18n/I18nProvider';

const LS_PREFIX = 'keyvault_';

function getClientKeyValue(id: string): string {
  return localStorage.getItem(LS_PREFIX + id) ?? '';
}
function setClientKeyValue(id: string, value: string) {
  if (value) {
    localStorage.setItem(LS_PREFIX + id, value);
  } else {
    localStorage.removeItem(LS_PREFIX + id);
  }
}

const KEY_PREFIXES: Record<string, string> = {
  groq: 'gsk_',
  anthropic: 'sk-ant-',
  openai: 'sk-',
  'grok-xai': 'xai-',
  'openai-server': 'sk-',
  resend: 're_',
};

function validateFormat(id: string, value: string): boolean {
  const prefix = KEY_PREFIXES[id];
  if (!prefix) return true;
  return value.startsWith(prefix) && value.length > prefix.length + 4;
}

function maskValue(value: string): string {
  if (!value || value.length < 8) return '••••••••';
  const prefix = value.substring(0, Math.min(6, value.length - 4));
  const suffix = value.slice(-4);
  const dots = '•'.repeat(Math.max(4, value.length - prefix.length - 4));
  return `${prefix}${dots}${suffix}`;
}

interface KeyMaskedRowProps {
  entry: KeyEntry;
  onEdit: () => void;
  onRefresh: () => void;
}

function KeyMaskedRow({ entry, onEdit, onRefresh }: KeyMaskedRowProps) {
  const { t } = useI18n();
  const [revealed, setRevealed] = useState(false);
  const [revealValue, setRevealValue] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const clipboardTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const effectiveHasValue = entry.scope === 'client'
    ? !!getClientKeyValue(entry.id)
    : entry.hasValue;
  const effectiveMasked = entry.scope === 'client'
    ? (getClientKeyValue(entry.id) ? maskValue(getClientKeyValue(entry.id)) : '')
    : entry.masked;

  const handleReveal = async () => {
    if (revealed) {
      setRevealed(false);
      setRevealValue('');
      setCountdown(0);
      clearInterval(timerRef.current);
      return;
    }
    let raw = '';
    if (entry.scope === 'client') {
      raw = getClientKeyValue(entry.id);
    } else {
      try {
        const res = await fetch(`/api/keys/${encodeURIComponent(entry.id)}/value`);
        if (res.ok) raw = (await res.json()).value ?? '';
      } catch { /* */ }
    }
    if (!raw) return;
    setRevealValue(raw);
    setRevealed(true);
    setCountdown(10);
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(timerRef.current);
          setRevealed(false);
          setRevealValue('');
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  };

  const handleCopy = async () => {
    const val = revealed
      ? revealValue
      : entry.scope === 'client' ? getClientKeyValue(entry.id) : '';
    if (!val) return;
    await navigator.clipboard.writeText(val);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    clearTimeout(clipboardTimerRef.current);
    clipboardTimerRef.current = setTimeout(() => {
      navigator.clipboard.writeText('').catch(() => {});
    }, 30_000);
  };

  const handleDelete = async () => {
    const ok = await uiConfirm({
      title: t('settings.keys.deleteTitle'),
      description: t('settings.keys.deleteConfirm', { label: entry.label }),
      variant: 'danger',
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    if (entry.scope === 'client') {
      setClientKeyValue(entry.id, '');
    } else {
      await deleteKey(entry.id);
    }
    onRefresh();
  };

  useEffect(() => () => {
    clearInterval(timerRef.current);
    clearTimeout(clipboardTimerRef.current);
  }, []);

  return (
    <Card
      withBorder
      radius="md"
      p="md"
      style={{
        background: 'var(--bg-card)',
        borderColor: revealed ? 'var(--accent-warning)' : undefined,
        transition: 'border-color 0.2s',
      }}
    >
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Group gap="xs" align="center">
            <Text size="sm" fw={600}>{entry.label}</Text>
            <Badge size="xs" variant="light" color={entry.scope === 'server' ? 'yellow' : 'indigo'}>
              {entry.scope === 'server' ? t('settings.keys.scopeServer') : t('settings.keys.scopeClient')}
            </Badge>
          </Group>
          <Text size="xs" c="dimmed" style={{ fontFamily: 'monospace' }} aria-hidden>
            {effectiveHasValue ? effectiveMasked : t('settings.keys.notSet')}
          </Text>
        </Stack>

        <Group gap={4} wrap="nowrap">
          <ActionIcon
            variant="subtle"
            size="sm"
            onClick={() => void handleReveal()}
            disabled={!effectiveHasValue}
            aria-label={revealed ? t('settings.keys.hide') : t('settings.keys.show')}
          >
            {revealed ? <IconEyeOff size={14} /> : <IconEye size={14} />}
          </ActionIcon>
          <ActionIcon
            variant="subtle"
            size="sm"
            onClick={() => void handleCopy()}
            disabled={!effectiveHasValue}
            aria-label={t('settings.keys.copyKey')}
          >
            {copied ? <IconCheck size={14} color="var(--accent-success)" /> : <IconCopy size={14} />}
          </ActionIcon>
          <ActionIcon variant="subtle" size="sm" onClick={onEdit} aria-label={t('settings.edit')}>
            <IconPencil size={14} />
          </ActionIcon>
          <ActionIcon
            variant="subtle"
            size="sm"
            color="red"
            onClick={() => void handleDelete()}
            disabled={!effectiveHasValue}
            aria-label={t('common.delete')}
          >
            <IconTrash size={14} />
          </ActionIcon>
        </Group>
      </Group>

      {revealed && (
        <Stack gap={4} mt="xs">
          <PasswordInput
            value={revealValue}
            readOnly
            size="xs"
            styles={{ input: { fontFamily: 'monospace' } }}
            aria-label={t('settings.keys.valueAriaLabel', { label: entry.label })}
          />
          <Group gap="xs" align="center">
            <Text size="xs" c="dimmed" aria-live="polite">{t('settings.keys.autoHideCountdown', { seconds: countdown })}</Text>
            <Progress value={(countdown / 10) * 100} size="xs" style={{ flex: 1 }} />
          </Group>
        </Stack>
      )}
    </Card>
  );
}

interface KeyEntryDrawerProps {
  opened: boolean;
  entry: KeyEntry | null;
  onClose: () => void;
  onSaved: () => void;
}

function KeyEntryDrawer({ opened, entry, onClose, onSaved }: KeyEntryDrawerProps) {
  const { t } = useI18n();
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (opened) { setValue(''); setError(''); }
  }, [opened]);

  const handleSave = async () => {
    if (!entry) return;
    const trimmed = value.trim();
    if (!trimmed) { setError(t('settings.keys.valueRequired')); return; }
    if (!validateFormat(entry.id, trimmed)) {
      setError(t('settings.keys.invalidFormat'));
      return;
    }
    setSaving(true);
    if (entry.scope === 'client') {
      setClientKeyValue(entry.id, trimmed);
      setSaving(false);
      onSaved();
      onClose();
    } else {
      const result = await saveKey(entry.id, trimmed);
      setSaving(false);
      if (!result.ok) { setError(result.error ?? t('settings.keys.saveFailed')); return; }
      onSaved();
      onClose();
    }
  };

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      title={t('settings.keys.editTitle', { label: entry?.label ?? t('settings.apiKeys') })}
      position="right"
      size="md"
      overlayProps={{ blur: 2, backgroundOpacity: 0.4 }}
    >
      <Stack gap="md" p="md">
        {entry?.prefix && (
          <Text size="xs" c="dimmed">{t('settings.keys.formatHint', { prefix: entry.prefix })}</Text>
        )}
        <PasswordInput
          label={t('settings.keys.valueLabel')}
          placeholder={entry?.prefix ? `${entry.prefix}...` : t('settings.keys.valuePlaceholderDefault')}
          value={value}
          onChange={(e) => { setValue(e.currentTarget.value); setError(''); }}
          error={error || undefined}
          autoFocus
        />
        {entry?.scope === 'server' && (
          <Alert color="blue" variant="light" p="xs">
            <Text size="xs">{t('settings.keys.serverKeyHint')}</Text>
          </Alert>
        )}
        {entry?.scope === 'client' && (
          <Alert color="indigo" variant="light" p="xs">
            <Text size="xs">{t('settings.keys.clientKeyHint')}</Text>
          </Alert>
        )}
        <Group justify="flex-end" mt="sm">
          <Button variant="subtle" onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
          <Button color="jarvis" loading={saving} onClick={() => void handleSave()}>{t('settings.save')}</Button>
        </Group>
      </Stack>
    </Drawer>
  );
}

export default function KeyVaultPanel() {
  const { t } = useI18n();
  const [keys, setKeys] = useState<KeyEntry[]>([]);
  const [drawerEntry, setDrawerEntry] = useState<KeyEntry | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tick, setTick] = useState(0);

  const load = async () => {
    const serverKeys = await fetchKeys();
    const merged = serverKeys.map((k) => {
      if (k.scope === 'client') {
        const localVal = getClientKeyValue(k.id);
        return { ...k, hasValue: !!localVal, masked: localVal ? maskValue(localVal) : '' };
      }
      return k;
    });
    setKeys(merged);
  };

  useEffect(() => { void load(); }, [tick]);

  const refresh = () => setTick((t) => t + 1);

  const openEdit = (entry: KeyEntry) => {
    setDrawerEntry(entry);
    setDrawerOpen(true);
  };

  return (
    <>
      <Stack gap="md">
        <Group gap="xs" align="center">
          <IconKey size={16} />
          <Text size="sm" fw={600}>{t('settings.keys.registeredTitle')}</Text>
        </Group>

        {keys.length === 0 ? (
          <Text size="xs" c="dimmed">{t('settings.keys.loading')}</Text>
        ) : (
          <Stack gap="xs">
            {keys.map((entry) => (
              <KeyMaskedRow
                key={entry.id}
                entry={entry}
                onEdit={() => openEdit(entry)}
                onRefresh={refresh}
              />
            ))}
          </Stack>
        )}
      </Stack>

      <IntegrationWizard />

      <KeyEntryDrawer
        opened={drawerOpen}
        entry={drawerEntry}
        onClose={() => setDrawerOpen(false)}
        onSaved={refresh}
      />
    </>
  );
}
