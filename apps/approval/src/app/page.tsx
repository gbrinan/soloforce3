"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
  Group,
  Loader,
  Modal,
  NumberInput,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Timeline,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconArrowLeft,
  IconCalendar,
  IconCheck,
  IconClipboardList,
  IconClock,
  IconFileInvoice,
  IconPlus,
  IconReceipt2,
  IconSend,
  IconSparkles,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import { fetchMe } from '../lib/me';
import {
  listWorkflows,
  createWorkflow,
  submitWorkflow as apiSubmit,
  decideWorkflow as apiDecide,
  cancelWorkflow as apiCancel,
  getMyBalance,
  listPartners,
  aiDraft,
  aiSummarizeRequest,
} from '../lib/workflow-api';
import type { WorkflowRequest, WorkflowStatus, WorkflowType, PartnerLite, AiSummary } from '../lib/workflow-api';
import { useI18n } from '../lib/i18n';
import type { MessageKey, Translator } from '../lib/i18n';
import './workflow.css';

type Screen = 'list' | 'type-select' | 'form' | 'detail';
type InboxTab = 'sent' | 'received' | 'done';
type DecisionIntent = 'approved' | 'rejected' | null;

interface ApproverDraft {
  key: string;
  approverId: string;
  required: boolean;
}

interface WorkflowDraft {
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  vendor: string;
  amount: number;
  category: string;
}

// label/short/desc는 i18n 키 — 표시 시 t()로 해석한다.
const TYPE_META: Record<WorkflowType, { label: MessageKey; short: MessageKey; desc: MessageKey; color: string; icon: React.ReactNode }> = {
  vacation: {
    label: 'type.vacation.label',
    short: 'type.vacation.short',
    desc: 'type.vacation.desc',
    color: 'cyan',
    icon: <IconCalendar size={24} stroke={1.7} />,
  },
  expense: {
    label: 'type.expense.label',
    short: 'type.expense.short',
    desc: 'type.expense.desc',
    color: 'yellow',
    icon: <IconReceipt2 size={24} stroke={1.7} />,
  },
  purchase: {
    label: 'type.purchase.label',
    short: 'type.purchase.short',
    desc: 'type.purchase.desc',
    color: 'violet',
    icon: <IconClipboardList size={24} stroke={1.7} />,
  },
};

// 휴가 유형은 저장 데이터 호환을 위해 value(한국어 원문)를 유지하고 표시 라벨만 로케일화한다.
const LEAVE_TYPE_VALUES = ['연차', '반차(오전)', '반차(오후)', '병가', '특별휴가'] as const;
const LEAVE_TYPE_KEYS: Record<string, MessageKey> = {
  '연차': 'leave.annual',
  '반차(오전)': 'leave.halfAm',
  '반차(오후)': 'leave.halfPm',
  '병가': 'leave.sick',
  '특별휴가': 'leave.special',
};

function leaveTypeLabel(value: string, t: Translator): string {
  const key = LEAVE_TYPE_KEYS[value];
  return key ? t(key) : value;
}

// 결재자 후보는 동료(External 파트너)에서 런타임 로드한다. (하드코딩 목록 제거)
interface ApproverOption { value: string; label: string }

// approverName()이 참조하는 표시명 맵 — 파트너 로드 시 갱신. 표시 전용이라 모듈 스코프로 둔다.
let approverLabelMap: Record<string, string> = {};

// 동료 1명 → 결재자 옵션. value는 이메일(없으면 id), label은 "이름 (부서/회사)".
function partnerToOption(p: PartnerLite): ApproverOption {
  const sub = p.department?.trim() || p.companyName?.trim();
  return {
    value: p.contactEmail?.trim() || p.id,
    label: sub ? `${p.contactName} (${sub})` : p.contactName,
  };
}

const NAV_ITEMS: { id: InboxTab; label: MessageKey }[] = [
  { id: 'sent', label: 'nav.sent' },
  { id: 'received', label: 'nav.received' },
  { id: 'done', label: 'nav.done' },
];

const DEFAULT_DRAFT: WorkflowDraft = {
  leaveType: '연차',
  startDate: '2026-07-01',
  endDate: '2026-07-02',
  days: 2,
  reason: '',
  vendor: '',
  amount: 0,
  category: '',
};

function dateLabel(iso: string | undefined, intl: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat(intl, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function dateTimeLabel(iso: string | undefined, intl: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(intl, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

function moneyLabel(value: unknown, t: Translator, intl: string): string {
  const n = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(n) ? t('money.format', { n: n.toLocaleString(intl) }) : '-';
}

function approverName(id: string): string {
  return approverLabelMap[id] ?? id;
}

function currentPendingStep(req: WorkflowRequest) {
  return req.approvers.find((step) => step.status === 'pending');
}

function statusLabel(req: WorkflowRequest, t: Translator): string {
  if (req.status === 'approved') return t('status.approved');
  if (req.status === 'rejected') return t('status.rejected');
  if (req.status === 'cancelled') return t('status.cancelled');
  if (req.status === 'draft') return t('status.draft');
  const step = currentPendingStep(req);
  return step ? t('status.step', { n: step.order }) : t('status.inProgress');
}

function statusTone(status: WorkflowStatus): { color: string; icon: React.ReactNode } {
  if (status === 'approved') return { color: 'green', icon: <IconCheck size={14} /> };
  if (status === 'rejected' || status === 'cancelled') return { color: 'red', icon: <IconX size={14} /> };
  if (status === 'draft') return { color: 'gray', icon: <IconClock size={14} /> };
  return { color: 'yellow', icon: <IconClock size={14} /> };
}

function buildTitle(type: WorkflowType, draft: WorkflowDraft, t: Translator): string {
  if (type === 'vacation') {
    return t('title.vacation', { leaveType: leaveTypeLabel(draft.leaveType, t), start: draft.startDate, end: draft.endDate });
  }
  if (type === 'expense') {
    return `${t('title.expense', { category: draft.category || t('fallback.expense') })}${draft.vendor ? ` - ${draft.vendor}` : ''}`;
  }
  return `${t('title.purchase', { category: draft.category || t('fallback.purchase') })}${draft.vendor ? ` - ${draft.vendor}` : ''}`;
}

function buildData(type: WorkflowType, draft: WorkflowDraft): Record<string, unknown> {
  if (type === 'vacation') {
    return {
      leaveType: draft.leaveType,
      startDate: draft.startDate,
      endDate: draft.endDate,
      days: draft.days,
    };
  }
  return {
    vendor: draft.vendor,
    amount: draft.amount,
    category: draft.category,
  };
}

function SubHeader({
  title,
  onBack,
}: {
  title: string;
  onBack: () => void;
}) {
  const { t } = useI18n();
  return (
    <Group
      px="md"
      py="sm"
      gap="xs"
      wrap="nowrap"
      style={{ borderBottom: '1px solid var(--mantine-color-default-border)', flexShrink: 0 }}
    >
      <ActionIcon variant="subtle" onClick={onBack} aria-label={t('common.back')}>
        <IconArrowLeft size={16} />
      </ActionIcon>
      <Text fw={700} truncate>{title}</Text>
    </Group>
  );
}

function WorkflowFlow({ request }: { request: WorkflowRequest }) {
  const { t, intl } = useI18n();
  return (
    <div className="workflow-flow" aria-label={t('flow.aria')}>
      <div className="workflow-node requester">
        <div className="workflow-avatar">{t('flow.requesterInitial')}</div>
        <Text size="xs" fw={700}>{t('flow.requester')}</Text>
        <Text size="xs" c="dimmed" truncate>{request.requesterId}</Text>
      </div>
      {request.approvers.map((step) => {
        const active = request.status === 'submitted' && step.status === 'pending' && currentPendingStep(request)?.order === step.order;
        const done = step.status === 'approved';
        const rejected = step.status === 'rejected';
        return (
          <React.Fragment key={`${step.order}-${step.approverId}`}>
            <div className={`workflow-connector ${done ? 'done' : ''}`} />
            <div className={`workflow-node ${done ? 'done' : ''} ${active ? 'active' : ''} ${rejected ? 'rejected' : ''}`}>
              <div className="workflow-avatar">{step.order}</div>
              <Text size="xs" fw={700}>{t('flow.step', { n: step.order })}</Text>
              <Text size="xs" c="dimmed" truncate>{approverName(step.approverId)}</Text>
              {step.decidedAt && <Text size="xs" c="dimmed">{dateLabel(step.decidedAt, intl)}</Text>}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

function RequestSummary({ request }: { request: WorkflowRequest }) {
  const { t, intl } = useI18n();
  const data = request.data ?? {};
  const type = request.type;
  return (
    <Card className="workflow-section-card">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <div>
            <Text fw={700}>{t('summary.title')}</Text>
            <Text size="sm" c="dimmed">{request.description || t('summary.noDesc')}</Text>
          </div>
          <Badge color={TYPE_META[type].color} variant="light">{t(TYPE_META[type].short)}</Badge>
        </Group>
        <div className="workflow-detail-grid">
          {type === 'vacation' ? (
            <>
              <div>
                <Text size="xs" c="dimmed">{t('summary.leaveType')}</Text>
                <Text fw={700}>{leaveTypeLabel(String(data.leaveType ?? '연차'), t)}</Text>
              </div>
              <div>
                <Text size="xs" c="dimmed">{t('summary.period')}</Text>
                <Text fw={700}>{String(data.startDate ?? '-')} ~ {String(data.endDate ?? '-')}</Text>
              </div>
              <div>
                <Text size="xs" c="dimmed">{t('summary.days')}</Text>
                <Text fw={700}>{t('unit.days', { n: String(data.days ?? '-') })}</Text>
              </div>
            </>
          ) : (
            <>
              <div>
                <Text size="xs" c="dimmed">{t('summary.category')}</Text>
                <Text fw={700}>{String(data.category ?? '-')}</Text>
              </div>
              <div>
                <Text size="xs" c="dimmed">{t('summary.vendor')}</Text>
                <Text fw={700}>{String(data.vendor ?? '-')}</Text>
              </div>
              <div>
                <Text size="xs" c="dimmed">{t('summary.amount')}</Text>
                <Text fw={700}>{moneyLabel(data.amount, t, intl)}</Text>
              </div>
            </>
          )}
        </div>
      </Stack>
    </Card>
  );
}

function HistoryTimeline({ request }: { request: WorkflowRequest }) {
  const { t, intl } = useI18n();
  const items = [
    { key: 'submit', at: request.submittedAt ?? request.createdAt, title: t('history.submitted'), body: t('history.submittedBy', { name: request.requesterId }), color: 'blue', icon: <IconSend size={13} /> },
    ...request.approvers
      .filter((step) => step.status !== 'pending')
      .map((step) => ({
        key: `${step.order}-${step.status}`,
        at: step.decidedAt ?? request.updatedAt,
        title: step.status === 'approved' ? t('history.approved') : t('history.rejected'),
        body: `${t('history.approverStep', { n: step.order, name: approverName(step.approverId) })}${step.comment ? ` · ${step.comment}` : ''}`,
        color: step.status === 'approved' ? 'green' : 'red',
        icon: step.status === 'approved' ? <IconCheck size={13} /> : <IconX size={13} />,
      })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <Card className="workflow-section-card">
      <Text fw={700} mb="sm">{t('history.title')}</Text>
      <Timeline active={items.length - 1} bulletSize={24} lineWidth={2}>
        {items.map((item) => (
          <Timeline.Item key={item.key} bullet={item.icon} color={item.color} title={item.title}>
            <Text size="sm">{item.body}</Text>
            <Text size="xs" c="dimmed">{dateTimeLabel(item.at, intl)}</Text>
          </Timeline.Item>
        ))}
      </Timeline>
    </Card>
  );
}

// Per-workflow AI summary cache — avoids re-spawning the Claude CLI when the
// approver re-opens the same document detail.
const aiSummaryCache = new Map<string, AiSummary>();

function AiSummaryCard({ request }: { request: WorkflowRequest }) {
  const { t } = useI18n();
  const [summary, setSummary] = useState<AiSummary | null>(aiSummaryCache.get(request.id) ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const cached = aiSummaryCache.get(request.id);
    if (cached) {
      setSummary(cached);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await aiSummarizeRequest(request);
      aiSummaryCache.set(request.id, result);
      setSummary(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card className="workflow-section-card">
      <Group justify="space-between" mb="sm">
        <Text fw={700}>{t('ai.title')}</Text>
        <Badge variant="light" color="grape" leftSection={<IconSparkles size={12} />}>AI</Badge>
      </Group>
      {loading && (
        <Group gap="xs">
          <Loader size="xs" />
          <Text size="sm" c="dimmed">{t('ai.generating')}</Text>
        </Group>
      )}
      {!loading && error && (
        <Group gap="xs">
          <Text size="sm" c="red">{t('ai.failed', { error })}</Text>
          <Button size="compact-xs" variant="subtle" onClick={() => void load()}>{t('ai.retry')}</Button>
        </Group>
      )}
      {!loading && !error && summary && (
        <Stack gap={6}>
          {summary.summary.map((line, index) => (
            <Text size="sm" key={index}>{index + 1}. {line}</Text>
          ))}
          {summary.risk && (
            <Alert color="orange" variant="light" title={t('ai.caution')} mt="xs">{summary.risk}</Alert>
          )}
        </Stack>
      )}
    </Card>
  );
}

export default function ApprovalPage() {
  const { t, locale, intl } = useI18n();
  const [screen, setScreen] = useState<Screen>('list');
  const [tab, setTab] = useState<InboxTab>('sent');
  const [currentUserKey, setCurrentUserKey] = useState('__local__');
  const [items, setItems] = useState<WorkflowRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedType, setSelectedType] = useState<WorkflowType>('vacation');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WorkflowDraft>(DEFAULT_DRAFT);
  const [approvers, setApprovers] = useState<ApproverDraft[]>([
    { key: '1', approverId: '', required: true },
  ]);
  const [approverOptions, setApproverOptions] = useState<ApproverOption[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [decisionIntent, setDecisionIntent] = useState<DecisionIntent>(null);
  const [decisionComment, setDecisionComment] = useState('');
  const [decisionSubmitting, setDecisionSubmitting] = useState(false);
  const [myBalance, setMyBalance] = useState<number | null>(null);
  const [aiDrafting, setAiDrafting] = useState(false);

  // 브라우저 탭 제목을 로케일에 맞춰 동기화 (layout metadata는 SSR 기본값 유지)
  useEffect(() => {
    document.title = t('app.title');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [me, workflows, partners] = await Promise.all([
        fetchMe().catch(() => null),
        listWorkflows({ role: 'all', limit: 100 }),
        listPartners().catch(() => [] as PartnerLite[]),
      ]);
      setCurrentUserKey(me?.email || '__local__');
      setItems(workflows);
      // 동료(active) → 결재자 옵션. 표시명 맵도 함께 갱신해 상세/타임라인 라벨에 반영.
      const opts = partners.filter((p) => p.active !== false).map(partnerToOption);
      setApproverOptions(opts);
      approverLabelMap = Object.fromEntries(opts.map((o) => [o.value, o.label]));
    } catch (err) {
      notifications.show({ color: 'red', message: t('toast.loadFail', { error: (err as Error).message }) });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadBalance = useCallback(async () => {
    try {
      const bal = await getMyBalance(new Date().getFullYear());
      setMyBalance(bal.remaining);
    } catch {
      setMyBalance(null);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadBalance();
  }, [load, loadBalance]);

  useEffect(() => {
    const es = new EventSource('/api/events');
    const handler = (e: MessageEvent) => {
      try {
        const env = JSON.parse(e.data) as { type: 'wf_created' | 'wf_updated'; request: WorkflowRequest };
        if (env.type === 'wf_created') {
          setItems(prev => prev.find(i => i.id === env.request.id) ? prev : [env.request, ...prev]);
        } else if (env.type === 'wf_updated') {
          setItems(prev => prev.map(i => i.id === env.request.id ? env.request : i));
        }
      } catch { /* skip */ }
    };
    es.addEventListener('workflow-approval', handler);
    return () => { es.removeEventListener('workflow-approval', handler); es.close(); };
  }, []);

  const selected = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId]);

  const lists = useMemo(() => {
    const sent = items.filter((item) => item.requesterId === currentUserKey);
    const received = items.filter((item) => {
      const current = currentPendingStep(item);
      return item.status === 'submitted' && current?.approverId === currentUserKey;
    });
    const done = items.filter((item) => {
      const involved = item.requesterId === currentUserKey || item.approvers.some((step) => step.approverId === currentUserKey);
      return involved && ['approved', 'rejected', 'cancelled'].includes(item.status);
    });
    return { sent, received, done };
  }, [items, currentUserKey]);

  const visibleRows = lists[tab];

  function resetForm(type: WorkflowType) {
    setSelectedType(type);
    setDraft({
      ...DEFAULT_DRAFT,
      category: type === 'expense' ? t('category.mealDefault') : type === 'purchase' ? t('category.equipmentDefault') : '',
    });
    // 결재자는 동료 목록에서 직접 고르므로 빈 필수 행 1개로 시작한다.
    setApprovers([{ key: crypto.randomUUID(), approverId: '', required: true }]);
    setScreen('form');
  }

  // Generate a document draft via Claude CLI and fill the form fields.
  // The current 사유 text is passed as free-form hints.
  async function fillAiDraft() {
    setAiDrafting(true);
    try {
      const result = await aiDraft({ type: selectedType, hints: draft.reason.trim() });
      setDraft((prev) => {
        const next = { ...prev };
        if (result.reason) next.reason = result.reason;
        if (selectedType === 'vacation') {
          if (result.leaveType) next.leaveType = result.leaveType;
          if (result.startDate) next.startDate = result.startDate;
          if (result.endDate) next.endDate = result.endDate;
          if (typeof result.days === 'number' && result.days > 0) next.days = result.days;
        } else {
          if (result.vendor) next.vendor = result.vendor;
          if (result.category) next.category = result.category;
          if (typeof result.amount === 'number' && result.amount >= 0) next.amount = result.amount;
        }
        return next;
      });
      notifications.show({ color: 'green', message: t('toast.draftFilled') });
    } catch (err) {
      notifications.show({ color: 'red', message: t('toast.draftFail', { error: (err as Error).message }) });
    } finally {
      setAiDrafting(false);
    }
  }

  async function submitWorkflow() {
    if (approverOptions.length === 0) {
      notifications.show({ color: 'yellow', message: t('toast.needPartners') });
      return;
    }
    const approverIds = approvers.map((row) => row.approverId).filter(Boolean);
    if (approverIds.length === 0 || approvers.some((row) => row.required && !row.approverId)) {
      notifications.show({ color: 'red', message: t('toast.needApprover') });
      return;
    }
    if (!draft.reason.trim()) {
      notifications.show({ color: 'red', message: t('toast.needReason') });
      return;
    }
    setSubmitting(true);
    try {
      const created = await createWorkflow({
        type: selectedType,
        title: buildTitle(selectedType, draft, t),
        description: draft.reason,
        data: buildData(selectedType, draft),
        approverIds,
      });
      const submitted = await apiSubmit(created.id);
      setItems((prev) => [submitted, ...prev.filter((item) => item.id !== submitted.id)]);
      setSelectedId(submitted.id);
      setScreen('detail');
      setTab('sent');
      notifications.show({ color: 'green', message: t('toast.submitted') });
      void loadBalance();
    } catch (err) {
      notifications.show({ color: 'red', message: t('toast.submitFail', { error: (err as Error).message }) });
    } finally {
      setSubmitting(false);
    }
  }

  async function decideWorkflow() {
    if (!selected || !decisionIntent) return;
    if (decisionIntent === 'rejected' && !decisionComment.trim()) {
      notifications.show({ color: 'red', message: t('toast.needRejectComment') });
      return;
    }
    setDecisionSubmitting(true);
    try {
      const updated = await apiDecide(selected.id, { decision: decisionIntent, comment: decisionComment.trim() });
      setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setDecisionIntent(null);
      setDecisionComment('');
      notifications.show({ color: decisionIntent === 'approved' ? 'green' : 'red', message: decisionIntent === 'approved' ? t('toast.approvedDone') : t('toast.rejectedDone') });
    } catch (err) {
      notifications.show({ color: 'red', message: t('toast.decideFail', { error: (err as Error).message }) });
    } finally {
      setDecisionSubmitting(false);
    }
  }

  async function cancelWorkflowItem() {
    if (!selected) return;
    if (!window.confirm(t('confirm.cancel'))) return;
    try {
      const updated = await apiCancel(selected.id);
      setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      notifications.show({ color: 'gray', message: t('toast.cancelled') });
      void loadBalance();
    } catch (err) {
      notifications.show({ color: 'red', message: t('toast.cancelFail', { error: (err as Error).message }) });
    }
  }

  function openDetail(item: WorkflowRequest) {
    setSelectedId(item.id);
    setScreen('detail');
  }

  const balanceLabel = t('unit.days', { n: myBalance === null ? '—' : myBalance });
  const remaining = myBalance === null ? 99 : myBalance;

  const leaveTypeOptions = LEAVE_TYPE_VALUES.map((value) => ({ value, label: leaveTypeLabel(value, t) }));

  // Sidebar navigation item click — reload list when switching tabs
  function handleNavClick(id: InboxTab) {
    setTab(id);
    setScreen('list');
    if (id !== tab) void load();
  }

  return (
    <Box className="workflow-layout">
      {/* ── Left Sidebar ────────────────────────────── */}
      <div className="workflow-sidebar">
        <Button variant="filled"
          className="workflow-compose-btn"
          leftSection={<IconPlus size={15} />}
          fullWidth
          loading={loading && screen === 'list'}
          onClick={() => setScreen('type-select')}
        >
          {t('btn.newRequest')}
        </Button>

        <nav className="workflow-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`workflow-nav-item${tab === item.id && screen === 'list' ? ' active' : ''}`}
              onClick={() => handleNavClick(item.id)}
            >
              <span>{t(item.label)}</span>
              {item.id === 'received' && lists.received.length > 0 && (
                <Badge size="xs" color="blue" variant="filled">{lists.received.length}</Badge>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* ── Right Content ────────────────────────────── */}
      <div className="workflow-main">

        {/* Sub-header for non-list screens */}
        {screen !== 'list' && (
          <SubHeader
            title={
              screen === 'type-select' ? t('btn.newRequest')
              : screen === 'form' ? t(TYPE_META[selectedType].label)
              : selected?.title ?? t('detail.title')
            }
            onBack={() => {
              if (screen === 'detail') setScreen('list');
              else if (screen === 'form') setScreen('type-select');
              else setScreen('list');
            }}
          />
        )}

        {/* List screen */}
        {screen === 'list' && (
          <ScrollArea className="workflow-scroll">
            <Stack gap="md" p="md">
              <Card className="workflow-list-card">
                {visibleRows.length === 0 ? (
                  <Box className="workflow-empty">
                    <IconFileInvoice size={28} stroke={1.5} />
                    <Text fw={700}>{t('list.empty.title')}</Text>
                    <Text size="sm" c="dimmed">{t('list.empty.desc')}</Text>
                  </Box>
                ) : (
                  <Table highlightOnHover verticalSpacing="sm" className="workflow-table">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>{t('list.th.type')}</Table.Th>
                        <Table.Th>{t('list.th.title')}</Table.Th>
                        <Table.Th>{t('list.th.status')}</Table.Th>
                        <Table.Th>{t('list.th.date')}</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {visibleRows.map((item) => {
                        const tone = statusTone(item.status);
                        return (
                          <Table.Tr key={item.id} onClick={() => openDetail(item)} className="workflow-row">
                            <Table.Td><Badge size="sm" variant="light" color={TYPE_META[item.type].color}>{t(TYPE_META[item.type].short)}</Badge></Table.Td>
                            <Table.Td>
                              <Text fw={700} size="sm" lineClamp={1}>{item.title}</Text>
                              <Text size="xs" c="dimmed" lineClamp={1}>{item.description || item.id}</Text>
                            </Table.Td>
                            <Table.Td>
                              <Badge color={tone.color} variant="light" leftSection={tone.icon}>{statusLabel(item, t)}</Badge>
                            </Table.Td>
                            <Table.Td><Text size="sm">{dateLabel(item.createdAt, intl)}</Text></Table.Td>
                          </Table.Tr>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                )}
              </Card>
            </Stack>
          </ScrollArea>
        )}

        {/* Type select screen */}
        {screen === 'type-select' && (
          <ScrollArea className="workflow-scroll">
            <Stack gap="md" p="md">
              <div className="workflow-type-grid">
                {(Object.keys(TYPE_META) as WorkflowType[]).map((type) => (
                  <button key={type} className="workflow-type-card" onClick={() => resetForm(type)}>
                    <span className="workflow-type-icon">{TYPE_META[type].icon}</span>
                    <Text fw={800}>{t(TYPE_META[type].short)}</Text>
                    <Text size="sm" c="dimmed">{t(TYPE_META[type].desc)}</Text>
                  </button>
                ))}
              </div>
            </Stack>
          </ScrollArea>
        )}

        {/* Form screen */}
        {screen === 'form' && (
          <ScrollArea className="workflow-scroll">
            <Stack gap="md" p="md" className="workflow-form">
              <Card className="workflow-section-card">
                <Stack gap="md">
                  {selectedType === 'vacation' ? (
                    <>
                      <Select label={t('form.leaveType')} data={leaveTypeOptions} value={draft.leaveType} onChange={(v) => setDraft((p) => ({ ...p, leaveType: v ?? '연차' }))} />
                      <Group grow align="flex-start">
                        <TextInput label={t('form.startDate')} type="date" value={draft.startDate} onChange={(e) => setDraft((p) => ({ ...p, startDate: e.currentTarget.value }))} />
                        <TextInput label={t('form.endDate')} type="date" value={draft.endDate} onChange={(e) => setDraft((p) => ({ ...p, endDate: e.currentTarget.value }))} />
                      </Group>
                      <NumberInput label={t('form.days')} min={0.5} step={0.5} value={draft.days} onChange={(v) => setDraft((p) => ({ ...p, days: Number(v) || 0 }))} />
                      <Box className={`workflow-leave-balance ${draft.days > remaining ? 'danger' : ''}`}>
                        <Text size="sm" fw={700}>{t('form.balance', { n: balanceLabel })}</Text>
                        <Text size="sm">{t('form.usage', { days: draft.days, after: Math.max(remaining - draft.days, 0) })}</Text>
                        {draft.days > remaining && <Text size="sm">{t('form.balanceExceeded')}</Text>}
                      </Box>
                    </>
                  ) : (
                    <>
                      <TextInput label={selectedType === 'expense' ? t('form.vendorExpense') : t('form.vendorPurchase')} placeholder={t('form.vendorPlaceholder')} value={draft.vendor} onChange={(e) => setDraft((p) => ({ ...p, vendor: e.currentTarget.value }))} />
                      <TextInput label={t('form.category')} placeholder={selectedType === 'expense' ? t('form.categoryPhExpense') : t('form.categoryPhPurchase')} value={draft.category} onChange={(e) => setDraft((p) => ({ ...p, category: e.currentTarget.value }))} />
                      <NumberInput label={t('form.amount')} min={0} step={1000} thousandSeparator="," suffix={t('form.amountSuffix')} value={draft.amount} onChange={(v) => setDraft((p) => ({ ...p, amount: Number(v) || 0 }))} />
                    </>
                  )}
                  <Textarea label={t('form.reason')} minRows={3} placeholder={t('form.reasonPlaceholder')} value={draft.reason} onChange={(e) => setDraft((p) => ({ ...p, reason: e.currentTarget.value }))} />
                  <Group justify="space-between">
                    <Button variant="subtle" leftSection={<IconPlus size={15} />}>{t('form.addFile')}</Button>
                    <Button
                      variant="light"
                      leftSection={<IconSparkles size={15} />}
                      loading={aiDrafting}
                      onClick={() => void fillAiDraft()}
                    >
                      {t('form.aiDraft')}
                    </Button>
                  </Group>
                </Stack>
              </Card>

              <Card className="workflow-section-card">
                <Group justify="space-between" mb="sm">
                  <Text fw={800}>{t('form.approvalLine')}</Text>
                  <Button
                    size="xs"
                    variant="subtle"
                    leftSection={<IconPlus size={14} />}
                    disabled={approverOptions.length === 0 || approvers.length >= 5}
                    onClick={() => setApprovers((prev) => [...prev, { key: crypto.randomUUID(), approverId: '', required: false }])}
                  >
                    {t('form.add')}
                  </Button>
                </Group>
                {approverOptions.length === 0 ? (
                  <Alert color="yellow" variant="light" title={t('form.noPartners.title')}>
                    {t('form.noPartners.body')} <b>{t('toast.needPartners')}</b>
                  </Alert>
                ) : (
                  <Stack gap="sm">
                    {approvers.map((row, index) => (
                      <Group key={row.key} className="workflow-approver-row" wrap="nowrap">
                        <span className="workflow-step-index">{index + 1}</span>
                        <Select
                          aria-label={t('form.approverAria', { n: index + 1 })}
                          placeholder={t('form.approverPlaceholder')}
                          data={approverOptions}
                          value={row.approverId || null}
                          onChange={(value) => setApprovers((prev) => prev.map((item) => item.key === row.key ? { ...item, approverId: value ?? '' } : item))}
                          searchable
                          nothingFoundMessage={t('form.noMatch')}
                          style={{ flex: 1 }}
                        />
                        <Checkbox
                          label={row.required ? t('form.required') : t('form.optional')}
                          checked={row.required}
                          onChange={(e) => setApprovers((prev) => prev.map((item) => item.key === row.key ? { ...item, required: e.currentTarget.checked } : item))}
                        />
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          disabled={approvers.length <= 1}
                          onClick={() => setApprovers((prev) => prev.filter((item) => item.key !== row.key))}
                          aria-label={t('form.removeApprover')}
                        >
                          <IconTrash size={15} />
                        </ActionIcon>
                      </Group>
                    ))}
                  </Stack>
                )}
              </Card>

              <Group justify="flex-end">
                <Button variant="default" onClick={() => setScreen('type-select')}>{t('common.cancel')}</Button>
                <Button variant="filled"
                  onClick={() => void submitWorkflow()}
                  loading={submitting}
                  disabled={approverOptions.length === 0}
                >
                  {t('btn.newRequest')}
                </Button>
              </Group>
            </Stack>
          </ScrollArea>
        )}

        {/* Detail screen */}
        {screen === 'detail' && selected && (
          <ScrollArea className="workflow-scroll">
            <Stack gap="md" p="md">
              <Card className="workflow-detail-head">
                <Group justify="space-between" align="flex-start">
                  <div>
                    <Text size="xs" c="dimmed">#{selected.id.slice(0, 8)}</Text>
                    <Text fw={800} size="lg">{selected.title}</Text>
                  </div>
                  <Badge color={statusTone(selected.status).color} variant="light" leftSection={statusTone(selected.status).icon}>
                    {statusLabel(selected, t)}
                  </Badge>
                </Group>
                <WorkflowFlow request={selected} />
              </Card>

              <RequestSummary request={selected} />
              <HistoryTimeline request={selected} />

              {selected.requesterId === currentUserKey && ['draft', 'submitted'].includes(selected.status) && (
                <Button variant="subtle" color="red" leftSection={<IconTrash size={15} />} onClick={() => void cancelWorkflowItem()}>
                  {t('detail.cancelRequest')}
                </Button>
              )}

              {/* AI briefing card — shown to the approver whose turn it is */}
              {selected.status === 'submitted' && currentPendingStep(selected)?.approverId === currentUserKey && (
                <AiSummaryCard request={selected} />
              )}

              {selected.status === 'submitted' && currentPendingStep(selected)?.approverId === currentUserKey && (
                <Card className="workflow-section-card">
                  <Stack gap="md">
                    <Divider label={t('decision.divider')} labelPosition="left" />
                    <Textarea minRows={3} placeholder={t('decision.placeholder')} value={decisionComment} onChange={(e) => setDecisionComment(e.currentTarget.value)} />
                    <Group justify="space-between">
                      <Button variant="filled" className="workflow-reject-btn" leftSection={<IconX size={16} />} onClick={() => setDecisionIntent('rejected')}>{t('decision.reject')}</Button>
                      <Button variant="filled" className="workflow-approve-btn" leftSection={<IconCheck size={16} />} onClick={() => setDecisionIntent('approved')}>{t('decision.approve')}</Button>
                    </Group>
                  </Stack>
                </Card>
              )}
            </Stack>
          </ScrollArea>
        )}
      </div>

      {/* Decision confirmation modal */}
      <Modal
        opened={decisionIntent !== null}
        onClose={() => setDecisionIntent(null)}
        title={decisionIntent === 'approved' ? t('modal.approveTitle') : t('modal.rejectTitle')}
        centered
      >
        <Stack gap="md">
          <Text>{decisionIntent === 'approved' ? t('modal.approveConfirm') : t('modal.rejectConfirm')}</Text>
          {decisionIntent === 'rejected' && (
            <Textarea
              label={t('modal.rejectComment')}
              minRows={3}
              value={decisionComment}
              onChange={(e) => setDecisionComment(e.currentTarget.value)}
              error={decisionIntent === 'rejected' && !decisionComment.trim() ? t('modal.rejectCommentRequired') : undefined}
            />
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDecisionIntent(null)}>{t('common.cancel')}</Button>
            <Button variant="filled"
              color={decisionIntent === 'approved' ? 'green' : 'red'}
              loading={decisionSubmitting}
              onClick={() => void decideWorkflow()}
            >
              {decisionIntent === 'approved' ? t('decision.approve') : t('decision.reject')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Box>
  );
}
