import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Stack, Center, Text, Loader, ThemeIcon, Button, Alert, Code, CopyButton, Box,
} from '@mantine/core';
import {
  IconLock, IconAlertTriangle, IconAlertCircle, IconCopy, IconCheck,
} from '@tabler/icons-react';
import { useT } from '../../i18n/I18nProvider';

type ClaudeDetectResult = {
  ok: boolean;
  installed: boolean;
  version?: string;
  authenticated?: boolean;
  error?: string;
};

type AuthPhase = 'checking' | 'ok' | 'not-installed' | 'not-authenticated' | 'error';

// sessionStorage 유틸
const CACHE_KEY = 'jarvis:claudeAuthOk';
const BYPASS_KEY = 'jarvis:claudeAuthBypassed';

export function getCachedClaudeAuth(): boolean {
  try { return sessionStorage.getItem(CACHE_KEY) === 'true'; } catch { return false; }
}
export function setCachedClaudeAuth(ok: boolean): void {
  try {
    if (ok) sessionStorage.setItem(CACHE_KEY, 'true');
    else sessionStorage.removeItem(CACHE_KEY);
  } catch {}
}
export function getClaudeAuthBypassed(): boolean {
  try { return sessionStorage.getItem(BYPASS_KEY) === 'true'; } catch { return false; }
}
export function setClaudeAuthBypassed(v: boolean): void {
  try {
    if (v) sessionStorage.setItem(BYPASS_KEY, 'true');
    else sessionStorage.removeItem(BYPASS_KEY);
  } catch {}
}

// WarningBanner — bypassed 상태에서 앱 상단 고정
export function WarningBanner({ onSettings }: { onSettings: () => void }) {
  const t = useT();
  return (
    <div role="alert" style={{ position: 'sticky', top: 0, zIndex: 1000 }}>
      <Alert
        color="yellow"
        styles={{
          root: {
            borderRadius: 0,
            borderTop: 'none',
            borderLeft: 'none',
            borderRight: 'none',
            padding: '8px 16px',
          },
          body: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
          message: { flex: 1 },
        }}
      >
        <Text size="sm">{t('auth.aiNotConnected')}</Text>
        <Button size="xs" variant="light" color="yellow" onClick={onSettings} style={{ flexShrink: 0 }}>
          {t('auth.connectionSettings')}
        </Button>
      </Alert>
    </div>
  );
}

type PhaseContent = {
  icon: React.ReactNode;
  iconColor: string;
  title: string;
  desc: string;
  command?: string;
};

function getPhaseContent(phase: AuthPhase, t: ReturnType<typeof useT>, errorMessage?: string): PhaseContent | null {
  switch (phase) {
    case 'not-installed':
      return {
        icon: <IconAlertTriangle size={28} />,
        iconColor: 'yellow',
        title: t('auth.cliNotInstalledTitle'),
        desc: t('auth.cliNotInstalledDesc'),
        command: 'npm install -g @anthropic-ai/claude-code',
      };
    case 'not-authenticated':
      return {
        icon: <IconLock size={28} />,
        iconColor: 'yellow',
        title: t('auth.loginRequiredTitle'),
        desc: t('auth.loginRequiredDesc'),
        command: 'claude',
      };
    case 'error':
      return {
        icon: <IconAlertCircle size={28} />,
        iconColor: 'red',
        title: t('auth.checkFailedTitle'),
        desc: errorMessage || t('auth.unknownError'),
      };
    default:
      return null;
  }
}

function AuthCheckSpinner() {
  const t = useT();
  return (
    <Center
      h="100vh"
      aria-live="polite"
      aria-label={t('auth.checkingAriaLabel')}
      style={{ background: 'var(--bg-canvas, #0A0F1E)' }}
    >
      <Stack align="center" py="xl" gap="md">
        <Loader variant="dots" size="md" color="jarvis" />
        <Text c="dimmed" size="sm">{t('auth.checking')}</Text>
      </Stack>
    </Center>
  );
}

function ReauthPrompt({
  phase,
  errorMessage,
  onRecheck,
  onBypass,
  skipVisible,
}: {
  phase: AuthPhase;
  errorMessage?: string;
  onRecheck: () => void;
  onBypass: () => void;
  skipVisible: boolean;
}) {
  const t = useT();
  const content = getPhaseContent(phase, t, errorMessage);
  if (!content) return null;

  return (
    <Center h="100vh" style={{ background: 'var(--bg-canvas, #0A0F1E)' }}>
      <Stack align="center" gap="xl" style={{ maxWidth: 480, padding: '32px 24px' }}>
        <ThemeIcon size={56} radius="xl" color={content.iconColor} variant="light">
          {content.icon}
        </ThemeIcon>

        <Stack align="center" gap="xs">
          <Text fw={700} size="xl" role="heading" aria-level={1} ta="center">
            {content.title}
          </Text>
          <Text c="dimmed" size="sm" ta="center">
            {content.desc}
          </Text>
        </Stack>

        {content.command && (
          <Stack gap="xs" style={{ width: '100%' }}>
            <Box
              component="pre"
              aria-label={t('auth.terminalCommandAriaLabel')}
              style={{
                background: 'var(--bg-muted, #151F32)',
                borderRadius: 10,
                padding: '12px 16px',
                margin: 0,
                userSelect: 'all',
              }}
            >
              <Code
                style={{ background: 'transparent', padding: 0, fontSize: 'var(--font-m)', fontFamily: 'monospace', color: 'var(--text-primary, #F8F8F8)' }}
              >
                {content.command}
              </Code>
            </Box>
            <CopyButton value={content.command}>
              {({ copied, copy }) => (
                <Button
                  leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                  variant="subtle"
                  size="xs"
                  color={copied ? 'teal' : 'gray'}
                  onClick={copy}
                  style={{ alignSelf: 'flex-end' }}
                >
                  {copied ? t('auth.copied') : t('auth.copy')}
                </Button>
              )}
            </CopyButton>
          </Stack>
        )}

        <Stack gap="xs" align="center">
          <Button variant="filled" color="jarvis" radius="md" onClick={onRecheck} autoFocus>
            {t('auth.recheck')}
          </Button>
          {skipVisible && (
            <Button
              variant="subtle"
              c="dimmed"
              size="sm"
              onClick={onBypass}
              aria-label={t('auth.skipAriaLabel')}
            >
              {t('auth.skip')}
            </Button>
          )}
        </Stack>
      </Stack>
    </Center>
  );
}

// LoginGate — App.tsx에서 조건부 렌더
export default function LoginGate({
  onPass,
  onBypass,
  allowSkip = true,
}: {
  onPass: () => void;
  onBypass: () => void;
  // 첫 설정(온보딩) 전에는 false — 클로드 미연동 상태로 설정 진입을 차단.
  allowSkip?: boolean;
}) {
  const t = useT();
  const [phase, setPhase] = useState<AuthPhase>('checking');
  const [errorMsg, setErrorMsg] = useState('');
  const [skipVisible, setSkipVisible] = useState(false);
  const onPassRef = useRef(onPass);
  useEffect(() => { onPassRef.current = onPass; }, [onPass]);

  const check = useCallback(async () => {
    setPhase('checking');
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 8_000);
      const res = await fetch('/api/notes/ai/claude/detect', { signal: ctrl.signal });
      clearTimeout(tid);
      const data: ClaudeDetectResult = await res.json();
      if (!data.installed) {
        setPhase('not-installed');
      } else if (!data.authenticated) {
        setPhase('not-authenticated');
      } else {
        onPassRef.current();
      }
    } catch (e) {
      const msg = e instanceof Error
        ? (e.name === 'AbortError' ? t('auth.timeoutError') : e.message)
        : t('auth.checkError');
      setPhase('error');
      setErrorMsg(msg);
    }
  }, [t]);

  useEffect(() => { check(); }, [check]);

  useEffect(() => {
    const t = setTimeout(() => setSkipVisible(true), 30_000);
    return () => clearTimeout(t);
  }, []);

  if (phase === 'checking') return <AuthCheckSpinner />;

  return (
    <ReauthPrompt
      phase={phase}
      errorMessage={errorMsg}
      onRecheck={check}
      onBypass={onBypass}
      skipVisible={allowSkip && skipVisible}
    />
  );
}
