import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import AdmZip from 'adm-zip';
import { CorpusStore } from '../src/server/corpus/store.js';
import { CorpusService } from '../src/server/corpus/service.js';
import { CorpusIntakeService } from '../src/server/corpus/intake.js';
import { INTAKE_LIMITS } from '../src/shared/corpus-intake.js';
import { hash } from '../src/server/corpus/extract.js';
import { extractTextFile } from '../src/server/corpus/text-file-reader.js';
import type { SourceUnit } from '../src/shared/corpus.js';

const root = mkdtempSync(join(tmpdir(), 'corpus-intake-'));
const store = new CorpusStore(join(root, 'corpus'));
const importer = new CorpusService(store);
let allowed = true;
let intake = new CorpusIntakeService(store, () => allowed);
const code = (expected: string) => (e: unknown) => (e as { code?: string }).code === expected;
async function upload(name: string, bytes: Buffer) {
  let job = intake.create({ name, bytes: bytes.length, mime: '', labels: [] });
  for (let offset = 0; offset < bytes.length; offset += INTAKE_LIMITS.partBytes) {
    const part = bytes.subarray(offset, offset + INTAKE_LIMITS.partBytes);
    job = await intake.append(job.id, offset, part, hash(part));
  }
  return intake.finish(job.id);
}
try {
  const bytes = Buffer.from('# 규칙\n원본은 바꾸지 않습니다.\n# 예외\n사람이 최종 발송합니다.');
  const initial = intake.create({ name: 'resume.md', bytes: bytes.length, mime: '', labels: [] });
  const first = bytes.subarray(0, 10);
  await intake.append(initial.id, 0, first, hash(first));
  assert.equal((await intake.append(initial.id, 0, first, hash(first))).uploadedBytes, 10);
  await assert.rejects(intake.append(initial.id, 0, Buffer.from('other'), hash('other')), code('intake_part_conflict'));
  await assert.rejects(intake.finish(initial.id), code('intake_upload_incomplete'));
  // Emulate a crash after a tail write but before its receipt was committed.
  writeFileSync(join(intake.directory(initial.id), 'original.bin'), Buffer.concat([first, Buffer.from('unacknowledged')]));
  intake = new CorpusIntakeService(store, () => allowed);
  const rest = bytes.subarray(10); await intake.append(initial.id, 10, rest, hash(rest));
  const sealed = await intake.finish(initial.id); assert.equal(sealed.contentHash, hash(bytes));
  assert.deepEqual(readFileSync(join(intake.directory(initial.id), 'original.bin')), bytes);
  assert.equal(store.list().length, 0);
  intake.start(initial.id, 1);
  const paused = await intake.wait(initial.id);
  assert.equal(paused.state, 'paused', JSON.stringify(paused)); assert.equal(paused.cursor, 1); assert.equal(store.list().length, 0);
  const unitBytes = readFileSync(join(intake.directory(initial.id), 'units', '000001.json'));
  intake = new CorpusIntakeService(store, () => allowed);
  intake.start(initial.id, 1); const completed = await intake.wait(initial.id);
  assert.equal(completed.state, 'complete', JSON.stringify(completed)); assert.equal(completed.cursor, 2);
  assert.deepEqual(readFileSync(join(intake.directory(initial.id), 'units', '000001.json')), unitBytes);
  assert.equal(store.snapshot(completed.source!.sourceId)?.units?.length, 2);
  console.log('PASS partial upload/retry/conflict, crash tail recovery, original readback, process restart/checkpoint, publish only after completion');

  const zip = new AdmZip();
  zip.addFile('ppt/presentation.xml', Buffer.from('<p:presentation/>'));
  zip.addFile('ppt/media/unread-image.bin', randomBytes(21 * 1024 * 1024));
  for (let n = 1; n <= 2; n++) zip.addFile(`ppt/slides/slide${n}.xml`, Buffer.from(`<p:sld><a:t>슬라이드 ${n} 사람의 승인 조건 유지</a:t></p:sld>`));
  const largeBytes = zip.toBuffer(); assert.ok(largeBytes.length > 20 * 1024 * 1024);
  const large = await upload('large-deck.pptx', largeBytes);
  intake.start(large.id, 1); assert.equal((await intake.wait(large.id)).state, 'paused');
  intake.start(large.id, 1); const largeDone = await intake.wait(large.id);
  assert.equal(largeDone.state, 'complete', JSON.stringify(largeDone));
  const largeSource = store.snapshot(largeDone.source!.sourceId)!;
  assert.equal(largeSource.contentHash, hash(largeBytes)); assert.equal(largeSource.units!.length, 2);
  assert.ok(store.verifyOriginal(largeSource));
  assert.ok(largeSource.profile.warnings.some(w => w.includes('이미지')));
  console.log('PASS real >20 MiB PPTX: isolated parser, slide checkpoint/resume, original hash, image-layout warning');

  const automatic = await upload('automatic.md', Buffer.from('# 첫째\n본문\n# 둘째\n조건\n# 셋째\n예외'));
  intake.start(automatic.id, 1, true);
  assert.equal((await intake.wait(automatic.id)).state, 'complete');
  const stoppable = await upload('pause.md', Buffer.from('# 첫째\n본문\n# 둘째\n예외'));
  intake.start(stoppable.id, 1, true); intake.pause(stoppable.id);
  assert.equal((await intake.wait(stoppable.id)).reason, 'intake_user_paused');
  intake.start(stoppable.id, 1, true);
  assert.equal((await intake.wait(stoppable.id)).state, 'complete');
  console.log('PASS automatic checkpoint continuation, user pause and resume');

  const quotedPath = join(root, 'quoted.csv');
  writeFileSync(quotedPath, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('항목,조건\r\n001,"첫 줄\n둘째 줄, 예외 ""보류"""\r\n002,승인', 'utf16le')]));
  const streamed: SourceUnit[] = [];
  const firstRun = await extractTextFile(quotedPath, 'quoted.csv', '', 0, 2, unit => streamed.push(unit));
  assert.deepEqual(firstRun.progress, { cursor: 2, complete: false });
  const secondRun = await extractTextFile(quotedPath, 'quoted.csv', '', 2, 2, unit => streamed.push(unit));
  assert.deepEqual(secondRun.progress, { cursor: 3, complete: true });
  assert.equal(streamed[1].cells?.[0], '001'); assert.equal(streamed[1].cells?.[1], '첫 줄\n둘째 줄, 예외 "보류"');
  assert.ok(streamed[2].text.includes('열: 항목 | 조건'));
  writeFileSync(quotedPath, '항목,조건\n001,"닫히지 않음');
  await assert.rejects(extractTextFile(quotedPath, 'quoted.csv', '', 0, 250, () => {}), code('unclosed_csv_quote'));
  const largeCsvBytes = Buffer.from('ID,조건\n' + Array.from({ length: 200 }, (_, i) => `${i},${'가'.repeat(35_000)} 담당자 승인`).join('\n'));
  assert.ok(largeCsvBytes.length > 20 * 1024 * 1024);
  const largeCsv = await upload('large.csv', largeCsvBytes);
  intake.start(largeCsv.id, 250, true); const csvDone = await intake.wait(largeCsv.id);
  assert.equal(csvDone.state, 'complete', JSON.stringify(csvDone));
  const csvSource = store.snapshot(csvDone.source!.sourceId)!;
  assert.equal(csvSource.units!.length, 201); assert.equal(csvSource.units![200].cells?.[0], '199');
  assert.equal(csvSource.contentHash, hash(largeCsvBytes)); assert.ok(store.verifyOriginal(csvSource));
  console.log('PASS streamed UTF-16 CSV, quoted multiline cells, restart headers, malformed input; real >20 MiB CSV with 201 complete rows');

  const conflict = await upload('resume.md', Buffer.from('# 새 규칙\n오래 걸리는 변경입니다.'));
  const newest = await importer.import({ provider: 'local', externalId: 'resume.md', name: 'resume.md', mime: '', bytes: Buffer.from('# 더 최신\n이 판을 유지합니다.') });
  intake.start(conflict.id); const refused = await intake.wait(conflict.id);
  assert.equal(refused.reason, 'intake_base_changed'); assert.equal(store.snapshot(newest.sourceId)?.revision, newest.revision);
  const corrupt = await upload('tamper.md', Buffer.from('original'));
  writeFileSync(join(intake.directory(corrupt.id), 'original.bin'), 'changed');
  intake.start(corrupt.id); assert.equal((await intake.wait(corrupt.id)).reason, 'intake_original_changed');
  const revoked = await upload('revoked.md', Buffer.from('never publish after revocation'));
  intake.start(revoked.id); allowed = false;
  await assert.rejects(intake.wait(revoked.id), code('connection_inactive')); allowed = true;
  assert.equal(intake.read(revoked.id).reason, 'connection_inactive');
  assert.ok(store.list().every(source => source.name !== 'revoked.md'));
  console.log('PASS concurrent newer source survives, changed original rejected, revoked job cannot publish');
} finally { rmSync(root, { recursive: true, force: true }); }
