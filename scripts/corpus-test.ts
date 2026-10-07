import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import AdmZip from 'adm-zip';
import ExcelJS from 'exceljs';
import { classify, CorpusError, extract, MAX_SOURCE_BYTES, parseDelimited } from '../src/server/corpus/extract.js';
import { CorpusStore } from '../src/server/corpus/store.js';
import { CorpusService } from '../src/server/corpus/service.js';
import { localEmbedder, searchCorpus, validateVectors, type CorpusEmbedder } from '../src/server/corpus/search.js';
import { createCorpusRoutes } from '../src/server/corpus/routes.js';

let passed = 0;
async function test(name: string, run: () => void | Promise<void>) { await run(); passed++; console.log(`PASS ${name}`); }
const root = mkdtempSync(join(tmpdir(), 'soloforce-corpus-'));
const store = new CorpusStore(root); const service = new CorpusService(store);
const input = (name: string, text: string, labels: string[] = []) => ({ provider: 'local' as const, externalId: name, name, mime: 'text/plain', bytes: Buffer.from(text), labels });
function pdf(text = ''): Buffer {
  const stream = `BT /F1 12 Tf 70 750 Td (${text}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let body = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}
try {
  await test('signature wins over extension; corrupt Office is review, not text', () => {
    assert.equal(classify('renamed.txt', 'text/plain', pdf()).format, 'pdf');
    assert.equal(classify('fake.xlsx', 'application/octet-stream', Buffer.from('not an office file')).format, 'unknown');
    assert.equal(classify('broken.docx', '', Buffer.from('PKbroken archive')).format, 'unknown');
    assert.throws(() => classify('big.txt', 'text/plain', Buffer.alloc(MAX_SOURCE_BYTES + 1)), (e: unknown) => e instanceof CorpusError && e.status === 413);
  });
  await test('CSV preserves quoted commas, multiline cells, zero prefixes, negatives', () => {
    assert.deepEqual(parseDelimited('코드,금액,메모\r\n0012,"-1,200.50","첫 줄\n둘째 ""인용"""\r\n'), [['코드', '금액', '메모'], ['0012', '-1,200.50', '첫 줄\n둘째 "인용"']]);
    assert.throws(() => parseDelimited('"broken'), /unclosed_csv_quote/);
  });
  await test('mixed Markdown branches to text + table + user-label graph', async () => {
    const result = await extract('report.md', 'text/markdown', Buffer.from('# 매출\n고객 설명\n\n| 고객 | 금액 |\n| --- | --- |\n| 현대 | 001200 |\n'), ['고객:현대']);
    assert.deepEqual(new Set(result.profile.routes.map(r => r.route)), new Set(['text', 'table', 'graph']));
    assert.ok(result.units.find(c => c.kind === 'table' && c.cells?.includes('001200')));
  });
  await test('real XLSX preserves formula, cached value, format, sparse cells and sheet', async () => {
    const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet('사업별');
    sheet.addRow(['고객', '금액']); sheet.addRow(['0012', -1200.5]);
    sheet.getCell('B3').value = { formula: 'B2*2', result: -2401 }; sheet.getCell('B3').numFmt = '#,##0.00';
    const result = await extract('numbers.xlsx', '', Buffer.from(await book.xlsx.writeBuffer()));
    assert.ok(result.chunks.some(c => c.text.includes('formula=B2*2') && c.text.includes('-2401') && c.locator.includes('사업별')));
    assert.ok(result.units.some(c => c.cells?.[0] === '0012'));
  });
  await test('DOCX body and table are separate, XML entities decoded without execution', async () => {
    const zip = new AdmZip(); zip.addFile('word/document.xml', Buffer.from('<w:document><w:p><w:r><w:t>A &amp; B</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>001</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>-50</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:document>'));
    const result = await extract('office.docx', '', zip.toBuffer());
    assert.equal(result.chunks.filter(c => c.kind === 'text')[0].text, 'A & B');
    assert.deepEqual(result.units.find(c => c.kind === 'table')?.cells, ['001', '-50']);
  });
  await test('PDF uses actual text parser and empty pages require OCR', async () => {
    const text = await extract('real.pdf', 'application/pdf', pdf('Evidence alpha invoice 12345'));
    assert.ok(text.chunks.some(c => c.text.includes('invoice 12345') && c.locator.includes('1쪽')));
    const scanned = await extract('empty.pdf', 'application/pdf', pdf());
    assert.ok(scanned.profile.routes.some(r => r.route === 'ocr' && r.status === 'needs_tool'));
  });
  await test('unsupported media and malformed JSON are backed up but never falsely ready', async () => {
    for (const [name, bytes] of [['photo.png', Buffer.from([137, 80, 78, 71])], ['recording.mp3', Buffer.from('ID3')], ['broken.json', Buffer.from('{no')]] as const) {
      const source = await service.import({ ...input(name, ''), bytes });
      assert.equal(source.chunkCount, 0); assert.ok(source.profile.routes.every(r => r.status !== 'ready'));
      assert.ok(store.backup(source.sourceId).length);
    }
  });
  await test('long text past 16 KiB remains searchable and has a stable locator', async () => {
    const source = await service.import(input('long.txt', '일반 설명 '.repeat(4000) + ' 후반부전용증거XYZ'));
    const result = await searchCorpus(store, '후반부전용증거XYZ');
    assert.ok(result.hits.some(h => h.sourceId === source.sourceId && h.text.includes('후반부전용증거XYZ')));
  });
  await test('same-version imports reuse backup; new version preserves old bytes', async () => {
    const first = await service.import(input('versions.txt', 'alpha 첫 버전'));
    const same = await service.import(input('versions.txt', 'alpha 첫 버전'));
    assert.equal(first.revision, same.revision); assert.equal(same.revisions, 1);
    const next = await service.import(input('versions.txt', 'beta 다음 버전'));
    assert.equal(next.revisions, 2); assert.notEqual(next.revision, first.revision);
    const archive = new AdmZip(store.backup(first.sourceId));
    assert.equal(archive.readAsText(`corpus/${first.sourceId}/${first.revision}/original.bin`), 'alpha 첫 버전');
    assert.equal(archive.readAsText(`corpus/${first.sourceId}/${next.revision}/original.bin`), 'beta 다음 버전');
    assert.throws(() => store.snapshot('../../etc/passwd'), /invalid_source_id/);
  });
  await test('excluded sources stay excluded on re-import and never enter retrieval', async () => {
    const source = await service.import(input('private.txt', 'privatesecret'));
    store.setEnabled(source.sourceId, false);
    assert.equal((await service.import(input('private.txt', 'privatesecret updated'))).enabled, false);
    assert.equal((await searchCorpus(store, 'privatesecret')).hits.length, 0);
  });
  await test('keyword and graph fusion preserve evidence without inventing facts', async () => {
    const source = await service.import(input('timeline.txt', '일정은 다음 주 화요일입니다.', ['프로젝트:선박A']));
    const result = await searchCorpus(store, '선박A');
    assert.ok(result.hits.some(h => h.sourceId === source.sourceId && h.signals.includes('graph')));
    assert.ok(result.hits.every(h => !h.signals.includes('vector')));
  });
  await test('real vector math + RRF finds semantic candidate and rejects dimension drift', async () => {
    const isolated = new CorpusStore(join(root, 'vector-test'));
    const embedder: CorpusEmbedder = { model: 'fixture-semantic-v1', embed: async texts => texts.map(t => t.includes('invoice') || t.includes('billing') ? [1, 0] : [0, 1]) };
    const vectorService = new CorpusService(isolated, embedder);
    const invoice = await vectorService.import(input('record.txt', 'invoice overdue'));
    const other = await vectorService.import(input('manual.txt', 'unrelated equipment'));
    await vectorService.indexVectors(invoice.sourceId); await vectorService.indexVectors(other.sourceId);
    const result = await searchCorpus(isolated, 'billing', { embedder });
    assert.equal(result.mode, 'keyword_vector_graph'); assert.equal(result.hits[0].sourceId, invoice.sourceId);
    assert.deepEqual(result.hits[0].signals, ['vector']);
    const drift = await searchCorpus(isolated, 'billing', { embedder: { ...embedder, embed: async () => [[1, 0, 0]] } });
    assert.equal(drift.mode, 'keyword_graph'); assert.ok(drift.warnings.length);
    assert.equal(validateVectors([[Number.NaN]], 1), false); assert.equal(validateVectors([[0, 0]], 1), false);
    assert.throws(() => localEmbedder({ CORPUS_EMBED_MODEL: 'test', CORPUS_EMBED_URL: 'https://external.example/api/embed' }), /embedding_requires_local_endpoint/);
  });
  await test('revocation during await blocks both import commit and vector search', async () => {
    const isolated = new CorpusStore(join(root, 'revoke-test')); const importer = new CorpusService(isolated);
    await assert.rejects(importer.import(input('denied.txt', 'never indexed'), () => false), /connection_inactive/);
    assert.equal(isolated.list().length, 0);
    const source = await importer.import(input('remote.txt', 'remote evidence'));
    let active = true;
    const embedder: CorpusEmbedder = { model: 'revocation', embed: async () => { active = false; return [[1, 0]]; } };
    isolated.writeVectors(source.sourceId, source.revision, embedder.model, [[1, 0]]);
    assert.equal((await searchCorpus(isolated, 'remote', { embedder, allowed: () => active })).hits.length, 0);
  });
  await test('actual HTTP upload -> classification -> retrieval -> backup, with CSRF checks', async () => {
    const app = createCorpusRoutes({ service: new CorpusService(new CorpusStore(join(root, 'http-test'))) });
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address(); assert.ok(address && typeof address === 'object');
    const origin = `http://127.0.0.1:${address.port}`;
    try {
      assert.equal((await fetch(`${origin}/status`)).status, 200);
      assert.equal((await fetch(`${origin}/sources`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
      assert.equal((await fetch(`${origin}/import/local`, { method: 'POST' })).status, 403);
      const form = new FormData(); form.set('file', new File(['이 자료의 고유검증단어는 오로라입니다.'], 'uploaded.txt')); form.set('labels', '[]');
      const response = await fetch(`${origin}/import/local`, { method: 'POST', headers: { Origin: origin }, body: form });
      assert.equal(response.status, 201, await response.clone().text());
      const { source } = await response.json() as { source: { sourceId: string } };
      const search = await fetch(`${origin}/search?q=${encodeURIComponent('고유검증단어')}`);
      const body = await search.json() as { hits: { text: string }[] }; assert.ok(body.hits[0].text.includes('오로라'));
      assert.equal((await fetch(`${origin}/sources/${source.sourceId}/backup`)).headers.get('content-type'), 'application/zip');
      assert.equal((await fetch(`${origin}/sources/${source.sourceId}/enabled`, { method: 'POST', headers: { Origin: 'https://hostile.example', 'Content-Type': 'application/json' }, body: '{"enabled":false}' })).status, 403);
      const bad = new FormData(); bad.set('file', new File(['test'], 'test.txt')); bad.set('labels', '{"wrong":true}');
      assert.equal((await fetch(`${origin}/import/local`, { method: 'POST', headers: { Origin: origin }, body: bad })).status, 400);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
  console.log(`Corpus: ${passed} scenarios passed (real parsers/HTTP, fixture vectors; no paid service).`);
} finally { rmSync(root, { recursive: true, force: true }); }
