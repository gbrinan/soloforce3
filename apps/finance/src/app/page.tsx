"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Container,
  Grid,
  Group,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { apiUrl } from "@/lib/api-url";

interface Account {
  id: string;
  name: string;
  type: string;
}
interface Category {
  id: string;
  name: string;
  kind: "income" | "fixed" | "variable" | "subscription";
}
interface Tx {
  id: string;
  date: string;
  amount: number;
  account_id: string;
  category_id: string;
  payee: string;
  memo: string;
}
interface Schedule {
  id: string;
  name: string;
  rule: string;
  amount: number;
  category_id: string;
  payee: string;
  next_date: string;
  active: number;
}
interface Summary {
  month: string;
  income: number;
  fixed: number;
  variable: number;
  subscription: number;
  net: number;
  unconfirmedSubscriptions: Array<{
    schedule_id: string;
    name: string;
    payee: string;
    amount: number;
    expected_date: string;
  }>;
}
interface Flow {
  month: string;
  income: number;
  expense: number;
  net: number;
  projected: boolean;
}

const KRW = new Intl.NumberFormat("ko-KR");
const fmt = (n: number) => `${KRW.format(n)}원`;

const KIND_LABEL: Record<Category["kind"], string> = {
  income: "수입",
  fixed: "고정비",
  variable: "변동비",
  subscription: "구독",
};

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// 간단한 SVG 막대+선 차트 (외부 차트 라이브러리 없이)
function CashflowChart({ flows }: { flows: Flow[] }) {
  if (flows.length === 0) return null;
  const W = 720;
  const H = 220;
  const padL = 8;
  const padB = 28;
  const chartH = H - padB - 10;
  const maxV = Math.max(1, ...flows.map((f) => Math.max(f.income, f.expense, Math.abs(f.net))));
  const band = (W - padL * 2) / flows.length;
  const barW = Math.min(22, band / 3.2);
  const y = (v: number) => chartH - (v / maxV) * (chartH - 10);

  const yNet = (v: number) => Math.min(chartH, Math.max(4, y(v)));
  const netPoints = flows.map((f, i) => `${padL + band * i + band / 2},${yNet(f.net)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }} role="img" aria-label="현금흐름 차트">
      {flows.map((f, i) => {
        const cx = padL + band * i + band / 2;
        return (
          <g key={f.month} opacity={f.projected ? 0.55 : 1}>
            <rect x={cx - barW - 2} y={y(f.income)} width={barW} height={chartH - y(f.income)} fill="#2f9e8f" rx={2} />
            <rect x={cx + 2} y={y(f.expense)} width={barW} height={chartH - y(f.expense)} fill="#e8590c" rx={2} />
            <text x={cx} y={H - 10} textAnchor="middle" fontSize={11} fill="#909296">
              {f.month.slice(2)}{f.projected ? "*" : ""}
            </text>
          </g>
        );
      })}
      <polyline points={netPoints} fill="none" stroke="#845ef7" strokeWidth={2} />
      {flows.map((f, i) => (
        <circle key={f.month} cx={padL + band * i + band / 2} cy={yNet(f.net)} r={3} fill="#845ef7" />
      ))}
    </svg>
  );
}

export default function FinancePage() {
  const month = currentMonth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Tx[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);

  // 거래 추가 폼 상태
  const [txDate, setTxDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [txAmount, setTxAmount] = useState<number | string>("");
  const [txAccount, setTxAccount] = useState<string | null>(null);
  const [txCategory, setTxCategory] = useState<string | null>(null);
  const [txPayee, setTxPayee] = useState("");
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    const [s, f, a, c, t, sc] = await Promise.all([
      fetch(apiUrl(`/api/summary?month=${month}`)).then((r) => r.json()),
      fetch(apiUrl("/api/cashflow?months=6")).then((r) => r.json()),
      fetch(apiUrl("/api/accounts")).then((r) => r.json()),
      fetch(apiUrl("/api/categories")).then((r) => r.json()),
      fetch(apiUrl(`/api/transactions?month=${month}`)).then((r) => r.json()),
      fetch(apiUrl("/api/schedules")).then((r) => r.json()),
    ]);
    setSummary(s);
    setFlows(f);
    setAccounts(a);
    setCategories(c);
    setTransactions(t);
    setSchedules(sc);
  }, [month]);

  useEffect(() => {
    reload().catch(() => notifications.show({ color: "red", message: "데이터를 불러오지 못했습니다" }));
  }, [reload]);

  const categoryName = useMemo(() => {
    const map = new Map(categories.map((c) => [c.id, c.name]));
    return (id: string) => map.get(id) ?? "-";
  }, [categories]);

  async function addTransaction() {
    if (!txAccount || !txCategory || txAmount === "" || Number(txAmount) === 0) {
      notifications.show({ color: "yellow", message: "날짜·금액·계좌·카테고리를 입력하세요" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(apiUrl("/api/transactions"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: txDate,
          amount: Math.trunc(Number(txAmount)),
          account_id: txAccount,
          category_id: txCategory,
          payee: txPayee,
        }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "저장 실패");
      }
      setTxAmount("");
      setTxPayee("");
      notifications.show({ color: "teal", message: "거래가 추가되었습니다" });
      await reload();
    } catch (e) {
      notifications.show({ color: "red", message: e instanceof Error ? e.message : "저장 실패" });
    } finally {
      setSaving(false);
    }
  }

  const unconfirmedIds = new Set(summary?.unconfirmedSubscriptions.map((u) => u.schedule_id) ?? []);

  return (
    <Container size="lg" py="lg">
      <Stack gap="lg">
        <Group justify="space-between">
          <Title order={2}>정산 대시보드</Title>
          <Text c="dimmed">{month}</Text>
        </Group>

        {/* 이번 달 요약 */}
        <SimpleGrid cols={{ base: 2, sm: 5 }}>
          {(
            [
              ["수입", summary?.income ?? 0, "teal"],
              ["고정비", summary?.fixed ?? 0, "orange"],
              ["변동비", summary?.variable ?? 0, "yellow"],
              ["구독", summary?.subscription ?? 0, "grape"],
              ["순현금흐름", summary?.net ?? 0, (summary?.net ?? 0) >= 0 ? "teal" : "red"],
            ] as Array<[string, number, string]>
          ).map(([label, value, color]) => (
            <Card key={label} withBorder padding="md">
              <Text size="sm" c="dimmed">
                {label}
              </Text>
              <Text size="lg" fw={700} c={color}>
                {fmt(value)}
              </Text>
            </Card>
          ))}
        </SimpleGrid>

        {/* 현금흐름 차트 */}
        <Card withBorder padding="md">
          <Group justify="space-between" mb="xs">
            <Text fw={600}>현금흐름 (실적 6개월 + 전망 3개월*)</Text>
            <Group gap="xs">
              <Badge color="teal" variant="dot">수입</Badge>
              <Badge color="orange" variant="dot">지출</Badge>
              <Badge color="violet" variant="dot">순흐름</Badge>
            </Group>
          </Group>
          <CashflowChart flows={flows} />
        </Card>

        <Grid>
          {/* 구독 트래커 */}
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Card withBorder padding="md" h="100%">
              <Group justify="space-between" mb="sm">
                <Text fw={600}>구독 트래커</Text>
                {unconfirmedIds.size > 0 && <Badge color="red">{unconfirmedIds.size}건 미확인</Badge>}
              </Group>
              <Stack gap="xs">
                {schedules.length === 0 && <Text c="dimmed" size="sm">등록된 스케줄이 없습니다</Text>}
                {schedules.map((s) => (
                  <Group key={s.id} justify="space-between">
                    <div>
                      <Text size="sm" fw={500}>
                        {s.name}{" "}
                        {s.active !== 1 && (
                          <Badge size="xs" color="gray" variant="light">중지</Badge>
                        )}{" "}
                        {unconfirmedIds.has(s.id) && (
                          <Badge size="xs" color="red">미확인</Badge>
                        )}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {s.rule} · 다음 {s.next_date} · {categoryName(s.category_id)}
                      </Text>
                    </div>
                    <Text size="sm">{fmt(s.amount)}</Text>
                  </Group>
                ))}
              </Stack>
            </Card>
          </Grid.Col>

          {/* 거래 추가 */}
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Card withBorder padding="md" h="100%">
              <Text fw={600} mb="sm">거래 추가</Text>
              <Stack gap="xs">
                <Group grow>
                  <TextInput label="날짜" type="date" value={txDate} onChange={(e) => setTxDate(e.currentTarget.value)} />
                  <NumberInput
                    label="금액 (원)"
                    value={txAmount}
                    onChange={setTxAmount}
                    thousandSeparator=","
                    allowDecimal={false}
                  />
                </Group>
                <Group grow>
                  <Select
                    label="계좌"
                    data={accounts.map((a) => ({ value: a.id, label: a.name }))}
                    value={txAccount}
                    onChange={setTxAccount}
                  />
                  <Select
                    label="카테고리"
                    data={categories.map((c) => ({ value: c.id, label: `${c.name} (${KIND_LABEL[c.kind]})` }))}
                    value={txCategory}
                    onChange={setTxCategory}
                  />
                </Group>
                <TextInput label="거래처" value={txPayee} onChange={(e) => setTxPayee(e.currentTarget.value)} />
                <Button onClick={addTransaction} loading={saving}>추가</Button>
              </Stack>
            </Card>
          </Grid.Col>
        </Grid>

        {/* 이번 달 거래 목록 */}
        <Card withBorder padding="md">
          <Text fw={600} mb="sm">이번 달 거래</Text>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>날짜</Table.Th>
                <Table.Th>거래처</Table.Th>
                <Table.Th>카테고리</Table.Th>
                <Table.Th style={{ textAlign: "right" }}>금액</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {transactions.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={4}>
                    <Text c="dimmed" size="sm">이번 달 거래가 없습니다</Text>
                  </Table.Td>
                </Table.Tr>
              )}
              {transactions.map((t) => (
                <Table.Tr key={t.id}>
                  <Table.Td>{t.date}</Table.Td>
                  <Table.Td>{t.payee || "-"}</Table.Td>
                  <Table.Td>{categoryName(t.category_id)}</Table.Td>
                  <Table.Td style={{ textAlign: "right" }}>{fmt(t.amount)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      </Stack>
    </Container>
  );
}
