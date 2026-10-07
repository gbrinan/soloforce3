"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Container,
  Drawer,
  Group,
  Modal,
  NumberInput,
  ScrollArea,
  Select,
  Stack,
  Tabs,
  Text,
  TextInput,
  Textarea,
  Timeline,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { apiUrl } from "@/lib/api-url";

interface Pipeline {
  id: string;
  name: string;
  product: string;
  created_at: string;
}
interface Stage {
  id: string;
  pipeline_id: string;
  name: string;
  sort: number;
  rotting_days: number | null;
}
interface Lead {
  id: string;
  pipeline_id: string;
  stage_id: string;
  title: string;
  contact_name: string;
  contact_channel: string;
  source: "website" | "sns" | "email" | "manual" | "agent";
  value_krw: number;
  memo: string;
  next_action: string;
  next_action_date: string | null;
  created_at: string;
  stage_changed_at: string;
  rotting: boolean;
}
interface LeadEvent {
  id: string;
  lead_id: string;
  ts: string;
  type: string;
  body: string;
}

const KRW = new Intl.NumberFormat("ko-KR");
const fmtKrw = (n: number) => `${KRW.format(n)}원`;

const SOURCE_LABEL: Record<Lead["source"], string> = {
  website: "웹사이트",
  sns: "SNS",
  email: "이메일",
  manual: "수동",
  agent: "에이전트",
};

const EVENT_LABEL: Record<string, string> = {
  stage_change: "스테이지 이동",
  memo: "메모",
  inbound: "인바운드",
  created: "생성",
};

function daysInStage(lead: Lead): number {
  const ms = Date.now() - new Date(lead.stage_changed_at).getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export default function LeadsPage() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [activePipeline, setActivePipeline] = useState<string | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);

  // 상세 드로어
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [events, setEvents] = useState<LeadEvent[]>([]);
  const [memoText, setMemoText] = useState("");

  // 리드 추가 폼
  const [addOpen, setAddOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContact, setNewContact] = useState("");
  const [newChannel, setNewChannel] = useState("");
  const [newSource, setNewSource] = useState<string | null>("manual");
  const [newValue, setNewValue] = useState<number | string>("");
  const [newMemo, setNewMemo] = useState("");

  // 파이프라인 추가 폼
  const [pipeOpen, setPipeOpen] = useState(false);
  const [pipeName, setPipeName] = useState("");
  const [pipeProduct, setPipeProduct] = useState("");

  const loadPipelines = useCallback(async () => {
    try {
      const rows = await fetchJson<Pipeline[]>("/api/pipelines");
      setPipelines(rows);
      setActivePipeline((cur) => cur && rows.some((p) => p.id === cur) ? cur : rows[0]?.id ?? null);
    } catch (e) {
      notifications.show({ color: "red", message: `파이프라인 로드 실패: ${(e as Error).message}` });
    }
  }, []);

  const loadBoard = useCallback(async (pipelineId: string) => {
    try {
      const [st, ld] = await Promise.all([
        fetchJson<Stage[]>(`/api/stages?pipeline=${pipelineId}`),
        fetchJson<Lead[]>(`/api/leads?pipeline=${pipelineId}`),
      ]);
      setStages(st);
      setLeads(ld);
    } catch (e) {
      notifications.show({ color: "red", message: `보드 로드 실패: ${(e as Error).message}` });
    }
  }, []);

  useEffect(() => {
    void loadPipelines();
  }, [loadPipelines]);

  useEffect(() => {
    if (activePipeline) void loadBoard(activePipeline);
  }, [activePipeline, loadBoard]);

  const openLead = useCallback(async (lead: Lead) => {
    setSelectedLead(lead);
    setMemoText("");
    try {
      setEvents(await fetchJson<LeadEvent[]>(`/api/leads/${lead.id}/events`));
    } catch {
      setEvents([]);
    }
  }, []);

  const refreshAfterChange = useCallback(async () => {
    if (activePipeline) await loadBoard(activePipeline);
  }, [activePipeline, loadBoard]);

  const moveStage = useCallback(
    async (lead: Lead, stageId: string) => {
      try {
        await fetchJson(`/api/leads/${lead.id}/stage`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stageId }),
        });
        await refreshAfterChange();
        const updated = { ...lead, stage_id: stageId, stage_changed_at: new Date().toISOString() };
        setSelectedLead(updated);
        setEvents(await fetchJson<LeadEvent[]>(`/api/leads/${lead.id}/events`));
        notifications.show({ color: "teal", message: "스테이지를 이동했습니다" });
      } catch (e) {
        notifications.show({ color: "red", message: `이동 실패: ${(e as Error).message}` });
      }
    },
    [refreshAfterChange],
  );

  const addMemo = useCallback(async () => {
    if (!selectedLead || memoText.trim().length === 0) return;
    try {
      await fetchJson(`/api/leads/${selectedLead.id}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: memoText.trim() }),
      });
      setMemoText("");
      setEvents(await fetchJson<LeadEvent[]>(`/api/leads/${selectedLead.id}/events`));
      notifications.show({ color: "teal", message: "메모를 추가했습니다" });
    } catch (e) {
      notifications.show({ color: "red", message: `메모 추가 실패: ${(e as Error).message}` });
    }
  }, [selectedLead, memoText]);

  const createLead = useCallback(async () => {
    if (!activePipeline || newTitle.trim().length === 0 || !newSource) return;
    const firstStage = stages[0];
    if (!firstStage) return;
    try {
      await fetchJson("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipelineId: activePipeline,
          stageId: firstStage.id,
          title: newTitle.trim(),
          contact_name: newContact,
          contact_channel: newChannel,
          source: newSource,
          value_krw: typeof newValue === "number" ? newValue : 0,
          memo: newMemo,
        }),
      });
      setAddOpen(false);
      setNewTitle("");
      setNewContact("");
      setNewChannel("");
      setNewValue("");
      setNewMemo("");
      await refreshAfterChange();
      notifications.show({ color: "teal", message: "리드를 추가했습니다" });
    } catch (e) {
      notifications.show({ color: "red", message: `리드 추가 실패: ${(e as Error).message}` });
    }
  }, [activePipeline, stages, newTitle, newContact, newChannel, newSource, newValue, newMemo, refreshAfterChange]);

  const createPipeline = useCallback(async () => {
    if (pipeName.trim().length === 0) return;
    try {
      const created = await fetchJson<Pipeline>("/api/pipelines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: pipeName.trim(), product: pipeProduct.trim() }),
      });
      setPipeOpen(false);
      setPipeName("");
      setPipeProduct("");
      await loadPipelines();
      setActivePipeline(created.id);
      notifications.show({ color: "teal", message: "파이프라인을 추가했습니다 (기본 스테이지 4종 생성)" });
    } catch (e) {
      notifications.show({ color: "red", message: `파이프라인 추가 실패: ${(e as Error).message}` });
    }
  }, [pipeName, pipeProduct, loadPipelines]);

  const leadsByStage = useMemo(() => {
    const map = new Map<string, Lead[]>();
    for (const s of stages) map.set(s.id, []);
    for (const l of leads) map.get(l.stage_id)?.push(l);
    return map;
  }, [stages, leads]);

  const selectedStage = selectedLead ? stages.find((s) => s.id === selectedLead.stage_id) : undefined;

  return (
    <Container size="xl" py="md">
      <Group justify="space-between" mb="md">
        <Title order={2}>📇 리드 파이프라인</Title>
        <Group>
          <Button variant="light" onClick={() => setPipeOpen(true)}>
            + 파이프라인 추가
          </Button>
          <Button onClick={() => setAddOpen(true)} disabled={!activePipeline || stages.length === 0}>
            + 리드 추가
          </Button>
        </Group>
      </Group>

      <Tabs value={activePipeline} onChange={setActivePipeline} mb="md">
        <Tabs.List>
          {pipelines.map((p) => (
            <Tabs.Tab key={p.id} value={p.id}>
              {p.name}
              {p.product ? ` · ${p.product}` : ""}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>

      <ScrollArea type="auto">
        <Group align="flex-start" wrap="nowrap" gap="md" style={{ minHeight: 400 }}>
          {stages.map((stage) => {
            const columnLeads = leadsByStage.get(stage.id) ?? [];
            return (
              <Stack key={stage.id} gap="xs" style={{ minWidth: 260, flex: "0 0 260px" }}>
                <Group justify="space-between" px={4}>
                  <Text fw={600} size="sm">
                    {stage.name}
                  </Text>
                  <Group gap={4}>
                    {stage.rotting_days != null && (
                      <Text size="xs" c="dimmed">
                        정체 {stage.rotting_days}일
                      </Text>
                    )}
                    <Badge size="sm" variant="light" color="gray">
                      {columnLeads.length}
                    </Badge>
                  </Group>
                </Group>
                {columnLeads.map((lead) => (
                  <Card
                    key={lead.id}
                    withBorder
                    padding="sm"
                    style={{ cursor: "pointer" }}
                    onClick={() => void openLead(lead)}
                  >
                    <Group justify="space-between" wrap="nowrap" gap={4}>
                      <Text fw={500} size="sm" lineClamp={2}>
                        {lead.title}
                      </Text>
                      {lead.rotting && (
                        <Badge color="orange" size="sm" variant="filled">
                          ⚠️ 정체
                        </Badge>
                      )}
                    </Group>
                    {lead.contact_name && (
                      <Text size="xs" c="dimmed">
                        {lead.contact_name}
                        {lead.contact_channel ? ` (${lead.contact_channel})` : ""}
                      </Text>
                    )}
                    <Group justify="space-between" mt={6}>
                      {lead.value_krw > 0 ? (
                        <Text size="xs" fw={600} c="indigo.3">
                          {fmtKrw(lead.value_krw)}
                        </Text>
                      ) : (
                        <span />
                      )}
                      <Text size="xs" c="dimmed">
                        {daysInStage(lead)}일 경과
                      </Text>
                    </Group>
                  </Card>
                ))}
                {columnLeads.length === 0 && (
                  <Text size="xs" c="dimmed" ta="center" py="md">
                    리드 없음
                  </Text>
                )}
              </Stack>
            );
          })}
        </Group>
      </ScrollArea>

      {/* 리드 상세 드로어 */}
      <Drawer
        opened={selectedLead != null}
        onClose={() => setSelectedLead(null)}
        position="right"
        size="md"
        title={selectedLead?.title ?? ""}
      >
        {selectedLead && (
          <Stack gap="md">
            <Group gap="xs">
              <Badge variant="light">{SOURCE_LABEL[selectedLead.source]}</Badge>
              <Badge variant="light" color="gray">
                {selectedStage?.name ?? "?"}
              </Badge>
              {selectedLead.rotting && (
                <Badge color="orange">⚠️ 정체 ({daysInStage(selectedLead)}일)</Badge>
              )}
            </Group>
            {selectedLead.contact_name && (
              <Text size="sm">
                연락처: {selectedLead.contact_name}
                {selectedLead.contact_channel ? ` (${selectedLead.contact_channel})` : ""}
              </Text>
            )}
            {selectedLead.value_krw > 0 && (
              <Text size="sm">예상 가치: {fmtKrw(selectedLead.value_krw)}</Text>
            )}
            {selectedLead.memo && (
              <Text size="sm" c="dimmed">
                {selectedLead.memo}
              </Text>
            )}

            <div>
              <Text fw={600} size="sm" mb={6}>
                스테이지 이동
              </Text>
              <Group gap="xs">
                {stages
                  .filter((s) => s.id !== selectedLead.stage_id)
                  .map((s) => (
                    <Button
                      key={s.id}
                      size="xs"
                      variant="light"
                      onClick={() => void moveStage(selectedLead, s.id)}
                    >
                      → {s.name}
                    </Button>
                  ))}
              </Group>
            </div>

            <div>
              <Text fw={600} size="sm" mb={6}>
                메모 추가
              </Text>
              <Textarea
                value={memoText}
                onChange={(e) => setMemoText(e.currentTarget.value)}
                placeholder="메모 내용"
                autosize
                minRows={2}
              />
              <Button size="xs" mt={6} onClick={() => void addMemo()} disabled={memoText.trim().length === 0}>
                추가
              </Button>
            </div>

            <div>
              <Text fw={600} size="sm" mb={6}>
                타임라인
              </Text>
              <Timeline bulletSize={16} lineWidth={2}>
                {[...events].reverse().map((ev) => (
                  <Timeline.Item key={ev.id} title={EVENT_LABEL[ev.type] ?? ev.type}>
                    <Text size="xs">{ev.body}</Text>
                    <Text size="xs" c="dimmed">
                      {new Date(ev.ts).toLocaleString("ko-KR")}
                    </Text>
                  </Timeline.Item>
                ))}
              </Timeline>
              {events.length === 0 && (
                <Text size="xs" c="dimmed">
                  기록 없음
                </Text>
              )}
            </div>
          </Stack>
        )}
      </Drawer>

      {/* 리드 추가 모달 */}
      <Modal opened={addOpen} onClose={() => setAddOpen(false)} title="리드 추가">
        <Stack gap="sm">
          <TextInput
            label="제목"
            required
            value={newTitle}
            onChange={(e) => setNewTitle(e.currentTarget.value)}
            placeholder="예: OO회사 강의 문의"
          />
          <TextInput
            label="담당자 이름"
            value={newContact}
            onChange={(e) => setNewContact(e.currentTarget.value)}
          />
          <TextInput
            label="연락 채널"
            value={newChannel}
            onChange={(e) => setNewChannel(e.currentTarget.value)}
            placeholder="이메일 / 전화 / 카카오톡 등"
          />
          <Select
            label="유입 경로"
            data={Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value, label }))}
            value={newSource}
            onChange={setNewSource}
          />
          <NumberInput
            label="예상 가치 (원)"
            value={newValue}
            onChange={setNewValue}
            min={0}
            thousandSeparator=","
          />
          <Textarea
            label="메모"
            value={newMemo}
            onChange={(e) => setNewMemo(e.currentTarget.value)}
            autosize
            minRows={2}
          />
          <Button onClick={() => void createLead()} disabled={newTitle.trim().length === 0 || !newSource}>
            추가
          </Button>
        </Stack>
      </Modal>

      {/* 파이프라인 추가 모달 */}
      <Modal opened={pipeOpen} onClose={() => setPipeOpen(false)} title="파이프라인 추가">
        <Stack gap="sm">
          <TextInput
            label="이름"
            required
            value={pipeName}
            onChange={(e) => setPipeName(e.currentTarget.value)}
            placeholder="예: AI 교육 과정"
          />
          <TextInput
            label="제품/서비스"
            value={pipeProduct}
            onChange={(e) => setPipeProduct(e.currentTarget.value)}
            placeholder="제품/서비스명 (선택)"
          />
          <Text size="xs" c="dimmed">
            기본 스테이지 4종(문의→미팅→견적→계약완료)이 자동 생성됩니다.
          </Text>
          <Button onClick={() => void createPipeline()} disabled={pipeName.trim().length === 0}>
            추가
          </Button>
        </Stack>
      </Modal>
    </Container>
  );
}
