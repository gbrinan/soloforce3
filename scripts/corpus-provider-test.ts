import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { GoogleReadonlyHttpProvider, GOOGLE_READONLY_SCOPES } from '../src/server/google-readonly-provider.js';
import { GoogleReadonlyConnectionService } from '../src/server/google-readonly-service.js';
import { GoogleConnectionRegistry } from '../src/server/google-connection-registry.js';
import { EncryptedConnectionSecretBroker } from '../src/server/connection-secret-broker.js';
import { createGoogleReadonlyRoutes } from '../src/server/google-readonly-routes.js';
import { NotionReadonlyProvider, NOTION_VERSION } from '../src/server/corpus/notion.js';
import { CorpusService } from '../src/server/corpus/service.js';
import { CorpusStore } from '../src/server/corpus/store.js';
import { searchCorpus } from '../src/server/corpus/search.js';

const root = mkdtempSync(join(tmpdir(), 'corpus-provider-'));
const mock = new Hono();
const bytes = Buffer.from('고객,금액\n현대,001250\n');
let versionChanged = false; let metadataReads = 0; let trashed = false; let tooLarge = false; let canDownload = true;
let exported = false; let corruptChecksum = false; let remoteForbidden = false;
let transferBytes = bytes; let badRange = false;
mock.post('/token', c => c.json({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 3600, token_type: 'Bearer', scope: GOOGLE_READONLY_SCOPES.join(' ') }));
mock.get('/identity', c => c.json({ sub: 'fixture-subject', email: 'owner@example.test', email_verified: true }));
mock.get('/drive/files/:id/export', c => {
  assert.equal(c.req.header('authorization'), 'Bearer fixture-access');
  assert.equal(c.req.query('mimeType'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  exported = true; return c.body(new Uint8Array(transferBytes));
});
mock.get('/drive/files/:id', c => {
  assert.equal(c.req.header('authorization'), 'Bearer fixture-access');
  if (remoteForbidden) return c.json({ error: 'forbidden' }, 403);
  if (c.req.query('alt') === 'media') {
    const range = c.req.header('range')?.match(/^bytes=(\d+)-(\d+)$/);
    if (range && !badRange) { const start = Number(range[1]); const end = Number(range[2]); c.header('Content-Range', `bytes ${start}-${end}/${transferBytes.length}`); return c.body(new Uint8Array(transferBytes.subarray(start, end + 1)), 206); }
    return c.body(new Uint8Array(transferBytes));
  }
  metadataReads++;
  const native = c.req.param('id') === 'native-sheet';
  return c.json({ id: c.req.param('id'), name: native ? '원본 시트' : 'sales.csv', mimeType: native ? 'application/vnd.google-apps.spreadsheet' : 'text/csv',
    version: versionChanged && metadataReads % 2 === 0 ? '2' : '1', size: tooLarge ? '30000000' : String(transferBytes.length), trashed,
    capabilities: { canDownload }, md5Checksum: corruptChecksum ? 'bad' : createHash('md5').update(transferBytes).digest('hex') });
});
mock.get('/drive/files', c => c.json({ files: [{ id: 'fixture-file', name: 'sales.csv', mimeType: 'text/csv' }] }));
const pageId = '11111111-1111-1111-1111-111111111111';
let pageReads = 0; let notionChanged = false; let notionDenied = false; let notionArchived = false; let malformedCursor = false;
mock.use('/notion/*', async (c, next) => {
  assert.equal(c.req.header('Notion-Version'), NOTION_VERSION);
  assert.equal(c.req.header('Authorization'), 'Bearer test-notion-token');
  if (notionDenied) return c.json({ object: 'error' }, 403);
  await next();
});
mock.get('/notion/pages/:id', c => {
  pageReads++;
  return c.json({ object: 'page', id: pageId, last_edited_time: notionChanged && pageReads % 2 === 0 ? '2026-09-06T01:00:00Z' : '2026-09-06T00:00:00Z', archived: notionArchived,
    properties: { title: { type: 'title', title: [{ plain_text: '프로젝트 회의' }] } } });
});
mock.get('/notion/blocks/:id/children', c => {
  const text = (id: string, value: string, children = false) => ({ id, type: 'paragraph', has_children: children, paragraph: { rich_text: [{ plain_text: value }] } });
  const heading = (id: string, value: string) => ({ id, type: 'heading_1', heading_1: { rich_text: [{ plain_text: value }] } });
  if (c.req.param('id') === 'nested') return c.json({ results: [heading('child-heading', '하위 범위'), text('inside', '중첩 본문 증거')], has_more: false });
  if (c.req.query('start_cursor') === 'opaque=cursor/2') return c.json({ results: [text('after', '바깥 본문'), { id: 'row', type: 'table_row', table_row: { cells: [[{ plain_text: '현대' }], [{ plain_text: '001250' }]] } }, { id: 'photo', type: 'image', image: { file: { url: 'https://example.invalid/signed' } } }], has_more: false });
  return c.json({ results: [heading('root-heading', '주 문서'), text('nested', '상위 본문', true)], has_more: true, next_cursor: malformedCursor ? null : 'opaque=cursor/2' });
});
const server = serve({ fetch: mock.fetch, hostname: '127.0.0.1', port: 0 });
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address(); assert.ok(address && typeof address === 'object');
const base = `http://127.0.0.1:${address.port}`;
const provider = new GoogleReadonlyHttpProvider({ clientId: 'id', clientSecret: 'secret', redirectUri: 'http://localhost/callback', authorizationEndpoint: `${base}/authorize`, tokenEndpoint: `${base}/token`, userinfoEndpoint: `${base}/identity`, driveFilesEndpoint: `${base}/drive/files` });
let passed = 0;
async function test(name: string, run: () => Promise<void>) { await run(); passed++; console.log(`PASS ${name}`); }
try {
  await test('Drive binary download validates revision, size and checksum', async () => {
    const file = await provider.readFile('refresh', 'fixture-file');
    assert.equal(file.mime, 'text/csv'); assert.deepEqual(file.bytes, bytes); assert.equal(file.exported, false);
  });
  await test('Drive native document uses export MIME and preserves origin revision', async () => {
    const file = await provider.readFile('refresh', 'native-sheet');
    assert.ok(exported); assert.equal(file.exported, true); assert.equal(file.name, '원본 시트.xlsx'); assert.equal(file.revision, '1');
  });
  await test('Drive export resume rechecks previously accepted bytes at the same revision', async () => {
    const { CorpusIntakeService } = await import('../src/server/corpus/intake.js');
    const intake = new CorpusIntakeService(new CorpusStore(join(root, 'export-resume', 'corpus')));
    transferBytes = Buffer.alloc(5 * 1024 * 1024, 65);
    let id = ''; let stop = true;
    const sink = {
      async begin(meta: { name: string; bytes: number; mime: string }) {
        if (!id) id = intake.create({ name: meta.name, bytes: meta.bytes, mime: meta.mime }).id;
        return intake.read(id).uploadedBytes;
      },
      async write(offset: number, part: Buffer) {
        if (stop && offset > 0) throw new Error('synthetic interruption');
        await intake.append(id, offset, part, createHash('sha256').update(part).digest('hex'));
      },
    };
    await assert.rejects(provider.transferFile('refresh', 'native-sheet', sink));
    assert.equal(intake.read(id).uploadedBytes, 4 * 1024 * 1024);
    stop = false; transferBytes[0] = 66;
    await assert.rejects(provider.transferFile('refresh', 'native-sheet', sink), /intake_part_conflict/);
    assert.equal(intake.read(id).uploadedBytes, 4 * 1024 * 1024);
    transferBytes[0] = 65;
    await provider.transferFile('refresh', 'native-sheet', sink);
    assert.equal((await intake.finish(id)).contentHash, createHash('sha256').update(transferBytes).digest('hex'));
    transferBytes = bytes;
  });
  await test('Drive changes, deleted files, disabled download, size and checksum fail closed', async () => {
    metadataReads = 0; versionChanged = true; await assert.rejects(provider.readFile('refresh', 'fixture-file'), /source_changed_retry/); versionChanged = false;
    trashed = true; await assert.rejects(provider.readFile('refresh', 'fixture-file'), /drive_download_forbidden/); trashed = false;
    canDownload = false; await assert.rejects(provider.readFile('refresh', 'fixture-file'), /drive_download_forbidden/); canDownload = true;
    tooLarge = true; await assert.rejects(provider.readFile('refresh', 'fixture-file'), /file_too_large/); tooLarge = false;
    corruptChecksum = true; await assert.rejects(provider.readFile('refresh', 'fixture-file'), /drive_checksum_mismatch/); corruptChecksum = false;
    remoteForbidden = true; await assert.rejects(provider.readFile('refresh', 'fixture-file'), /drive_content_fetch_failed/); remoteForbidden = false;
  });
  await test('Drive range transfer resumes without re-downloading accepted bytes and rejects an ignored range', async () => {
    transferBytes = Buffer.alloc(5 * 1024 * 1024, 65); let received = 0; let interrupt = true;
    const parts: Buffer[] = [];
    const sink = { async begin(meta: { bytes: number }) { assert.equal(meta.bytes, transferBytes.length); return received; },
      async write(offset: number, value: Buffer) { assert.equal(offset, received); if (interrupt && received) throw new Error('synthetic interruption'); parts.push(value); received += value.length; } };
    await assert.rejects(provider.transferFile('refresh', 'fixture-file', sink)); assert.equal(received, 4 * 1024 * 1024);
    interrupt = false; await provider.transferFile('refresh', 'fixture-file', sink); assert.deepEqual(Buffer.concat(parts), transferBytes);
    badRange = true; received = 4 * 1024 * 1024; await assert.rejects(provider.transferFile('refresh', 'fixture-file', sink), /drive_range_not_supported/); badRange = false;
    metadataReads = 0; versionChanged = true; received = transferBytes.length;
    await assert.rejects(provider.transferFile('refresh', 'fixture-file', sink), /source_changed_retry/); versionChanged = false;
    transferBytes = bytes;
  });
  await test('Drive OAuth -> list -> import -> search -> revoke uses encrypted credential broker', async () => {
    const registry = new GoogleConnectionRegistry({ projectRoot: root });
    const broker = new EncryptedConnectionSecretBroker({ rootDirectory: join(root, 'secrets'), encryptionKey: Buffer.alloc(32, 1) });
    const drive = new GoogleReadonlyConnectionService({ projectRoot: root, projectId: 'corpus-test', registry, broker, provider });
    const corpus = new CorpusService(new CorpusStore(join(root, 'corpus')));
    const routes = createGoogleReadonlyRoutes({ projectId: 'corpus-test', service: drive, corpus,
      resolveCredential: c => c.req.path.endsWith('/callback') ? { kind: 'oauth_transaction', state: 'active', provider: 'google-drive' } : { kind: 'owner', csrfValid: c.req.header('origin') === 'http://localhost', recentAuth: true }, resolveOwnerPrincipalId: () => 'owner-fixture' });
    const start = drive.startConnection({ ownerPrincipalId: 'owner-fixture' }); const state = new URL(start.authorizationUrl).searchParams.get('state');
    const callback = await routes.request(`http://localhost/oauth/callback?state=${state}&code=fixture`);
    assert.equal(callback.status, 201);
    const { connection } = await callback.json() as { connection: { connectionId: string } };
    const id = connection.connectionId;
    const list = await routes.request('http://localhost/connections');
    const listText = await list.text(); assert.ok(listText.includes('owner@example.test')); assert.ok(!listText.includes('refresh')); assert.ok(!listText.includes('credentialHandle'));
    assert.equal((await routes.request(`http://localhost/${id}/import`, { method: 'POST', body: '{"fileId":"fixture-file"}' })).status, 403);
    const imported = await routes.request(`http://localhost/${id}/import`, { method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body: '{"fileId":"fixture-file","labels":["고객:현대"]}' });
    assert.equal(imported.status, 201, await imported.clone().text());
    const result = await searchCorpus(corpus.store, '현대', { allowed: s => drive.isConnectionActive(s.connectionId!) });
    assert.ok(result.hits.some(h => h.text.includes('001250')));
    const received = await routes.request(`http://localhost/${id}/intake`, { method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body: '{"fileId":"fixture-file","labels":[]}' });
    assert.equal(received.status, 201, await received.clone().text());
    const receipt = await received.json() as { job: { state: string; contentHash: string } };
    assert.equal(receipt.job.state, 'queued'); assert.equal(receipt.job.contentHash, createHash('sha256').update(bytes).digest('hex'));
    drive.revokeConnection(id);
    assert.equal((await searchCorpus(corpus.store, '현대', { allowed: s => drive.isConnectionActive(s.connectionId!) })).hits.length, 0);
    await assert.rejects(drive.readFile(id, 'fixture-file'), /connection_inactive/);
    assert.equal(corpus.store.list().length, 1, 'offline backup remains after revocation');
  });
  const notion = new NotionReadonlyProvider('test-notion-token', `${base}/notion`);
  await test('Notion recursively paginates opaque cursors and preserves table cells + original blocks', async () => {
    const input = await notion.readPage(`https://app.notion.com/p/${pageId}`, ['프로젝트:선박A']);
    assert.ok(input.extracted?.chunks.some(c => c.text.includes('중첩 본문 증거')));
    assert.ok(input.extracted?.units?.some(c => c.cells?.includes('001250')));
    assert.ok(input.extracted?.profile.routes.some(r => r.route === 'ocr' && r.status === 'needs_tool'));
    assert.equal(input.backup, 'page_snapshot'); assert.ok(!input.bytes.toString().includes('test-notion-token'));
    assert.equal(JSON.parse(input.bytes.toString()).blocks.length, 7);
    assert.deepEqual(input.extracted?.units?.find(unit => unit.text === '중첩 본문 증거')?.headingPath, ['하위 범위']);
    assert.deepEqual(input.extracted?.units?.find(unit => unit.text === '바깥 본문')?.headingPath, ['주 문서']);
  });
  await test('Notion rejects changing pages, revoked access, archived pages and broken pagination', async () => {
    pageReads = 0; notionChanged = true; await assert.rejects(notion.readPage(pageId), /source_changed_retry/); notionChanged = false;
    notionDenied = true; await assert.rejects(notion.readPage(pageId), /notion_page_not_accessible/); notionDenied = false;
    notionArchived = true; await assert.rejects(notion.readPage(pageId), /notion_page_not_accessible/); notionArchived = false;
    malformedCursor = true; await assert.rejects(notion.readPage(pageId), /notion_pagination_error/); malformedCursor = false;
    await assert.rejects(notion.readPage('https://169.254.169.254/latest/meta-data'), /invalid_notion_page/);
  });
  console.log(`Corpus providers: ${passed} scenarios passed using local mock HTTP; no live cloud credentials.`);
} finally {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  rmSync(root, { force: true, recursive: true });
}
