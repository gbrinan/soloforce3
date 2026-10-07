import React, { useEffect, useState } from 'react';
import {
  Modal, Stack, TextInput, Textarea, Group, Button, Checkbox, Switch, Text, Menu, ActionIcon, Box, NumberInput,
} from '@mantine/core';
import { IconEdit, IconCheck, IconChevronDown } from '@tabler/icons-react';
import { DateTimePicker } from '@mantine/dates';
import type { Schedule, ScheduleColor, ScheduleInput } from '../../utils/api';
import {
  SCHEDULE_COLORS, COLOR_SWATCH_HEX, colorLabel, loadColorLabels, saveColorLabels, type ColorLabelMap,
} from '../../utils/colorLabels';
import { uiConfirm } from '../Dialog/dialog';
import { useT } from '../../i18n/I18nProvider';

interface Props {
  opened: boolean;
  initial?: Schedule | null;
  defaultStart?: Date;
  onClose: () => void;
  onSave: (input: ScheduleInput, id?: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}

function toIso(v: Date | string | null): string {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString();
  // DateTimePicker may emit a date-time string like '2026-05-15 14:00:00'
  const d = new Date(v);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

export default function ScheduleModal({ opened, initial, defaultStart, onClose, onSave, onDelete }: Props) {
  const t = useT();
  const [title, setTitle] = useState('');
  const [start, setStart] = useState<Date | null>(null);
  const [end, setEnd] = useState<Date | null>(null);
  const [allDay, setAllDay] = useState(false);
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [color, setColor] = useState<ScheduleColor>('green');
  const [notifyChat, setNotifyChat] = useState(false);
  const [notifyToast, setNotifyToast] = useState(false);
  const [notifyMinutes, setNotifyMinutes] = useState<number>(10);
  const [endTouched, setEndTouched] = useState(false);   // 사용자가 종료일시를 직접 수정했는지 여부
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [labels, setLabels] = useState<ColorLabelMap>(() => loadColorLabels());
  const [colorMenuOpened, setColorMenuOpened] = useState(false);
  const [editingColor, setEditingColor] = useState<ScheduleColor | null>(null);
  const [editValue, setEditValue] = useState('');

  useEffect(() => {
    if (!opened) return;
    if (initial) {
      setTitle(initial.title);
      setStart(new Date(initial.start));
      setEnd(new Date(initial.end));
      setAllDay(!!initial.allDay);
      setDescription(initial.description ?? '');
      setLocation(initial.location ?? '');
      setColor(initial.color ?? 'green');
      setNotifyChat(!!initial.notification?.chat);
      setNotifyToast(!!initial.notification?.toast);
      setNotifyMinutes(initial.notification?.minutesBefore ?? 10);
    } else {
      const base = defaultStart ?? new Date();
      setTitle('');
      setStart(new Date(base));
      setEnd(new Date(base.getTime() + 60 * 60 * 1000));
      setAllDay(false);
      setDescription('');
      setLocation('');
      setColor('green');
      setNotifyChat(false);
      setNotifyToast(false);
      setNotifyMinutes(10);
    }
    setEndTouched(false);
    setError(null);
    setEditingColor(null);
    setLabels(loadColorLabels());
  }, [opened, initial, defaultStart]);

  const handleSave = async () => {
    if (!title.trim()) { setError(t('calendar.titleRequired')); return; }
    if (!start || !end) { setError(t('calendar.startEndRequired')); return; }
    const startIso = toIso(start);
    const endIso = toIso(end);
    if (!startIso || !endIso) { setError(t('calendar.startEndInvalid')); return; }
    if (new Date(endIso).getTime() < new Date(startIso).getTime()) {
      setError(t('calendar.endAfterStart')); return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave({
        title: title.trim(),
        start: startIso,
        end: endIso,
        allDay,
        description: description.trim() || undefined,
        location: location.trim() || undefined,
        color,
        notification: (notifyChat || notifyToast)
          ? { chat: notifyChat, toast: notifyToast, minutesBefore: Math.max(0, Math.min(1440, Math.round(notifyMinutes || 0))) }
          : { chat: false, toast: false },
      }, initial?.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!initial || !onDelete) return;
    if (!(await uiConfirm({
      title: t('calendar.deleteConfirmTitle'),
      description: t('calendar.deleteConfirmDesc'),
      variant: 'danger',
      confirmLabel: t('calendar.deleteButton'),
    }))) return;
    setBusy(true);
    try {
      await onDelete(initial.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const displayLabel = (c: ScheduleColor) => colorLabel(c, labels);
  const startEditLabel = (c: ScheduleColor) => { setEditValue(labels[c] ?? ''); setEditingColor(c); };
  const commitLabel = (c: ScheduleColor) => {
    const next: ColorLabelMap = { ...labels };
    const v = editValue.trim();
    if (v) next[c] = v; else delete next[c];
    setLabels(next);
    saveColorLabels(next);
    setEditingColor(null);
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={initial ? t('calendar.editScheduleTitle') : t('calendar.newScheduleTitle')}
      size="md"
      centered
      overlayProps={{ backgroundOpacity: 0.8, blur: 2 }}
    >
      <Stack gap="sm">
        <TextInput
          label={t('calendar.titleLabel')}
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          required
          autoFocus
        />
        <Group grow align="flex-start">
          <DateTimePicker
            label={t('calendar.startLabel')}
            value={start}
            onChange={(v) => {
              const newStart = v ? new Date(v) : null;
              setStart(newStart);
              if (!allDay && !endTouched && newStart) {
                setEnd(new Date(newStart.getTime() + 60 * 60 * 1000));
              }
            }}
            valueFormat="YYYY-MM-DD HH:mm"
            placeholder={t('calendar.startPlaceholder')}
            clearable={false}
            required
            disabled={allDay}
          />
          <DateTimePicker
            label={t('calendar.endLabel')}
            value={end}
            onChange={(v) => { setEnd(v ? new Date(v) : null); setEndTouched(true); }}
            valueFormat="YYYY-MM-DD HH:mm"
            placeholder={t('calendar.endPlaceholder')}
            clearable={false}
            required
            disabled={allDay}
          />
        </Group>
        <Group justify="space-between" align="center">
          <Checkbox label={t('calendar.allDayLabel')} checked={allDay} onChange={(e) => setAllDay(e.currentTarget.checked)} />
          <Menu
            opened={colorMenuOpened}
            onChange={(o) => { setColorMenuOpened(o); if (!o) setEditingColor(null); }}
            closeOnItemClick={false}
            position="bottom-end"
            width={220}
            withinPortal
          >
            <Menu.Target>
              <Button variant="default" size="xs" rightSection={<IconChevronDown size={14} stroke={1.5} />}>
                <Group gap={6} wrap="nowrap">
                  <Box w={10} h={10} style={{ borderRadius: 4, background: COLOR_SWATCH_HEX[color], flexShrink: 0 }} />
                  <span>{displayLabel(color)}</span>
                </Group>
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              {SCHEDULE_COLORS.map((c) => (
                <Box
                  key={c}
                  px="xs"
                  py={5}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, borderRadius: 4,
                    cursor: editingColor === c ? 'default' : 'pointer',
                    background: color === c ? 'var(--mantine-color-default-hover)' : undefined,
                  }}
                  onClick={() => { if (editingColor !== c) { setColor(c); setColorMenuOpened(false); } }}
                >
                  <Box w={12} h={12} style={{ borderRadius: 4, background: COLOR_SWATCH_HEX[c], flexShrink: 0 }} />
                  {editingColor === c ? (
                    <Group gap={4} style={{ flex: 1 }} wrap="nowrap" onClick={(e) => e.stopPropagation()}>
                      <TextInput
                        size="xs"
                        value={editValue}
                        autoFocus
                        placeholder={displayLabel(c)}
                        onChange={(e) => setEditValue(e.currentTarget.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); commitLabel(c); }
                          else if (e.key === 'Escape') { e.preventDefault(); setEditingColor(null); }
                        }}
                        style={{ flex: 1 }}
                      />
                      <ActionIcon size="sm" variant="subtle" aria-label={t('calendar.saveLabelAria')} onClick={() => commitLabel(c)}>
                        <IconCheck size={14} stroke={1.5} />
                      </ActionIcon>
                    </Group>
                  ) : (
                    <>
                      <Text size="xs" style={{ flex: 1 }}>{displayLabel(c)}</Text>
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        color="gray"
                        aria-label={t('calendar.editLabelAria')}
                        onClick={(e) => { e.stopPropagation(); startEditLabel(c); }}
                      >
                        <IconEdit size={13} stroke={1.5} />
                      </ActionIcon>
                    </>
                  )}
                </Box>
              ))}
            </Menu.Dropdown>
          </Menu>
        </Group>
        <TextInput
          label={t('calendar.locationLabel')}
          value={location}
          onChange={(e) => setLocation(e.currentTarget.value)}
        />
        <Textarea
          label={t('calendar.descriptionLabel')}
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
          minRows={2}
          styles={{ input: { resize: 'vertical', maxHeight: '300px' } }}
        />
        <Box>
          <Group justify="space-between" align="center">
            <Box>
              <Text size="sm">{t('calendar.chatNotifyTitle')}</Text>
              <Text size="xs" c="dimmed">{t('calendar.chatNotifyDesc')}</Text>
            </Box>
            <Switch
              checked={notifyChat}
              onChange={(e) => setNotifyChat(e.currentTarget.checked)}
            />
          </Group>
          <Group justify="space-between" align="center" mt="xs">
            <Box>
              <Text size="sm">{t('calendar.toastNotifyTitle')}</Text>
              <Text size="xs" c="dimmed">{t('calendar.toastNotifyDesc')}</Text>
            </Box>
            <Switch
              checked={notifyToast}
              onChange={(e) => setNotifyToast(e.currentTarget.checked)}
            />
          </Group>
          {(notifyChat || notifyToast) && (
            <Group gap="xs" align="center" mt="xs" pl={28}>
              <Text size="sm">{t('calendar.startLabel')}</Text>
              <NumberInput
                value={notifyMinutes}
                onChange={(v) => setNotifyMinutes(typeof v === 'number' ? v : Number(v) || 0)}
                min={0}
                max={1440}
                step={5}
                clampBehavior="strict"
                w={90}
                size="xs"
              />
              <Text size="sm">{t('calendar.minutesBefore')}</Text>
            </Group>
          )}
        </Box>
        {error && <Text size="sm" c="jarvis.7">{error}</Text>}
        <Group justify="space-between">
          {initial && onDelete ? (
            <Button color="jarvis.7" onClick={handleDelete} disabled={busy}>{t('calendar.deleteButton')}</Button>
          ) : <span />}
          <Group gap="xs">
            <Button variant="default" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
            <Button onClick={handleSave} loading={busy}>{initial ? t('calendar.editButton') : t('calendar.addButton')}</Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
