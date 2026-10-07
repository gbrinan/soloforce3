import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';

const root = mkdtempSync(join(tmpdir(), 'corpus-real-server-'));
process.env.MYCREW_HOME = root; process.env.WORKSPACE_ROOT = root; process.env.PROJECTS_FOLDER = 'projects';
delete process.env.CORPUS_EMBED_MODEL;
delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET;
try {
  const { createServerApp } = await import('../src/server/create-server-app.js');
  const { getCorpusService } = await import('../src/server/corpus/runtime.js');
  const { restoreFromZip } = await import('../src/server/data-backup.js');
  const { buildWorkspaceAskContext } = await import('../src/server/ai-search.js');
  const app = createServerApp();
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(`${origin}/api/health`)).status, 200);
    assert.equal((await fetch(`${origin}/api/data/backup`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.equal((await fetch(`${origin}/api/data/restore`, { method: 'POST' })).status, 403);
    const form = new FormData(); form.set('file', new File(['검증프로젝트 오로라의 확정 예산은 001200원입니다.'], '검증프로젝트.txt'));
    const imported = await fetch(`${origin}/api/corpus/import/local`, { method: 'POST', headers: { origin }, body: form });
    assert.equal(imported.status, 201, await imported.clone().text());
    const { source } = await imported.json() as { source: { sourceId: string; revision: string } };
    const response = await fetch(`${origin}/api/ai/search?q=${encodeURIComponent('검증프로젝트')}`);
    assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json() as { results: { source: string; snippet: string }[] };
    assert.ok(result.results.some(hit => hit.source === 'corpus' && hit.snippet.includes('001200')));
    const context = await buildWorkspaceAskContext('검증프로젝트', true);
    assert.ok(context.context.includes('001200')); assert.ok(context.sources[0].locator);
    const denied = await buildWorkspaceAskContext('검증프로젝트', false);
    assert.ok(denied.sources.every(hit => hit.source !== 'corpus'));
    const backup = await fetch(`${origin}/api/corpus/sources/${source.sourceId}/backup`);
    const zipPath = join(root, 'restore-fixture.zip'); writeFileSync(zipPath, Buffer.from(await backup.arrayBuffer()));
    rmSync(join(root, 'history', 'corpus', source.sourceId), { force: true, recursive: true });
    assert.equal(getCorpusService().store.list().length, 0);
    assert.equal(restoreFromZip(zipPath).restored, 3);
    assert.equal(getCorpusService().store.snapshot(source.sourceId)?.revision, source.revision);
    assert.ok((await buildWorkspaceAskContext('검증프로젝트', true)).context.includes('001200'));
    console.log('PASS shipped server: health, corpus upload, SQLite-backed unified search, Ask context authorization, backup restore');

    const { getCorpusIntake } = await import('../src/server/corpus/routes.js');
    const { hash } = await import('../src/server/corpus/extract.js');
    const intake = getCorpusIntake(getCorpusService());
    const exception = '단, 대외 발송은 담당자가 검토 후 직접 발송한다.';
    const raw = Buffer.from('# 문맥검증규칙\n자동 발송을 허용한다.\n' + '절차 설명. '.repeat(250) + exception + '\n# 다른 절\n별도 조건');
    const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const create = await fetch(`${origin}/api/corpus/intakes`, post({ name: 'context.md', bytes: raw.length, labels: [] }));
    assert.equal(create.status, 201, await create.clone().text());
    const { job } = await create.json() as { job: { id: string } };
    const path = `${origin}/api/corpus/intakes/${job.id}`;
    assert.equal((await fetch(`${origin}/api/corpus/intakes`, { ...post({}), headers: { origin: 'https://foreign.invalid' } })).status, 403);
    assert.equal((await fetch(`${path}/original`)).status, 409);
    const content = { method: 'PATCH', headers: { origin, 'X-Chunk-SHA256': hash(raw) }, body: raw };
    assert.equal((await fetch(`${path}/content?offset=10`, content)).status, 409);
    assert.equal((await fetch(`${path}/content?offset=0`, { ...content, headers: { origin, 'X-Chunk-SHA256': 'bad' } })).status, 400);
    assert.equal((await fetch(`${path}/content?offset=0`, content)).status, 200);
    assert.equal((await fetch(`${path}/complete`, post({}))).status, 200);
    const original = await fetch(`${path}/original`);
    assert.equal(original.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Buffer.from(await original.arrayBuffer()), raw);
    assert.equal((await fetch(`${path}/process`, post({ unitLimit: 1 }))).status, 202);
    assert.equal((await intake.wait(job.id)).state, 'complete'); // Default HTTP mode continues every checkpoint.
    const expanded = await buildWorkspaceAskContext('문맥검증규칙', true);
    assert.ok(expanded.context.includes(exception), expanded.context);
    const oversized = await getCorpusService().import({ provider: 'local', externalId: 'oversized.txt', name: 'oversized.txt', mime: '', bytes: Buffer.from('문맥누락검증\n' + 'X'.repeat(25_000)) });
    const bounded = await buildWorkspaceAskContext('문맥누락검증', true);
    assert.ok(bounded.sources.every(hit => hit.sourceId !== oversized.sourceId));
    assert.ok(!bounded.context.includes('X'.repeat(1200)));
    assert.ok(bounded.warnings.some(warning => warning.includes('문맥 예산')));

    // A caller cannot upload local bytes while claiming they came from a Drive connection.
    const remoteStore = new (await import('../src/server/corpus/store.js')).CorpusStore(join(root, 'remote', 'corpus'));
    const remoteService = new (await import('../src/server/corpus/service.js')).CorpusService(remoteStore);
    const { createCorpusRoutes } = await import('../src/server/corpus/routes.js');
    const remoteApp = createCorpusRoutes({ service: remoteService, authorize: () => true, allowed: () => true });
    const remoteIntake = getCorpusIntake(remoteService);
    const remote = remoteIntake.create({ name: 'drive.md', bytes: 3 }, { provider: 'google-drive', externalId: 'file', connectionId: 'connection' });
    assert.equal((await remoteApp.request(`/intakes/${remote.id}/content?offset=0`, { method: 'PATCH', body: 'abc' })).status, 403);
    assert.equal((await remoteApp.request(`/intakes/${remote.id}/complete`, { method: 'POST' })).status, 403);
    console.log('PASS shipped intake HTTP: owner guard, part/hash/offset checks, original readback, automatic analysis, full parent Ask context, oversized unit held out, remote provenance guard');
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
} finally { rmSync(root, { force: true, recursive: true }); }
// 실제 앱 조합의 기존 background watchers/timers는 테스트 종료 시 함께 정리한다.
process.exit(0);
