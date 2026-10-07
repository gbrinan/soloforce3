import React, { useEffect, useState } from 'react';
import { Accordion, Alert, Badge, Button, FileInput, Group, Paper, Select, Stack, Switch, Tabs, Text, TextInput } from '@mantine/core';
import type { CorpusSearchResult, CorpusSnapshot, CorpusSource } from '../../../shared/corpus';
import WikiPanel from './WikiPanel';
import type { CorpusIntake } from '../../../shared/corpus-intake';

type Source = CorpusSource & { retrievalAllowed: boolean };
type Connection = { connectionId: string; displayEmail: string; state: string };
type Status = { notionConfigured: boolean; embeddingConfigured: boolean; maxFileBytes: number; maxOriginalBytes: number; uploadPartBytes: number };
const routeNames: Record<string, string> = { text: '본문', table: '표', graph: '업무 연결', ocr: 'OCR', transcription: '음성 전사', review: '검토' };
const providerNames = { local: '로컬', 'google-drive': 'Drive', notion: 'Notion' };
const errors: Record<string, string> = {
  owner_same_origin_required: '자료 관리는 이 기기의 로컬 화면 또는 로그인한 화면에서 이용하세요.',
  google_connector_not_configured: 'Google Drive 연결 설정이 필요합니다.',
  recent_auth_required: 'Drive 연결을 변경하려면 다시 로그인한 뒤 시도하세요.',
  notion_not_configured: '서버의 Notion 연결 토큰을 먼저 설정하세요.',
  notion_page_not_accessible: 'Notion 페이지를 읽을 수 없습니다. 연결에 페이지를 공유했는지 확인하세요.',
  drive_download_forbidden: '이 파일의 다운로드 권한이 없거나 휴지통에 있습니다.',
  drive_content_fetch_failed: 'Drive 파일을 읽지 못했습니다. 연결과 다운로드 권한을 확인하세요.',
  source_changed_retry: '가져오는 동안 원본이 변경되었습니다. 다시 가져오세요.',
  file_too_large: '일반 가져오기 한도를 넘었습니다. 큰 원본 접수로 등록하세요.',
  download_too_large: '다운로드 크기 제한을 넘었습니다. 일반 파일은 20 MB, Google 문서 내보내기는 10 MB까지 지원합니다.',
  connection_inactive: '해제된 연결입니다. 다시 연결한 뒤 자료를 가져오세요.',
  import_busy_retry: '다른 자료를 처리하고 있습니다. 완료 후 다시 시도하세요.',
  query_length_1_to_500: '검색어는 1~500자로 입력하세요.',
  use_notion_page_id_or_url: 'Notion 페이지의 전체 URL 또는 페이지 ID를 입력하세요.',
  local_embedding_not_configured: '로컬 임베딩 모델 설정이 필요합니다.',
  embedding_unavailable: '로컬 임베딩 모델이 실행 중인지 확인하세요.',
  unsupported_drive_native_type: '이 Google 파일 형식은 직접 가져올 수 없습니다. 파일로 내보낸 뒤 등록하세요.',
  intake_worker_busy: '다른 자료를 분석하고 있습니다. 완료 후 이어서 처리하세요.',
  intake_offset_conflict: '저장된 업로드 위치가 달라졌습니다. 목록을 새로고침한 뒤 이어서 올리세요.',
  intake_original_changed: '원본 검증 결과가 다릅니다. 보존한 파일을 확인하세요.',
  intake_base_changed: '분석 중 더 최신 자료가 등록됐습니다. 이전 판은 반영하지 않았습니다.',
  intake_storage_budget: '원본 보관 공간 또는 접수 건수의 한도에 도달했습니다. 보관 내역을 확인하세요.',
  intake_extraction_budget: '분석한 내용의 양이 한도를 넘었습니다. 원본과 진행 위치는 남아 있습니다. 처리 범위를 나눠야 합니다.',
  intake_worker_timeout: '이번 분석이 시간 한도에 도달했습니다. 저장된 위치부터 다시 시도할 수 있습니다.',
  intake_user_paused: '분석을 멈췄습니다. 저장된 위치부터 다시 이어갈 수 있습니다.',
  parser_version_changed: '분석기 버전이 바뀌었습니다. 원본은 보존돼 있으므로 새 접수로 다시 처리하세요.',
  drive_range_not_supported: '이 파일은 부분 다운로드를 지원하지 않습니다. 파일로 내려받은 뒤 로컬 원본 접수로 등록하세요.',
  intake_original_too_large: '현재 원본 보관 한도는 파일당 512 MiB입니다.',
};
const intakeState: Record<CorpusIntake['state'], string> = { uploading: '업로드 중', queued: '원본 보존 · 분석 대기', running: '분석 중', paused: '진행 위치 저장됨', complete: '처리 종료', needs_review: '원본 보존 · 확인 필요' };
async function digest(blob: Blob): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))).map(n => n.toString(16).padStart(2, '0')).join('');
}
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok) throw new Error(errors[body.error] ?? `요청을 완료하지 못했습니다 (${body.error ?? response.status}).`);
  return body as T;
}
const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export default function CorpusPanel() {
  const [sources, setSources] = useState<Source[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connection, setConnection] = useState<string | null>(null);
  const [driveFiles, setDriveFiles] = useState<{ id: string; name: string; mimeType: string }[]>([]);
  const [driveFile, setDriveFile] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [notionPage, setNotionPage] = useState('');
  const [labels, setLabels] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CorpusSearchResult | null>(null);
  const [snapshot, setSnapshot] = useState<CorpusSnapshot | null>(null);
  const [wikiSnapshot, setWikiSnapshot] = useState<CorpusSnapshot | null>(null);
  const [intakes, setIntakes] = useState<CorpusIntake[]>([]);

  const refresh = async () => {
    const [listing, state, google] = await Promise.all([
      request<{ sources: Source[] }>('/api/corpus/sources'), request<Status>('/api/corpus/status'),
      request<{ configured: boolean }>('/api/connections/google-drive/status'),
    ]);
    setSources(listing.sources); setStatus(state); setGoogleConfigured(google.configured);
    setIntakes((await request<{ jobs: CorpusIntake[] }>('/api/corpus/intakes')).jobs);
    if (google.configured) setConnections((await request<{ connections: Connection[] }>('/api/connections/google-drive/connections')).connections);
  };
  useEffect(() => { void refresh().catch(err => setError(String(err.message))); }, []);
  useEffect(() => {
    if (!intakes.some(job => job.state === 'running')) return;
    const timer = window.setTimeout(() => { void refresh().catch(err => setError(String(err.message))); }, 2000);
    return () => window.clearTimeout(timer);
  }, [intakes]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await action(); await refresh(); } catch (err) { setError(err instanceof Error ? err.message : '처리에 실패했습니다.'); await refresh().catch(() => {}); }
    finally { setBusy(false); }
  };
  const tags = () => labels.split(',').map(label => label.trim()).filter(Boolean);
  const imported = (source: CorpusSource) => {
    const pending = source.profile.routes.some(route => route.status !== 'ready');
    setNotice(`${source.name}: 원본 보존 완료 · ${source.chunkCount}개 검색 조각${pending ? ' · 추가 처리가 필요한 항목이 있습니다.' : ''}`);
    setSnapshot(null); setResults(null); setWikiSnapshot(null);
  };
  const upload = async (resume?: CorpusIntake) => {
    if (!file) throw new Error('이어서 올릴 원본 파일을 선택하세요.');
    if (file.size > (status?.maxOriginalBytes ?? 512 * 1024 * 1024)) throw new Error('현재 원본 보관 한도는 파일당 512 MiB입니다.');
    if (resume && (file.name !== resume.name || file.size !== resume.bytes)) throw new Error('접수한 것과 이름·크기가 같은 원본을 선택하세요.');
    let job = resume ?? (await request<{ job: CorpusIntake }>('/api/corpus/intakes', post({ name: file.name, mime: file.type, bytes: file.size, labels: tags() }))).job;
    // A same-name replacement must never be appended to an earlier file's prefix.
    for (const part of job.parts) if (await digest(file.slice(part.offset, part.offset + part.bytes)) !== part.sha256) throw new Error('선택한 파일의 앞부분이 보존한 원본과 다릅니다. 새 파일로 접수하세요.');
    while (job.uploadedBytes < file.size) {
      const offset = job.uploadedBytes; const part = file.slice(offset, offset + (status?.uploadPartBytes ?? 4 * 1024 * 1024));
      job = (await request<{ job: CorpusIntake }>(`/api/corpus/intakes/${job.id}/content?offset=${offset}`, { method: 'PATCH', headers: { 'Content-Type': 'application/octet-stream', 'X-Chunk-SHA256': await digest(part) }, body: part })).job;
      setNotice(`${file.name}: 원본 업로드 ${Math.floor(job.uploadedBytes / file.size * 100)}%`);
    }
    await request(`/api/corpus/intakes/${job.id}/complete`, post({}));
    setFile(null); setNotice('원본을 검증해 보존했습니다. 아래 접수 목록에서 분석을 시작하세요.');
  };

  return <Paper withBorder p="md" radius="md">
    <Stack gap="sm">
      <Group justify="space-between"><Text fw={600}>자료 가져오기 · 종류별 처리</Text><Button size="xs" variant="subtle" disabled={busy} onClick={() => void run(refresh)}>목록 새로고침</Button></Group>
      <Text size="sm" c="dimmed">Drive·Notion을 원본으로 사용하고, 가져온 버전은 이 기기에 보존합니다. 같은 자료를 다시 가져오면 변경된 버전을 추가합니다. 자동 동기화는 하지 않습니다.</Text>
      {error && <Alert color="red" title="처리 확인" role="alert">{error}</Alert>}
      {notice && <Alert color="teal" role="status">{notice}</Alert>}
      <TextInput label="업무 분류 (선택)" description="쉼표로 구분하세요. 같은 프로젝트·고객 분류의 자료를 연결해 검색합니다." placeholder="프로젝트:선박A, 고객:현대" value={labels} onChange={e => setLabels(e.currentTarget.value)} maxLength={1600} disabled={busy} />
      <Tabs defaultValue="drive">
        <Tabs.List><Tabs.Tab value="drive">Google Drive</Tabs.Tab><Tabs.Tab value="notion">Notion</Tabs.Tab><Tabs.Tab value="local">로컬 파일</Tabs.Tab></Tabs.List>
        <Tabs.Panel value="drive" pt="sm"><Stack gap="sm">
          {!googleConfigured ? <Text size="sm" c="dimmed">Drive 읽기 전용 OAuth 설정 후 이용할 수 있습니다. 설정 방법은 config/corpus/README.md에 있습니다. 로컬 파일은 바로 등록할 수 있습니다.</Text> : <>
            <Group><Button size="xs" variant="light" disabled={busy} onClick={() => {
              const popup = window.open('about:blank', '_blank', 'popup,width=560,height=700');
              void run(async () => {
                try {
                  const result = await request<{ authorizationUrl: string }>('/api/connections/google-drive/oauth/start', post({}));
                  if (!popup) throw new Error('팝업을 허용한 뒤 다시 연결하세요.');
                  popup.location.href = result.authorizationUrl;
                  setNotice('Google 연결을 완료한 뒤 이 화면에서 목록 새로고침을 누르세요.');
                } catch (err) { popup?.close(); throw err; }
              });
            }}>Drive 연결</Button></Group>
            <Select label="연결 계정" data={connections.filter(c => c.state === 'active').map(c => ({ value: c.connectionId, label: c.displayEmail }))} value={connection} disabled={busy} onChange={value => { setConnection(value); setDriveFiles([]); setDriveFile(null); }} placeholder="연결 계정 선택" />
            <Group><Button size="xs" variant="light" disabled={busy || !connection} onClick={() => void run(async () => {
              const result = await request<{ files: typeof driveFiles }>(`/api/connections/google-drive/${connection}/files`);
              setDriveFiles(result.files.filter(f => f.mimeType !== 'application/vnd.google-apps.folder'));
            })}>파일 목록 불러오기</Button>
              <Button size="xs" variant="subtle" color="red" disabled={busy || !connection} onClick={() => void run(async () => {
                const response = await fetch(`/api/connections/google-drive/${connection}/revoke`, post({}));
                if (!response.ok) throw new Error('연결을 해제하지 못했습니다. 다시 로그인한 뒤 시도하세요.');
                setConnection(null); setDriveFiles([]); setDriveFile(null); setResults(null); setSnapshot(null); setWikiSnapshot(null);
                setNotice('연결을 해제했습니다. 해당 자료는 검색에서 제외되고 로컬 백업은 보존됩니다.');
              })}>연결 해제</Button></Group>
            <Select label="가져올 파일" searchable data={driveFiles.map(f => ({ value: f.id, label: f.name }))} value={driveFile} onChange={setDriveFile} disabled={busy} placeholder="파일명으로 검색" />
            <Button disabled={busy || !connection || !driveFile} onClick={() => void run(async () => {
              const result = await request<{ source: CorpusSource }>(`/api/connections/google-drive/${connection}/import`, post({ fileId: driveFile, labels: tags() })); imported(result.source);
            })}>선택 파일 가져오기</Button>
            <Button variant="light" disabled={busy || !connection || !driveFile} onClick={() => void run(async () => {
              await request(`/api/connections/google-drive/${connection}/intake`, post({ fileId: driveFile, labels: tags() }));
              setNotice('Drive 원본을 보존했습니다. 접수 목록에서 분석을 시작하세요.');
            })}>큰 원본 보존 후 나누어 분석</Button>
          </>}
        </Stack></Tabs.Panel>
        <Tabs.Panel value="notion" pt="sm"><Stack gap="sm">
          <Text size="sm" c="dimmed">연결에 공유한 페이지의 본문·표·속성을 가져옵니다. 첨부파일, 하위 페이지, 데이터베이스 전체는 각각 등록하세요.</Text>
          {!status?.notionConfigured && <Alert color="yellow">서버에 NOTION_ACCESS_TOKEN을 설정하고 Notion 페이지에 해당 연결을 추가하세요.</Alert>}
          <TextInput label="Notion 페이지 URL 또는 ID" value={notionPage} onChange={e => setNotionPage(e.currentTarget.value)} disabled={busy} />
          <Button disabled={busy || !status?.notionConfigured || !notionPage.trim()} onClick={() => void run(async () => {
            const result = await request<{ source: CorpusSource }>('/api/corpus/import/notion', post({ page: notionPage, labels: tags() })); imported(result.source);
          })}>페이지 가져오기</Button>
        </Stack></Tabs.Panel>
        <Tabs.Panel value="local" pt="sm"><Stack gap="sm">
          <FileInput label="보존·분류할 파일" placeholder="파일 선택 (원본 최대 512 MiB)" value={file} onChange={setFile} disabled={busy} clearable />
          <Text size="xs" c="dimmed">TXT·MD·CSV·JSON·PDF·DOCX·XLSX·PPTX·HWPX를 지원합니다. 스캔·이미지·음성은 원본을 보존하고 추가 처리 대상으로 표시합니다. 같은 파일명은 한 자료의 새 버전으로 관리합니다.</Text>
          <Button disabled={busy || !file} onClick={() => void run(() => upload())}>원본 나누어 올리고 보존하기</Button>
        </Stack></Tabs.Panel>
      </Tabs>
      {busy && <Text size="sm" role="status">자료를 처리하고 있습니다…</Text>}
      {!!intakes.length && <Stack gap="xs"><Text fw={600}>원본 접수와 분석 진행</Text><Text size="xs" c="dimmed">분석이 끝나기 전에는 기존 검색 자료를 바꾸지 않습니다. 화면을 닫아도 이번 분석의 진행 위치를 보존합니다.</Text>
        {intakes.map(job => <Paper key={job.id} p="sm" withBorder><Stack gap="xs">
          <Group><Text size="sm">{job.name}</Text><Badge color={job.state === 'needs_review' ? 'yellow' : 'blue'}>{intakeState[job.state]}</Badge></Group>
          <Text size="xs">업로드 {Math.floor(job.uploadedBytes / job.bytes * 100)}% · 분석한 구조 단위 {job.cursor}개</Text>
          {job.reason && <Text size="xs" c="dimmed">{errors[job.reason] ?? (job.state === 'paused' ? '이번 묶음까지 저장했습니다. 다음 묶음을 이어서 처리하세요.' : '원본을 보존했습니다. 분석 범위와 파일 형식을 확인한 뒤 다시 시도하세요.')}</Text>}
          <Group>
            {job.state === 'uploading' && job.provider === 'local' && <Button size="xs" disabled={busy || !file} onClick={() => void run(() => upload(job))}>선택한 원본으로 업로드 재개</Button>}
            {job.state === 'uploading' && job.provider === 'google-drive' && <Button size="xs" disabled={busy} onClick={() => void run(async () => {
              await request(`/api/connections/google-drive/${job.connectionId}/intake`, post({ fileId: job.externalId, labels: job.labels, intakeId: job.id }));
              setNotice('Drive 다운로드를 이어서 완료했습니다. 분석을 시작하세요.');
            })}>Drive 다운로드 이어가기</Button>}
            {['queued', 'paused', 'needs_review'].includes(job.state) && <Button size="xs" disabled={busy || intakes.some(item => item.state === 'running')} onClick={() => void run(async () => { await request(`/api/corpus/intakes/${job.id}/process`, post({})); })}>{job.state === 'queued' ? '분석 시작' : '분석 이어가기'}</Button>}
            {job.state === 'running' && <Button size="xs" variant="light" disabled={busy} onClick={() => void run(async () => { await request(`/api/corpus/intakes/${job.id}/pause`, post({})); })}>잠시 멈춤</Button>}
            {job.contentHash && <Button size="xs" variant="subtle" component="a" href={`/api/corpus/intakes/${job.id}/original`} download>보존한 원본 받기</Button>}
          </Group>
        </Stack></Paper>)}
      </Stack>}
      <Text fw={600} mt="sm">보존한 자료 {sources.length}개</Text>
      {!sources.length && <Text size="sm" c="dimmed">자료를 등록하면 처리 경로와 검색 가능 상태가 여기에 표시됩니다.</Text>}
      <Accordion variant="separated">
        {sources.map(source => <Accordion.Item key={source.sourceId} value={source.sourceId}>
          <Accordion.Control><Group gap="xs"><Text size="sm">{source.name}</Text><Badge size="xs" variant="light">{providerNames[source.provider]}</Badge><Badge size="xs" color={source.chunkCount && source.retrievalAllowed && source.enabled ? 'teal' : 'gray'}>{source.chunkCount}개 검색 조각</Badge></Group></Accordion.Control>
          <Accordion.Panel><Stack gap="xs">
            <Text size="xs" c="dimmed">{new Date(source.importedAt).toLocaleString()} · {source.revisions}개 버전 · {source.profile.format} · {source.backup === 'original' ? '원본 파일' : source.backup === 'export' ? '내보낸 파일' : '페이지 JSON'} 보존</Text>
            <Group gap="xs">{source.profile.routes.map((route, i) => <Badge key={`${route.route}-${i}`} color={route.status === 'ready' ? 'teal' : 'yellow'} variant="light">{routeNames[route.route]} · {route.status === 'ready' ? '준비' : '추가 처리'}</Badge>)}</Group>
            {source.labels.length > 0 && <Text size="xs">업무 분류: {source.labels.join(', ')}</Text>}
            {source.profile.routes.filter(r => r.status !== 'ready').map((route, i) => <Text size="xs" key={i}>{route.detail}</Text>)}
            {source.profile.warnings.map((warning, i) => <Text size="xs" c="dimmed" key={i}>{warning}</Text>)}
            {!source.retrievalAllowed && <Text size="xs" c="red">연결이 비활성 상태여서 검색에서 제외됩니다.</Text>}
            <Switch label="검색에 포함" checked={source.enabled} disabled={busy || !source.retrievalAllowed} onChange={event => {
              const enabled = event.currentTarget.checked;
              void run(async () => { await request(`/api/corpus/sources/${source.sourceId}/enabled`, post({ enabled })); setResults(null); setSnapshot(null); setWikiSnapshot(null); });
            }} />
            <Group><Button size="xs" variant="light" disabled={busy || !source.retrievalAllowed} onClick={() => void run(async () => {
              setSnapshot((await request<{ snapshot: CorpusSnapshot }>(`/api/corpus/sources/${source.sourceId}`)).snapshot);
            })}>추출 내용 확인</Button>
              <Button size="xs" variant="light" component="a" href={`/api/corpus/sources/${source.sourceId}/backup`} download>모든 버전 백업</Button>
              <Button size="xs" variant="light" disabled={busy || !source.enabled || !source.retrievalAllowed || !source.chunkCount} onClick={() => void run(async () => {
                setWikiSnapshot((await request<{ snapshot: CorpusSnapshot }>(`/api/corpus/sources/${source.sourceId}`)).snapshot);
              })}>Wiki 분석·정본</Button>
              {status?.embeddingConfigured && <Button size="xs" variant="light" disabled={busy || !source.enabled || !source.retrievalAllowed || !source.chunkCount} onClick={() => void run(async () => {
                const progress = await request<{ chunks: number; total: number; complete: boolean }>(`/api/corpus/sources/${source.sourceId}/vectors`, post({}));
                setNotice(`${source.name}: 벡터 ${progress.chunks}/${progress.total}개 ${progress.complete ? '완료' : '저장. 다시 누르면 이어서 처리합니다.'}`);
              })}>벡터 색인</Button>}
            </Group>
          </Stack></Accordion.Panel>
        </Accordion.Item>)}
      </Accordion>
      {wikiSnapshot && <WikiPanel key={`${wikiSnapshot.sourceId}-${wikiSnapshot.revision}`} snapshot={wikiSnapshot} close={() => setWikiSnapshot(null)} />}
      {snapshot && <Paper p="sm" withBorder><Stack gap="xs"><Group justify="space-between"><Text fw={600}>{snapshot.name} · 추출 내용</Text><Button size="xs" variant="subtle" onClick={() => setSnapshot(null)}>닫기</Button></Group>
        <Text size="xs" c="dimmed">총 {snapshot.chunks.length}개 중 처음 20개를 표시합니다. 전체 내용은 백업에 포함됩니다.</Text>
        {snapshot.chunks.slice(0, 20).map(chunk => <div key={chunk.id}><Text size="xs" fw={600}>{chunk.locator}</Text><Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{chunk.text}</Text></div>)}
      </Stack></Paper>}
      <Text fw={600} mt="sm">자료 검색</Text>
      <Text size="xs" c="dimmed">키워드와 업무 분류를 합쳐 순위를 정합니다. 로컬 임베딩을 설정하고 색인하면 벡터 검색도 함께 사용합니다.</Text>
      <Group align="end"><TextInput style={{ flex: 1 }} label="검색어" value={query} onChange={e => setQuery(e.currentTarget.value)} maxLength={500} /><Button disabled={busy || !query.trim()} onClick={() => void run(async () => setResults(await request<CorpusSearchResult>(`/api/corpus/search?q=${encodeURIComponent(query)}`)))}>검색</Button></Group>
      {results && <Stack gap="xs"><Text size="xs" c="dimmed">{results.mode === 'keyword_vector_graph' ? '키워드 + 벡터 + 업무 연결' : '키워드 + 업무 연결'} · {results.hits.length}개 결과</Text>
        {results.warnings.map(w => <Text size="xs" c="orange" key={w}>{w}</Text>)}
        {results.hits.map(hit => <Paper p="sm" withBorder key={`${hit.sourceId}-${hit.chunkId}`}><Text size="sm" fw={600}>{hit.title}</Text><Text size="xs" c="dimmed">{hit.locator} · {hit.signals.map(s => s === 'keyword' ? '키워드' : s === 'vector' ? '벡터' : '업무 연결').join(' + ')}</Text><Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{hit.text}</Text>
          {hit.context?.complete && <details><summary>절·표의 문맥 함께 읽기</summary><Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{hit.context.text}</Text></details>}
          {hit.context && !hit.context.complete && <Text size="xs" c="orange">전체 문맥을 확인하지 못했습니다. 이 조각만으로 조건이나 예외를 확정하지 마세요.</Text>}
        </Paper>)}
      </Stack>}
    </Stack>
  </Paper>;
}
