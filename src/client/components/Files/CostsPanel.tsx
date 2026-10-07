import React, { useState, useEffect, useCallback } from 'react';
import {
  Stack, Group, Text, Card, Button, ActionIcon, SegmentedControl, Table, ScrollArea, Tabs, Progress,
} from '@mantine/core';
import { IconX, IconChevronLeft, IconChevronRight, IconRefresh } from '@tabler/icons-react';
import DrawerSubHeader from '../DrawerSubHeader';
import { useT } from '../../i18n/I18nProvider';
import { formatCodexWindowLabel } from './codexUsage';
import { hasAntigravityUsageHistory, selectAntigravityDisplayModel } from './antigravityUsage';
import { prettyModel } from '../Staff/modelDisplay';

interface AgentCost {
  name?: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  calls: number;
}

interface DateCost {
  costUsd: number;
  calls: number;
}

interface CostsData {
  totalCost: number;
  totalEntries: number;
  byAgent: Record<string, AgentCost>;
  byDate: Record<string, DateCost>;
}

interface DetailEntry {
  timestamp: string;
  agentId: string;
  agentName?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  costUsd?: number;
  durationMs?: number;
}

interface RollingAgent {
  agentId: string;
  agentName: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  weightPct: number;
}

interface RollingData {
  window: '5h' | '7d';
  from: string;
  to: string;
  total: { inputTokens: number; outputTokens: number; cost: number; sessions: number };
  byAgent: RollingAgent[];
  planUsagePct: number | null;
}

interface ClaudeBucket {
  key: string;
  label: string;
  utilization: number;
  resetsAt: string | null;
}

interface ClaudeUsage {
  available: boolean;
  reason?: string;
  subscriptionType: string | null;
  buckets: ClaudeBucket[];
  asOf: string;
}

interface CodexRateWindow {
  usedPercent: number;
  windowMinutes: number;
  resetsAt: number | null;
}

interface CodexUsage {
  available: boolean;
  reason?: string;
  model: string | null;
  planType: string | null;
  primary: CodexRateWindow | null;
  secondary: CodexRateWindow | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  asOf: string | null;
}

interface AntigravityUsage {
  available: boolean;
  reason?: string;
  configuredModel: string | null;
  recentActualModel: string | null;
  cliBinaryPath: string | null;
  recent24hTokens: number | null;
  recent7dTokens: number | null;
  recent7dCalls: number;
  asOf: string | null;
}

interface TokenUsageData {
  claude: ClaudeUsage;
  codex: CodexUsage;
  antigravity: AntigravityUsage;
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtUntilMs(ms: number, t: ReturnType<typeof useT>): string {
  if (Number.isNaN(ms)) return '';
  if (ms <= 0) return t('costs.reset');
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h >= 24) return t('costs.resetInDays', { d: Math.floor(h / 24), h: h % 24 });
  if (h > 0) return t('costs.resetInHours', { h, m });
  return t('costs.resetInMins', { m });
}

function fmtReset(resetsAt: number | null, t: ReturnType<typeof useT>): string {
  if (!resetsAt) return '';
  return fmtUntilMs(resetsAt * 1000 - Date.now(), t);
}

function fmtResetIso(iso: string | null, t: ReturnType<typeof useT>): string {
  if (!iso) return '';
  return fmtUntilMs(Date.parse(iso) - Date.now(), t);
}

export default function CostsPanel({ visible, onClose }: Props) {
  const t = useT();
  const now = new Date();
  const [mode, setMode] = useState<'month' | 'day' | '5h' | '7d'>('month');
  const [rollingData, setRollingData] = useState<RollingData | null>(null);
  const [rollingLoading, setRollingLoading] = useState(false);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [day, setDay] = useState(now.getDate());
  const [data, setData] = useState<CostsData | null>(null);
  const [detail, setDetail] = useState<{ title: string; entries: DetailEntry[] } | null>(null);
  const [tab, setTab] = useState<'token' | 'cost'>('token');
  const [token, setToken] = useState<TokenUsageData | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);   // 리프레시 버튼 공용 로딩 — token/cost 탭 양쪽 경로 커버
  const [lastSync, setLastSync] = useState<Date | null>(null);

  // fresh=true(수동 동기화)면 서버 60초 캐시를 우회해 최신 세션 스냅샷을 강제 재집계.
  const loadToken = async (fresh = false) => {
    setTokenLoading(true);
    try {
      const res = await fetch(`/api/token-usage${fresh ? '?fresh=1' : ''}`);
      setToken(await res.json());
      setLastSync(new Date());
    } catch {
      setToken(null);
    } finally {
      setTokenLoading(false);
    }
  };

  useEffect(() => {
    if (visible && tab === 'token') loadToken();
  }, [visible, tab]);

  const load = async () => {
    try {
      let from: string, to: string;
      if (mode === 'month') {
        from = `${year}-${String(month).padStart(2, '0')}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      } else {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        from = dateStr;
        to = dateStr;
      }
      const res = await fetch(`/api/costs?from=${from}&to=${to}`);
      const d = await res.json();
      setData(d);
      setLastSync(new Date());
    } catch {
      setData(null);
    }
  };

  const loadRolling = async (win: '5h' | '7d') => {
    setRollingLoading(true);
    try {
      const res = await fetch(`/api/costs/rolling?window=${win}`);
      setRollingData(await res.json());
      setLastSync(new Date());
    } catch {
      setRollingData(null);
    } finally {
      setRollingLoading(false);
    }
  };

  useEffect(() => {
    if (!visible) return;
    if (mode === '5h' || mode === '7d') loadRolling(mode);
    else load();
  }, [visible, year, month, day, mode]);

  // 수동/자동 동기화 — 토큰 탭은 로컬 사용량 스냅샷을 다시 읽고, 비용 탭은 기존 동작.
  const syncAll = useCallback(async () => {
    setSyncing(true);
    try {
      if (tab === 'token') {
        await loadToken(true);
      } else if (mode === '5h' || mode === '7d') {
        await loadRolling(mode);
      } else {
        await load();
      }
    } finally {
      setSyncing(false);
    }
  // load/loadToken/loadRolling은 매 렌더 재생성되나 닫힌 클로저로 최신 state 참조.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, year, month, day, mode]);

  // 10분 자동 동기화 — 드로우가 열려 있는 동안만. 닫히면 cleanup.
  useEffect(() => {
    if (!visible) return;
    const iv = setInterval(() => { void syncAll(); }, 600_000);
    return () => clearInterval(iv);
  }, [visible, syncAll]);

  const move = (delta: number) => {
    setDetail(null);
    if (mode === 'month') {
      let m = month + delta;
      let y = year;
      if (m < 1) { m = 12; y--; }
      if (m > 12) { m = 1; y++; }
      setMonth(m);
      setYear(y);
    } else {
      const d = new Date(year, month - 1, day + delta);
      setYear(d.getFullYear());
      setMonth(d.getMonth() + 1);
      setDay(d.getDate());
    }
  };

  const showDetail = async (title: string, query: string) => {
    try {
      const res = await fetch(`/api/costs/detail?${query}`);
      const entries = await res.json();
      const sorted = Array.isArray(entries)
        ? [...entries].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
        : [];
      setDetail({ title, entries: sorted });
    } catch { /* */ }
  };

  if (!visible) return null;

  const agentList = data ? Object.entries(data.byAgent).sort((a, b) => b[1].costUsd - a[1].costUsd) : [];
  const dateList = data ? Object.entries(data.byDate).sort((a, b) => b[0].localeCompare(a[0])) : [];

  if (detail) {
    return (
      <Stack h="100%" gap={0}>
        <DrawerSubHeader title={detail.title} onBack={() => setDetail(null)} />
        <ScrollArea style={{ flex: 1 }}>
          {detail.entries.length === 0 ? (
            <Text c="dimmed" ta="center" py="lg">{t('costs.noData')}</Text>
          ) : (
            <Table fz="xs" striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('costs.colTime')}</Table.Th>
                  <Table.Th>{t('costs.colAgent')}</Table.Th>
                  <Table.Th ta="right">{t('costs.colInput')}</Table.Th>
                  <Table.Th ta="right">{t('costs.colCache')}</Table.Th>
                  <Table.Th ta="right">{t('costs.colOutput')}</Table.Th>
                  <Table.Th ta="right">{t('costs.colCost')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {detail.entries.map((e, i) => (
                  <Table.Tr key={i}>
                    <Table.Td>
                      {new Date(e.timestamp).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })}{' '}
                      {new Date(e.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                    </Table.Td>
                    <Table.Td>{e.agentName ?? e.agentId}</Table.Td>
                    <Table.Td ta="right">{((e.inputTokens || 0) / 1000).toFixed(1)}K</Table.Td>
                    <Table.Td ta="right">{((e.cacheReadTokens || 0) / 1000).toFixed(0)}K</Table.Td>
                    <Table.Td ta="right">{((e.outputTokens || 0) / 1000).toFixed(1)}K</Table.Td>
                    <Table.Td ta="right">${(e.costUsd || 0).toFixed(4)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </ScrollArea>
      </Stack>
    );
  }

  return (
    <Stack h="100%" gap={0}>
      <Group justify="space-between" align="center" p="md" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
        <Text fw={600} size="md">{t('nav.tokens')}</Text>
        <Group gap={6} align="center" wrap="nowrap">
          {lastSync && (
            <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
              {t('costs.lastUpdate', { time: lastSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}
            </Text>
          )}
          <ActionIcon variant="subtle" color="gray" onClick={() => { void syncAll(); }} loading={syncing || tokenLoading} aria-label={t('costs.sync')} title={t('costs.sync')}>
            <IconRefresh size={16} stroke={1.5} />
          </ActionIcon>
          <ActionIcon variant="subtle" color="gray" size={36} className="drawer-close" onClick={onClose} aria-label={t('common.close')}>
            <IconX size={18} stroke={1.5} />
          </ActionIcon>
        </Group>
      </Group>

      <Tabs value={tab} onChange={(v) => { setTab((v as 'token' | 'cost') || 'token'); setDetail(null); }} keepMounted={false}>
        <Tabs.List grow>
          <Tabs.Tab value="token">{t('nav.tokens')}</Tabs.Tab>
          <Tabs.Tab value="cost">{t('costs.tabCost')}</Tabs.Tab>
        </Tabs.List>
      </Tabs>

      {tab === 'token' && (
        <ScrollArea style={{ flex: 1 }} p="sm">
          <Stack gap="md">
            {/* Claude — 상단 (/usage 플랜 사용량) */}
            <Card withBorder padding="md">
              <Stack gap={10}>
                <Group justify="space-between" align="center">
                  <Text size="sm" fw={700}>Claude</Text>
                  {token?.claude.available && token.claude.subscriptionType && (
                    <Text size="xs" c="dimmed">{t('costs.plan', { type: token.claude.subscriptionType })}</Text>
                  )}
                </Group>
                {tokenLoading && !token && <Text size="xs" c="dimmed">{t('costs.loading')}</Text>}
                {token?.claude.available ? (
                  token.claude.buckets.length === 0 ? (
                    <Text size="xs" c="dimmed">{t('costs.noLimits')}</Text>
                  ) : (
                    token.claude.buckets.map((b) => (
                      <Stack key={b.key} gap={3}>
                        <Group justify="space-between">
                          <Text size="xs">{b.label}</Text>
                          <Text size="xs" fw={600}>{b.utilization}%</Text>
                        </Group>
                        <Progress
                          value={b.utilization}
                          size="xl"
                          radius="sm"
                          color={b.utilization >= 80 ? 'var(--accent-danger)' : b.utilization >= 50 ? 'var(--accent-warning)' : 'var(--accent-success)'}
                        />
                        {fmtResetIso(b.resetsAt, t) && <Text size="xs" c="dimmed">{fmtResetIso(b.resetsAt, t)}</Text>}
                      </Stack>
                    ))
                  )
                ) : (
                  !tokenLoading && <Text size="xs" c="dimmed">{t('costs.noData')}{token?.claude.reason ? ` (${token.claude.reason})` : ''}</Text>
                )}
              </Stack>
            </Card>

            {/* GPT (Codex) — 중앙 */}
            <Card withBorder padding="md">
              <Stack gap={8}>
                <Group justify="space-between" align="center">
                  <Group gap="xs" align="baseline">
                    <Text size="sm" fw={700}>GPT (Codex)</Text>
                    {token?.codex.available && token.codex.model && (
                      <Text size="xs" c="dimmed">{token.codex.model}</Text>
                    )}
                  </Group>
                  {token?.codex.available && token.codex.planType && <Text size="xs" c="dimmed">{t('costs.plan', { type: token.codex.planType })}</Text>}
                </Group>
                {tokenLoading && !token && <Text size="xs" c="dimmed">{t('costs.loading')}</Text>}
                {token?.codex.available ? (
                  <>
                    {token.codex.primary && (
                      <Stack gap={3}>
                        <Group justify="space-between">
                          <Text size="xs">{formatCodexWindowLabel(token.codex.primary.windowMinutes, t)}</Text>
                          <Text size="xs" fw={600}>{token.codex.primary.usedPercent}%</Text>
                        </Group>
                        <Progress value={token.codex.primary.usedPercent} size="xl" radius="sm" color={token.codex.primary.usedPercent >= 80 ? 'var(--accent-danger)' : token.codex.primary.usedPercent >= 50 ? 'var(--accent-warning)' : 'var(--accent-success)'} />
                        {fmtReset(token.codex.primary.resetsAt, t) && <Text size="xs" c="dimmed">{fmtReset(token.codex.primary.resetsAt, t)}</Text>}
                      </Stack>
                    )}
                    {token.codex.secondary && (
                      <Stack gap={3}>
                        <Group justify="space-between">
                          <Text size="xs">{formatCodexWindowLabel(token.codex.secondary.windowMinutes, t)}</Text>
                          <Text size="xs" fw={600}>{token.codex.secondary.usedPercent}%</Text>
                        </Group>
                        <Progress value={token.codex.secondary.usedPercent} size="xl" radius="sm" color={token.codex.secondary.usedPercent >= 80 ? 'var(--accent-danger)' : token.codex.secondary.usedPercent >= 50 ? 'var(--accent-warning)' : 'var(--accent-success)'} />
                        {fmtReset(token.codex.secondary.resetsAt, t) && <Text size="xs" c="dimmed">{fmtReset(token.codex.secondary.resetsAt, t)}</Text>}
                      </Stack>
                    )}
                    {token.codex.totalTokens != null && (
                      <Text size="xs" c="dimmed">{t('costs.recentSessionTokens', { n: fmtTokens(token.codex.totalTokens) })}</Text>
                    )}
                    {token.codex.asOf && (
                      <Text size="xs" c="dimmed">
                        {t('costs.snapshotBasis', { date: new Date(token.codex.asOf).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) })}
                      </Text>
                    )}
                  </>
                ) : (
                  !tokenLoading && <Text size="xs" c="dimmed">{t('costs.noData')}{token?.codex.reason ? ` (${token.codex.reason})` : ''}</Text>
                )}
              </Stack>
            </Card>

            {/* Antigravity (Gemini) — 외부 quota가 아닌 마이크루 로컬 누적 사용량. */}
            <Card withBorder padding="md">
              <Stack gap={10}>
                <Group justify="space-between" align="center">
                  <Group gap="xs" align="baseline">
                    <Text size="sm" fw={700}>Antigravity (Gemini)</Text>
                    {token?.antigravity.available && selectAntigravityDisplayModel(token.antigravity.configuredModel, token.antigravity.recentActualModel) && (
                      <Text size="xs" c="dimmed">
                        {prettyModel(selectAntigravityDisplayModel(token.antigravity.configuredModel, token.antigravity.recentActualModel))}
                      </Text>
                    )}
                  </Group>
                  {token?.antigravity.available && token.antigravity.cliBinaryPath && (
                    <Text size="xs" c="dimmed">{t('costs.cliBinary', { path: token.antigravity.cliBinaryPath })}</Text>
                  )}
                </Group>
                {tokenLoading && !token && <Text size="xs" c="dimmed">{t('costs.loading')}</Text>}
                {token?.antigravity.available && !hasAntigravityUsageHistory(token.antigravity) ? (
                  <Text size="xs" c="dimmed">{t('costs.noRecentUsage')}</Text>
                ) : token?.antigravity.available ? (
                  (() => {
                    const ANTIGRAVITY_24H_LIMIT = 1_000_000;
                    const ANTIGRAVITY_7D_LIMIT = 5_000_000;
                    const t24 = token.antigravity.recent24hTokens ?? 0;
                    const t7 = token.antigravity.recent7dTokens ?? 0;
                    const pct24 = Math.min(100, Math.round((t24 / ANTIGRAVITY_24H_LIMIT) * 100));
                    const pct7 = Math.min(100, Math.round((t7 / ANTIGRAVITY_7D_LIMIT) * 100));
                    return (
                      <>
                        <Text size="xs" fw={600} c="dimmed">{t('costs.localAccumulatedUsage')}</Text>
                        <Stack gap={3}>
                          <Group justify="space-between">
                            <Text size="xs">{t('costs.rolling24h')}</Text>
                            <Text size="xs" fw={600}>{pct24}%</Text>
                          </Group>
                          <Progress
                            value={pct24}
                            size="xl"
                            radius="sm"
                            color={pct24 >= 80 ? 'var(--accent-danger)' : pct24 >= 50 ? 'var(--accent-warning)' : 'var(--accent-success)'}
                          />
                          <Text size="xs" c="dimmed">{t('costs.recent24hTokens', { n: fmtTokens(t24) })}</Text>
                        </Stack>
                        <Stack gap={3}>
                          <Group justify="space-between">
                            <Text size="xs">{t('costs.rolling7d')}</Text>
                            <Text size="xs" fw={600}>{pct7}%</Text>
                          </Group>
                          <Progress
                            value={pct7}
                            size="xl"
                            radius="sm"
                            color={pct7 >= 80 ? 'var(--accent-danger)' : pct7 >= 50 ? 'var(--accent-warning)' : 'var(--accent-success)'}
                          />
                          <Text size="xs" c="dimmed">{t('costs.recent7dTokens', { n: fmtTokens(t7) })}</Text>
                        </Stack>
                        <Text size="xs" c="dimmed">{t('costs.callCount', { n: token.antigravity.recent7dCalls })}</Text>
                        {token.antigravity.asOf && (
                          <Text size="xs" c="dimmed">
                            {t('costs.localSnapshotBasis', { date: new Date(token.antigravity.asOf).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) })}
                          </Text>
                        )}
                      </>
                    );
                  })()
                ) : (
                  !tokenLoading && <Text size="xs" c="dimmed">{t('costs.noData')}{token?.antigravity.reason ? ` (${token.antigravity.reason})` : ''}</Text>
                )}
              </Stack>
            </Card>
          </Stack>
        </ScrollArea>
      )}

      {tab === 'cost' && (
      <>
      {/* 롤링 윈도우 헤더 — 날짜 네비 불필요, 간단한 기간 표시만 */}
      {(mode === '5h' || mode === '7d') && (
        <Stack gap="xs" p="sm" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
          <Group justify="center">
            <SegmentedControl
              size="xs"
              value={mode}
              onChange={(v) => { setMode(v as 'month' | 'day' | '5h' | '7d'); setDetail(null); }}
              data={[
                { label: t('costs.monthly'), value: 'month' },
                { label: t('costs.daily'), value: 'day' },
                { label: t('costs.rolling5h'), value: '5h' },
                { label: t('costs.rolling7d'), value: '7d' },
              ]}
            />
          </Group>
          {rollingData && (
            <Text size="xs" c="dimmed" ta="center">
              {new Date(rollingData.from).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
              {' — '}
              {new Date(rollingData.to).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </Text>
          )}
        </Stack>
      )}

      {(mode === '5h' || mode === '7d') && (
        <ScrollArea style={{ flex: 1 }} p="sm">
          {rollingLoading && !rollingData ? (
            <Text c="dimmed" ta="center" py="lg">{t('costs.loading')}</Text>
          ) : rollingData ? (
            <Stack gap="sm">
              {/* 합계 카드 */}
              <Card withBorder padding="md">
                <Stack gap={4} align="center">
                  <Text size="xl" fw={700} c="jarvis.4">${rollingData.total.cost.toFixed(4)}</Text>
                  <Text size="xs" c="dimmed">{t('costs.rolling.totalTokens', { n: fmtTokens(rollingData.total.inputTokens + rollingData.total.outputTokens) })}</Text>
                  <Text size="xs" c="dimmed">{t('costs.callCount', { n: rollingData.total.sessions })}</Text>
                </Stack>
              </Card>

              {/* 플랜 게이지 */}
              {rollingData.planUsagePct !== null ? (
                <Card withBorder padding="md">
                  <Stack gap={4}>
                    <Group justify="space-between">
                      <Text size="xs" fw={600}>{t('costs.rolling.planGauge', { pct: rollingData.planUsagePct.toFixed(1) })}</Text>
                      <Text size="xs" fw={600}>{rollingData.planUsagePct.toFixed(1)}%</Text>
                    </Group>
                    <Progress
                      value={rollingData.planUsagePct}
                      size="xl"
                      radius="sm"
                      color={
                        rollingData.planUsagePct >= 80 ? 'var(--accent-danger)'
                          : rollingData.planUsagePct >= 50 ? 'var(--accent-warning)'
                          : 'var(--accent-success)'
                      }
                    />
                  </Stack>
                </Card>
              ) : null}

              {/* 직원별 비중 */}
              {rollingData.byAgent.length > 0 && (
                <Stack gap={4}>
                  <Text size="xs" fw={600} c="dimmed">{t('costs.rolling.byAgent')}</Text>
                  {rollingData.byAgent.map((a) => (
                    <Card key={a.agentId} withBorder radius="sm" padding="xs">
                      <Group justify="space-between" gap="xs" mb={4}>
                        <Text size="xs">{a.agentName}</Text>
                        <Group gap={6}>
                          <Text size="xs" c="dimmed">{a.weightPct.toFixed(1)}%</Text>
                          <Text size="xs" c="jarvis.4" fw={600}>${a.cost.toFixed(4)}</Text>
                        </Group>
                      </Group>
                      <Progress
                        value={a.weightPct}
                        size="sm"
                        radius="sm"
                        color="jarvis.5"
                      />
                      <Text size="xs" c="dimmed" mt={2}>
                        {t('costs.tokenBreakdown', {
                          input: (a.inputTokens / 1000).toFixed(1),
                          cache: '0',
                          output: (a.outputTokens / 1000).toFixed(1),
                        })}
                      </Text>
                    </Card>
                  ))}
                </Stack>
              )}

              {rollingData.byAgent.length === 0 && (
                <Text c="dimmed" ta="center" py="lg">{t('costs.noData')}</Text>
              )}
            </Stack>
          ) : (
            <Text c="dimmed" ta="center" py="lg">{t('costs.noData')}</Text>
          )}
        </ScrollArea>
      )}

      {/* 기존 월별/일별 헤더 + 내용 — rolling 모드일 때 숨김 */}
      {(mode !== '5h' && mode !== '7d') && (<>
      <Stack gap="xs" p="sm" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
        <Group justify="center">
          <SegmentedControl
            size="xs"
            value={mode}
            onChange={(v) => { setMode(v as 'month' | 'day' | '5h' | '7d'); setDetail(null); }}
            data={[
              { label: t('costs.monthly'), value: 'month' },
              { label: t('costs.daily'), value: 'day' },
              { label: t('costs.rolling5h'), value: '5h' },
              { label: t('costs.rolling7d'), value: '7d' },
            ]}
          />
        </Group>
        <Group justify="center" gap="md">
          <ActionIcon variant="subtle" color="gray" onClick={() => move(-1)} aria-label={t('common.prev')}>
            <IconChevronLeft size={16} stroke={1.5} />
          </ActionIcon>
          <Text fw={600} size="sm">
            {mode === 'month' ? t('costs.yearMonth', { y: year, m: month }) : t('costs.yearMonthDay', { y: year, m: month, d: day })}
          </Text>
          <ActionIcon variant="subtle" color="gray" onClick={() => move(1)} aria-label={t('common.next')}>
            <IconChevronRight size={16} stroke={1.5} />
          </ActionIcon>
        </Group>
      </Stack>

      <ScrollArea style={{ flex: 1 }} p="sm">
        <Stack gap="sm">
          <Card withBorder padding="md">
            <Stack gap={2} align="center">
              <Text size="xl" fw={700} c="jarvis.4">
                ${data?.totalCost?.toFixed(2) ?? '0.00'}
              </Text>
              <Text size="xs" c="dimmed">{t('costs.callCount', { n: data?.totalEntries ?? 0 })}</Text>
            </Stack>
          </Card>

          {agentList.length > 0 && (
            <Stack gap={4}>
              <Text size="xs" fw={600} c="dimmed">{t('costs.byAgent')}</Text>
              {agentList.map(([agent, info]) => (
                <Card
                  key={agent}
                  withBorder
                  radius="sm"
                  padding="xs"
                  onClick={() => showDetail(t('costs.detailTitle', { name: info.name ?? agent }), `agent=${agent}`)}
                  style={{ cursor: 'pointer' }}
                >
                  <Group justify="space-between" gap="xs">
                    <Text size="xs">{t('costs.nameCount', { name: info.name ?? agent, n: info.calls })}</Text>
                    <Text size="xs" c="jarvis.4" fw={600}>${info.costUsd.toFixed(2)}</Text>
                  </Group>
                  <Text size="xs" c="dimmed" mt={2} style={{ fontSize: 'var(--font-s)', lineHeight: 1.3 }}>
                    {t('costs.tokenBreakdown', { input: (info.inputTokens / 1000).toFixed(0), cache: (info.cacheReadTokens / 1000).toFixed(0), output: (info.outputTokens / 1000).toFixed(0) })}
                  </Text>
                </Card>
              ))}
            </Stack>
          )}

          {dateList.length > 0 && (
            <Stack gap={4}>
              <Text size="xs" fw={600} c="dimmed">{t('costs.byDate')}</Text>
              {dateList.map(([date, info]) => (
                <Card
                  key={date}
                  withBorder
                  radius="sm"
                  padding="xs"
                  onClick={() => showDetail(t('costs.detailTitle', { name: date }), `date=${date}`)}
                  style={{ cursor: 'pointer' }}
                >
                  <Group justify="space-between" gap="xs">
                    <Text size="xs">{t('costs.nameCount', { name: date, n: info.calls })}</Text>
                    <Text size="xs" c="jarvis.4" fw={600}>${info.costUsd.toFixed(2)}</Text>
                  </Group>
                </Card>
              ))}
            </Stack>
          )}

          {!data && <Text c="dimmed" ta="center" py="lg">{t('costs.noData')}</Text>}
        </Stack>
      </ScrollArea>
      </>)}
      </>
      )}
    </Stack>
  );
}
