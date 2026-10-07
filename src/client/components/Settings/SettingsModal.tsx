import React, { useEffect, useState } from 'react';
import {
  Modal, Stack, Group, Text, SimpleGrid, UnstyledButton, Badge, Box, ScrollArea,
  NavLink, Select, Slider, SegmentedControl, Switch, Button, Divider, PasswordInput, TextInput,
  useMantineColorScheme, useComputedColorScheme,
} from '@mantine/core';
import { IconSun, IconMoon, IconCheck, IconSettings, IconNotes, IconGripVertical, IconRefresh, IconKey, IconShield, IconFileCode, IconApps, IconBell, IconLock, IconShoppingBag, IconDatabase, IconUsers } from '@tabler/icons-react';
import { uiConfirm, uiAlert } from '../Dialog/dialog';
import UpdateModal from '../Genie/UpdateModal';
import KeyVaultPanel from './KeyVaultPanel';
import StorePairingPanel from './StorePairingPanel';
import ConfigEditorModal from './ConfigEditorModal';
import { ServicePolicyPanel } from './ServicePolicyPanel';
import ConsentSettingsPanel from './ConsentSettingsPanel';
import CorpusPanel from './CorpusPanel';
import {
  getLockSettings, saveLockSettings, clearLockCredential, saveCredential, LOCK_NOW_EVENT,
} from '../Security/LockScreen';
import type { LockSettings } from '../Security/LockScreen';
import { useI18n } from '../../i18n/I18nProvider';
import { LOCALES, type Locale } from '../../i18n/messages';
import {
  loadNoteViewSettings, saveNoteViewSettings, type NoteViewSettings, type NoteSpacing,
} from '../../utils/noteViewSettings';
import {
  BODY_FONT_DEFS, CODE_FONT_DEFS, fontSelectOptions, ensureFontLoaded,
} from '../../utils/fonts';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  loadNavSettings, saveNavSettings, resolveAllItems, type NavSettings, type PanelId,
} from '../../utils/navSettings';
import { notifyPluginToggle } from '../../utils/storeSync';
import {
  loadNotificationSettings, saveNotificationSettings, DEFAULT_NOTIFICATION_SETTINGS,
  visibleNotificationKinds,
  type NotificationSettings, type NotificationKind,
} from '../../../shared/notifications';
import { getManifests } from '../../utils/appRegistry';
import pkg from '../../../../package.json';

interface Props {
  opened: boolean;
  onClose: () => void;
  initialCategory?: string;
  // 설정 > 직원 탭에서 "직원 패널 열기" — 설정을 닫고 StaffPanel을 여는 콜백 (App.tsx 제공)
  onOpenStaff?: () => void;
}

type Category = 'general' | 'notes' | 'staff' | 'keys' | 'security' | 'config' | 'services' | 'store' | 'notifications' | 'privacy' | 'data';

// 스킴 독립적 팔레트 토큰 — 현재 모드와 무관하게 라이트/다크 프리뷰를 동시에 그리기 위함.
// (라이브 토큰 --bg-canvas 등은 현재 스킴만 반영하므로 양쪽 동시 표현 불가)
const PREVIEW = {
  light: {
    bg: 'var(--mantine-color-gray-0)',
    bar: 'var(--mantine-color-gray-2)',
    line: 'var(--mantine-color-gray-3)',
    lineStrong: 'var(--mantine-color-gray-4)',
  },
  dark: {
    bg: 'var(--mantine-color-dark-7)',
    bar: 'var(--mantine-color-dark-5)',
    line: 'var(--mantine-color-dark-4)',
    lineStrong: 'var(--mantine-color-dark-3)',
  },
} as const;

// 작은 "앱 화면" 목업 일러스트 — 상단 바 + 콘텐츠 라인. 텍스트 없이 시각만으로 모드 구분.
function ModePreview({ mode }: { mode: 'light' | 'dark' }) {
  const c = PREVIEW[mode];
  return (
    <Box
      aria-hidden
      style={{
        background: c.bg,
        borderRadius: 'var(--mantine-radius-sm)',
        padding: 8,
        height: 88,
        border: '1px solid var(--border-default)',
        overflow: 'hidden',
      }}
    >
      {/* 상단 바 — 창 컨트롤 점(좌). sun/moon 메타포는 카드 하단 라벨 아이콘으로 일원화
          (흐린 코너 아이콘 제거 → 선택 시 우상단 "현재 사용 중" 배지와 위치 충돌 방지) */}
      <Group gap={4} mb={8} wrap="nowrap">
        <Box style={{ width: 6, height: 6, borderRadius: '50%', background: c.line }} />
        <Box style={{ width: 6, height: 6, borderRadius: '50%', background: c.line }} />
        <Box style={{ width: 6, height: 6, borderRadius: '50%', background: c.line }} />
      </Group>
      {/* 콘텐츠 라인 */}
      <Box style={{ height: 8, width: '70%', borderRadius: 4, background: c.lineStrong, marginBottom: 6 }} />
      <Box style={{ height: 6, width: '100%', borderRadius: 4, background: c.line, marginBottom: 5 }} />
      <Box style={{ height: 6, width: '85%', borderRadius: 4, background: c.line }} />
    </Box>
  );
}

function SelectCard({
  selected, onClick, children, currentLabel,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  currentLabel: string;
}) {
  return (
    <UnstyledButton onClick={onClick} style={{ width: '100%' }} aria-pressed={selected}>
      <Box
        style={{
          position: 'relative',
          borderRadius: 'var(--mantine-radius-md)',
          padding: 10,
          background: 'var(--bg-surface)',
          border: `2px solid ${selected ? 'var(--ring)' : 'var(--border-default)'}`,
          transition: 'border-color 0.15s',
        }}
      >
        {selected && (
          <Badge
            size="xs"
            color="var(--ring)"
            leftSection={<IconCheck size={10} stroke={2.5} />}
            style={{ position: 'absolute', top: 6, right: 6 }}
          >
            {currentLabel}
          </Badge>
        )}
        {children}
      </Box>
    </UnstyledButton>
  );
}

// ── 마이크루 디자인 프리미티브 (docs/design-tokens.md 캐노니컬 스케일) ─────────────
// 설정 콘텐츠 전반을 토큰 기반 카드 + 일관 타이포로 재구성한다.

// 토큰 카드 — 표면(--bg-surface) + 보더(--border-default) + radius(md). 설정 그룹 컨테이너.
function SettingsCard({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <Box
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--mantine-radius-md)',
        padding: 16,
        ...style,
      }}
    >
      {children}
    </Box>
  );
}

// 섹션 헤더 — 제목(L=16/700, --text-primary) + 설명(S=12, --text-muted).
function SectionHead({ title, desc }: { title: string; desc?: string }) {
  return (
    <Stack gap={2} mb="md">
      <Text style={{ fontSize: 'var(--font-l)', fontWeight: 700, color: 'var(--text-primary)' }}>{title}</Text>
      {desc && <Text style={{ fontSize: 'var(--font-s)', color: 'var(--text-muted)' }}>{desc}</Text>}
    </Stack>
  );
}

// 그룹 소제목 — 카드 내부 개별 항목 라벨(M=14/600).
function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Text style={{ fontSize: 'var(--font-m)', fontWeight: 600, color: 'var(--text-primary)' }}>{children}</Text>;
}

// 설정 > 일반 — 화면 모드 + 언어 (기존 항목 유지).
function GeneralSection() {
  const { t, locale, setLocale } = useI18n();
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme('dark', { getInitialValueInEffect: true });
  const [updateOpened, setUpdateOpened] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <Stack gap="lg">
      {/* 섹션 A — 화면 모드 */}
      <SettingsCard>
        <SectionHead title={t('settings.appearance.title')} desc={t('settings.appearance.desc')} />
        <SimpleGrid cols={2} spacing="sm">
          <SelectCard
            selected={computed === 'light'}
            onClick={() => setColorScheme('light')}
            currentLabel={t('settings.appearance.current')}
          >
            <ModePreview mode="light" />
            <Group gap={6} mt={8} justify="center">
              <IconSun size={20} stroke={2} color="var(--accent-warning)" />
              <Text size="sm" fw={600}>{t('settings.appearance.light')}</Text>
            </Group>
          </SelectCard>
          <SelectCard
            selected={computed === 'dark'}
            onClick={() => setColorScheme('dark')}
            currentLabel={t('settings.appearance.current')}
          >
            <ModePreview mode="dark" />
            <Group gap={6} mt={8} justify="center">
              <IconMoon size={20} stroke={2} color="var(--text-secondary)" />
              <Text size="sm" fw={600}>{t('settings.appearance.dark')}</Text>
            </Group>
          </SelectCard>
        </SimpleGrid>
      </SettingsCard>

      {/* 섹션 B — 언어 */}
      <SettingsCard>
        <SectionHead title={t('settings.language.title')} desc={t('settings.language.desc')} />
        <SimpleGrid cols={3} spacing="sm">
          {LOCALES.map((l) => (
            <SelectCard
              key={l.value}
              selected={locale === l.value}
              onClick={() => setLocale(l.value as Locale)}
              currentLabel={t('settings.appearance.current')}
            >
              <Stack gap={4} align="center" py={4}>
                <Text style={{ fontSize: 28, lineHeight: 1 }}>{l.flag}</Text>
                <Text size="sm" fw={600}>{l.label}</Text>
              </Stack>
            </SelectCard>
          ))}
        </SimpleGrid>
      </SettingsCard>

      {/* 섹션 C — 메뉴 (상단 메뉴 바 순서/표시 설정) */}
      <SettingsCard>
        <MenuSection />
      </SettingsCard>

      {/* 섹션 D — 시스템 */}
      <SettingsCard>
        <SectionHead title={t('settings.system.title')} desc={t('settings.system.desc')} />
        <Stack gap="sm">
          <ProgramUpdateStatus />
          <Button
            variant="light"
            leftSection={<IconRefresh size={16} />}
            onClick={() => setUpdateOpened(true)}
            style={{ alignSelf: 'flex-start' }}
          >
            {t('settings.system.checkUpdate')}
          </Button>
        </Stack>
      </SettingsCard>

      {/* 섹션 E — 계정 삭제 */}
      <SettingsCard>
        <SectionHead title={t('settings.privacy.deleteAccount')} desc={t('settings.privacy.deleteAccountDesc')} />
        <Button
          variant="light"
          color="red"
          onClick={() => setDeleteOpen(true)}
          style={{ alignSelf: 'flex-start' }}
        >
          {t('settings.privacy.deleteAccount')}
        </Button>
      </SettingsCard>

      <UpdateModal opened={updateOpened} onClose={() => setUpdateOpened(false)} />

      {/* 계정 삭제 확인 모달 */}
      <Modal
        opened={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={<Text fw={700} c="red">{t('settings.privacy.deleteAccount')}</Text>}
        size="sm"
        centered
      >
        <Stack gap="md">
          <Text size="sm">{t('settings.privacy.deleteConfirm')}</Text>
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setDeleteOpen(false)}>{t('common.cancel')}</Button>
            <Button color="red" onClick={() => setDeleteOpen(false)}>{t('common.delete')}</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

// 프로그램 업데이트 상태 — /api/update-status (update-check.ts가 6시간 주기로 스토어 폴링).
// 현재/최신 버전 표시 + 새 버전이면 업데이트(설치본 다운로드) 버튼, 수동 "지금 확인" 지원.
interface UpdateStatusResp {
  currentVersion: string;
  latestVersion: string | null;
  updatable: boolean;
  downloadUrl: string | null;
  checkedAt: string | null;
}
function ProgramUpdateStatus() {
  const { t } = useI18n();
  const [st, setSt] = useState<UpdateStatusResp | null>(null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/update-status')
      .then((r) => (r.ok ? r.json() : null))
      .then(setSt)
      .catch(() => setSt(null));
  }, []);

  const checkNow = async () => {
    setChecking(true);
    try {
      const res = await fetch('/api/update-status/check', { method: 'POST' });
      if (res.ok) setSt(await res.json());
    } catch { /* offline */ } finally {
      setChecking(false);
    }
  };

  // 자동 업데이트 — 서버가 새 패키지를 내려받아 덮어쓰고 재시작한다(수 분 소요).
  // 되돌리기 어려운 작업이라 명시적 확인 후에만 실행.
  const applyUpdate = async () => {
    if (!window.confirm(t('settings.system.updateApplyConfirm'))) return;
    setApplying(true);
    setApplyMsg(t('settings.system.updateApplying'));
    try {
      const res = await fetch('/api/update-status/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.ok) {
        setApplyMsg(t('settings.system.updateApplyRestarting'));
      } else {
        setApplyMsg(t('settings.system.updateApplyFailed', { error: body.error ?? res.status }));
        setApplying(false);
      }
    } catch (e) {
      setApplyMsg(t('settings.system.updateApplyFailed', { error: e instanceof Error ? e.message : 'network' }));
      setApplying(false);
    }
  };

  if (!st) return null;
  return (
    <Stack gap={6}>
      {st.updatable ? (
        <Text size="sm" fw={600} c="indigo">
          {t('settings.system.newVersionAvailable', { latest: st.latestVersion ?? '', current: st.currentVersion })}
        </Text>
      ) : (
        <Text size="xs" c="dimmed">
          {t('settings.system.currentVersion', { version: st.currentVersion })}
          {st.latestVersion
            ? t('settings.system.latestUpToDate', { version: st.latestVersion })
            : t('settings.system.latestNotChecked')}
        </Text>
      )}
      <Group gap="sm">
        {st.updatable && (
          <Button size="xs" color="indigo" loading={applying} onClick={() => void applyUpdate()}>
            {t('settings.system.updateApplyNow')}
          </Button>
        )}
        {st.updatable && (
          <Button
            size="xs"
            variant="light"
            color="indigo"
            component="a"
            href={st.downloadUrl ?? 'https://store.dooitspace.com'}
            target="_blank"
            rel="noreferrer"
          >
            {t('settings.system.updateDownload')}
          </Button>
        )}
        <Button size="xs" variant="default" loading={checking} onClick={() => void checkNow()}>
          {t('settings.system.checkNow')}
        </Button>
      </Group>
      {applyMsg && <Text size="xs" c={applying ? 'indigo' : 'red'}>{applyMsg}</Text>}
      {st.checkedAt && (
        <Text size="xs" c="dimmed">{t('settings.system.lastChecked', { date: new Date(st.checkedAt).toLocaleString('ko-KR') })}</Text>
      )}
    </Stack>
  );
}

// 설정 > 노트 — 본문/코드 글꼴, 글자 크기, 줄 간격, 문서 폭. localStorage 저장 + 즉시 반영.
function NotesSection() {
  const { t } = useI18n();
  const [v, setV] = useState<NoteViewSettings>(() => loadNoteViewSettings());
  // 진입 시 저장된 글꼴을 동적 로드(설정 화면 미리보기/일관성). 인터넷 없으면 graceful 폴백.
  useEffect(() => {
    ensureFontLoaded(v.bodyFont);
    ensureFontLoaded(v.codeFont);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 부분 갱신 + 저장(이벤트 발화로 열린 NotesPanel 즉시 반영).
  const update = (patch: Partial<NoteViewSettings>) => {
    setV((prev) => {
      const next = { ...prev, ...patch };
      saveNoteViewSettings(next);
      return next;
    });
  };

  // 글꼴 선택 — 저장 + 즉시 동적 로드(실시간 미리보기).
  const selectFont = (key: 'bodyFont' | 'codeFont', val: string | null) => {
    if (!val) return;
    ensureFontLoaded(val);
    update({ [key]: val } as Partial<NoteViewSettings>);
  };

  const spacingData = [
    { value: 'narrow', label: t('settings.narrow') },
    { value: 'normal', label: t('settings.normal') },
    { value: 'wide', label: t('settings.wide') },
  ];

  return (
    <Stack gap="lg">
      <SettingsCard>
        <SectionHead title={t('settings.notes')} />
        <Stack gap="lg">
          <Stack gap={6}>
            <FieldLabel>{t('settings.noteFont')}</FieldLabel>
            <Select
              value={v.bodyFont}
              onChange={(val) => selectFont('bodyFont', val)}
              data={fontSelectOptions(BODY_FONT_DEFS, v.bodyFont)}
              placeholder="Pretendard"
              searchable
              allowDeselect={false}
              maxDropdownHeight={240}
              comboboxProps={{ withinPortal: true }}
            />
            <Text style={{ fontSize: 'var(--font-s)', color: 'var(--text-muted)' }}>{t('settings.fontPreviewHint')}</Text>
          </Stack>

          <Stack gap={6}>
            <FieldLabel>{t('settings.codeFont')}</FieldLabel>
            <Select
              value={v.codeFont}
              onChange={(val) => selectFont('codeFont', val)}
              data={fontSelectOptions(CODE_FONT_DEFS, v.codeFont)}
              placeholder="IBM Plex Mono"
              searchable
              allowDeselect={false}
              maxDropdownHeight={240}
              comboboxProps={{ withinPortal: true }}
            />
          </Stack>

          <Stack gap={6}>
            <Group justify="space-between" align="center">
              <FieldLabel>{t('settings.fontSize')}</FieldLabel>
              <Text style={{ fontSize: 'var(--font-s)', color: 'var(--text-muted)' }}>{v.fontSize}px</Text>
            </Group>
            <Slider
              min={12}
              max={24}
              step={1}
              value={v.fontSize}
              onChange={(val) => update({ fontSize: val })}
              marks={[{ value: 12 }, { value: 16 }, { value: 20 }, { value: 24 }]}
            />
          </Stack>

          <Stack gap={6}>
            <FieldLabel>{t('settings.lineHeight')}</FieldLabel>
            <SegmentedControl
              fullWidth
              value={v.lineHeight}
              onChange={(val) => update({ lineHeight: val as NoteSpacing })}
              data={spacingData}
            />
          </Stack>

          <Stack gap={6}>
            <FieldLabel>{t('settings.docWidth')}</FieldLabel>
            <SegmentedControl
              fullWidth
              value={v.docWidth}
              onChange={(val) => update({ docWidth: val as NoteSpacing })}
              data={spacingData}
            />
          </Stack>
        </Stack>
      </SettingsCard>
    </Stack>
  );
}

// 설정 > 메뉴 — 상단 메뉴 바 항목의 순서(드래그) + 표시 ON/OFF(스위치). navSettings에 저장 → 헤더 즉시 반영.
function SortableMenuRow({
  id, label, visible, fixed, onToggle,
}: {
  id: PanelId;
  label: string;
  visible: boolean;
  fixed: boolean;
  onToggle: (visible: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <Box
      ref={setNodeRef}
      style={{
        ...style,
        border: '1px solid var(--mantine-color-default-border)',
        borderRadius: 'var(--mantine-radius-sm)',
        padding: '8px 10px',
        background: 'var(--bg-surface)',
      }}
    >
      <Group gap="sm" wrap="nowrap" justify="space-between">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          <Box
            {...attributes}
            {...listeners}
            aria-label="reorder"
            style={{ cursor: 'grab', display: 'flex', alignItems: 'center', touchAction: 'none', color: 'var(--text-secondary)' }}
          >
            <IconGripVertical size={16} stroke={1.5} />
          </Box>
          <Text size="sm" style={{ opacity: visible ? 1 : 0.5 }}>{label}</Text>
        </Group>
        {!fixed && <Switch size="sm" checked={visible} onChange={(e) => onToggle(e.currentTarget.checked)} />}
      </Group>
    </Box>
  );
}

function MenuSection() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<NavSettings>(() => loadNavSettings());
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const persist = (next: NavSettings) => { setSettings(next); saveNavSettings(next); };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = settings.order.indexOf(active.id as PanelId);
    const to = settings.order.indexOf(over.id as PanelId);
    if (from < 0 || to < 0) return;
    persist({ ...settings, order: arrayMove(settings.order, from, to) });
  };

  const toggleVisible = (id: PanelId, visible: boolean) => {
    const hidden = new Set(settings.hidden);
    if (visible) {
      hidden.delete(id);
    } else {
      // 최소 1개는 표시 유지 — 마지막 하나는 끄지 못하게.
      if (settings.order.length - settings.hidden.length <= 1) return;
      hidden.add(id);
    }
    persist({ ...settings, hidden: [...hidden] });
    // 스토어 installed.jsonl 동기화 (fire-and-forget). FIXED_PANELS는 Switch가 렌더되지 않아 여기 도달 안 함.
    notifyPluginToggle(id, visible);
  };

  const items = resolveAllItems(settings);

  return (
    <Stack gap="md">
      <SectionHead title={t('settings.menu')} desc={t('settings.menuReorderHint')} />
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={settings.order} strategy={verticalListSortingStrategy}>
          <Stack gap={6}>
            {items.map((it) => (
              <SortableMenuRow
                key={it.id}
                id={it.id}
                label={t(it.labelKey)}
                visible={it.visible}
                fixed={it.fixed}
                onToggle={(v) => toggleVisible(it.id, v)}
              />
            ))}
          </Stack>
        </SortableContext>
      </DndContext>
    </Stack>
  );
}

// 설정 > 데이터 — 개인 데이터 백업(ZIP 다운로드)·복원(ZIP 업로드). 재설치 대비.
function DataSection() {
  const { t } = useI18n();
  const [restoring, setRestoring] = useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const onBackup = () => {
    // Content-Disposition(attachment)으로 브라우저 다운로드 매니저가 처리 — 페이지 이동 없음.
    const a = document.createElement('a');
    a.href = '/api/data/backup';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const onPickRestore = () => fileRef.current?.click();

  const onRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 같은 파일 재선택 허용
    if (!file) return;
    const ok = await uiConfirm({
      title: t('settings.data.restoreTitle'),
      description: t('settings.data.restoreConfirmDesc', { fileName: file.name }),
      variant: 'danger',
      confirmLabel: t('settings.data.restoreConfirm'),
    });
    if (!ok) return;
    setRestoring(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/data/restore', { method: 'POST', body: fd });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; restored?: number; error?: string } | null;
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'failed');
      await uiAlert({
        title: t('settings.data.restoreSuccessTitle', { count: data.restored ?? 0 }),
        description: t('settings.data.restartHint'),
        variant: 'info',
      });
    } catch (err) {
      await uiAlert({
        title: t('settings.data.restoreFailTitle'),
        description: err instanceof Error ? err.message : t('settings.unknownError'),
        variant: 'danger',
      });
    } finally {
      setRestoring(false);
    }
  };

  return (
    <Stack gap="md">
      <SectionHead title={t('settings.data')} desc={t('settings.data.desc')} />
      <CorpusPanel />
      <SettingsCard>
        <Stack gap="xs">
          <FieldLabel>{t('settings.data.backupLabel')}</FieldLabel>
          <Text style={{ fontSize: 'var(--font-s)', color: 'var(--text-muted)' }}>
            {t('settings.data.backupDesc')}
          </Text>
          <Group>
            <Button variant="light" leftSection={<IconDatabase size={16} stroke={1.5} />} onClick={onBackup}>
              {t('settings.data.backupButton')}
            </Button>
          </Group>
        </Stack>
      </SettingsCard>
      <SettingsCard>
        <Stack gap="xs">
          <FieldLabel>{t('settings.data.restoreLabel')}</FieldLabel>
          <Text style={{ fontSize: 'var(--font-s)', color: 'var(--text-muted)' }}>
            {t('settings.data.restoreDesc')}
          </Text>
          <Group>
            <Button variant="light" color="orange" loading={restoring} onClick={onPickRestore}>
              {t('settings.data.restoreButton')}
            </Button>
            <input ref={fileRef} type="file" accept=".zip,application/zip" hidden onChange={onRestoreFile} />
          </Group>
        </Stack>
      </SettingsCard>
    </Stack>
  );
}

// 설정 > 보안 — 앱 잠금 설정 (PIN/비밀번호, 자동 잠금 타임아웃)
function SecuritySection() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<LockSettings>(() => getLockSettings());
  const [showSetup, setShowSetup] = useState(false);
  const [step, setStep] = useState<'new' | 'confirm'>('new');
  const [inputNew, setInputNew] = useState('');
  const [inputConfirm, setInputConfirm] = useState('');
  const [setupError, setSetupError] = useState('');
  const [saved, setSaved] = useState(false);

  const hasCredential = !!localStorage.getItem('jarvis:lockCredential');

  const update = (patch: Partial<LockSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveLockSettings(next);
  };

  const openSetup = () => {
    setShowSetup(true);
    setStep('new');
    setInputNew('');
    setInputConfirm('');
    setSetupError('');
    setSaved(false);
  };

  const handleSetupSubmit = async () => {
    if (step === 'new') {
      if (settings.mode === 'pin' && !/^\d{4}$/.test(inputNew)) {
        setSetupError(t('settings.security.pinFormatError'));
        return;
      }
      if (!inputNew) { setSetupError(t('settings.security.valueRequired')); return; }
      setStep('confirm');
      setInputConfirm('');
      setSetupError('');
    } else {
      if (inputNew !== inputConfirm) {
        setSetupError(t('settings.security.mismatchError'));
        setStep('new');
        setInputNew('');
        setInputConfirm('');
        return;
      }
      await saveCredential(inputNew);
      if (!settings.enabled) update({ enabled: true });
      setShowSetup(false);
      setSaved(true);
      setStep('new');
      setInputNew('');
      setInputConfirm('');
      setSetupError('');
    }
  };

  const handleDisable = () => {
    clearLockCredential();
    update({ enabled: false });
    setSaved(false);
  };

  const timeoutData = [
    { value: '5', label: t('settings.security.timeout5m') },
    { value: '10', label: t('settings.security.timeout10m') },
    { value: '30', label: t('settings.security.timeout30m') },
    { value: '60', label: t('settings.security.timeout1h') },
    { value: '0', label: t('settings.security.timeoutOff') },
  ];

  const modeData = [
    { value: 'pin', label: t('settings.security.modePin') },
    { value: 'password', label: t('settings.security.modePassword') },
  ];

  return (
    <SettingsCard>
    <Stack gap="lg">
      <SectionHead title={t('settings.security.title')} desc={t('settings.security.desc')} />

      <Switch
        label={t('settings.security.enableLabel')}
        description={!hasCredential ? t('settings.security.setupFirst') : undefined}
        checked={settings.enabled}
        disabled={!hasCredential && !saved}
        onChange={e => update({ enabled: e.currentTarget.checked })}
      />

      <Stack gap={6}>
        <FieldLabel>{t('settings.security.modeLabel')}</FieldLabel>
        <Select
          value={settings.mode}
          onChange={val => val && update({ mode: val as 'pin' | 'password' })}
          data={modeData}
          allowDeselect={false}
          comboboxProps={{ withinPortal: true }}
        />
      </Stack>

      <Stack gap={6}>
        <FieldLabel>{t('settings.security.timeoutLabel')}</FieldLabel>
        <Select
          value={String(settings.timeoutMinutes)}
          onChange={val => val && update({ timeoutMinutes: Number(val) })}
          data={timeoutData}
          disabled={!settings.enabled}
          allowDeselect={false}
          comboboxProps={{ withinPortal: true }}
        />
      </Stack>

      <Group gap="sm">
        <Button variant="light" onClick={openSetup}>
          {hasCredential || saved ? t('settings.security.changeCredential') : t('settings.security.setCredential')}
        </Button>
        {settings.enabled && (
          <Button
            variant="light"
            color="orange"
            onClick={() => window.dispatchEvent(new Event(LOCK_NOW_EVENT))}
          >
            {t('settings.security.lockNow')}
          </Button>
        )}
      </Group>

      {showSetup && (
        <Stack
          gap="sm"
          style={{
            background: 'var(--bg-surface)',
            borderRadius: 10,
            padding: 16,
            border: '1px solid var(--border-default)',
          }}
        >
          <Text size="sm" fw={600}>
            {step === 'new'
              ? settings.mode === 'pin' ? t('settings.security.enterNewPin') : t('settings.security.enterNewPassword')
              : t('settings.security.confirmReenter')}
          </Text>
          <PasswordInput
            value={step === 'new' ? inputNew : inputConfirm}
            onChange={e =>
              step === 'new'
                ? setInputNew(e.currentTarget.value)
                : setInputConfirm(e.currentTarget.value)
            }
            placeholder={settings.mode === 'pin' ? t('settings.security.pinPlaceholder') : t('settings.security.passwordPlaceholder')}
            maxLength={settings.mode === 'pin' ? 4 : undefined}
            onKeyDown={e => { if (e.key === 'Enter') handleSetupSubmit(); }}
            autoFocus
          />
          {setupError && (
            <Text size="xs" c="red" role="alert">{setupError}</Text>
          )}
          <Group gap="sm">
            <Button size="sm" onClick={handleSetupSubmit}>
              {step === 'new' ? t('settings.security.nextStep') : t('settings.save')}
            </Button>
            <Button size="sm" variant="subtle" onClick={() => {
              setShowSetup(false);
              setStep('new');
              setInputNew('');
              setInputConfirm('');
              setSetupError('');
            }}>
              {t('common.cancel')}
            </Button>
          </Group>
        </Stack>
      )}

      {(hasCredential || saved) && (
        <>
          <Divider />
          <Button
            variant="light"
            color="red"
            size="sm"
            style={{ alignSelf: 'flex-start' }}
            onClick={handleDisable}
          >
            {t('settings.security.removeLock')}
          </Button>
        </>
      )}
    </Stack>
    </SettingsCard>
  );
}

const SAFE_ENV_KEYS = ["NGROK_URL", "APP_PORT", "LOG_LEVEL", "DEBUG_MODE", "DISABLE_AUTH", "AUTO_MODE"];

function EnvVarSection() {
  const { t } = useI18n();
  const [key, setKey] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!key) return;
    setSaving(true); setError(null); setSaved(false);
    try {
      const res = await fetch('/api/config/safe-env-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      setSaved(true);
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  };

  return (
    <SettingsCard>
      <SectionHead title={t('settings.envVar.title')} desc={t('settings.envVar.desc')} />
      <Stack gap="sm">
        <Select
          label={t('settings.envVar.keyLabel')}
          placeholder={t('settings.envVar.keyPlaceholder')}
          value={key}
          onChange={(v) => { setKey(v); setSaved(false); setError(null); }}
          data={SAFE_ENV_KEYS}
          allowDeselect={false}
          comboboxProps={{ withinPortal: true }}
        />
        <TextInput
          label={t('settings.envVar.valueLabel')}
          placeholder={t('settings.envVar.valuePlaceholder')}
          value={value}
          onChange={(e) => { setValue(e.currentTarget.value); setSaved(false); }}
          disabled={!key}
        />
        {error && <Text size="xs" c="red">{error}</Text>}
        {saved && <Text size="xs" c="green">{t('settings.envVar.savedRestartHint')}</Text>}
        <Button variant="light" onClick={handleSave} loading={saving} disabled={!key} style={{ alignSelf: 'flex-start' }}>
          {t('settings.save')}
        </Button>
      </Stack>
    </SettingsCard>
  );
}

// 설정 > 설정 파일 — ConfigEditorModal 진입점.
function ConfigSection() {
  const { t } = useI18n();
  const [editorOpen, setEditorOpen] = useState(false);
  return (
    <Stack gap="lg">
      <SettingsCard>
        <SectionHead title={t('settings.configFile.title')} desc={t('settings.configFile.desc')} />
        <Button
          variant="light"
          leftSection={<IconFileCode size={16} />}
          onClick={() => setEditorOpen(true)}
          style={{ alignSelf: 'flex-start' }}
        >
          {t('settings.configFile.openEditor')}
        </Button>
        <ConfigEditorModal opened={editorOpen} onClose={() => setEditorOpen(false)} />
      </SettingsCard>
      <EnvVarSection />
    </Stack>
  );
}

const ALL_KINDS: NotificationKind[] = ['partner_added', 'schedule', 'mail', 'booking', 'contract', 'workflow_approval', 'diary', 'update'];

function NotificationsSection() {
  const { t } = useI18n();
  const [s, setS] = useState<NotificationSettings>(() => loadNotificationSettings());
  const AUTO_DELETE_OPTIONS = [
    { value: '7', label: t('settings.notifications.autoDelete7d') },
    { value: '30', label: t('settings.notifications.autoDelete30d') },
    { value: 'null', label: t('settings.security.timeoutOff') },
  ];

  const update = (patch: Partial<NotificationSettings>) => {
    setS((prev) => {
      const next = { ...prev, ...patch };
      saveNotificationSettings(next);
      return next;
    });
  };

  const toggleKind = (kind: NotificationKind, val: boolean) => {
    update({ kinds: { ...s.kinds, [kind]: val } });
  };

  // 앱 전용 알림 kind는 해당 앱이 설치돼 있을 때만 노출(삭제 시 자동 숨김). 시스템 kind는 항상.
  const installedAppIds = new Set(getManifests().map((m) => m.id));
  const kinds = visibleNotificationKinds(ALL_KINDS, installedAppIds);

  return (
    <Stack gap="lg">
      <SettingsCard>
        <SectionHead title={t('settings.notifications')} desc={t('settings.notifications.kinds')} />
        <Stack gap="sm">
          {kinds.map((kind) => (
            <Switch
              key={kind}
              label={t(`notifications.kind.${kind}` as any)}
              description={t(`settings.notifications.desc.${kind}` as any)}
              checked={s.kinds[kind]}
              onChange={(e) => toggleKind(kind, e.currentTarget.checked)}
            />
          ))}
        </Stack>
      </SettingsCard>

      <SettingsCard>
        <Stack gap="md">
          <Switch
            label={t('settings.notifications.sound')}
            checked={s.sound}
            onChange={(e) => update({ sound: e.currentTarget.checked })}
          />
          <Switch
            label={t('settings.notifications.toast')}
            checked={s.toast}
            onChange={(e) => update({ toast: e.currentTarget.checked })}
          />
          <Stack gap={6}>
            <FieldLabel>{t('settings.notifications.autoDelete')}</FieldLabel>
            <Select
              value={s.autoDeleteDays === null ? 'null' : String(s.autoDeleteDays)}
              onChange={(val) => {
                if (!val) return;
                const days = val === 'null' ? null : (Number(val) as 7 | 30);
                update({ autoDeleteDays: days });
              }}
              data={AUTO_DELETE_OPTIONS}
              allowDeselect={false}
              comboboxProps={{ withinPortal: true }}
            />
          </Stack>
        </Stack>
      </SettingsCard>
    </Stack>
  );
}

// 설정 > 직원 — AI 직원 로스터 요약 (/api/staff). 상세 관리는 직원 패널로 연결.
interface StaffRosterMember { id: string; name: string; role: string; model?: string | null; busy: boolean }
interface StaffRosterTeam { name: string; lead: StaffRosterMember | null; members: StaffRosterMember[] }
function StaffSection({ onOpenStaff }: { onOpenStaff?: () => void }) {
  const { t } = useI18n();
  const [genie, setGenie] = useState<StaffRosterMember | null>(null);
  const [teams, setTeams] = useState<StaffRosterTeam[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/staff');
        const body = await res.json();
        setGenie(body.genie ?? null);
        setTeams(Array.isArray(body.teams) ? body.teams : []);
      } catch { /* 로스터 조회 실패 — 빈 목록 표시 */ }
      setLoading(false);
    })();
  }, []);

  const rows: StaffRosterMember[] = [
    ...(genie ? [genie] : []),
    ...teams.flatMap((tm) => [...(tm.lead ? [tm.lead] : []), ...tm.members]),
  ];

  return (
    <Stack gap="lg">
      <SettingsCard>
        <SectionHead title={t('settings.staff.title')} desc={t('settings.staff.desc')} />
        {loading ? (
          <Text style={{ fontSize: 'var(--font-s)', color: 'var(--text-muted)' }}>…</Text>
        ) : (
          <Stack gap={0}>
            {rows.map((m, i) => (
              <Group key={m.id} justify="space-between" py={10} style={{ borderTop: i > 0 ? '1px solid var(--border-default)' : undefined }}>
                <Group gap={10}>
                  <Text style={{ fontSize: 'var(--font-m)', fontWeight: 600, color: 'var(--text-primary)' }}>{m.name}</Text>
                  <Text style={{ fontSize: 'var(--font-s)', color: 'var(--text-muted)' }}>{m.role}</Text>
                </Group>
                <Group gap={8}>
                  {m.model && <Badge size="sm" variant="light" color="gray">{m.model}</Badge>}
                  {m.busy && <Badge size="sm" variant="light" color="jarvis">{t('settings.staff.busy')}</Badge>}
                </Group>
              </Group>
            ))}
          </Stack>
        )}
        <Group justify="flex-end" mt="md">
          <Button variant="light" color="jarvis" leftSection={<IconUsers size={16} stroke={1.5} />} onClick={onOpenStaff}>
            {t('settings.staff.openPanel')}
          </Button>
        </Group>
      </SettingsCard>
    </Stack>
  );
}

export default function SettingsModal({ opened, onClose, initialCategory, onOpenStaff }: Props) {
  const { t } = useI18n();
  const [category, setCategory] = useState<Category>(() => (initialCategory as Category) ?? 'general');

  useEffect(() => {
    if (opened && initialCategory) setCategory(initialCategory as Category);
  }, [opened, initialCategory]);

  // 좌측 네비 — 9개 항목을 3개 논리 그룹으로 묶어 스캔성 향상. 그룹 헤더는 시각 구분용(비인터랙티브).
  const navGroups: { heading: string; items: { id: Category; label: string; icon: React.ReactNode }[] }[] = [
    {
      heading: t('settings.groupGeneral'),
      items: [
        { id: 'general', label: t('settings.general'), icon: <IconSettings size={16} stroke={1.5} /> },
        { id: 'staff', label: t('settings.staff'), icon: <IconUsers size={16} stroke={1.5} /> },
        { id: 'notes', label: t('settings.notes'), icon: <IconNotes size={16} stroke={1.5} /> },
        { id: 'notifications', label: t('settings.notifications'), icon: <IconBell size={16} stroke={1.5} /> },
      ],
    },
    {
      heading: t('settings.groupIntegration'),
      items: [
        { id: 'keys', label: t('settings.apiKeys'), icon: <IconKey size={16} stroke={1.5} /> },
        { id: 'services', label: t('settings.services'), icon: <IconApps size={16} stroke={1.5} /> },
        { id: 'store', label: t('settings.store'), icon: <IconShoppingBag size={16} stroke={1.5} /> },
      ],
    },
    {
      heading: t('settings.groupSecurityPrivacy'),
      items: [
        { id: 'security', label: t('settings.security'), icon: <IconShield size={16} stroke={1.5} /> },
        { id: 'privacy', label: t('settings.privacy'), icon: <IconLock size={16} stroke={1.5} /> },
        { id: 'data', label: t('settings.data'), icon: <IconDatabase size={16} stroke={1.5} /> },
        { id: 'config', label: t('settings.configFile'), icon: <IconFileCode size={16} stroke={1.5} /> },
      ],
    },
  ];

  return (
    <Modal opened={opened} onClose={onClose} title={t('settings.title')} size="xl" centered>
      <Group align="stretch" wrap="nowrap" gap={0} style={{ minHeight: 420 }}>
        {/* 좌측 사이드바 — 설정 카테고리 (3개 그룹으로 묶음) */}
        <Box style={{ width: 160, flexShrink: 0, borderRight: '1px solid var(--mantine-color-default-border)', paddingRight: 8 }}>
          <Stack gap="sm">
            {navGroups.map((group) => (
              <Box key={group.heading}>
                <Text size="xs" fw={700} c="dimmed" px={8} mb={4} style={{ letterSpacing: 0.4 }}>
                  {group.heading}
                </Text>
                {group.items.map((it) => (
                  <NavLink
                    key={it.id}
                    active={category === it.id}
                    label={it.label}
                    leftSection={it.icon}
                    onClick={() => setCategory(it.id)}
                    style={{ borderRadius: 'var(--mantine-radius-sm)' }}
                  />
                ))}
              </Box>
            ))}
          </Stack>
        </Box>

        {/* 우측 컨텐츠 */}
        <ScrollArea style={{ flex: 1, minWidth: 0 }} pl="md" type="auto">
          {category === 'general' && <GeneralSection />}
          {category === 'staff' && <StaffSection onOpenStaff={() => { onClose(); onOpenStaff?.(); }} />}
          {category === 'notes' && <NotesSection />}
          {category === 'keys' && <KeyVaultPanel />}
          {category === 'security' && <SecuritySection />}
          {category === 'config' && <ConfigSection />}
          {category === 'services' && <ServicePolicyPanel />}
          {category === 'store' && <StorePairingPanel />}
          {category === 'notifications' && <NotificationsSection />}
          {category === 'privacy' && <ConsentSettingsPanel />}
          {category === 'data' && <DataSection />}
        </ScrollArea>
      </Group>
      <Divider mt="md" mb="xs" />
      <Text size="xs" c="dimmed" ta="center">MyCrew v{pkg.version}</Text>
    </Modal>
  );
}
