import React, { useEffect, useState } from 'react';
import {
  Modal, Stack, Select, Group, Button, Text,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { fetchPartners, sendFriendScheduleRequest, type Partner } from '../../utils/api';
import { notifications } from '@mantine/notifications';
import { useT } from '../../i18n/I18nProvider';

interface Props {
  opened: boolean;
  defaultFrom?: Date;
  defaultTo?: Date;
  onClose: () => void;
  onSent?: () => void;
}

function toIso(v: Date | string | null): string {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

export default function FriendScheduleRequestModal({ opened, defaultFrom, defaultTo, onClose, onSent }: Props) {
  const t = useT();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [from, setFrom] = useState<Date | null>(null);
  const [to, setTo] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    setError(null);
    setBusy(false);
    setFrom(defaultFrom ?? new Date());
    setTo(defaultTo ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
    void (async () => {
      const list = await fetchPartners();
      const active = list.filter((p) => p.active);
      setPartners(active);
      if (active.length && !partnerId) setPartnerId(active[0].id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, defaultFrom, defaultTo]);

  const handleSend = async () => {
    if (!partnerId) { setError(t('calendar.selectFriendRequired')); return; }
    if (!from || !to) { setError(t('calendar.periodRequired')); return; }
    const fromIso = toIso(from);
    const toIsoStr = toIso(to);
    if (!fromIso || !toIsoStr) { setError(t('calendar.periodInvalid')); return; }
    if (new Date(toIsoStr).getTime() < new Date(fromIso).getTime()) {
      setError(t('calendar.endAfterStartDate')); return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await sendFriendScheduleRequest({ partnerId, from: fromIso, to: toIsoStr });
      if (!result.ok) {
        setError(result.error ?? t('calendar.requestSendFailed'));
        return;
      }
      notifications.show({
        title: t('calendar.scheduleShareRequestSent'),
        message: t('calendar.scheduleShareRequestSentDesc'),
        color: 'jarvis',
      });
      onSent?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t('calendar.friendScheduleRequestTitle')}
      size="md"
      centered
      overlayProps={{ backgroundOpacity: 0.8, blur: 2 }}
    >
      <Stack gap="sm">
        <Select
          label={t('calendar.defaultFriendLabel')}
          placeholder={t('calendar.selectColleaguePlaceholder')}
          value={partnerId}
          onChange={setPartnerId}
          data={partners.map((p) => ({
            value: p.id,
            label: `${p.companyName}${p.contactName ? ` — ${p.contactName}` : ''}${p.secretaryName ? ` (${p.secretaryName})` : ''}`,
          }))}
          searchable
          nothingFoundMessage={t('calendar.noFriendsRegistered')}
          required
        />
        <Group grow align="flex-start">
          <DatePickerInput
            label={t('calendar.startDateLabel')}
            value={from}
            onChange={(v) => setFrom(v ? new Date(v) : null)}
            valueFormat="YYYY-MM-DD"
            clearable={false}
            required
          />
          <DatePickerInput
            label={t('calendar.endDateLabel')}
            value={to}
            onChange={(v) => setTo(v ? new Date(v) : null)}
            valueFormat="YYYY-MM-DD"
            clearable={false}
            required
          />
        </Group>
        <Text size="xs" c="dimmed">
          {t('calendar.friendScheduleRequestNote')}
        </Text>
        {error && <Text size="sm" c="jarvis.7">{error}</Text>}
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button onClick={handleSend} loading={busy}>{t('calendar.sendRequestButton')}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
