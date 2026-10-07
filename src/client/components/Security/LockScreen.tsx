import React, { useState, useEffect, useCallback } from 'react';
import {
  Stack, Group, Box, Text, ActionIcon, SimpleGrid,
  PasswordInput, Button,
} from '@mantine/core';
import { useComputedColorScheme } from '@mantine/core';
import { IconBackspace, IconCheck } from '@tabler/icons-react';
import { useT } from '../../i18n/I18nProvider';

// ─── 타입 & 상수 ────────────────────────────────────────────────────
export type LockSettings = {
  enabled: boolean;
  mode: 'pin' | 'password';
  timeoutMinutes: number;
  biometricEnabled: boolean;
};

type LockCredential = {
  hash: string;
  salt: string;
};

const SETTINGS_KEY = 'jarvis:lockSettings';
const CREDENTIAL_KEY = 'jarvis:lockCredential';
const LOCKOUT_KEY = 'jarvis:lockoutUntil';
export const LOCK_SETTINGS_CHANGED_EVENT = 'jarvis:lock-settings-changed';
export const LOCK_NOW_EVENT = 'jarvis:lock-now';

const DEFAULT_SETTINGS: LockSettings = {
  enabled: false,
  mode: 'pin',
  timeoutMinutes: 10,
  biometricEnabled: false,
};

// ─── 유틸 (App.tsx / SettingsModal에서 re-export) ───────────────────
export function getLockSettings(): LockSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveLockSettings(s: LockSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    window.dispatchEvent(new Event(LOCK_SETTINGS_CHANGED_EVENT));
  } catch { /* */ }
}

export function isLockEnabled(): boolean {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw) as Partial<LockSettings>;
    if (!s.enabled) return false;
    return !!localStorage.getItem(CREDENTIAL_KEY);
  } catch {
    return false;
  }
}

export function clearLockCredential(): void {
  try {
    localStorage.removeItem(CREDENTIAL_KEY);
    localStorage.removeItem(LOCKOUT_KEY);
  } catch { /* */ }
}

async function hashValue(value: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(salt + value);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function saveCredential(value: string): Promise<void> {
  const salt = crypto.randomUUID();
  const hash = await hashValue(value, salt);
  localStorage.setItem(CREDENTIAL_KEY, JSON.stringify({ hash, salt } as LockCredential));
}

export async function verifyCredential(input: string): Promise<boolean> {
  try {
    const raw = localStorage.getItem(CREDENTIAL_KEY);
    if (!raw) return false;
    const cred = JSON.parse(raw) as LockCredential;
    const hash = await hashValue(input, cred.salt);
    return hash === cred.hash;
  } catch {
    return false;
  }
}

// ─── LockScreen 컴포넌트 ────────────────────────────────────────────
interface Props {
  mode: 'pin' | 'password';
  onUnlock: () => void;
}

export default function LockScreen({ mode, onUnlock }: Props) {
  const t = useT();
  const colorScheme = useComputedColorScheme('dark', { getInitialValueInEffect: true });
  const [pin, setPin] = useState('');
  const [password, setPassword] = useState('');
  const [errorCount, setErrorCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [cooldownSec, setCooldownSec] = useState(0);
  const [shake, setShake] = useState(false);
  const [verifying, setVerifying] = useState(false);

  // 마운트 시 기존 쿨다운 복원
  useEffect(() => {
    const lockoutUntil = Number(localStorage.getItem(LOCKOUT_KEY) ?? 0);
    const remaining = Math.ceil((lockoutUntil - Date.now()) / 1000);
    if (remaining > 0) setCooldownSec(remaining);
  }, []);

  // 쿨다운 1초 타이머 체인
  useEffect(() => {
    if (cooldownSec <= 0) return;
    const t = setTimeout(() => setCooldownSec(prev => Math.max(0, prev - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldownSec]);

  // Esc 차단 — 잠금 상태에서 오버레이 닫기 불가
  useEffect(() => {
    const block = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); }
    };
    document.addEventListener('keydown', block, true);
    return () => document.removeEventListener('keydown', block, true);
  }, []);

  const handleVerify = useCallback(async (input: string) => {
    if (!input || verifying || cooldownSec > 0) return;
    setVerifying(true);
    try {
      const ok = await verifyCredential(input);
      if (ok) {
        localStorage.removeItem(LOCKOUT_KEY);
        setErrorCount(0);
        setErrorMsg('');
        onUnlock();
      } else {
        const newCount = errorCount + 1;
        setErrorCount(newCount);
        setShake(true);
        setPin('');
        setPassword('');
        setTimeout(() => setShake(false), 600);
        if (newCount >= 5) {
          const lockoutUntil = Date.now() + 30_000;
          localStorage.setItem(LOCKOUT_KEY, String(lockoutUntil));
          setCooldownSec(30);
          setErrorCount(0);
          setErrorMsg('');
        } else {
          setErrorMsg(t('security.wrongCredential', {
            type: mode === 'pin' ? 'PIN' : t('security.passwordLabel'),
            count: newCount,
          }));
        }
      }
    } finally {
      setVerifying(false);
    }
  }, [errorCount, mode, onUnlock, verifying, cooldownSec, t]);

  const handlePinPress = useCallback((key: string) => {
    if (cooldownSec > 0 || verifying) return;
    if (key === 'back') { setPin(prev => prev.slice(0, -1)); return; }
    if (key === 'confirm') { if (pin.length === 4) handleVerify(pin); return; }
    if (pin.length >= 4) return;
    const next = pin + key;
    setPin(next);
    if (next.length === 4) handleVerify(next);
  }, [pin, cooldownSec, verifying, handleVerify]);

  const isCoolingDown = cooldownSec > 0;
  const isDark = colorScheme === 'dark';
  const backdropBg = isDark ? 'rgba(4,7,15,0.88)' : 'rgba(250,250,250,0.88)';

  const dotFill = (i: number): string => {
    if (shake && i < pin.length) return 'var(--accent-danger, #F87171)';
    if (i < pin.length) return 'var(--ring, #6366F1)';
    return 'transparent';
  };
  const dotBorder = (i: number): string => {
    if (shake && i < pin.length) return '1.5px solid var(--accent-danger, #F87171)';
    if (i < pin.length) return 'none';
    return '1.5px solid var(--border-default, #1F293D)';
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        backdropFilter: 'blur(12px)',
        background: backdropBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'opacity 200ms ease',
        userSelect: 'none',
      }}
    >
      <Box
        style={{
          background: 'var(--bg-card, #0F1726)',
          borderRadius: 14,
          boxShadow: '0 6px 24px rgba(0,0,0,0.28)',
          width: 360,
          padding: 32,
          border: '1px solid var(--border-default, #1F293D)',
        }}
      >
        <Stack align="center" gap="lg">
          {/* 헤더 */}
          <Stack align="center" gap="xs">
            <Box
              aria-hidden
              style={{
                width: 48, height: 48, borderRadius: 10,
                background: 'var(--ring, #6366F1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 24,
              }}
            >
              🔒
            </Box>
            <Text fw={700} size="xl">MyCrew</Text>
            <Text c="dimmed" size="sm">{t('security.unlockPrompt')}</Text>
          </Stack>

          {/* PIN 모드 */}
          {mode === 'pin' && (
            <>
              {/* PinDisplay */}
              <Group gap="md" aria-hidden>
                {[0, 1, 2, 3].map(i => (
                  <Box
                    key={i}
                    style={{
                      width: 12, height: 12, borderRadius: '50%',
                      background: dotFill(i),
                      border: dotBorder(i),
                      transition: 'background 0.15s, border 0.15s',
                    }}
                  />
                ))}
              </Group>

              {/* PinPad */}
              <SimpleGrid cols={3} spacing="xs" style={{ opacity: isCoolingDown ? 0.4 : 1 }}>
                {['1','2','3','4','5','6','7','8','9'].map((n, idx) => (
                  <ActionIcon
                    key={n}
                    size={56}
                    radius="xl"
                    variant="subtle"
                    disabled={isCoolingDown || verifying}
                    onClick={() => handlePinPress(n)}
                    aria-label={t('security.digitLabel', { n })}
                    tabIndex={idx + 1}
                    style={{ fontSize: 20, fontWeight: 600 }}
                  >
                    {n}
                  </ActionIcon>
                ))}
                <ActionIcon
                  size={56} radius="xl" variant="subtle"
                  disabled={isCoolingDown || verifying}
                  onClick={() => handlePinPress('back')}
                  aria-label={t('security.backspace')}
                  tabIndex={10}
                  c="dimmed"
                >
                  <IconBackspace size={22} stroke={1.5} />
                </ActionIcon>
                <ActionIcon
                  size={56} radius="xl" variant="subtle"
                  disabled={isCoolingDown || verifying}
                  onClick={() => handlePinPress('0')}
                  aria-label={t('security.digitLabel', { n: 0 })}
                  tabIndex={11}
                  style={{ fontSize: 20, fontWeight: 600 }}
                >
                  0
                </ActionIcon>
                <ActionIcon
                  size={56} radius="xl" variant="subtle"
                  disabled={isCoolingDown || verifying || pin.length < 4}
                  onClick={() => handlePinPress('confirm')}
                  aria-label={t('security.confirm')}
                  tabIndex={12}
                  color="var(--ring)"
                >
                  <IconCheck size={22} stroke={2} />
                </ActionIcon>
              </SimpleGrid>
            </>
          )}

          {/* 비밀번호 모드 */}
          {mode === 'password' && (
            <Stack style={{ width: '100%' }} gap="sm">
              <PasswordInput
                size="md"
                placeholder={t('security.passwordLabel')}
                value={password}
                onChange={e => setPassword(e.currentTarget.value)}
                disabled={isCoolingDown || verifying}
                onKeyDown={e => { if (e.key === 'Enter' && password) handleVerify(password); }}
                autoFocus
                aria-label={t('security.passwordLabel')}
              />
              <Button
                fullWidth
                disabled={isCoolingDown || verifying || !password}
                loading={verifying}
                onClick={() => handleVerify(password)}
              >
                {t('security.unlockButton')}
              </Button>
            </Stack>
          )}

          {/* 오류 메시지 */}
          {errorMsg && !isCoolingDown && (
            <Text
              size="sm"
              style={{ color: 'var(--accent-danger, #F87171)' }}
              role="alert"
            >
              {errorMsg}
            </Text>
          )}

          {/* 쿨다운 */}
          {isCoolingDown && (
            <Text c="dimmed" size="sm" aria-live="polite">
              {t('security.cooldownRetry', { n: cooldownSec })}
            </Text>
          )}
        </Stack>
      </Box>
    </div>
  );
}
