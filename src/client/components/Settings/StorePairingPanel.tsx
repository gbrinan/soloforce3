import { useEffect, useState } from 'react';
import {
  Stack, Text, Button, Group, Box, Alert, CopyButton, Tooltip, ActionIcon,
} from '@mantine/core';
import { IconShoppingBag, IconCopy, IconCheck, IconAlertCircle, IconRefresh } from '@tabler/icons-react';
import { useI18n } from '../../i18n/I18nProvider';

interface PairState {
  code: string;
  expiresAt: number;
}

function formatRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// 설정 > 스토어 — store.dooitspace.com 페어링 코드 발급 UI.
// 백엔드: POST /api/store/pair (10분 TTL, 로그인 없이도 발급 가능 — src/server/routes/store.ts)
export default function StorePairingPanel() {
  const { t } = useI18n();
  const [pair, setPair] = useState<PairState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!pair) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [pair]);

  const remainingMs = pair ? pair.expiresAt - now : 0;
  const expired = !!pair && remainingMs <= 0;

  const issueCode = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/store/pair', { method: 'POST' });
      if (!res.ok) {
        setError(t('settings.store.issueFailedHttp', { status: res.status }));
        return;
      }
      const data = await res.json();
      if (!data?.code || !data?.expiresAt) {
        setError(t('settings.store.responseFormatError'));
        return;
      }
      setNow(Date.now());
      setPair({ code: data.code, expiresAt: data.expiresAt });
    } catch {
      setError(t('settings.store.networkError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Stack gap="lg">
      <Stack gap={4}>
        <Text size="md" fw={700}>{t('settings.store.title')}</Text>
        <Text size="xs" c="dimmed">
          {t('settings.store.desc')}
        </Text>
      </Stack>

      <Alert icon={<IconAlertCircle size={16} />} color="blue" variant="light">
        {t('settings.store.loginHint')}
      </Alert>

      {!pair && (
        <Button
          leftSection={<IconShoppingBag size={16} />}
          onClick={issueCode}
          loading={loading}
          style={{ alignSelf: 'flex-start' }}
        >
          {t('settings.store.issueButton')}
        </Button>
      )}

      {pair && (
        <Box
          role="group"
          aria-label={t('settings.store.issuedCodeAriaLabel')}
          style={{
            background: 'var(--bg-surface)',
            border: `1px solid ${expired ? 'var(--mantine-color-red-6)' : 'var(--border-default)'}`,
            borderRadius: 'var(--mantine-radius-md)',
            padding: 20,
          }}
        >
          <Group justify="space-between" align="center" wrap="nowrap">
            <Text
              aria-label={t('settings.store.codeAriaLabel', { code: pair.code })}
              style={{
                fontFamily: 'var(--mantine-font-family-monospace, monospace)',
                fontSize: 28,
                fontWeight: 700,
                letterSpacing: 4,
                opacity: expired ? 0.4 : 1,
              }}
            >
              {pair.code}
            </Text>
            <CopyButton value={pair.code} timeout={1500}>
              {({ copied, copy }) => (
                <Tooltip label={copied ? t('settings.store.copied') : t('common.copyClipboard')} withArrow>
                  <ActionIcon
                    variant="light"
                    size="lg"
                    onClick={copy}
                    disabled={expired}
                    aria-label={t('settings.store.copyCodeAriaLabel')}
                  >
                    {copied ? <IconCheck size={18} /> : <IconCopy size={18} />}
                  </ActionIcon>
                </Tooltip>
              )}
            </CopyButton>
          </Group>
          <Group justify="space-between" mt={12}>
            {expired ? (
              <Text size="sm" c="red" fw={600}>{t('settings.store.expired')}</Text>
            ) : (
              <Text size="sm" c="dimmed">{t('settings.store.timeRemaining', { time: formatRemaining(remainingMs) })}</Text>
            )}
            <Button
              size="xs"
              variant="subtle"
              leftSection={<IconRefresh size={14} />}
              onClick={issueCode}
              loading={loading}
            >
              {t('settings.store.reissue')}
            </Button>
          </Group>
        </Box>
      )}

      {error && (
        <Text size="xs" c="red" role="alert">{error}</Text>
      )}
    </Stack>
  );
}
