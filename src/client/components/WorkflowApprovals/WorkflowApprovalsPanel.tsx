import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
  Group,
  Modal,
  NumberInput,
  ScrollArea,
  Select,
  Stack,
  Table,
  Tabs,
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
  IconRefresh,
  IconSend,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import DrawerSubHeader from '../DrawerSubHeader';
import { fetchMe } from '../../utils/api';
import { useI18n } from '../../i18n/I18nProvider';
import type {
  WorkflowRequest,
  WorkflowStatus,
  WorkflowType,
} from '../../../server/workflow-approvals';
import './WorkflowApprovalsPanel.css';

type TFunc = ReturnType<typeof useI18n>['t'];

interface Props {
  visible: boolean;
  onClose: () => void;
}

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

const TYPE_META: Record<WorkflowType, { labelKey: string; shortKey: string; descKey: string; color: string; icon: React.ReactNode }> = {
  vacation: {
    labelKey: 'workflow.type.vacation.label',
    shortKey: 'workflow.type.vacation.short',
    descKey: 'workflow.type.vacation.desc',
    color: 'cyan',
    icon: <IconCalendar size={24} stroke={1.7} />,
  },
  expense: {
    labelKey: 'workflow.type.expense.label',
    shortKey: 'workflow.type.expense.short',
    descKey: 'workflow.type.expense.desc',
    color: 'yellow',
    icon: <IconReceipt2 size={24} stroke={1.7} />,
  },
  purchase: {
    labelKey: 'workflow.type.purchase.label',
    shortKey: 'workflow.type.purchase.short',
    descKey: 'workflow.type.purchase.desc',
    color: 'violet',
    icon: <IconClipboardList size={24} stroke={1.7} />,
  },
};

const APPROVER_KEYS: Record<string, string> = {
  'team-leader@email.com': 'workflow.approver.teamLeader',
  'dept-head@email.com': 'workflow.approver.deptHead',
  'finance@email.com': 'workflow.approver.finance',
  'hr@email.com': 'workflow.approver.hr',
  'ceo@email.com': 'workflow.approver.ceo',
};

function approverOptions(t: TFunc) {
  return Object.entries(APPROVER_KEYS).map(([value, key]) => ({ value, label: t(key as Parameters<typeof t>[0]) }));
}

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

function dateLabel(iso?: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function dateTimeLabel(iso?: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

function moneyLabel(value: unknown, t: TFunc): string {
  const n = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(n) ? t('workflow.currency.won', { n: n.toLocaleString('ko-KR') }) : '-';
}

function approverName(id: string, t: TFunc): string {
  const key = APPROVER_KEYS[id];
  return key ? t(key as Parameters<typeof t>[0]) : id;
}

function currentPendingStep(req: WorkflowRequest) {
  return req.approvers.find((step) => step.status === 'pending');
}

function statusLabel(req: WorkflowRequest, t: TFunc): string {
  if (req.status === 'approved') return t('workflow.status.approved');
  if (req.status === 'rejected') return t('workflow.status.rejected');
  if (req.status === 'cancelled') return t('workflow.status.cancelled');
  if (req.status === 'draft') return t('workflow.status.draft');
  const step = currentPendingStep(req);
  return step ? t('workflow.status.inProgressStep', { n: step.order }) : t('workflow.status.inProgress');
}

function statusTone(status: WorkflowStatus): { color: string; icon: React.ReactNode } {
  if (status === 'approved') return { color: 'green', icon: <IconCheck size={14} /> };
  if (status === 'rejected' || status === 'cancelled') return { color: 'red', icon: <IconX size={14} /> };
  if (status === 'draft') return { color: 'gray', icon: <IconClock size={14} /> };
  return { color: 'yellow', icon: <IconClock size={14} /> };
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function buildTitle(type: WorkflowType, draft: WorkflowDraft): string {
  if (type === 'vacation') return `${draft.leaveType} 신청 (${draft.startDate}~${draft.endDate})`;
  if (type === 'expense') return `${draft.category || '지출'} 결재${draft.vendor ? ` - ${draft.vendor}` : ''}`;
  return `${draft.category || '구매'} 품의${draft.vendor ? ` - ${draft.vendor}` : ''}`;
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

function WorkflowFlow({ request }: { request: WorkflowRequest }) {
  const { t } = useI18n();
  return (
    <div className="workflow-flow" aria-label={t('workflow.flow.ariaLabel')}>
      <div className="workflow-node requester">
        <div className="workflow-avatar">{t('workflow.flow.requesterInitial')}</div>
        <Text size="xs" fw={700}>{t('workflow.flow.requester')}</Text>
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
              <Text size="xs" fw={700}>{t('workflow.flow.orderStep', { n: step.order })}</Text>
              <Text size="xs" c="dimmed" truncate>{approverName(step.approverId, t)}</Text>
              {step.decidedAt && <Text size="xs" c="dimmed">{dateLabel(step.decidedAt)}</Text>}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

function RequestSummary({ request }: { request: WorkflowRequest }) {
  const { t } = useI18n();
  const data = request.data ?? {};
  const type = request.type;
  return (
    <Card className="workflow-section-card">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <div>
            <Text fw={700}>{t('workflow.summary.title')}</Text>
            <Text size="sm" c="dimmed">{request.description || t('workflow.summary.noDescription')}</Text>
          </div>
          <Badge color={TYPE_META[type].color} variant="light">{t(TYPE_META[type].shortKey as Parameters<typeof t>[0])}</Badge>
        </Group>
        <div className="workflow-detail-grid">
          {type === 'vacation' ? (
            <>
              <div>
                <Text size="xs" c="dimmed">{t('workflow.field.type')}</Text>
                <Text fw={700}>{String(data.leaveType ?? '연차')}</Text>
              </div>
              <div>
                <Text size="xs" c="dimmed">{t('workflow.field.period')}</Text>
                <Text fw={700}>{String(data.startDate ?? '-')} ~ {String(data.endDate ?? '-')}</Text>
              </div>
              <div>
                <Text size="xs" c="dimmed">{t('workflow.field.days')}</Text>
                <Text fw={700}>{t('workflow.summary.daysValue', { n: String(data.days ?? '-') })}</Text>
              </div>
            </>
          ) : (
            <>
              <div>
                <Text size="xs" c="dimmed">{t('workflow.field.category')}</Text>
                <Text fw={700}>{String(data.category ?? '-')}</Text>
              </div>
              <div>
                <Text size="xs" c="dimmed">{t('workflow.field.vendor')}</Text>
                <Text fw={700}>{String(data.vendor ?? '-')}</Text>
              </div>
              <div>
                <Text size="xs" c="dimmed">{t('workflow.field.amount')}</Text>
                <Text fw={700}>{moneyLabel(data.amount, t)}</Text>
              </div>
            </>
          )}
        </div>
      </Stack>
    </Card>
  );
}

function HistoryTimeline({ request }: { request: WorkflowRequest }) {
  const { t } = useI18n();
  const items = [
    { key: 'submit', at: request.submittedAt ?? request.createdAt, title: t('workflow.history.submit'), body: t('workflow.history.submittedBy', { name: request.requesterId }), color: 'blue', icon: <IconSend size={13} /> },
    ...request.approvers
      .filter((step) => step.status !== 'pending')
      .map((step) => ({
        key: `${step.order}-${step.status}`,
        at: step.decidedAt ?? request.updatedAt,
        title: step.status === 'approved' ? t('workflow.decision.approve') : t('workflow.decision.reject'),
        body: `${t('workflow.history.stepApprover', { n: step.order, name: approverName(step.approverId, t) })}${step.comment ? ` · ${step.comment}` : ''}`,
        color: step.status === 'approved' ? 'green' : 'red',
        icon: step.status === 'approved' ? <IconCheck size={13} /> : <IconX size={13} />,
      })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <Card className="workflow-section-card">
      <Text fw={700} mb="sm">{t('workflow.history.title')}</Text>
      <Timeline active={items.length - 1} bulletSize={24} lineWidth={2}>
        {items.map((item) => (
          <Timeline.Item key={item.key} bullet={item.icon} color={item.color} title={item.title}>
            <Text size="sm">{item.body}</Text>
            <Text size="xs" c="dimmed">{dateTimeLabel(item.at)}</Text>
          </Timeline.Item>
        ))}
      </Timeline>
    </Card>
  );
}

export default function WorkflowApprovalsPanel({ visible, onClose }: Props) {
  const { t } = useI18n();
  const [screen, setScreen] = useState<Screen>('list');
  const [tab, setTab] = useState<InboxTab>('sent');
  const [currentUserKey, setCurrentUserKey] = useState('__local__');
  const [items, setItems] = useState<WorkflowRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedType, setSelectedType] = useState<WorkflowType>('vacation');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WorkflowDraft>(DEFAULT_DRAFT);
  const [approvers, setApprovers] = useState<ApproverDraft[]>([
    { key: '1', approverId: 'team-leader@email.com', required: true },
    { key: '2', approverId: 'dept-head@email.com', required: true },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [decisionIntent, setDecisionIntent] = useState<DecisionIntent>(null);
  const [decisionComment, setDecisionComment] = useState('');
  const [decisionSubmitting, setDecisionSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [me, workflows] = await Promise.all([
        fetchMe().catch(() => null),
        apiJson<WorkflowRequest[]>('/api/workflows?role=all&limit=100'),
      ]);
      setCurrentUserKey(me?.email || '__local__');
      setItems(workflows);
    } catch (err) {
      notifications.show({ color: 'red', message: t('workflow.error.loadList', { msg: (err as Error).message }) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  useEffect(() => {
    if (!visible) return;
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
  }, [visible]);

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
      category: type === 'expense' ? '식대' : type === 'purchase' ? '장비 구매' : '',
    });
    setApprovers([
      { key: crypto.randomUUID(), approverId: 'team-leader@email.com', required: true },
      { key: crypto.randomUUID(), approverId: type === 'expense' ? 'finance@email.com' : 'dept-head@email.com', required: true },
    ]);
    setScreen('form');
  }

  async function submitWorkflow() {
    const approverIds = approvers.map((row) => row.approverId).filter(Boolean);
    if (approverIds.length === 0 || approvers.some((row) => row.required && !row.approverId)) {
      notifications.show({ color: 'red', message: t('workflow.error.approverRequired') });
      return;
    }
    if (!draft.reason.trim()) {
      notifications.show({ color: 'red', message: t('workflow.error.reasonRequired') });
      return;
    }
    setSubmitting(true);
    try {
      const created = await apiJson<WorkflowRequest>('/api/workflows', {
        method: 'POST',
        body: JSON.stringify({
          type: selectedType,
          title: buildTitle(selectedType, draft),
          description: draft.reason,
          data: buildData(selectedType, draft),
          approverIds,
        }),
      });
      const submitted = await apiJson<WorkflowRequest>(`/api/workflows/${created.id}/submit`, { method: 'POST' });
      setItems((prev) => [submitted, ...prev.filter((item) => item.id !== submitted.id)]);
      setSelectedId(submitted.id);
      setScreen('detail');
      setTab('sent');
      notifications.show({ color: 'green', message: t('workflow.success.submitted') });
    } catch (err) {
      notifications.show({ color: 'red', message: t('workflow.error.submitFailed', { msg: (err as Error).message }) });
    } finally {
      setSubmitting(false);
    }
  }

  async function decideWorkflow() {
    if (!selected || !decisionIntent) return;
    if (decisionIntent === 'rejected' && !decisionComment.trim()) {
      notifications.show({ color: 'red', message: t('workflow.error.commentRequired') });
      return;
    }
    setDecisionSubmitting(true);
    try {
      const updated = await apiJson<WorkflowRequest>(`/api/workflows/${selected.id}/decide`, {
        method: 'POST',
        body: JSON.stringify({ decision: decisionIntent, comment: decisionComment.trim() }),
      });
      setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setDecisionIntent(null);
      setDecisionComment('');
      notifications.show({ color: decisionIntent === 'approved' ? 'green' : 'red', message: decisionIntent === 'approved' ? t('workflow.success.approved') : t('workflow.success.rejected') });
    } catch (err) {
      notifications.show({ color: 'red', message: t('workflow.error.decideFailed', { msg: (err as Error).message }) });
    } finally {
      setDecisionSubmitting(false);
    }
  }

  async function cancelWorkflow() {
    if (!selected) return;
    if (!window.confirm(t('workflow.confirm.cancel'))) return;
    try {
      const updated = await apiJson<WorkflowRequest>(`/api/workflows/${selected.id}`, { method: 'DELETE' });
      setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      notifications.show({ color: 'gray', message: t('workflow.success.cancelled') });
    } catch (err) {
      notifications.show({ color: 'red', message: t('workflow.error.cancelFailed', { msg: (err as Error).message }) });
    }
  }

  function openDetail(item: WorkflowRequest) {
    setSelectedId(item.id);
    setScreen('detail');
  }

  if (!visible) return null;

  return (
    <Stack className="workflow-panel" gap={0}>
      <DrawerSubHeader
        title={screen === 'list' ? t('workflow.title.inbox') : screen === 'type-select' ? t('workflow.title.newRequest') : screen === 'form' ? t(TYPE_META[selectedType].labelKey as Parameters<typeof t>[0]) : selected?.title ?? t('workflow.title.detail')}
        onBack={() => {
          if (screen === 'list') onClose();
          else if (screen === 'detail') setScreen('list');
          else if (screen === 'form') setScreen('type-select');
          else setScreen('list');
        }}
        rightSlot={screen === 'list' ? (
          <Group gap="xs">
            <ActionIcon variant="subtle" onClick={() => void load()} loading={loading} aria-label={t('workflow.refresh')}>
              <IconRefresh size={16} />
            </ActionIcon>
            <Button leftSection={<IconPlus size={15} />} onClick={() => setScreen('type-select')}>{t('workflow.title.newRequest')}</Button>
          </Group>
        ) : undefined}
      />

      {screen === 'list' && (
        <ScrollArea className="workflow-scroll">
          <Stack gap="md" p="md">
            <Tabs value={tab} onChange={(value) => setTab((value as InboxTab) ?? 'sent')} variant="default" className="workflow-tabs">
              <Tabs.List grow>
                <Tabs.Tab value="sent">{t('workflow.tab.sent')}</Tabs.Tab>
                <Tabs.Tab value="received">
                  <Group gap={6} wrap="nowrap" justify="center">
                    <span>{t('workflow.tab.received')}</span>
                    {lists.received.length > 0 && <Badge size="xs" color="jarvis" variant="filled">{lists.received.length}</Badge>}
                  </Group>
                </Tabs.Tab>
                <Tabs.Tab value="done">{t('workflow.tab.done')}</Tabs.Tab>
              </Tabs.List>
            </Tabs>

            <Card className="workflow-list-card">
              {visibleRows.length === 0 ? (
                <Box className="workflow-empty">
                  <IconFileInvoice size={28} stroke={1.5} />
                  <Text fw={700}>{t('workflow.empty.title')}</Text>
                  <Text size="sm" c="dimmed">{t('workflow.empty.desc')}</Text>
                </Box>
              ) : (
                <Table highlightOnHover verticalSpacing="sm" className="workflow-table">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{t('workflow.field.type')}</Table.Th>
                      <Table.Th>{t('workflow.field.title')}</Table.Th>
                      <Table.Th>{t('workflow.field.status')}</Table.Th>
                      <Table.Th>{t('workflow.field.createdAt')}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {visibleRows.map((item) => {
                      const tone = statusTone(item.status);
                      return (
                        <Table.Tr key={item.id} onClick={() => openDetail(item)} className="workflow-row">
                          <Table.Td><Badge size="sm" variant="light" color={TYPE_META[item.type].color}>{t(TYPE_META[item.type].shortKey as Parameters<typeof t>[0])}</Badge></Table.Td>
                          <Table.Td>
                            <Text fw={700} size="sm" lineClamp={1}>{item.title}</Text>
                            <Text size="xs" c="dimmed" lineClamp={1}>{item.description || item.id}</Text>
                          </Table.Td>
                          <Table.Td>
                            <Badge color={tone.color} variant="light" leftSection={tone.icon}>{statusLabel(item, t)}</Badge>
                          </Table.Td>
                          <Table.Td><Text size="sm">{dateLabel(item.createdAt)}</Text></Table.Td>
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

      {screen === 'type-select' && (
        <ScrollArea className="workflow-scroll">
          <Stack gap="md" p="md">
            <div className="workflow-type-grid">
              {(Object.keys(TYPE_META) as WorkflowType[]).map((type) => (
                <button key={type} className="workflow-type-card" onClick={() => resetForm(type)}>
                  <span className="workflow-type-icon">{TYPE_META[type].icon}</span>
                  <Text fw={800}>{t(TYPE_META[type].shortKey as Parameters<typeof t>[0])}</Text>
                  <Text size="sm" c="dimmed">{t(TYPE_META[type].descKey as Parameters<typeof t>[0])}</Text>
                </button>
              ))}
            </div>
          </Stack>
        </ScrollArea>
      )}

      {screen === 'form' && (
        <ScrollArea className="workflow-scroll">
          <Stack gap="md" p="md" className="workflow-form">
            <Card className="workflow-section-card">
              <Stack gap="md">
                {selectedType === 'vacation' ? (
                  <>
                    <Select label={t('workflow.field.type')} data={['연차', '반차(오전)', '반차(오후)', '병가', '특별휴가']} value={draft.leaveType} onChange={(v) => setDraft((p) => ({ ...p, leaveType: v ?? '연차' }))} />
                    <Group grow align="flex-start">
                      <TextInput label={t('workflow.field.startDate')} type="date" value={draft.startDate} onChange={(e) => setDraft((p) => ({ ...p, startDate: e.currentTarget.value }))} />
                      <TextInput label={t('workflow.field.endDate')} type="date" value={draft.endDate} onChange={(e) => setDraft((p) => ({ ...p, endDate: e.currentTarget.value }))} />
                    </Group>
                    <NumberInput label={t('workflow.field.days')} min={0.5} step={0.5} value={draft.days} onChange={(v) => setDraft((p) => ({ ...p, days: Number(v) || 0 }))} />
                    <Box className={`workflow-leave-balance ${draft.days > 8 ? 'danger' : ''}`}>
                      <Text size="sm" fw={700}>{t('workflow.leaveBalance.remaining', { n: 8 })}</Text>
                      <Text size="sm">{t('workflow.leaveBalance.usage', { applied: draft.days, after: Math.max(8 - draft.days, 0) })}</Text>
                      {draft.days > 8 && <Text size="sm">{t('workflow.leaveBalance.exceeded')}</Text>}
                    </Box>
                  </>
                ) : (
                  <>
                    <TextInput label={selectedType === 'expense' ? t('workflow.field.expenseSource') : t('workflow.field.purchaseSource')} placeholder={t('workflow.field.vendorPlaceholder')} value={draft.vendor} onChange={(e) => setDraft((p) => ({ ...p, vendor: e.currentTarget.value }))} />
                    <TextInput label={t('workflow.field.category')} placeholder={selectedType === 'expense' ? t('workflow.field.categoryPlaceholderExpense') : t('workflow.field.categoryPlaceholderPurchase')} value={draft.category} onChange={(e) => setDraft((p) => ({ ...p, category: e.currentTarget.value }))} />
                    <NumberInput label={t('workflow.field.amount')} min={0} step={1000} thousandSeparator="," suffix={t('workflow.currency.suffix')} value={draft.amount} onChange={(v) => setDraft((p) => ({ ...p, amount: Number(v) || 0 }))} />
                  </>
                )}
                <Textarea label={t('workflow.field.reason')} minRows={3} placeholder={t('workflow.field.reasonPlaceholder')} value={draft.reason} onChange={(e) => setDraft((p) => ({ ...p, reason: e.currentTarget.value }))} />
                <Button variant="subtle" leftSection={<IconPlus size={15} />}>{t('workflow.button.addFile')}</Button>
              </Stack>
            </Card>

            <Card className="workflow-section-card">
              <Group justify="space-between" mb="sm">
                <Text fw={800}>{t('workflow.field.approvalLine')}</Text>
                <Button
                  size="xs"
                  variant="subtle"
                  leftSection={<IconPlus size={14} />}
                  disabled={approvers.length >= 5}
                  onClick={() => setApprovers((prev) => [...prev, { key: crypto.randomUUID(), approverId: '', required: false }])}
                >
                  {t('workflow.button.add')}
                </Button>
              </Group>
              <Stack gap="sm">
                {approvers.map((row, index) => (
                  <Group key={row.key} className="workflow-approver-row" wrap="nowrap">
                    <span className="workflow-step-index">{index + 1}</span>
                    <Select
                      aria-label={t('workflow.field.approverOrdinal', { n: index + 1 })}
                      placeholder={t('workflow.field.approverPlaceholder')}
                      data={approverOptions(t)}
                      value={row.approverId || null}
                      onChange={(value) => setApprovers((prev) => prev.map((item) => item.key === row.key ? { ...item, approverId: value ?? '' } : item))}
                      searchable
                      style={{ flex: 1 }}
                    />
                    <Checkbox
                      label={row.required ? t('workflow.field.required') : t('workflow.field.optional')}
                      checked={row.required}
                      onChange={(e) => setApprovers((prev) => prev.map((item) => item.key === row.key ? { ...item, required: e.currentTarget.checked } : item))}
                    />
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      disabled={approvers.length <= 1}
                      onClick={() => setApprovers((prev) => prev.filter((item) => item.key !== row.key))}
                      aria-label={t('workflow.button.deleteApprover')}
                    >
                      <IconTrash size={15} />
                    </ActionIcon>
                  </Group>
                ))}
              </Stack>
            </Card>

            <Group justify="flex-end">
              <Button variant="default" onClick={() => setScreen('type-select')}>{t('common.cancel')}</Button>
              <Button onClick={() => void submitWorkflow()} loading={submitting}>{t('workflow.title.newRequest')}</Button>
            </Group>
          </Stack>
        </ScrollArea>
      )}

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
              <Button variant="subtle" color="red" leftSection={<IconTrash size={15} />} onClick={() => void cancelWorkflow()}>
                {t('workflow.button.cancelRequest')}
              </Button>
            )}

            {selected.status === 'submitted' && currentPendingStep(selected)?.approverId === currentUserKey && (
              <Card className="workflow-section-card">
                <Stack gap="md">
                  <Divider label={t('workflow.field.opinion')} labelPosition="left" />
                  <Textarea minRows={3} placeholder={t('workflow.field.opinionPlaceholder')} value={decisionComment} onChange={(e) => setDecisionComment(e.currentTarget.value)} />
                  <Group justify="space-between">
                    <Button className="workflow-reject-btn" leftSection={<IconX size={16} />} onClick={() => setDecisionIntent('rejected')}>{t('workflow.decision.reject')}</Button>
                    <Button className="workflow-approve-btn" leftSection={<IconCheck size={16} />} onClick={() => setDecisionIntent('approved')}>{t('workflow.decision.approve')}</Button>
                  </Group>
                </Stack>
              </Card>
            )}
          </Stack>
        </ScrollArea>
      )}

      <Modal
        opened={decisionIntent !== null}
        onClose={() => setDecisionIntent(null)}
        title={decisionIntent === 'approved' ? t('workflow.modal.approveTitle') : t('workflow.modal.rejectTitle')}
        centered
      >
        <Stack gap="md">
          <Text>{decisionIntent === 'approved' ? t('workflow.modal.approveConfirm') : t('workflow.modal.rejectConfirm')}</Text>
          {decisionIntent === 'rejected' && (
            <Textarea
              label={t('workflow.modal.rejectCommentLabel')}
              minRows={3}
              value={decisionComment}
              onChange={(e) => setDecisionComment(e.currentTarget.value)}
              error={decisionIntent === 'rejected' && !decisionComment.trim() ? t('workflow.modal.rejectCommentRequired') : undefined}
            />
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDecisionIntent(null)}>{t('common.cancel')}</Button>
            <Button
              color={decisionIntent === 'approved' ? 'green' : 'red'}
              loading={decisionSubmitting}
              onClick={() => void decideWorkflow()}
            >
              {decisionIntent === 'approved' ? t('workflow.decision.approve') : t('workflow.decision.reject')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
