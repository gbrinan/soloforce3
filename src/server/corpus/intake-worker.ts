/** Isolated parser process. Only the parent supplies this workspace path. No network or model calls. */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import type { CorpusIntake } from '../../shared/corpus-intake.js';
import { INTAKE_LIMITS } from '../../shared/corpus-intake.js';
import type { SourceUnit } from '../../shared/corpus.js';
import { extract, hash, PIPELINE_VERSION, CorpusError } from './extract.js';
import { atomicJson, fileHashSync } from './files.js';
import { extractTextFile } from './text-file-reader.js';

const directory = process.argv[2];
const unitLimit = Number(process.argv[3]);
// Parser diagnostics must not interleave source content with the JSON protocol.
console.log = () => {}; console.warn = () => {}; console.info = () => {};
async function run(): Promise<void> {
  const job = JSON.parse(readFileSync(join(directory, 'intake.json'), 'utf8')) as CorpusIntake;
  if (job.parserVersion !== PIPELINE_VERSION) throw new CorpusError('parser_version_changed', 409);
  const original = join(directory, 'original.bin');
  if (fileHashSync(original) !== job.contentHash) throw new CorpusError('intake_original_changed', 409);
  const unitsDir = join(directory, 'units'); mkdirSync(unitsDir, { recursive: true, mode: 0o700 });
  const checkpointPath = join(directory, 'checkpoint.json');
  const checkpoint = existsSync(checkpointPath) ? JSON.parse(readFileSync(checkpointPath, 'utf8')) as { cursor: number; characters: number } : { cursor: 0, characters: 0 };
  const onUnit = (unit: SourceUnit, ordinal: number) => {
    if (ordinal !== checkpoint.cursor + 1) throw new CorpusError('intake_checkpoint_invalid', 409);
    if (ordinal > INTAKE_LIMITS.units || checkpoint.characters + unit.text.length > INTAKE_LIMITS.extractedCharacters) throw new CorpusError('intake_extraction_budget', 413);
    const data = JSON.stringify({ unit, sha256: hash(JSON.stringify(unit)) });
    const path = join(unitsDir, `${String(ordinal).padStart(6, '0')}.json`);
    if (existsSync(path)) { if (readFileSync(path, 'utf8') !== data) throw new CorpusError('intake_unit_changed', 409); }
    else { const temporary = `${path}.pending`; writeFileSync(temporary, data, { mode: 0o600 }); renameSync(temporary, path); }
    checkpoint.cursor = ordinal; checkpoint.characters += unit.text.length;
    atomicJson(checkpointPath, checkpoint);
  };
  const signature = Buffer.alloc(16); const fd = openSync(original, 'r');
  try { readSync(fd, signature, 0, 16, 0); } finally { closeSync(fd); }
  const streamText = statSync(original).size > 20 * 1024 * 1024 && ['.csv', '.tsv', '.txt', '.md'].includes(extname(job.name).toLowerCase()) && !signature.subarray(0, 2).equals(Buffer.from('PK')) && !signature.subarray(0, 5).equals(Buffer.from('%PDF-'));
  const parsed = streamText ? await extractTextFile(original, job.name, job.mime, checkpoint.cursor, unitLimit, onUnit) : await extract(job.name, job.mime, readFileSync(original), job.labels, {
    maxSourceBytes: INTAKE_LIMITS.originalBytes, maxExpandedBytes: INTAKE_LIMITS.expandedBytes,
    maxPdfPages: 5000, startUnit: checkpoint.cursor, unitLimit, onUnit,
  });
  if (job.labels.length && checkpoint.cursor && !parsed.profile.routes.some(route => route.route === 'graph')) parsed.profile.routes.push({ route: 'graph', status: 'ready', detail: '사용자가 지정한 업무 분류' });
  if (fileHashSync(original) !== job.contentHash) throw new CorpusError('intake_original_changed', 409);
  atomicJson(join(directory, 'result.json'), { profile: parsed.profile, cursor: checkpoint.cursor, complete: parsed.progress.complete });
  process.stdout.write(JSON.stringify({ ok: true }) + '\n');
}
run().catch(error => {
  // No source excerpts, filesystem paths or secrets in error responses.
  process.stdout.write(JSON.stringify({ ok: false, error: error instanceof CorpusError ? error.code : 'intake_parse_failed' }) + '\n');
  process.exitCode = 2;
});
