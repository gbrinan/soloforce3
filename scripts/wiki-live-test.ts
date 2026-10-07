/** Explicit opt-in: one real Claude request, synthetic source, isolated history. */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
if (!process.argv.includes('--confirm-real-call')) throw new Error('Pass --confirm-real-call to consume Claude account usage');
const output = process.argv[process.argv.indexOf('--output') + 1];
if (!process.argv.includes('--output') || !output) throw new Error('--output <report.json> required');
const root = mkdtempSync(join(tmpdir(), 'ingestiger-live-'));
process.env.MYCREW_HOME = root; process.env.WORKSPACE_ROOT = root;
mkdirSync(join(root, 'history'), { recursive: true });
writeFileSync(join(root, 'history/agents.json'), '{"agents":[]}');
const { CorpusStore } = await import('../src/server/corpus/store.js');
const { CorpusService } = await import('../src/server/corpus/service.js');
const { WikiService } = await import('../src/server/wiki/service.js');
const { WikiExecution, WIKI_MODEL } = await import('../src/server/wiki/execution.js');
const corpus = new CorpusStore(join(root, 'history/corpus'));
const importer = new CorpusService(corpus);
const wiki = new WikiService(join(root, 'history/wiki'), corpus, () => true);
try {
  const source = await importer.import({ provider: 'local', externalId: 'synthetic-order.md', name: 'synthetic-order.md', mime: 'text/markdown',
    bytes: Buffer.from('# 합성 검증용 주문 규칙\n\n초안 금액은 001200원이다. 시스템은 초안만 작성한다. 최종 주문은 사람이 실행하며 자동 주문은 금지한다. 적용 시작일은 2026-10-01이다. 담당 부서는 아직 정하지 않았다.') });
  const snapshot = corpus.snapshot(source.sourceId)!;
  const job = await wiki.prepare({ scope: { orgId: 'synthetic', projectId: 'real-call' }, sourceId: source.sourceId, expectedRevision: source.revision, unitIds: snapshot.units!.map(unit => unit.id), model: WIKI_MODEL });
  const result = await new WikiExecution(wiki).analyze(job.id, { scope: job.payload.scope, requestId: job.payload.requests[0].request_id });
  const report = { passed: true, realModel: true, model: WIKI_MODEL, platform: process.platform, root, job: result.job };
  writeFileSync(resolve(output), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ passed: true, model: WIKI_MODEL, candidates: result.job.candidates.length, root, report: resolve(output) }));
  process.exit(0);
} catch (error) {
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : '';
  const category = /timeout/i.test(cause) ? 'timeout' : /auth|login|401/i.test(cause) ? 'authentication' : /rate|429|limit/i.test(cause) ? 'rate_limit' : /503|529|overload/i.test(cause) ? 'upstream_unavailable' : 'other';
  const report = { passed: false, realModel: true, model: WIKI_MODEL, platform: process.platform, root, category, error: error instanceof Error ? error.message : String(error) };
  writeFileSync(resolve(output), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.error(JSON.stringify(report)); process.exit(1);
}
