import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Stack, Group, Text, ActionIcon, ScrollArea, TextInput, Select,
  Button, SegmentedControl, Box, Loader,
} from '@mantine/core';
import {
  IconX, IconSearch, IconPlus, IconCamera, IconScan, IconStar,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useT } from '../../i18n/I18nProvider';
import {
  fetchContacts, fetchContactsLabels, fetchContactsCompanies,
  deleteContact, toggleContactFavorite, postContactOcr,
  type Contact, type ContactsQuery, type ContactSort,
} from '../../utils/api';
import { uiConfirm } from '../Dialog/dialog';
import ContactCard from './ContactCard';
import ContactEditModal from './ContactEditModal';
import CameraCaptureModal from './CameraCaptureModal';

interface Props {
  visible: boolean;
  onClose: () => void;
}

// '자동 추가됨' 토글은 2026-06-11 사진앱 명함 메뉴로 이관. 연락처 드로우에서는 더 이상 노출하지 않음.
// '자동 추가됨' 토글은 사진앱 설정의 명함 섹션(/api/businesscard-settings)에서 관리.
// 본체(:3457)와 사진앱(:3201)은 cross-origin이라 localStorage 공유 불가 — 사진앱 서버의 data/businesscard-settings.json 파일로 영속화.

export default function ContactsPanel({ visible, onClose }: Props) {
  const t = useT();
  const [items, setItems] = useState<Contact[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [companies, setCompanies] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [label, setLabel] = useState<string | null>(null);
  const [company, setCompany] = useState<string | null>(null);
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [sort, setSort] = useState<ContactSort>('recent');
  const [editing, setEditing] = useState<Contact | null>(null);
  const [creating, setCreating] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const query: ContactsQuery = {
      q: q.trim() || undefined,
      label: label || undefined,
      company: company || undefined,
      favoriteOnly: favoriteOnly || undefined,
      sort,
    };
    try {
      const [list, lbls, cos] = await Promise.all([
        fetchContacts(query),
        fetchContactsLabels(),
        fetchContactsCompanies(),
      ]);
      setItems(list);
      setLabels(lbls);
      setCompanies(cos);
    } finally {
      setLoading(false);
    }
  }, [q, label, company, favoriteOnly, sort]);

  useEffect(() => {
    if (!visible) return;
    void load();
  }, [visible, load]);

  const handleDelete = useCallback(async (c: Contact) => {
    const ok = await uiConfirm({ title: t('contacts.confirmDelete'), variant: 'danger' });
    if (!ok) return;
    const success = await deleteContact(c.id);
    if (success) {
      setItems((prev) => prev.filter((x) => x.id !== c.id));
    }
  }, [t]);

  const handleToggleFav = useCallback(async (c: Contact) => {
    const updated = await toggleContactFavorite(c.id);
    if (updated) {
      setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    }
  }, []);

  const handleScanFile = useCallback(async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      notifications.show({ id: 'card-ocr', message: t('contacts.ocrProcessing'), loading: true, autoClose: false });
      try {
        const candidate = await postContactOcr(file);
        notifications.hide('card-ocr');
        if (!candidate) {
          notifications.show({ color: 'red', message: t('contacts.ocrFailed') });
          return;
        }
        setEditing(candidate);
      } catch {
        notifications.hide('card-ocr');
        notifications.show({ color: 'red', message: t('contacts.ocrFailed') });
      }
    };
    input.click();
  }, [t]);

  const handleCameraCapture = useCallback(async (file: File) => {
    setCameraOpen(false);
    notifications.show({ id: 'card-ocr', message: t('contacts.ocrProcessing'), loading: true, autoClose: false });
    try {
      const candidate = await postContactOcr(file);
      notifications.hide('card-ocr');
      if (!candidate) {
        notifications.show({ color: 'red', message: t('contacts.ocrFailed') });
        return;
      }
      setEditing(candidate);
    } catch {
      notifications.hide('card-ocr');
      notifications.show({ color: 'red', message: t('contacts.ocrFailed') });
    }
  }, [t]);

  const filteredCount = useMemo(() => items.length, [items]);

  if (!visible) return null;

  return (
    <>
      <Stack h="100%" gap={0}>
        <Group justify="space-between" align="center" p="md">
          <Group gap={6} align="baseline">
            <Text fw={600} size="md">{t('nav.contacts')}</Text>
            <Text size="sm" c="dimmed">{filteredCount}</Text>
          </Group>
          <ActionIcon variant="subtle" color="gray" size={36} className="drawer-close" onClick={onClose} aria-label="close">
            <IconX size={18} stroke={1.5} />
          </ActionIcon>
        </Group>

        <Box px="md" pb="xs">
          <Group gap="xs" wrap="nowrap">
            <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setCreating(true)}>
              {t('contacts.add')}
            </Button>
            <Button size="xs" variant="light" leftSection={<IconCamera size={14} />} onClick={() => setCameraOpen(true)}>
              {t('contacts.camera')}
            </Button>
            <Button size="xs" variant="light" leftSection={<IconScan size={14} />} onClick={handleScanFile}>
              {t('contacts.scan')}
            </Button>
          </Group>
        </Box>

        <Box px="md" pb="xs">
          <TextInput
            size="xs"
            placeholder={t('contacts.search')}
            leftSection={<IconSearch size={14} stroke={1.5} />}
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
          />
        </Box>

        <Box px="md" pb="xs">
          <Group gap="xs" wrap="nowrap">
            <Select
              size="xs"
              placeholder={t('contacts.allLabels')}
              data={[{ value: '', label: t('contacts.allLabels') }, ...labels.map((l) => ({ value: l, label: l }))]}
              value={label ?? ''}
              onChange={(v) => setLabel(v || null)}
              style={{ flex: 1 }}
              clearable
            />
            <Select
              size="xs"
              placeholder={t('contacts.allCompanies')}
              data={[{ value: '', label: t('contacts.allCompanies') }, ...companies.map((c) => ({ value: c, label: c }))]}
              value={company ?? ''}
              onChange={(v) => setCompany(v || null)}
              style={{ flex: 1 }}
              clearable
            />
          </Group>
        </Box>

        <Box px="md" pb="xs">
          <Group gap="xs" justify="space-between">
            <SegmentedControl
              size="xs"
              value={sort}
              onChange={(v) => setSort(v as ContactSort)}
              data={[
                { value: 'name', label: t('contacts.sort.name') },
                { value: 'recent', label: t('contacts.sort.recent') },
                { value: 'company', label: t('contacts.sort.company') },
              ]}
            />
            <ActionIcon
              variant={favoriteOnly ? 'filled' : 'subtle'}
              color={favoriteOnly ? 'yellow' : 'gray'}
              onClick={() => setFavoriteOnly((v) => !v)}
              aria-label={t('contacts.filter.favorite')}
            >
              <IconStar size={16} stroke={1.5} />
            </ActionIcon>
          </Group>
        </Box>

        <ScrollArea style={{ flex: 1 }}>
          <Box p="md" pt={0}>
            {loading ? (
              <Group justify="center" mt="xl"><Loader size="sm" /></Group>
            ) : items.length === 0 ? (
              <Stack align="center" mt="xl" gap="sm">
                <Text c="dimmed" size="sm">{t('contacts.empty')}</Text>
                <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setCreating(true)}>
                  {t('contacts.add')}
                </Button>
              </Stack>
            ) : (
              <div className="contact-grid">
                {items.map((c) => (
                  <ContactCard
                    key={c.id}
                    contact={c}
                    onEdit={() => setEditing(c)}
                    onDelete={() => handleDelete(c)}
                    onToggleFavorite={() => handleToggleFav(c)}
                  />
                ))}
              </div>
            )}
          </Box>
        </ScrollArea>
      </Stack>

      <ContactEditModal
        opened={creating || editing !== null}
        initial={editing}
        onClose={() => { setCreating(false); setEditing(null); }}
        onSaved={() => { setCreating(false); setEditing(null); void load(); }}
      />

      <CameraCaptureModal
        opened={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={handleCameraCapture}
      />
    </>
  );
}
