import React, { useEffect, useState } from 'react';
import { Alert, Badge, Button, Checkbox, Group, Paper, Select, Stack, Text, Textarea } from '@mantine/core';
import type { WikiJob, WikiKnowledgeView, WikiReview } from '../../../shared/wiki';

export default function WikiKnowledgePanel({ job, api }: { job: WikiJob; api: <T>(path: string, body?: unknown) => Promise<T> }) {
  const [items, setItems] = useState<WikiKnowledgeView[]>([]);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [reviews, setReviews] = useState<(WikiReview & { isLatest: boolean })[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [checked, setChecked] = useState(false);
  const [verdict, setVerdict] = useState<string | null>('hold');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [readback, setReadback] = useState<WikiKnowledgeView | null>(null);
  const [notice, setNotice] = useState('');
  const [usage, setUsage] = useState<{ agent: string; jobId: string; outputPath: string; locations: { lines: number[] }[]; recordedAt: string; knowledgeState: string; outputState: string; sourceState: string }[] | null>(null);
  useEffect(() => { setUsage(null); }, [readback?.knowledge.id, readback?.knowledge.revision]);
  const scope = job.payload.scope;
  const query = new URLSearchParams({ ...scope }).toString();
  const choices = job.candidates.flatMap(candidate => candidate.response.results.flatMap((result, unitIndex) => result.needs.map((need, needIndex) => ({
    key: `${candidate.id}:${unitIndex}:${needIndex}`, candidateId: candidate.id, unitId: result.unit_id, needIndex, need, status: result.status,
    unit: job.payload.requests.find(request => request.request_id === candidate.requestId)?.units.find(unit => unit.unit_id === result.unit_id),
  }))));
  const chosen = choices.find(item => item.key === selected);
  const currentReview = chosen ? reviews.find(review => review.isLatest && review.candidateId === chosen.candidateId && review.unitId === chosen.unitId && review.needIndex === chosen.needIndex) : undefined;
  const refresh = async () => {
    const [knowledge, decisions] = await Promise.all([
      api<{ snapshot: string | null; items: WikiKnowledgeView[] }>(`/knowledge?${query}`),
      api<{ reviews: (WikiReview & { isLatest: boolean })[] }>(`/jobs/${job.id}/reviews?${query}`),
    ]);
    setItems(knowledge.items); setSnapshot(knowledge.snapshot); setReviews(decisions.reviews);
  };
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await operation(); } catch (error) { setError(error instanceof Error ? error.message : '정본 작업 실패'); }
    finally { setBusy(false); }
  };
  useEffect(() => { setReadback(null); setUsage(null); void run(refresh); }, [job.id, job.candidates.length]);
  return <Paper withBorder p="sm"><Stack gap="sm">
    <Text fw={600}>후보 검토와 프로젝트 정본</Text>
    <Text size="sm">원문과 후보의 조건·예외를 대조한 후 결정하세요. 정본 반영은 이 프로젝트에서 제공할 판을 선택합니다. 업무 승인이나 외부 사실 검증은 별도입니다.</Text>
    {error && <Alert color="red" role="alert">{error}</Alert>}
    {notice && <Alert color="teal" role="status">{notice}</Alert>}
    <Select label="검토할 지식 후보" searchable disabled={busy} value={selected} data={choices.map((item, index) => ({ value: item.key, label: `${index + 1}. ${item.need.title}` }))} onChange={value => {
      setSelected(value); setChecked(false); setReason(''); setVerdict('hold'); setTarget(null);
    }} />
    {chosen && <Stack gap="xs">
      <Text fw={600}>{chosen.need.title}</Text><Text style={{ whiteSpace: 'pre-wrap' }}>{chosen.need.statement}</Text>
      {chosen.need.details.map((detail, index) => <Text key={index} size="sm">• {detail}</Text>)}
      <Text size="sm">원문 인용: {chosen.need.evidence.join(' / ')}</Text>
      <details><summary>해당 구조 단위 전체 · {chosen.unit?.locator}</summary><Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{chosen.unit?.text}</Text></details>
      <Alert color="yellow">검토 범위는 선택한 구조 단위입니다. 미선택 {job.payload.coverage.omittedUnitIds.length}개와 다른 절의 조건·첨부는 확인된 것으로 처리하지 않습니다.</Alert>
      <Select label="반영 대상" disabled={busy} value={target} clearable placeholder="새 지식 ID 발급" data={items.map(item => ({ value: item.knowledge.id, label: `${item.knowledge.title} · 판 ${item.knowledge.revision} · ${item.knowledge.id}` }))} onChange={setTarget} />
      {target && <Alert color="yellow">선택한 정본의 다음 판을 만듭니다. 같은 업무와 대상인지, 이전 세부 조건이 빠지지 않았는지 확인하세요.
        <Text size="sm">기존 문장: {items.find(item => item.knowledge.id === target)?.knowledge.statement}</Text>
        {items.find(item => item.knowledge.id === target)?.knowledge.details.map((detail, index) => <Text key={index} size="sm">• {detail}</Text>)}
      </Alert>}
      <Select label="의미 검토 결정" disabled={busy} value={verdict} onChange={setVerdict} data={[{ value: 'hold', label: '보류 · 추가 확인 필요' }, { value: 'reject', label: '반려 · 의미 불일치' }, { value: 'accept', label: '수용 · 선택 범위의 의미 일치' }]} />
      <Textarea label="판단 근거와 미확인 조건" value={reason} maxLength={4000} disabled={busy} onChange={event => setReason(event.currentTarget.value)} />
      <Checkbox label="인용과 문장 의미, 세부 조건·예외 및 반영 대상을 대조했습니다." checked={checked} disabled={busy} onChange={event => setChecked(event.currentTarget.checked)} />
      <Button variant="light" disabled={busy || job.sourceState !== 'unchanged' || !reason.trim() || !verdict || (verdict === 'accept' && (!checked || chosen.status !== 'analyzed'))} onClick={() => void run(async () => {
        await api('/reviews', { scope, jobId: job.id, candidateId: chosen.candidateId, unitId: chosen.unitId, needIndex: chosen.needIndex,
          verdict, reason, conditionsChecked: checked, baseSnapshot: snapshot, knowledgeId: target,
          expectedRevision: target ? items.find(item => item.knowledge.id === target)!.knowledge.revision : null });
        await refresh(); setNotice('검토 결정을 기록했습니다. 수용한 후보는 아래에서 정본에 반영할 수 있습니다.');
      })}>검토 결정 기록</Button>
      {currentReview && <Paper withBorder p="sm"><Stack gap="xs">
        <Text size="sm">기록된 결정: {currentReview.verdict === 'accept' ? '수용' : currentReview.verdict === 'hold' ? '보류' : '반려'} · {currentReview.recordedAt}</Text>
        <Text size="sm">{currentReview.reason}</Text>
        <Text size="xs" style={{ overflowWrap: 'anywhere' }}>기록된 대상: {currentReview.knowledgeId} · {currentReview.expectedRevision === null ? '새 지식' : `기준 판 ${currentReview.expectedRevision}`}</Text>
        <Button disabled={busy || currentReview.verdict !== 'accept' || job.sourceState !== 'unchanged'} onClick={() => void run(async () => {
          const committed = await api<WikiKnowledgeView>('/commit', { scope, reviewId: currentReview.id });
          const again = await api<WikiKnowledgeView>(`/knowledge/${committed.knowledge.id}?${query}`);
          if (again.snapshot !== committed.snapshot || again.knowledge.revision !== committed.knowledge.revision) throw new Error('반영 후 다른 판이 갱신되었습니다. 정본을 다시 조회하세요.');
          setReadback(again); await refresh(); setNotice('정본을 반영하고 같은 지식 ID·판으로 다시 조회했습니다.');
        })}>기록된 수용 결정을 정본에 반영</Button>
      </Stack></Paper>}
    </Stack>}
    <Group><Text fw={600}>현재 정본 {items.length}개</Text><Button size="xs" variant="subtle" disabled={busy} onClick={() => void run(refresh)}>새로 조회</Button></Group>
    {items.map(item => <Button key={item.knowledge.id} variant="subtle" disabled={busy} onClick={() => void run(async () => {
      setReadback(await api<WikiKnowledgeView>(`/knowledge/${item.knowledge.id}?${query}`));
    })}>{item.knowledge.title} · 판 {item.knowledge.revision}{item.sourceState === 'changed' ? ' · 원본 변경, 재검토 필요' : ''}</Button>)}
    {readback && <Paper p="sm" withBorder><Stack gap="xs">
      <Group><Badge>현재 제공 판</Badge><Badge color="yellow">원문 보고 · 업무 승인 미확인</Badge></Group>
      <Text fw={600}>{readback.knowledge.title}</Text>
      <Text size="xs" style={{ overflowWrap: 'anywhere' }}>{readback.knowledge.id} · 판 {readback.knowledge.revision} · snapshot {readback.snapshot}</Text>
      {readback.sourceState === 'changed' && <Alert color="yellow">근거 자료가 변경되었습니다. 확정 적용 전에 재검토하세요.</Alert>}
      <Text style={{ whiteSpace: 'pre-wrap' }}>{readback.knowledge.statement}</Text>
      {readback.knowledge.details.map((detail, index) => <Text key={index} size="sm">• {detail}</Text>)}
      <Text size="sm">근거: {readback.knowledge.provenance.locator} · {readback.knowledge.evidence.join(' / ')}</Text>
      <Text size="sm">검토 범위와 조건: {readback.knowledge.conditions.note}</Text>
      <Text size="xs">적용 기간은 별도 확정 전입니다. 직원은 검색 순위와 별개로 제약·미결정 목록을 확인합니다. 인용 기록은 의미상 올바른 적용을 보증하지 않습니다.</Text>
      <Button variant="light" disabled={busy} onClick={() => void run(async () => {
        const result = await api<{ items: NonNullable<typeof usage> }>(`/knowledge/${readback.knowledge.id}/usage?${query}`);
        setUsage(result.items);
      })}>이 지식을 인용한 결과물 확인</Button>
      {usage && usage.length === 0 && <Text size="sm">확인된 인용 기록이 없습니다.</Text>}
      {usage?.map((item, index) => <Paper withBorder p="xs" key={`${item.jobId}-${index}`}>
        <Text size="sm">{item.agent} · {item.recordedAt}</Text>
        <Text size="xs" style={{ overflowWrap: 'anywhere' }}>{item.outputPath} · 인용 위치 {item.locations.flatMap(location => location.lines).join(", ")}행</Text>
        <Text size="sm">{item.knowledgeState === 'revised' ? '지식 판 변경 · 재검토 필요' : '같은 지식 판'} · {item.outputState === 'unchanged' ? '결과물 해시 일치' : '결과물 변경 또는 접근 불가'}{item.sourceState === 'changed' ? ' · 원본 변경' : ''}</Text>
      </Paper>)}
    </Stack></Paper>}
  </Stack></Paper>;
}
