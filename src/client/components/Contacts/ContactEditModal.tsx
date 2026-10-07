import React, { useEffect, useState } from 'react';
import { Modal, Stack, TextInput, Textarea, Button, Group } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useT } from '../../i18n/I18nProvider';
import {
  createContact, updateContact,
  type Contact, type ContactDraft,
} from '../../utils/api';

interface Props {
  opened: boolean;
  initial: Contact | ContactDraft | null;
  onClose: () => void;
  onSaved: (contact: Contact) => void;
}

function isContact(v: Contact | ContactDraft | null): v is Contact {
  return !!v && typeof (v as Contact).id === 'string';
}

export default function ContactEditModal({ opened, initial, onClose, onSaved }: Props) {
  const t = useT();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [company, setCompany] = useState('');
  const [department, setDepartment] = useState('');
  const [position, setPosition] = useState('');
  const [memo, setMemo] = useState('');
  const [labels, setLabels] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!opened) return;
    setName(initial?.name ?? '');
    setPhone(initial?.phone ?? initial?.phones?.[0] ?? '');
    setEmail(initial?.email ?? initial?.emails?.[0] ?? '');
    setAddress(initial?.address ?? '');
    setCompany(initial?.company ?? '');
    setDepartment(initial?.department ?? '');
    setPosition(initial?.position ?? '');
    setMemo(initial?.memo ?? '');
    setLabels((initial?.labels ?? []).join(', '));
  }, [opened, initial]);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const draft: ContactDraft = {
      name: name.trim(),
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      address: address.trim() || undefined,
      company: company.trim() || undefined,
      department: department.trim() || undefined,
      position: position.trim() || undefined,
      memo: memo.trim() || undefined,
      labels: labels.split(',').map((s) => s.trim()).filter(Boolean),
    };
    try {
      let result: Contact | null;
      if (isContact(initial)) {
        result = await updateContact(initial.id, draft);
      } else {
        const payload: ContactDraft = {
          ...draft,
          source: initial?.source ?? 'manual',
          sourcePhotoSha: initial?.sourcePhotoSha,
          ocrConfidence: initial?.ocrConfidence,
        };
        result = await createContact(payload);
      }
      if (result) {
        onSaved(result);
      } else {
        notifications.show({ color: 'red', message: t('contacts.saveFailed') });
      }
    } catch {
      notifications.show({ color: 'red', message: t('contacts.saveFailed') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={isContact(initial) ? t('contacts.edit') : t('contacts.add')} size="md">
      <Stack gap="sm">
        <TextInput label={t('contacts.name')} value={name} onChange={(e) => setName(e.currentTarget.value)} required />
        <TextInput label={t('contacts.phone')} value={phone} onChange={(e) => setPhone(e.currentTarget.value)} />
        <TextInput label={t('contacts.email')} value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
        <TextInput label={t('contacts.address')} value={address} onChange={(e) => setAddress(e.currentTarget.value)} />
        <Group grow>
          <TextInput label={t('contacts.company')} value={company} onChange={(e) => setCompany(e.currentTarget.value)} />
          <TextInput label={t('contacts.department')} value={department} onChange={(e) => setDepartment(e.currentTarget.value)} />
        </Group>
        <TextInput label={t('contacts.position')} value={position} onChange={(e) => setPosition(e.currentTarget.value)} />
        <TextInput label={t('contacts.labels')} value={labels} onChange={(e) => setLabels(e.currentTarget.value)} />
        <Textarea label={t('contacts.memo')} value={memo} onChange={(e) => setMemo(e.currentTarget.value)} minRows={2} />
        <Group justify="flex-end" mt="xs">
          <Button variant="subtle" onClick={onClose}>{t('contacts.cancel')}</Button>
          <Button onClick={handleSave} loading={saving} disabled={!name.trim()}>{t('contacts.save')}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
