import React, { useState } from 'react';
import { Modal, Button, Stack, Group, Text, TextInput, Textarea, Select, Autocomplete } from '@mantine/core';
import { createStaff } from '../../utils/api';
import { useT } from '../../i18n/I18nProvider';

interface Props {
  onClose: () => void;
  onHired: () => void;
  teams: string[];
}

// StaffPanel 역할 탭 모델 선택지와 동기 유지 (신규 채용은 최신 모델만 노출 — 레거시 제외)
const MODELS = [
  { value: 'claude-fable-5', label: 'Fable 5' },
  { value: 'claude-opus-5', label: 'Opus 5' },
  { value: 'claude-opus-4-8', label: 'Opus 4.8' },
  { value: 'claude-sonnet-5', label: 'Sonnet 5' },
  { value: 'claude-haiku-4-5', label: 'Haiku 4.5' },
];

export default function HireAgentModal({ onClose, onHired, teams }: Props) {
  const t = useT();
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [team, setTeam] = useState('');
  const [model, setModel] = useState<string>('claude-sonnet-5');
  const [permissionLevel, setPermissionLevel] = useState<string>('standard');
  const [roleDirective, setRoleDirective] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError(t('staff.hireNameRequired')); return; }
    setBusy(true); setError(null);
    try {
      const r = await createStaff({
        name: trimmed,
        role: role.trim() || undefined,
        team: team.trim() || undefined,
        model,
        permissionLevel: permissionLevel as 'restricted' | 'standard' | 'admin',
        roleDirective: roleDirective.trim() || undefined,
      });
      if (!r.ok) throw new Error(r.error ?? 'create failed');
      onHired();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      opened
      onClose={onClose}
      title={t('staff.hireTitle')}
      size="md"
      centered
      overlayProps={{ backgroundOpacity: 0.8, blur: 2 }}
    >
      <Stack gap="sm">
        <Text size="xs" c="dimmed">{t('staff.hireDesc')}</Text>
        <TextInput
          label={t('staff.hireName')}
          placeholder={t('staff.hireNamePlaceholder')}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          required
          data-autofocus
        />
        <TextInput
          label={t('staff.hireRole')}
          placeholder={t('staff.hireRolePlaceholder')}
          value={role}
          onChange={(e) => setRole(e.currentTarget.value)}
        />
        <Autocomplete
          label={t('staff.hireTeam')}
          placeholder={t('staff.hireTeamPlaceholder')}
          data={teams}
          value={team}
          onChange={setTeam}
        />
        <Group grow align="flex-start">
          <Select
            label={t('staff.configModel')}
            data={MODELS}
            value={model}
            onChange={(v) => v && setModel(v)}
            allowDeselect={false}
          />
          <Select
            label={t('staff.configPermission')}
            data={[
              { value: 'restricted', label: t('staff.permRestricted') },
              { value: 'standard', label: t('staff.permStandard') },
              { value: 'admin', label: t('staff.permAdmin') },
            ]}
            value={permissionLevel}
            onChange={(v) => v && setPermissionLevel(v)}
            allowDeselect={false}
          />
        </Group>
        <Textarea
          label={t('staff.hireRoleDirective')}
          placeholder={t('staff.hireRoleDirectivePlaceholder')}
          value={roleDirective}
          onChange={(e) => setRoleDirective(e.currentTarget.value)}
          autosize
          minRows={3}
          maxRows={8}
        />
        {error && <Text size="xs" c="jarvis.7">{error}</Text>}
        <Group justify="flex-end" gap="xs" mt="sm">
          <Button variant="default" onClick={onClose}>{t('common.cancel')}</Button>
          <Button color="jarvis" disabled={busy || !name.trim()} onClick={onSubmit}>
            {busy ? t('staff.hiring') : t('staff.hireSubmit')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
