import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extract } from '../src/server/corpus/extract.js';
import { CorpusStore } from '../src/server/corpus/store.js';
import { CorpusService } from '../src/server/corpus/service.js';
import { searchCorpus } from '../src/server/corpus/search.js';
import { readChunkContext } from '../src/server/corpus/source-reader.js';

const root = mkdtempSync(join(tmpdir(), 'corpus-structure-'));
try {
  const store = new CorpusStore(root); const service = new CorpusService(store);
  const general = '자동 발송을 허용한다.'; const exception = '단, 대외 발송은 담당자가 검토 후 직접 발송한다.';
  const source = await service.import({ provider: 'local', externalId: 'rules.md', name: 'rules.md', mime: '', bytes: Buffer.from('# 발송 규칙\n'+general+'\n'+'절차 설명. '.repeat(250)+'\n'+exception) });
  const snapshot = store.snapshot(source.sourceId)!;
  assert.ok(snapshot.chunks.length > 1); assert.equal(snapshot.units!.length, 1);
  assert.ok(snapshot.chunks.every(chunk => chunk.unitId === snapshot.units![0].id));
  const context = readChunkContext(snapshot, snapshot.chunks[0]);
  assert.ok(context.complete && context.text.includes(general) && context.text.includes(exception));
  const hit = (await searchCorpus(store, '자동 발송')).hits[0];
  assert.ok(hit.context!.text.includes(exception));
  const huge = { ...snapshot, units: [{ ...snapshot.units![0], text: '원문'.repeat(100_000) }] };
  assert.equal(readChunkContext(huge, snapshot.chunks[0]).complete, false);
  console.log('PASS exception beyond search boundary reaches parent context; oversized context explicitly incomplete');

  const csv = await extract('table.csv', '', Buffer.from('기업,요구사항\nA기업,'+'상세설명.'.repeat(2400)+'\n'));
  assert.equal(csv.units.length, 2);
  const rows = csv.chunks.filter(chunk => chunk.unitId === csv.units[1].id);
  assert.ok(rows.length > 1); assert.ok(rows.every(chunk => chunk.cells === undefined));
  assert.equal(csv.units[1].cells?.[0], 'A기업'); assert.ok(csv.units[1].text.includes('열: 기업 | 요구사항'));
  assert.ok(JSON.stringify(rows).length < 20_000);
  const fenced = await extract('fence.md', '', Buffer.from('# 실제 절\n```text\n# 코드의 제목\n```\n예외도 같은 절에 있다.'));
  assert.equal(fenced.units.length, 1);
  console.log('PASS long table row stored once, headers retained, Markdown code fences do not create false sections');

  let calls = 0; let fail = true;
  const vectors = new CorpusService(store, { model: 'synthetic-no-network', async embed(texts) {
    calls++; if (fail && calls === 2) throw new Error('synthetic interruption');
    return texts.map(() => [1, 0]);
  } });
  const big = await service.import({ provider: 'local', externalId: 'many.csv', name: 'many.csv', mime: '', bytes: Buffer.from('ID,조건\n'+Array.from({ length: 1001 }, (_, i) => `${i},담당자가 승인 후 발송`).join('\n')) });
  await assert.rejects(vectors.indexVectors(big.sourceId));
  assert.equal(store.readVectorProgress(big.sourceId, big.revision, 'synthetic-no-network').length, 16);
  fail = false; let progress = await vectors.indexVectors(big.sourceId);
  assert.equal(progress.chunks, 144); assert.equal(progress.complete, false);
  while (!progress.complete) progress = await vectors.indexVectors(big.sourceId);
  assert.equal(progress.total, 1002); assert.equal(store.readVectors(big.sourceId, big.revision, 'synthetic-no-network')?.length, 1002);
  const before = calls; assert.equal((await vectors.indexVectors(big.sourceId)).complete, true); assert.equal(calls, before);
  console.log('PASS >1000 vectors, bounded batches, interrupted indexing resumes, complete cache avoids re-embedding');
} finally { rmSync(root, { recursive: true, force: true }); }
