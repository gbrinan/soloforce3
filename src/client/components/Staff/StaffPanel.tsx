import React, { useState, useEffect } from 'react';
import {
  Stack, Group, Text, Card, Button, ActionIcon, ScrollArea, Badge, Code, Tabs, Box, Select, TextInput,
} from '@mantine/core';
import { IconX, IconPencil } from '@tabler/icons-react';
import { fetchStaff, fetchStaffModels, updateStaffConfig } from '../../utils/api';
import type { StaffModelCatalog, StaffTeam, StaffMember, PermissionLevel } from '../../utils/api';
import { PermissionBadge } from './PermissionBadge';
import { renderMarkdown } from '../../utils/markdown';
import DrawerSubHeader from '../DrawerSubHeader';
import { uiConfirm } from '../Dialog/dialog';
import { useT } from '../../i18n/I18nProvider';
import HireAgentModal from './HireAgentModal';
import { btn } from '../../ui/controls';
import { formatWorkerModel } from './modelDisplay';

interface Props {
  visible: boolean;
  onClose: () => void;
  refreshKey?: number;
  genieProgressLog?: string[];
  genieQueueItems?: any[];
  jobLogs?: Record<string, string[]>;
  genieBusy?: boolean;
  ownerName?: string;
}

interface QueueStats {
  size: number;
  bySource: Record<string, number>;
  totalEnqueued: number;
  totalDone: number;
  totalDropped: number;
  droppedByReason: { capacity: number; "per-source": number; dedup: number };
}

const BADGE_DOT = <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />;

function StatusBadge({ busy, kind }: { busy: boolean; kind?: 'genie' | 'staff' }) {
  const t = useT();
  // 영업부 캡처 매칭: filled + pill + 좌측 흰 dot. theme.ts Badge defaultProps에서 variant/radius 처리.
  // 색상 의미: 대기=gray, 대화 중=cyan, 작업 중=cyan.
  if (busy) {
    return (
      <Badge size="xs" color="jarvis.3" leftSection={BADGE_DOT}>
        {kind === 'genie' ? t('staff.chatting') : t('staff.working')}
      </Badge>
    );
  }
  return <Badge size="xs" color="gray" leftSection={BADGE_DOT}>{t('staff.idle')}</Badge>;
}

function StaffRow({ member, teamName, accentColor, onClick }: { member: StaffMember; teamName: string; accentColor?: string; onClick: () => void }) {
  const t = useT();
  return (
    <Card
      withBorder
      radius="sm"
      padding="xs"
      onClick={onClick}
      style={{
        cursor: 'pointer',
        borderLeft: accentColor ? `3px solid ${accentColor}` : undefined,
      }}
    >
      <Group justify="space-between" align="center" gap="xs" wrap="nowrap">
        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Text size="sm" fw={600} truncate>{member.name}</Text>
          <Group gap={6} align="center">
            <Text size="xs" c="dimmed" truncate>
              {member.role} · {teamName}{member.model || member.recentActualModel ? ` | ${formatWorkerModel(member.model, member.recentActualModel, t('staff.recentModelLabel'))}` : ''}
            </Text>
            {member.permissionLevel && (!member.adapter || member.adapter === 'claude-code') && (
              <PermissionBadge level={member.permissionLevel} />
            )}
          </Group>
        </Stack>
        <StatusBadge busy={!!member.busy} kind={member.id === 'genie' ? 'genie' : 'staff'} />
      </Group>
      {member.busy && member.task && (
        <Text size="xs" c="dimmed" mt={4} lineClamp={1}>
          {member.task.length > 50 ? member.task.slice(0, 50) + '…' : member.task}
        </Text>
      )}
    </Card>
  );
}

export default function StaffPanel({ visible, onClose, refreshKey, genieProgressLog, genieQueueItems, jobLogs, genieBusy: genieBusyProp, ownerName }: Props) {
  const t = useT();
  const effectiveOwnerName = ownerName || t('staff.defaultOwnerName');
  const [genie, setGenie] = useState<StaffMember | null>(null);
  const [teams, setTeams] = useState<StaffTeam[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null);
  const [roleDirective, setRoleDirective] = useState<string>('');
  const [systemPrompt, setSystemPrompt] = useState<string>('');
  const [staffTab, setStaffTab] = useState<string>('role');
  const [currentJob, setCurrentJob] = useState<any>(null);
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [hireOpen, setHireOpen] = useState(false);
  const [modelCatalog, setModelCatalog] = useState<StaffModelCatalog | null>(null);
  const [modelCatalogLoading, setModelCatalogLoading] = useState(false);
  // 이름 변경 인라인 편집 상태
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [nameSaving, setNameSaving] = useState(false);

  const saveName = async () => {
    if (!selectedStaff) return;
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed.length > 20) { alert(t('staff.nameInvalid')); return; }
    if (trimmed === selectedStaff.name) { setEditingName(false); return; }
    setNameSaving(true);
    const r = await updateStaffConfig(selectedStaff.id, { name: trimmed });
    setNameSaving(false);
    if (!r.ok) {
      alert(r.error === 'duplicate name' ? t('staff.nameDuplicate') : t('staff.configUpdateFailed', { error: r.error ?? '' }));
      return;
    }
    setSelectedStaff({ ...selectedStaff, name: trimmed });
    setEditingName(false);
    load();
  };

  const load = async () => {
    const data = await fetchStaff();
    if (data.genie) setGenie(data.genie);
    setTeams(Array.isArray(data.teams) ? data.teams : (Object.values(data) as unknown as StaffTeam[]));
  };

  useEffect(() => {
    if (visible) load();
  }, [visible, refreshKey]);

  useEffect(() => {
    if (selectedStaff?.id === 'genie' && genieBusyProp !== undefined) {
      setSelectedStaff(prev => prev ? { ...prev, busy: genieBusyProp } : prev);
    }
  }, [genieBusyProp]);

  useEffect(() => {
    if (!selectedStaff || staffTab !== 'role') {
      setModelCatalog(null);
      return;
    }
    let cancelled = false;
    setModelCatalog(null);
    setModelCatalogLoading(true);
    fetchStaffModels(selectedStaff.id)
      .then((catalog) => { if (!cancelled) setModelCatalog(catalog); })
      .catch(() => { if (!cancelled) setModelCatalog(null); })
      .finally(() => { if (!cancelled) setModelCatalogLoading(false); });
    return () => { cancelled = true; };
  }, [selectedStaff?.id, staffTab]);

  useEffect(() => {
    if (!selectedStaff) return;
    const syncSelected = async () => {
      const data = await fetchStaff();
      const all = [data.genie, ...(data.teams || []).flatMap((t: any) => [t.lead, ...t.members || []])].filter(Boolean);
      const updated = all.find((m: any) => m.id === selectedStaff.id);
      if (updated) setSelectedStaff(updated);
    };
    syncSelected();
  }, [refreshKey]);

  useEffect(() => {
    if (!visible) return;
    const loadQueue = async () => {
      try {
        const res = await fetch('/api/genie/queue-stats');
        if (res.ok) setQueueStats(await res.json());
      } catch { /* */ }
    };
    loadQueue();
    const iv = setInterval(loadQueue, 30000);
    return () => clearInterval(iv);
  }, [visible]);

  const handleStaffClick = async (member: StaffMember) => {
    setSelectedStaff(member);
    setEditingName(false);
    setStaffTab(member.busy ? 'job' : 'role');
    setRoleDirective('');
    setSystemPrompt('');
    setCurrentJob(null);
    if (member.id !== 'genie') {
      try {
        const res = await fetch('/api/jobs');
        const jobs = await res.json();
        const job = jobs.find((j: any) => j.agent === member.id && (j.status === 'running' || j.status === 'planning'));
        if (job) setCurrentJob(job);
      } catch { /* */ }
    }
    try {
      const fetches: Promise<Response>[] = [
        fetch(`/api/staff/${member.id}/role-directive`),
      ];
      if (member.id === 'genie') {
        fetches.push(fetch(`/api/staff/genie/system-prompt`));
      }
      const results = await Promise.all(fetches);
      const rdData = await results[0].json();
      setRoleDirective(rdData.content || t('staff.noRoleDirective'));
      if (member.id === 'genie' && results[1]) {
        const sysData = await results[1].json();
        setSystemPrompt(sysData.content || t('staff.noSystemPrompt'));
      }
    } catch {
      setRoleDirective(t('staff.loadFailed'));
    }
  };

  useEffect(() => {
    if (!selectedStaff?.busy || staffTab !== 'job') return;
    if (selectedStaff.id === 'genie') return;
    if (!currentJob) return;
    const loadJob = async () => {
      try {
        const res = await fetch(`/api/jobs/${currentJob.id}`);
        if (res.ok) setCurrentJob(await res.json());
      } catch { /* */ }
    };
    loadJob();
    const iv = setInterval(loadJob, 10000);
    return () => clearInterval(iv);
  }, [selectedStaff, staffTab, currentJob?.id]);

  if (!visible) return null;

  if (selectedStaff) {
    const tabContent = staffTab === 'role' ? roleDirective : staffTab === 'system' ? systemPrompt : '';
    const isGenie = selectedStaff.id === 'genie';
    const supportsPermissionEditing = !selectedStaff.adapter || selectedStaff.adapter === 'claude-code';
    return (
      <Stack h="100%" gap={0}>
        <DrawerSubHeader title={selectedStaff.name} onBack={() => setSelectedStaff(null)} />
        {editingName && (
          <Group gap="xs" px="md" py={6} wrap="nowrap" align="center" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
            <TextInput
              size="xs"
              value={nameDraft}
              maxLength={20}
              autoFocus
              onChange={(e) => setNameDraft(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditingName(false); }}
              style={{ flex: 1 }}
            />
            <Button size="compact-xs" loading={nameSaving} onClick={saveName}>{t('staff.nameSave')}</Button>
            <Button size="compact-xs" variant="default" onClick={() => setEditingName(false)}>{t('common.cancel')}</Button>
          </Group>
        )}

        <Tabs value={staffTab} onChange={(v) => setStaffTab(v || 'role')} variant="default">
          <Tabs.List grow>
            <Tabs.Tab value="job" c={selectedStaff.busy ? 'jarvis.4' : undefined} fw={selectedStaff.busy ? 600 : 400}>
              {t('staff.tabJob')}
            </Tabs.Tab>
            <Tabs.Tab value="role">{t('staff.tabRole')}</Tabs.Tab>
            {isGenie && <Tabs.Tab value="system">{t('staff.tabSystem')}</Tabs.Tab>}
          </Tabs.List>
        </Tabs>

        <ScrollArea style={{ flex: 1 }} p="md">
          <Group justify="space-between" align="center" mb="sm">
            <Group gap={6} align="center">
              <Text size="sm" c="dimmed">{selectedStaff.role}</Text>
              {!editingName && (
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  aria-label={t('staff.renameButton')}
                  title={t('staff.renameButton')}
                  onClick={() => { setNameDraft(selectedStaff.name); setEditingName(true); }}
                >
                  <IconPencil size={14} stroke={1.5} />
                </ActionIcon>
              )}
            </Group>
            <StatusBadge busy={!!selectedStaff.busy} kind={isGenie ? 'genie' : 'staff'} />
          </Group>

          {staffTab === 'job' && isGenie && !selectedStaff.busy && (
            <Text c="dimmed" ta="center" py="lg">{t('staff.waiting')}</Text>
          )}

          {staffTab === 'job' && isGenie && selectedStaff.busy && (
            <Stack gap="md">
              <Group justify="space-between" align="center">
                <Text size="sm" fw={600} c="jarvis.4">{t('staff.progressLog')}</Text>
                <Button
                  size="compact-xs"
                  color="red"
                  onClick={async () => {
                    if (!(await uiConfirm({
                      title: t('staff.confirmAbortGenie', { name: selectedStaff.name }),
                      variant: 'danger',
                      confirmLabel: t('staff.abort'),
                    }))) return;
                    try { await fetch('/api/chat/abort', { method: 'POST' }); } catch { /* */ }
                  }}
                >
                  {t('staff.forceAbort')}
                </Button>
              </Group>
              <Code block style={{ maxHeight: 200, overflowY: 'auto', fontSize: 'var(--font-s)', lineHeight: 1.5 }}>
                {genieProgressLog?.length ? genieProgressLog.join('\n') : t('staff.waitingDots')}
              </Code>
              <Text size="sm" fw={600} c="dimmed">{t('staff.queueWaiting', { n: genieQueueItems?.length ?? 0 })}</Text>
              {genieQueueItems?.length ? (
                <Stack gap={4}>
                  {genieQueueItems.map((q: any) => (
                    <Card key={q.id} withBorder radius="sm" padding="xs">
                      <Group gap="xs" align="baseline" wrap="nowrap">
                        <Text size="xs" fw={600} c={q.kind === 'user' ? 'jarvis.5' : 'jarvis.3'}>
                          {q.kind === 'user' ? t('staff.owner', { name: effectiveOwnerName }) : q.source}
                        </Text>
                        <Text size="xs" c="dimmed" truncate>
                          {q.message.slice(0, 80)}{q.message.length > 80 ? '...' : ''}
                        </Text>
                      </Group>
                    </Card>
                  ))}
                </Stack>
              ) : (
                <Text size="xs" c="dimmed">{t('staff.queueEmpty')}</Text>
              )}
            </Stack>
          )}

          {staffTab === 'job' && !isGenie && !selectedStaff.busy && (
            <Text c="dimmed" ta="center" py="lg">{t('staff.waiting')}</Text>
          )}

          {staffTab === 'job' && !isGenie && currentJob && (
            <Stack gap="sm">
              <Group justify="space-between" align="center">
                <Text size="xs" c="dimmed">{currentJob.projectName || ''} · {currentJob.status}</Text>
                <Button
                  size="compact-xs"
                  color="red"
                  onClick={async () => {
                    if (!(await uiConfirm({
                      title: t('todo.cancelTitle.active'),
                      description: t('todo.cancelDesc'),
                      variant: 'danger',
                      confirmLabel: t('todo.confirmCancelWork'),
                      cancelLabel: t('todo.continueWork'),
                    }))) return;
                    try {
                      const res = await fetch(`/api/jobs/${currentJob.id}/cancel`, { method: 'POST' });
                      if (res.ok) setCurrentJob(null);
                    } catch { /* */ }
                  }}
                >
                  {t('todo.jobCancel')}
                </Button>
              </Group>
              <Card withBorder radius="sm" padding="xs" style={{ maxHeight: 150, overflowY: 'auto' }}>
                <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(currentJob.request || '') }} />
              </Card>
              <Code block style={{ maxHeight: 400, overflowY: 'auto', fontSize: 'var(--font-s)', lineHeight: 1.5 }}>
                {(() => {
                  const logs = jobLogs?.[currentJob.id]?.length ? jobLogs[currentJob.id] : currentJob.logs;
                  return logs?.slice(-30).join('\n') || t('staff.waitingDots');
                })()}
              </Code>
            </Stack>
          )}

          {staffTab !== 'job' && (
            <>
              {staffTab === 'role' && (
                <Stack gap={6} mb={18}>
                  <Group gap="xs" wrap="nowrap">
                    <Select
                      size="xs"
                      label={t('staff.configModel')}
                      data={(modelCatalog?.models ?? []).map((model) => ({ value: model.id, label: model.label }))}
                      value={selectedStaff.model ?? null}
                      disabled={modelCatalogLoading || !modelCatalog}
                      placeholder={modelCatalogLoading ? t('staff.modelCatalogLoading') : undefined}
                      onChange={async (val) => {
                        if (!val) return;
                        const prev = selectedStaff.model;
                        setSelectedStaff({ ...selectedStaff, model: val });
                        const r = await updateStaffConfig(selectedStaff.id, { model: val });
                        if (!r.ok) {
                          setSelectedStaff({ ...selectedStaff, model: prev });
                          alert(t('staff.configUpdateFailed', { error: r.error ?? '' }));
                        } else {
                          load();
                        }
                      }}
                      allowDeselect={false}
                      style={{ flex: 1 }}
                    />
                  {/* 워커 권한 3단계만 편집 가능. 마이크루 파일접근 권한(whitelist/workspace/full)은 별도 시스템 — 셀렉트에 노출 안 함. */}
                  {supportsPermissionEditing && (!selectedStaff.permissionLevel || ['restricted', 'standard', 'admin'].includes(selectedStaff.permissionLevel)) && (
                    <Select
                      size="xs"
                      label={t('staff.configPermission')}
                      data={[
                        { value: 'restricted', label: t('staff.permRestricted') },
                        { value: 'standard', label: t('staff.permStandard') },
                        { value: 'admin', label: t('staff.permAdmin') },
                      ]}
                      value={selectedStaff.permissionLevel ?? null}
                      onChange={async (val) => {
                        if (!val) return;
                        const prev = selectedStaff.permissionLevel;
                        setSelectedStaff({ ...selectedStaff, permissionLevel: val as PermissionLevel });
                        const r = await updateStaffConfig(selectedStaff.id, { permissionLevel: val as 'restricted' | 'standard' | 'admin' });
                        if (!r.ok) {
                          setSelectedStaff({ ...selectedStaff, permissionLevel: prev });
                          alert(t('staff.configUpdateFailed', { error: r.error ?? '' }));
                        } else {
                          load();
                        }
                      }}
                      allowDeselect={false}
                      style={{ flex: 1 }}
                    />
                  )}
                  {/* 마이크루 파일접근 권한은 읽기전용 배지로 표시 (선택 가능 값이 다름) */}
                  {supportsPermissionEditing && selectedStaff.permissionLevel && !['restricted', 'standard', 'admin'].includes(selectedStaff.permissionLevel) && (
                    <PermissionBadge level={selectedStaff.permissionLevel} />
                  )}
                  </Group>
                  {selectedStaff.busy && <Text size="xs" c="dimmed">{t('staff.modelAppliesNextJob')}</Text>}
                  {modelCatalog?.source === 'fallback' && <Text size="xs" c="dimmed">{t('staff.modelCatalogFallback')}</Text>}
                </Stack>
              )}
              <Box className="md" style={{ lineHeight: 1.7, fontSize: 'var(--font-s)' }}>
                <div dangerouslySetInnerHTML={{ __html: renderMarkdown(tabContent || t('job.loading')) }} />
              </Box>
            </>
          )}
        </ScrollArea>
      </Stack>
    );
  }

  const showQueueMini = queueStats && (queueStats.size > 0 || queueStats.totalDropped > 0);
  const queueTitle = queueStats
    ? t('staff.queueTitle', { done: queueStats.totalDone, cap: queueStats.droppedByReason.capacity, ps: queueStats.droppedByReason["per-source"], dd: queueStats.droppedByReason.dedup })
    : '';

  // 직원 총원: genie + 모든 팀의 lead + members. 사용자 요청(2026-06-11)으로 타이틀 옆 숫자만 표시(괄호 없음).
  const staffCount = (genie ? 1 : 0) + teams.reduce((n, team) => n + (team.lead ? 1 : 0) + (team.members?.length ?? 0), 0);

  return (
    <Stack h="100%" gap={0}>
      <Group justify="space-between" align="center" p="md" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
        <Group gap={6} align="baseline">
          <Text fw={600} size="md">{t('staff.title')}</Text>
          <Text size="sm" c="dimmed">{staffCount}</Text>
        </Group>
        <Group gap="xs">
          {showQueueMini && (
            <Text size="xs" c="dimmed" title={queueTitle}>
              {t('staff.queueSize', { n: queueStats!.size })}{queueStats!.totalDropped > 0 ? t('staff.queueDropped', { n: queueStats!.totalDropped }) : ''}
            </Text>
          )}
          <button
            onClick={() => setHireOpen(true)}
            style={btn('sm', 'neutral')}
          >
            {t('staff.hire')}
          </button>
          <ActionIcon variant="subtle" color="gray" size={36} className="drawer-close" onClick={onClose} aria-label={t('common.close')}>
            <IconX size={18} stroke={1.5} />
          </ActionIcon>
        </Group>
      </Group>
      <ScrollArea style={{ flex: 1 }} p="sm">
        <Stack gap="md">
          {genie && (
            <Stack gap={4}>
              <StaffRow
                member={genie}
                teamName={t('staff.secretariat')}
                accentColor="var(--accent-warning)"
                onClick={() => handleStaffClick(genie)}
              />
            </Stack>
          )}
          {teams.map(team => (
            <Stack key={team.name} gap={4}>
              {team.lead && (
                <StaffRow
                  member={team.lead}
                  teamName={team.name}
                  onClick={() => handleStaffClick(team.lead!)}
                />
              )}
              {team.members.map(m => (
                <Box key={m.id} pl={16}>
                  <StaffRow
                    member={m}
                    teamName={team.name}
                    onClick={() => handleStaffClick(m)}
                  />
                </Box>
              ))}
            </Stack>
          ))}
        </Stack>
      </ScrollArea>
      {hireOpen && (
        <HireAgentModal
          teams={teams.map(tm => tm.name)}
          onClose={() => setHireOpen(false)}
          onHired={load}
        />
      )}
    </Stack>
  );
}
