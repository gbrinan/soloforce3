import React, { useState } from 'react';
import { Modal, Button, Stack, Group, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { sendPartnerRequest } from '../../utils/api';
import { useT } from '../../i18n/I18nProvider';

interface Props {
  onClose: () => void;
  onSent: (requestId: string) => void;
}

export default function SendPartnerRequestModal({ onClose, onSent }: Props) {
  const t = useT();
  const [targetApiUrl, setTargetApiUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    const trimmed = targetApiUrl.trim();
    if (!trimmed) {
      setError(t('friend.apiUrlRequired'));
      return;
    }
    // ngrok-free.dev 등 호스트만 붙여넣어도 동작하도록 스킴 자동 부여. 서버에서도 한 번 더 정규화.
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    setBusy(true); setError(null);
    try {
      const r = await sendPartnerRequest({ targetApiUrl: normalized });
      if (!r.ok) throw new Error(r.error ?? 'send failed');
      notifications.show({
        color: 'green',
        title: t('external.requestSentTitle'),
        message: t('external.requestSentMessage'),
        autoClose: 8000,
      });
      onSent(r.requestId ?? '');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: 8,
    background: 'var(--mantine-color-body)',
    color: 'var(--mantine-color-text)',
    border: '1px solid var(--mantine-color-default-border)',
    borderRadius: 4, fontSize: 'var(--font-s)',
  };

  return (
    <Modal
      opened
      onClose={onClose}
      title={t('friend.addFriendTitle')}
      size="sm"
      centered
      overlayProps={{ backgroundOpacity: 0.8, blur: 2 }}
    >
      <Stack gap="sm">
        <Text size="xs" c="dimmed">{t('friend.sendReqDesc')}</Text>
        <div>
          <Text size="xs" c="dimmed" mb={3}>{t('friend.targetApiUrl')}</Text>
          <input value={targetApiUrl} onChange={(e) => setTargetApiUrl(e.target.value)} placeholder="https://partner.example.com" style={inputStyle} />
        </div>
        {error && <Text size="xs" c="jarvis.7">{error}</Text>}
        <Group justify="flex-end" gap="xs" mt="sm">
          <Button variant="default" onClick={onClose}>{t('common.cancel')}</Button>
          <Button color="jarvis" disabled={busy || !targetApiUrl.trim()} onClick={onSubmit}>
            {busy ? t('friend.sending') : t('friend.sendRequest')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
