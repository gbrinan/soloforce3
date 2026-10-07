import React, { useState, useEffect, useRef } from 'react';
import {
  TextInput, Button, Stack, Group, Text, Loader,
  Badge, Select, Radio, Box,
} from '@mantine/core';
import { submitOnboarding } from '../../utils/api';
import { uiAlert } from '../Dialog/dialog';
import StepIndicator from './StepIndicator';
import ConsentSection, { EMPTY_CONSENT, allRequiredAgreed, type ConsentState } from '../Consent/ConsentSection';
import { stashPendingConsent, flushPendingConsent } from '../../utils/consent';
import { useI18n } from '../../i18n/I18nProvider';

interface Props {
  onComplete: () => void;
}

const CARD_STYLE: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-default)',
  borderRadius: 14,
  padding: 32,
  boxShadow: 'var(--shadow-lg, 0 8px 32px rgba(0,0,0,0.4))',
  width: '100%',
};

// ── O-1: Consent/Welcome ─────────────────────────────────────────────────────
interface Step0Props {
  onNext: () => void;
  consent: ConsentState;
  setConsent: (v: ConsentState) => void;
}
function StepWelcome({ onNext, consent, setConsent }: Step0Props) {
  const { t } = useI18n();
  const allRequired = allRequiredAgreed(consent);
  return (
    <div style={CARD_STYLE}>
      <Stack gap="lg">
        <div>
          <Text fw={700} size="xl" style={{ color: 'var(--color-point-1)', marginBottom: 4 }}>MyCrew</Text>
          <Text fw={700} size="xl" style={{ color: 'var(--text-primary)' }}>{t('onboarding.welcome.tagline')}</Text>
        </div>

        <ConsentSection value={consent} onChange={setConsent} />

        <Button
          fullWidth
          color="jarvis"
          h={40}
          fw={600}
          radius={10}
          disabled={!allRequired}
          onClick={onNext}
        >
          {t('onboarding.welcome.googleLogin')}
        </Button>
      </Stack>
    </div>
  );
}

// ── O-2: Workspace ────────────────────────────────────────────────────────────
interface Step1Props {
  onNext: (wsId: string, name: string) => void;
}
function StepWorkspace({ onNext }: Step1Props) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugStatus, setSlugStatus] = useState<'idle' | 'checking' | 'ok' | 'taken'>('idle');
  const [loading, setLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toSlug = (v: string) => v.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

  const checkSlug = (s: string) => {
    if (!s) { setSlugStatus('idle'); return; }
    setSlugStatus('checking');
    fetch(`/api/onboarding/workspaces/check?slug=${encodeURIComponent(s)}`)
      .then(r => setSlugStatus(r.status === 200 ? 'ok' : r.status === 409 ? 'taken' : 'idle'))
      .catch(() => setSlugStatus('idle'));
  };

  const handleNameChange = (v: string) => {
    setName(v);
    const s = toSlug(v);
    setSlug(s);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => checkSlug(s), 300);
  };

  const handleSlugChange = (v: string) => {
    const s = toSlug(v);
    setSlug(s);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => checkSlug(s), 300);
  };

  const handleNext = async () => {
    if (!name.trim() || !slug) return;
    setLoading(true);
    setCreateError(null);
    try {
      const res = await fetch('/api/onboarding/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), slug }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('onboarding.workspace.serverError', { status: res.status }));
      onNext(data.id ?? 'local', name.trim());
    } catch (err) {
      setCreateError((err as Error).message || t('onboarding.workspace.createFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={CARD_STYLE}>
      <Stack gap="md">
        <div>
          <Text fw={700} size="lg" style={{ color: 'var(--text-primary)' }}>{t('onboarding.workspace.title')}</Text>
          <Text size="sm" style={{ color: 'var(--text-muted)', marginTop: 4 }}>{t('onboarding.workspace.subtitle')}</Text>
        </div>

        <TextInput
          label={t('onboarding.workspace.nameLabel')}
          placeholder={t('onboarding.workspace.namePlaceholder')}
          value={name}
          onChange={(e) => handleNameChange(e.currentTarget.value)}
          maxLength={50}
          radius="sm"
        />

        <div>
          <Text size="sm" mb={4} style={{ color: 'var(--text-primary)' }}>{t('onboarding.workspace.urlLabel')}</Text>
          <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
            <span style={{
              padding: '8px 10px',
              background: 'var(--bg-muted)',
              border: '1px solid var(--border-default)',
              borderRight: 'none',
              borderRadius: '4px 0 0 4px',
              fontSize: 'var(--font-s)',
              color: 'var(--text-muted)',
              whiteSpace: 'nowrap',
            }}>mycrew.app/</span>
            <TextInput
              value={slug}
              onChange={(e) => handleSlugChange(e.currentTarget.value)}
              placeholder="team-slug"
              radius="sm"
              style={{ flex: 1 }}
              styles={{ input: { borderRadius: '0 4px 4px 0' } }}
            />
          </div>
          {slugStatus === 'checking' && <Text size="xs" mt={4} c="dimmed">{t('onboarding.workspace.checking')}</Text>}
          {slugStatus === 'ok' && <Badge size="xs" color="green" mt={4}>{t('onboarding.workspace.slugAvailable')}</Badge>}
          {slugStatus === 'taken' && <Badge size="xs" color="red" mt={4}>{t('onboarding.workspace.slugTaken')}</Badge>}
        </div>

        {createError && (
          <Text size="sm" style={{ color: 'var(--accent-danger)' }}>⚠ {createError}</Text>
        )}
        <Button
          fullWidth color="jarvis" h={40} fw={600} radius={10}
          disabled={!name.trim() || !slug || slugStatus === 'taken' || loading}
          onClick={handleNext}
          loading={loading}
        >
          {t('common.next')}
        </Button>
      </Stack>
    </div>
  );
}

// ── O-3: Team invite ──────────────────────────────────────────────────────────
interface Invitee { email: string; role: 'admin' | 'member' }
interface Step2Props {
  workspaceId: string;
  onNext: () => void;
}
function StepInvite({ workspaceId, onNext }: Step2Props) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [list, setList] = useState<Invitee[]>([]);
  const [sending, setSending] = useState(false);

  const addEmail = () => {
    const e = email.trim().toLowerCase();
    if (!e || !e.includes('@')) return;
    if (list.find(i => i.email === e)) { void uiAlert({ title: t('onboarding.invite.duplicateEmail'), variant: 'info' }); return; }
    setList(prev => [...prev, { email: e, role }]);
    setEmail('');
  };

  const handleSend = async () => {
    setSending(true);
    try {
      await Promise.allSettled(list.map(inv =>
        fetch(`/api/onboarding/workspaces/${workspaceId}/invite`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: inv.email }),
        })
      ));
    } finally {
      setSending(false);
      onNext();
    }
  };

  return (
    <div style={CARD_STYLE}>
      <Stack gap="md">
        <div>
          <Text fw={700} size="lg" style={{ color: 'var(--text-primary)' }}>{t('onboarding.invite.title')}</Text>
          <Text size="sm" style={{ color: 'var(--text-muted)', marginTop: 4 }}>{t('onboarding.invite.subtitle')}</Text>
        </div>

        <Group gap="xs" align="flex-end">
          <TextInput
            type="email"
            placeholder={t('onboarding.invite.emailPlaceholder')}
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addEmail(); }}
            style={{ flex: 1 }}
            radius="sm"
          />
          <Select
            value={role}
            onChange={(v) => setRole((v as 'admin' | 'member') ?? 'member')}
            data={[
              { value: 'admin', label: t('onboarding.invite.roleAdmin') },
              { value: 'member', label: t('onboarding.invite.roleMember') },
            ]}
            w={100}
            radius="sm"
          />
          <Button onClick={addEmail} color="jarvis" radius="sm">{t('onboarding.invite.addButton')}</Button>
        </Group>

        <Box
          p="xs"
          style={{
            border: '1px solid var(--border-default)',
            borderRadius: 10,
            minHeight: 80,
            background: 'var(--bg-elevated)',
          }}
        >
          {list.length === 0 ? (
            <Text size="xs" style={{ color: 'var(--text-muted)', padding: 8 }}>
              {t('onboarding.invite.emptyHint')}
            </Text>
          ) : (
            <Stack gap={4}>
              {list.map((inv) => (
                <Group key={inv.email} justify="space-between" p={4}>
                  <Text size="sm">👤 {inv.email}</Text>
                  <Group gap={8}>
                    <Text size="xs" style={{ color: 'var(--text-muted)' }}>{inv.role === 'admin' ? t('onboarding.invite.roleAdmin') : t('onboarding.invite.roleMember')}</Text>
                    <button
                      onClick={() => setList(prev => prev.filter(i => i.email !== inv.email))}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16 }}
                    >×</button>
                  </Group>
                </Group>
              ))}
            </Stack>
          )}
        </Box>

        <Group justify="space-between">
          <Button variant="subtle" color="gray" onClick={onNext}>{t('onboarding.laterButton')}</Button>
          <Button
            color="jarvis" radius={10} loading={sending}
            disabled={list.length === 0}
            onClick={handleSend}
          >
            {t('onboarding.invite.sendButton')}
          </Button>
        </Group>
      </Stack>
    </div>
  );
}

// ── O-4: AI agent ──────────────────────────────────────────────────────────
const PERSONALITY_OPTIONS = [
  { value: 'analytical', labelKey: 'onboarding.agent.personality.analytical' },
  { value: 'creative', labelKey: 'onboarding.agent.personality.creative' },
  { value: 'pragmatic', labelKey: 'onboarding.agent.personality.pragmatic' },
  { value: 'friendly', labelKey: 'onboarding.agent.personality.friendly' },
];

export interface StaffNames {
  ctoName: string;
  csoName: string;
  cqoName: string;
}
interface Step3Props {
  onNext: (agentName: string, staff: StaffNames) => void;
}
function StepAgent({ onNext }: Step3Props) {
  const { t } = useI18n();
  const [agentName, setAgentName] = useState('지니');
  const [role, setRole] = useState('비서');
  const [personality, setPersonality] = useState('pragmatic');
  // 함께 시작하는 직원 3명 — 서버 기본값(데이브/리사/잭키)과 동일한 초기값. 빈 값이면 서버 기본값 적용.
  const [ctoName, setCtoName] = useState('데이브');
  const [csoName, setCsoName] = useState('리사');
  const [cqoName, setCqoName] = useState('잭키');
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [tick, setTick] = useState(0);

  const CREATING_MSGS = [
    t('onboarding.agent.creating1'),
    t('onboarding.agent.creating2'),
    t('onboarding.agent.creating3'),
  ];

  const handleCreate = async () => {
    setLoading(true);
    setCreating(true);
    const interval = setInterval(() => setTick(t => t + 1), 900);
    await new Promise(r => setTimeout(r, 2500));
    clearInterval(interval);
    setLoading(false);
    onNext(agentName, { ctoName, csoName, cqoName });
  };

  return (
    <div style={CARD_STYLE}>
      <Stack gap="md">
        <div>
          <Text fw={700} size="lg" style={{ color: 'var(--text-primary)' }}>{t('onboarding.agent.title')}</Text>
        </div>

        <Group gap="md" align="flex-end">
          <TextInput
            label={t('onboarding.agent.nameLabel')}
            value={agentName}
            onChange={(e) => setAgentName(e.currentTarget.value)}
            maxLength={20}
            placeholder={t('onboarding.agent.namePlaceholder')}
            style={{ flex: 1 }}
            radius="sm"
          />
          <Select
            label={t('onboarding.agent.roleLabel')}
            value={role}
            onChange={(v) => setRole(v ?? '비서')}
            data={['비서', '개발자', '디자이너', '분석가', '기타']}
            style={{ flex: 1 }}
            radius="sm"
          />
        </Group>

        <div>
          <Text size="sm" mb={8} style={{ color: 'var(--text-primary)' }}>{t('onboarding.agent.personalityLabel')}</Text>
          <Radio.Group value={personality} onChange={setPersonality}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {PERSONALITY_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  style={{
                    border: `1px solid ${personality === opt.value ? 'var(--color-point-1)' : 'var(--border-default)'}`,
                    borderRadius: 10,
                    padding: 12,
                    cursor: 'pointer',
                    background: personality === opt.value ? 'rgba(79,70,229,0.08)' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <Radio value={opt.value} color="jarvis" />
                  <Text size="sm">{t(opt.labelKey as Parameters<typeof t>[0])}</Text>
                </label>
              ))}
            </div>
          </Radio.Group>
        </div>

        <div>
          <Text size="sm" mb={8} style={{ color: 'var(--text-primary)' }}>{t('onboarding.agent.staffTitle')}</Text>
          <Group gap="md" grow>
            <TextInput
              label={t('onboarding.agent.staffCto')}
              value={ctoName}
              onChange={(e) => setCtoName(e.currentTarget.value)}
              maxLength={20}
              radius="sm"
            />
            <TextInput
              label={t('onboarding.agent.staffCso')}
              value={csoName}
              onChange={(e) => setCsoName(e.currentTarget.value)}
              maxLength={20}
              radius="sm"
            />
            <TextInput
              label={t('onboarding.agent.staffCqo')}
              value={cqoName}
              onChange={(e) => setCqoName(e.currentTarget.value)}
              maxLength={20}
              radius="sm"
            />
          </Group>
        </div>

        {creating && (
          <Group gap={8}>
            <Loader size="xs" color="jarvis" />
            <Text size="sm" style={{ color: 'var(--text-muted)' }}>{CREATING_MSGS[tick % CREATING_MSGS.length]}</Text>
          </Group>
        )}

        <Group justify="space-between">
          <Button variant="subtle" color="gray" onClick={() => onNext('', { ctoName: '', csoName: '', cqoName: '' })}>{t('onboarding.laterButton')}</Button>
          <Button color="jarvis" radius={10} loading={loading} onClick={handleCreate}>{t('onboarding.agent.createButton')}</Button>
        </Group>
      </Stack>
    </div>
  );
}

// ── O-5: Complete ──────────────────────────────────────────────────────────
interface Step4Props {
  agentName: string;
  onComplete: () => void;
}
function StepComplete({ agentName, onComplete }: Step4Props) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setVisible(true), 100); return () => clearTimeout(timer); }, []);

  return (
    <div style={CARD_STYLE}>
      <Stack gap="lg" align="center">
        <div style={{
          fontSize: 48,
          transform: visible ? 'scale(1)' : 'scale(0)',
          transition: 'transform 0.3s cubic-bezier(0.34,1.56,0.64,1)',
        }}>🎉</div>
        <div style={{ textAlign: 'center' }}>
          <Text fw={700} size="xl" style={{ color: 'var(--text-primary)' }}>{t('onboarding.complete.title')}</Text>
          {agentName && (
            <Text size="sm" style={{ color: 'var(--text-muted)', marginTop: 4 }}>
              {t('onboarding.complete.agentWaiting', { name: agentName })}
            </Text>
          )}
        </div>
        <Button
          fullWidth color="jarvis" h={48} fw={600} radius={10}
          onClick={onComplete}
        >
          {t('onboarding.complete.goButton')}
        </Button>
        <Text size="xs" style={{ color: 'var(--text-muted)', textAlign: 'center' }}>
          {t('onboarding.complete.hint')}
        </Text>
      </Stack>
    </div>
  );
}

// ── Root wizard ───────────────────────────────────────────────────────────────
export default function OnboardingView({ onComplete }: Props) {
  const { t } = useI18n();
  const steps = [t('onboarding.step.workspace'), t('onboarding.step.invite'), t('onboarding.step.agent'), t('onboarding.step.complete')];
  const [step, setStep] = useState(0); // 0=welcome, 1=workspace, 2=invite, 3=agent, 4=complete
  const [ready, setReady] = useState(false);
  const [consent, setConsent] = useState<ConsentState>(EMPTY_CONSENT);
  const [workspaceId, setWorkspaceId] = useState('');
  const [wsName, setWsName] = useState('');
  const [agentName, setAgentName] = useState('');

  // 약관 동의 → SSO → 마이크루 설정 플로우: SSO 전 /onboarding 페이지에서 이미 동의를 마친
  // 경우(App.tsx가 pendingConsent를 기록) 동의 단계를 건너뛰고 설정부터 시작한다.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/consent/status');
        const body = await res.json();
        if (body?.hasConsented) setStep(1);
      } catch { /* 동의 상태 확인 실패 — 동의 단계부터 진행 */ }
      setReady(true);
    })();
  }, []);

  // 구글 계정으로 로그인하기: 동의 선택을 보관 후 구글 SSO 모듈(/auth/google) 호출.
  // 미인증(SSO 활성)이면 OAuth로 이동하고, 복귀 후 App.tsx가 보관된 동의를 기록한다.
  // 이미 인증됐거나 SSO 비활성(로컬)이면 즉시 기록하고 설정 단계로 진행한다.
  const handleWelcomeNext = async () => {
    stashPendingConsent(consent);
    try {
      const res = await fetch('/auth/me');
      if (res.status === 401) {
        const body = await res.json().catch(() => ({} as { login?: string }));
        window.location.href = body?.login || '/auth/google';
        return;
      }
    } catch { /* SSO 상태 확인 실패 — 로컬 플로우로 계속 */ }
    await flushPendingConsent();
    setStep(1);
  };

  const handleWorkspaceNext = async (wsId: string, name: string) => {
    setWorkspaceId(wsId);
    setWsName(name);
    setStep(2);
  };

  const handleInviteNext = () => setStep(3);

  const handleAgentNext = async (aName: string, staff: StaffNames) => {
    setAgentName(aName);
    try {
      await submitOnboarding({
        name: wsName || 'User',
        genieName: aName || '지니',
        // 빈 값은 서버 기본값(데이브/리사/잭키) 적용
        ctoName: staff.ctoName.trim() || undefined,
        csoName: staff.csoName.trim() || undefined,
        cqoName: staff.cqoName.trim() || undefined,
      });
    } catch { /* proceed anyway */ }
    setStep(4);
  };

  const handleComplete = () => {
    onComplete();
  };

  const outerStyle: React.CSSProperties = {
    minHeight: '100vh',
    background: 'var(--bg-canvas)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px 16px',
  };

  if (!ready) return <div style={outerStyle} />;

  return (
    <div style={outerStyle}>
      <div style={{ width: '100%', maxWidth: step === 0 ? 440 : step === 3 ? 560 : step === 2 ? 520 : 480 }}>
        {step > 0 && step < 4 && (
          <div style={{ marginBottom: 8 }}>
            <Text size="xs" style={{ color: 'var(--text-muted)', marginBottom: 8 }}>
              Step {step} of {steps.length}
            </Text>
            <StepIndicator steps={steps} currentStep={step - 1} />
          </div>
        )}

        {step === 0 && (
          <StepWelcome onNext={handleWelcomeNext} consent={consent} setConsent={setConsent} />
        )}
        {step === 1 && (
          <StepWorkspace onNext={handleWorkspaceNext} />
        )}
        {step === 2 && (
          <StepInvite workspaceId={workspaceId} onNext={handleInviteNext} />
        )}
        {step === 3 && (
          <StepAgent onNext={handleAgentNext} />
        )}
        {step === 4 && (
          <StepComplete agentName={agentName} onComplete={handleComplete} />
        )}
      </div>
    </div>
  );
}
