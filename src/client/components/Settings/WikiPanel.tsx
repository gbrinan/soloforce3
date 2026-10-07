import React, { useEffect, useState } from 'react';
import { Alert, Badge, Button, Checkbox, Group, Paper, ScrollArea, Select, Stack, Text, Textarea, TextInput } from '@mantine/core';
import type { CorpusSnapshot } from '../../../shared/corpus';
import type { WikiJob, WikiJobSummary } from '../../../shared/wiki';
import WikiKnowledgePanel from './WikiKnowledgePanel';

const errors: Record<string, string> = {
  wiki_snapshot_conflict: '정본이 그사이 변경되었습니다. 새로 조회하고 최신 판을 기준으로 다시 검토하세요.',
  wiki_snapshot_invalid: '정본 파일 검증에 실패했습니다. 현재 판과 백업을 확인하세요.',
  wiki_semantic_review_required: '모호한 후보를 해소하고 원문·세부 조건 검토를 기록해야 정본에 반영할 수 있습니다.',
  wiki_review_superseded: '이후의 검토 결정이 있습니다. 최신 결정을 확인하세요.',
  wiki_writer_locked: '다른 정본 작업이 진행 중이거나 중단된 잠금이 있습니다. 운영 문서의 복구 절차를 확인하세요.',
  wiki_analysis_locked: '이 요청은 분석 중이거나 중단된 실행 잠금이 있습니다. 실행 기록을 확인하세요.',
  wiki_model_failed: '연결된 Claude 실행에 실패했습니다. 로그인·모델 설정을 확인한 뒤 해당 요청을 다시 실행하세요.',
  wiki_model_invalid_json: '모델 응답이 올바른 JSON이 아닙니다. 후보로 반영되지 않았습니다. 요청을 나누거나 수동 응답을 사용하세요.',
  wiki_model_request_mismatch: '모델이 다른 요청 ID를 반환했습니다. 이 응답은 저장하지 않았습니다.',
  wiki_model_mismatch: '현재 호스트 모델과 요청의 모델 표기가 다릅니다. 현재 모델로 새 요청을 준비하거나 수동 응답을 사용하세요.',
  wiki_model_budget_exceeded: '설정된 일일 AI 예산을 모두 사용했습니다.',
  owner_same_origin_required: '이 기기의 로컬 화면 또는 로그인한 화면에서 이용하세요.',
  wiki_python_unavailable: 'Python을 실행할 수 없습니다. 설치 후 INGESTIGER_PYTHON 실행 경로를 확인하세요.',
  wiki_bundle_invalid: 'IngesTiger 배포 파일이 변경되었거나 누락되었습니다. 설치 파일을 확인하세요.',
  wiki_response_or_units_invalid: '원문 인용, 단위별 응답 누락·중복 또는 요청 크기를 확인하세요. 요청에 포함된 모든 단위에 답해야 합니다.',
  wiki_source_changed: '요청을 만든 뒤 원본 버전이 바뀌었습니다. 최신 자료에서 새 요청을 만드세요.',
  wiki_original_changed: '보존한 원본 파일의 해시가 일치하지 않습니다. 원본과 백업을 확인하세요.',
  wiki_source_unavailable: '이 자료는 접근할 수 없거나 검색에서 제외되었습니다.',
  wiki_source_units_require_reimport: '이전 추출판입니다. 자료를 다시 가져오면 절·표 단위로 분석할 수 있습니다.',
  wiki_artifact_changed: '저장한 후보 또는 요청이 변경되었습니다. 백업과 대조하세요.',
  wiki_batch_too_large: '한 번에 최대 500개 단위, 본문 24만 자까지 준비할 수 있습니다. 범위를 줄이세요.',
  wiki_busy_retry: '다른 Wiki 요청을 처리 중입니다. 잠시 후 다시 시도하세요.',
  wiki_core_failed: 'IngesTiger 실행에 실패했습니다. Python 3과 실행 경로를 확인하세요.',
  wiki_response_too_large: '응답 하나의 니즈는 최대 500개입니다. 분석 범위를 나눠 요청하세요.',
  wiki_backup_too_large: '이 작업의 개별 백업이 32 MB를 넘었습니다. 설정의 전체 데이터 백업을 사용하세요.',
  invalid_request: '기업·프로젝트 ID, 모델 표기 또는 응답 JSON 형식을 확인하세요.',
};
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/wiki${path}`, body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(errors[value.error] ?? `Wiki 작업 실패 (${value.error ?? response.status})`);
  return value;
}

export default function WikiPanel({ snapshot, close }: { snapshot: CorpusSnapshot; close: () => void }) {
  const [orgId, setOrgId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [model, setModel] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [scopeConfirmed, setScopeConfirmed] = useState(false);
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [job, setJob] = useState<WikiJob | null>(null);
  const [jobs, setJobs] = useState<WikiJobSummary[]>([]);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [response, setResponse] = useState('');
  const [page, setPage] = useState(0);
  const units = snapshot.units ?? [];
  const scopeReady = [orgId, projectId].every(value => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(value));
  useEffect(() => {
    let live = true;
    void api<{ available: boolean; error?: string; model?: string }>('/capabilities').then(value => {
      if (!live) return;
      setAvailable(value.available);
      if (value.model) setModel(value.model);
      if (!value.available) setError(errors[value.error ?? ''] ?? 'Wiki 실행 환경이 준비되지 않았습니다.');
    }).catch(error => { if (live) setError(error.message); });
    return () => { live = false; };
  }, []);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (error) { setError(error instanceof Error ? error.message : '작업 실패'); }
    finally { setBusy(false); }
  };
  const open = (value: WikiJob) => { setJob(value); setRequestId(value.payload.requests[0]?.request_id ?? null); setResponse(''); };
  const resetScope = () => { setScopeConfirmed(false); setJob(null); setJobs([]); };
  const currentRequest = job?.payload.requests.find(request => request.request_id === requestId);
  const scopeQuery = new URLSearchParams({ orgId: job?.payload.scope.orgId ?? orgId, projectId: job?.payload.scope.projectId ?? projectId }).toString();
  return <Paper p="md" withBorder><Stack gap="sm">
    <Group justify="space-between"><Text fw={600}>{snapshot.name} · IngesTiger Wiki</Text><Button variant="subtle" size="xs" onClick={close}>닫기</Button></Group>
    <Text size="sm">절·페이지·표 행을 선택하고 분석을 실행한 뒤 후보를 검토해 정본에 반영하세요. 큰 단위는 잘라내지 않고 보류합니다. Drive 자동 저장은 아직 연결되지 않았습니다.</Text>
    {!snapshot.units && <Alert color="yellow">구조 단위가 없는 이전 추출판입니다. 자료를 다시 가져온 뒤 후보를 만드세요. 기존 원본과 후보는 유지됩니다.</Alert>}
    {error && <Alert color="red" role="alert">{error}</Alert>}
    {notice && <Alert color="teal" role="status">{notice}</Alert>}
    <Group grow>
      <TextInput label="기업 ID" description="영문 소문자·숫자·밑줄·하이픈, 예: example. con·aux 등 예약어는 제외합니다." value={orgId} disabled={busy} onChange={event => { setOrgId(event.currentTarget.value); resetScope(); }} />
      <TextInput label="프로젝트 ID" description="예: training-2026. 기존 ID가 있으면 유지하세요." value={projectId} disabled={busy} onChange={event => { setProjectId(event.currentTarget.value); resetScope(); }} />
    </Group>
    <TextInput label="분석 모델" description="기본값은 호스트에 설정한 Claude 모델입니다. 분석 실행은 현재 로그인 계정의 사용량을 소모합니다. 다른 모델 표기는 수동 응답 경로에서 사용하세요." value={model} disabled={busy} onChange={event => setModel(event.currentTarget.value)} maxLength={120} />
    <Group><Text size="sm">분석 범위: {selected.length} / {units.length}개 구조 단위</Text>
      <Button size="xs" variant="light" disabled={busy || units.length > 500} onClick={() => { setSelected(units.map(unit => unit.id)); setScopeConfirmed(false); }}>이 자료 전체 선택</Button>
      <Button size="xs" variant="subtle" disabled={busy} onClick={() => { setSelected([]); setScopeConfirmed(false); }}>선택 해제</Button></Group>
    <ScrollArea.Autosize mah={260}><Stack gap="xs">
      {units.slice(page * 30, (page + 1) * 30).map(chunk => <div key={chunk.id}>
        <Checkbox label={chunk.locator} checked={selected.includes(chunk.id)} disabled={busy} onChange={event => {
          const checked = event.currentTarget.checked;
          setSelected(previous => checked ? [...previous, chunk.id] : previous.filter(id => id !== chunk.id)); setScopeConfirmed(false);
        }} />
        <details><summary>원문 추출 내용 펼치기</summary><Text size="xs" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{chunk.text}</Text></details>
      </div>)}
    </Stack></ScrollArea.Autosize>
    {units.length > 30 && <Group><Button size="xs" variant="subtle" disabled={page === 0} onClick={() => setPage(page - 1)}>이전</Button><Text size="xs">{page + 1} / {Math.ceil(units.length / 30)}</Text><Button size="xs" variant="subtle" disabled={(page + 1) * 30 >= units.length} onClick={() => setPage(page + 1)}>다음</Button></Group>}
    <Checkbox label="선택한 부분이 위 기업·프로젝트의 자료인지 확인했습니다." checked={scopeConfirmed} disabled={busy} onChange={event => setScopeConfirmed(event.currentTarget.checked)} />
    <Group>
      <Button disabled={busy || !available || !scopeReady || !scopeConfirmed || !model.trim() || !selected.length || selected.length > 500} onClick={() => void run(async () => {
        const value = await api<{ job: WikiJob }>('/prepare', { scope: { orgId, projectId }, sourceId: snapshot.sourceId, expectedRevision: snapshot.revision, unitIds: selected, model });
        open(value.job); setNotice('분석 요청을 준비했습니다. 아래에서 요청별 분석을 실행하세요.');
      })}>분석 요청 준비</Button>
      <Button variant="light" disabled={busy || !scopeReady} onClick={() => void run(async () => {
        const query = new URLSearchParams({ orgId, projectId, sourceId: snapshot.sourceId });
        setJobs((await api<{ jobs: WikiJobSummary[] }>(`/jobs?${query}`)).jobs); setNotice('저장된 작업을 불러왔습니다.');
      })}>저장된 후보 불러오기</Button>
    </Group>
    {jobs.map(saved => <Button key={saved.id} disabled={busy} variant="subtle" size="xs" onClick={() => void run(async () => {
      open((await api<{ job: WikiJob }>(`/jobs/${saved.id}?${new URLSearchParams({ orgId, projectId })}`)).job);
    })}>작업 {saved.id.slice(0, 10)} · 후보 응답 {saved.candidateCount}개 · {saved.sourceState === 'changed' ? '원본 변경됨' : '원본 판 일치'}</Button>)}
    {job && <Stack gap="sm">
      <Group><Badge color="blue">{job.candidates.length ? '후보 저장됨' : '요청 준비됨'}</Badge><Text size="xs">요청 {job.payload.requests.length}개 · 후보 응답 {job.candidates.length}개 · 미선택 {job.payload.coverage.omittedUnitIds.length}개</Text></Group>
      {!!job.payload.coverage.pendingUnits?.length && <Alert color="yellow">{job.payload.coverage.pendingUnits.length}개 구조 단위가 입력 한도를 넘어 보류됐습니다. 해당 절·표의 범위를 다시 나눠야 하며, 이 작업을 자료 전체 분석 완료로 사용하지 마세요.</Alert>}
      {job.payload.coverage.pendingRoutes.length > 0 && <Alert color="yellow">추가 처리 대상: {job.payload.coverage.pendingRoutes.join(', ')}. 읽지 않은 이미지·첨부·음성은 분석 완료에 포함하지 않습니다.</Alert>}
      {job.sourceState === 'changed' && <Alert color="yellow">원본이 변경된 이전 작업입니다. 새 응답을 저장하려면 최신 자료에서 다시 준비하세요.</Alert>}
      <Select label="분석할 요청" disabled={busy} data={job.payload.requests.map((request, index) => ({ value: request.request_id, label: `요청 ${index + 1} · ${request.units.length}개 단위${job.candidates.some(candidate => candidate.requestId === request.request_id) ? ' · 후보 저장됨' : ''}` }))} value={requestId} onChange={value => { setRequestId(value); setResponse(''); }} />
      <Button loading={busy} disabled={busy || !currentRequest || job.sourceState !== 'unchanged'} onClick={() => void run(async () => {
        const result = await api<{ job: WikiJob; reused: boolean }>(`/jobs/${job.id}/analyze`, { scope: job.payload.scope, requestId });
        setJob(result.job); setNotice(result.reused ? '이미 저장된 후보를 불러왔습니다. 모델을 다시 호출하지 않았습니다.' : '분석과 인용 검사를 마쳤습니다. 아래에서 후보 의미를 검토하세요.');
      })}>선택한 요청 분석 실행</Button>
      {currentRequest && <details><summary>분석 요청 JSON 펼치기</summary><Textarea label="분석 요청 JSON" readOnly value={JSON.stringify(currentRequest)} autosize minRows={4} maxRows={10} /></details>}
      <Group><Button variant="light" disabled={!currentRequest} onClick={() => void run(async () => {
        await navigator.clipboard.writeText(JSON.stringify(currentRequest)); setNotice('요청 JSON을 복사했습니다. 사용 중인 LLM에 전달하고 JSON 응답을 받아오세요. 모델의 실제 입력 한도는 별도로 확인하세요.');
      })}>분석 요청 복사</Button>
        <Button component="a" variant="subtle" href={`/api/wiki/jobs/${job.id}/backup?${scopeQuery}`} download>요청·후보 백업</Button></Group>
      <Textarea label="LLM 응답 JSON" description="request_id와 results가 있는 JSON 객체를 붙여넣으세요. 코드 블록 표시는 제외합니다." minRows={5} autosize maxRows={14} value={response} onChange={event => setResponse(event.currentTarget.value)} disabled={busy} />
      <Button disabled={busy || !response.trim() || job.sourceState !== 'unchanged'} onClick={() => void run(async () => {
        let parsed: unknown;
        try { parsed = JSON.parse(response); } catch { throw new Error('응답이 올바른 JSON인지 확인하세요.'); }
        const value = await api<{ job: WikiJob }>(`/jobs/${job.id}/submit`, { scope: job.payload.scope, response: parsed });
        setJob(value.job); setResponse(''); setNotice('인용·누락·중복 검사를 통과한 후보를 저장했습니다. 의미 정확성과 업무 승인은 아직 검토 전입니다.');
      })}>응답 검사하고 후보 저장</Button>
      <WikiKnowledgePanel key={job.id} job={job} api={api} />
      {job.candidates.map(candidate => <Paper key={candidate.id} withBorder p="sm"><Stack gap="xs">
        <Text size="xs" c="dimmed">후보 판 {candidate.id.slice(0, 10)} · 니즈 {candidate.validation.needs}개 · 모호한 단위 {candidate.validation.ambiguous_units.length}개</Text>
        {candidate.response.results.flatMap(result => result.needs.map((need, index) => <div key={`${result.unit_id}-${index}`}>
          <Text fw={600} size="sm">{need.title}</Text><Text size="sm">{need.statement}</Text>
          {need.details.map((detail, i) => <Text key={i} size="sm">· {detail}</Text>)}
          <Text size="xs" c="dimmed">근거: {need.evidence.join(' / ')}</Text>
        </div>))}
      </Stack></Paper>)}
    </Stack>}
  </Stack></Paper>;
}
