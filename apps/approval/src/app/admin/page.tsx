"use client";

import React, { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Card,
  Group,
  NumberInput,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  listBalances,
  upsertBalance,
  listAdmins,
  addAdmin,
  getAuditLog,
  overrideWorkflow,
} from '../../lib/workflow-api';
import type { VacationBalance, ApprovalAdmin, WorkflowRequest } from '../../lib/workflow-api';
import { useI18n } from '../../lib/i18n';

function dateLabel(iso: string | undefined, intl: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat(intl, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d);
}

function BalancesTab() {
  const { t, intl } = useI18n();
  const [year, setYear] = useState(new Date().getFullYear());
  const [rows, setRows] = useState<VacationBalance[]>([]);
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState('');
  const [total, setTotal] = useState<number>(15);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listBalances(year));
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('403')) {
        notifications.show({ color: 'red', message: t('admin.noAccessAdmin') });
      } else {
        notifications.show({ color: 'red', message: t('admin.loadFail', { error: msg }) });
      }
    } finally {
      setLoading(false);
    }
  }, [year, t]);

  useEffect(() => { void load(); }, [load]);

  const handleSave = async () => {
    if (!userId.trim()) { notifications.show({ color: 'red', message: t('admin.enterUserEmail') }); return; }
    setSaving(true);
    try {
      await upsertBalance({ userId: userId.trim(), year, totalAllowed: total });
      notifications.show({ color: 'green', message: t('admin.saved') });
      setUserId('');
      void load();
    } catch (err) {
      notifications.show({ color: 'red', message: t('admin.saveFail', { error: (err as Error).message }) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack gap="md">
      <Group>
        <NumberInput label={t('admin.year')} value={year} onChange={(v) => setYear(Number(v) || new Date().getFullYear())} min={2020} max={2099} w={100} />
        <Button variant="light" onClick={() => void load()} loading={loading} style={{ alignSelf: 'flex-end' }}>{t('admin.query')}</Button>
      </Group>
      <Card withBorder p={0} style={{ overflow: 'hidden' }}>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('admin.th.user')}</Table.Th>
              <Table.Th>{t('admin.th.year')}</Table.Th>
              <Table.Th>{t('admin.th.totalAllowed')}</Table.Th>
              <Table.Th>{t('admin.th.used')}</Table.Th>
              <Table.Th>{t('admin.th.remaining')}</Table.Th>
              <Table.Th>{t('admin.th.updated')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.length === 0 ? (
              <Table.Tr><Table.Td colSpan={6}><Text c="dimmed" ta="center" py="md">{t('admin.noData')}</Text></Table.Td></Table.Tr>
            ) : rows.map((r) => (
              <Table.Tr key={`${r.userId}-${r.year}`}>
                <Table.Td>{r.userId}</Table.Td>
                <Table.Td>{r.year}</Table.Td>
                <Table.Td>{t('unit.days', { n: r.totalAllowed })}</Table.Td>
                <Table.Td>{t('unit.days', { n: r.used })}</Table.Td>
                <Table.Td>{t('unit.days', { n: r.remaining })}</Table.Td>
                <Table.Td>{dateLabel(r.updatedAt, intl)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      <Card withBorder>
        <Text fw={700} mb="sm">{t('admin.balanceSet')}</Text>
        <Group align="flex-end">
          <TextInput label={t('admin.email')} placeholder="user@example.com" value={userId} onChange={(e) => setUserId(e.currentTarget.value)} style={{ flex: 1 }} />
          <NumberInput label={t('admin.totalDays')} value={total} onChange={(v) => setTotal(Number(v) || 15)} min={0} max={365} w={120} />
          <Button variant="filled" onClick={() => void handleSave()} loading={saving}>{t('admin.save')}</Button>
        </Group>
      </Card>
    </Stack>
  );
}

function AdminsTab() {
  const { t, intl } = useI18n();
  const [rows, setRows] = useState<ApprovalAdmin[]>([]);
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listAdmins());
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('403')) {
        notifications.show({ color: 'red', message: t('admin.noAccess') });
      } else {
        notifications.show({ color: 'red', message: t('admin.loadFail', { error: msg }) });
      }
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const handleAdd = async () => {
    if (!userId.trim()) { notifications.show({ color: 'red', message: t('admin.enterEmail') }); return; }
    setSaving(true);
    try {
      await addAdmin({ userId: userId.trim(), role: 'approver' });
      notifications.show({ color: 'green', message: t('admin.added') });
      setUserId('');
      void load();
    } catch (err) {
      notifications.show({ color: 'red', message: t('admin.addFail', { error: (err as Error).message }) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack gap="md">
      <Button variant="light" onClick={() => void load()} loading={loading} style={{ alignSelf: 'flex-start' }}>{t('admin.refresh')}</Button>
      <Card withBorder p={0} style={{ overflow: 'hidden' }}>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('admin.th.user')}</Table.Th>
              <Table.Th>{t('admin.th.role')}</Table.Th>
              <Table.Th>{t('admin.th.managedTypes')}</Table.Th>
              <Table.Th>{t('admin.th.createdAt')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.length === 0 ? (
              <Table.Tr><Table.Td colSpan={4}><Text c="dimmed" ta="center" py="md">{t('admin.noData')}</Text></Table.Td></Table.Tr>
            ) : rows.map((r) => (
              <Table.Tr key={r.userId}>
                <Table.Td>{r.userId}</Table.Td>
                <Table.Td>{r.role}</Table.Td>
                <Table.Td>{r.managedTypes?.join(', ') ?? t('admin.all')}</Table.Td>
                <Table.Td>{dateLabel(r.createdAt, intl)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      <Card withBorder>
        <Text fw={700} mb="sm">{t('admin.addAdmin')}</Text>
        <Group align="flex-end">
          <TextInput label={t('admin.email')} placeholder="admin@example.com" value={userId} onChange={(e) => setUserId(e.currentTarget.value)} style={{ flex: 1 }} />
          <Button variant="filled" onClick={() => void handleAdd()} loading={saving}>{t('admin.add')}</Button>
        </Group>
      </Card>
    </Stack>
  );
}

function AuditLogTab() {
  const { t, intl } = useI18n();
  const [rows, setRows] = useState<WorkflowRequest[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await getAuditLog(100));
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('403')) {
        notifications.show({ color: 'red', message: t('admin.noAccess') });
      } else {
        notifications.show({ color: 'red', message: t('admin.loadFail', { error: msg }) });
      }
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  return (
    <Stack gap="md">
      <Button variant="light" onClick={() => void load()} loading={loading} style={{ alignSelf: 'flex-start' }}>{t('admin.refresh')}</Button>
      <Card withBorder p={0} style={{ overflow: 'hidden' }}>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('admin.th.id')}</Table.Th>
              <Table.Th>{t('admin.th.type')}</Table.Th>
              <Table.Th>{t('admin.th.title')}</Table.Th>
              <Table.Th>{t('admin.th.status')}</Table.Th>
              <Table.Th>{t('admin.th.requester')}</Table.Th>
              <Table.Th>{t('admin.th.resolvedAt')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.length === 0 ? (
              <Table.Tr><Table.Td colSpan={6}><Text c="dimmed" ta="center" py="md">{t('admin.noData')}</Text></Table.Td></Table.Tr>
            ) : rows.map((r) => (
              <Table.Tr key={r.id}>
                <Table.Td><Text size="xs" c="dimmed">#{r.id.slice(0, 8)}</Text></Table.Td>
                <Table.Td>{r.type}</Table.Td>
                <Table.Td><Text size="sm" lineClamp={1}>{r.title}</Text></Table.Td>
                <Table.Td>{r.status}</Table.Td>
                <Table.Td><Text size="xs">{r.requesterId}</Text></Table.Td>
                <Table.Td>{dateLabel(r.resolvedAt ?? r.updatedAt, intl)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>
    </Stack>
  );
}

function OverrideTab() {
  const { t } = useI18n();
  const [reqId, setReqId] = useState('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleOverride = async (decision: 'approved' | 'rejected') => {
    if (!reqId.trim()) { notifications.show({ color: 'red', message: t('admin.enterReqId') }); return; }
    setSubmitting(true);
    try {
      await overrideWorkflow(reqId.trim(), { decision, comment: comment.trim() });
      notifications.show({ color: 'green', message: t('admin.overrideDone', { decision }) });
      setReqId('');
      setComment('');
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('403')) {
        notifications.show({ color: 'red', message: t('admin.noAccess') });
      } else {
        notifications.show({ color: 'red', message: t('admin.overrideFail', { error: msg }) });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card withBorder>
      <Stack gap="md">
        <Text size="sm" c="dimmed">{t('admin.overrideDesc')}</Text>
        <TextInput label={t('admin.reqId')} placeholder={t('admin.reqIdPlaceholder')} value={reqId} onChange={(e) => setReqId(e.currentTarget.value)} />
        <TextInput label={t('admin.reason')} placeholder={t('admin.reasonPlaceholder')} value={comment} onChange={(e) => setComment(e.currentTarget.value)} />
        <Group>
          <Button variant="filled" color="green" loading={submitting} onClick={() => void handleOverride('approved')}>{t('admin.forceApprove')}</Button>
          <Button variant="filled" color="red" loading={submitting} onClick={() => void handleOverride('rejected')}>{t('admin.forceReject')}</Button>
        </Group>
      </Stack>
    </Card>
  );
}

export default function AdminPage() {
  const { t } = useI18n();
  return (
    <Box p="xl" style={{ maxWidth: 960, margin: '0 auto' }}>
      <Title order={3} mb="lg">{t('admin.title')}</Title>
      <Tabs defaultValue="balances">
        <Tabs.List mb="md">
          <Tabs.Tab value="balances">{t('admin.tab.balances')}</Tabs.Tab>
          <Tabs.Tab value="admins">{t('admin.tab.admins')}</Tabs.Tab>
          <Tabs.Tab value="audit">{t('admin.tab.audit')}</Tabs.Tab>
          <Tabs.Tab value="override">{t('admin.tab.override')}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="balances"><BalancesTab /></Tabs.Panel>
        <Tabs.Panel value="admins"><AdminsTab /></Tabs.Panel>
        <Tabs.Panel value="audit"><AuditLogTab /></Tabs.Panel>
        <Tabs.Panel value="override"><OverrideTab /></Tabs.Panel>
      </Tabs>
    </Box>
  );
}
