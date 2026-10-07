import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';

if (!process.argv.includes('--confirm-real-call')) throw new Error('Explicit real-call opt-in required');
const evidence = resolve('verification/windows-schema-live');
mkdirSync(evidence, { recursive: true });
const replay = process.argv.includes('--replay-captured-response');
const root = replay ? z.object({ root: z.string() }).parse(JSON.parse(readFileSync(join(evidence, 'run.json'), 'utf8'))).root : mkdtempSync(join(evidence, 'runtime 한글 '));
process.env.INGESTIGER_MODEL = 'claude-sonnet-5';
process.env.MYCREW_HOME = root;
process.env.WORKSPACE_ROOT = root;
process.env.CLAUDE_PATH = 'C:/Users/user/.local/bin/claude.exe';
process.env.INGESTIGER_PYTHON = 'C:/Users/user/AppData/Local/Python/pythoncore-3.14-64/python.exe';
process.env.MYCREW_AI_GW_WARM_POOL = '0';
mkdirSync(join(root, 'history'), { recursive: true });
writeFileSync(join(root, 'history/agents.json'), '{"agents":[]}');
const { CorpusStore } = await import('../src/server/corpus/store.js');
const { CorpusService } = await import('../src/server/corpus/service.js');
const { WikiService } = await import('../src/server/wiki/service.js');
const { WikiExecution, WIKI_MODEL } = await import('../src/server/wiki/execution.js');
const { buildBaseArgs } = await import('../src/server/ai-gateway.js');
const { safeChildEnvForCli } = await import('../src/server/utils/safeChildEnv.js');
const corpus = new CorpusStore(join(root, 'history/corpus'));
const importer = new CorpusService(corpus);
const wiki = new WikiService(join(root, 'history/wiki'), corpus, () => true);
const scope = { orgId: 'synthetic', projectId: 'windows-collaboration' };
const text = '2026-10-01부터 시스템은 주문 초안만 작성한다. 최종 주문은 사람이 실행한다. 자동 주문은 금지한다. 담당 부서는 아직 정하지 않았다.';
const source = await importer.import({ provider: 'local', externalId: '합성 규정.md', name: '합성 규정.md', mime: 'text/markdown', bytes: Buffer.from(text) });
const units = corpus.snapshot(source.sourceId)?.units;
assert.ok(units?.length);
const job = await wiki.prepare({ scope, sourceId: source.sourceId, expectedRevision: source.revision, unitIds: units.map(unit => unit.id), model: WIKI_MODEL });
const manifest = { root, scope, sourceId: source.sourceId, jobId: job.id, requestedModel: WIKI_MODEL, realModel: true };
writeFileSync(join(evidence, 'run.json'), JSON.stringify(manifest, null, 2));
const envelope = z.object({ result: z.string().default(''), structured_output: z.unknown().optional(), is_error: z.boolean().optional(), session_id: z.string(), total_cost_usd: z.number(), duration_ms: z.number(), modelUsage: z.record(z.string(), z.unknown()), usage: z.object({ input_tokens: z.number(), output_tokens: z.number(), cache_read_input_tokens: z.number().optional(), cache_creation_input_tokens: z.number().optional() }) });
const execution = new WikiExecution(wiki, async options => {
  const raw = replay ? readFileSync(join(evidence, 'cli-output.jsonl'), 'utf8') : await new Promise<string>((done, fail) => {
    const child = spawn(process.env.CLAUDE_PATH ?? '', ['-p', '--output-format', 'stream-json', '--verbose', ...buildBaseArgs(options)], { env: safeChildEnvForCli(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, cwd: root });
    let output = ''; let stderr = '';
    const timer = setTimeout(() => { child.kill(); fail(new Error('real analysis timeout')); }, 120000);
    child.stdout.on('data', data => { output += data.toString(); });
    child.stderr.on('data', data => { stderr += data.toString(); });
    child.on('error', fail);
    child.on('close', code => { clearTimeout(timer); writeFileSync(join(evidence, 'cli-output.jsonl'), output); writeFileSync(join(evidence, 'cli-stderr.log'), stderr); code === 0 ? done(output) : fail(new Error(`real CLI exit ${code}`)); });
    child.stdin.end(options.prompt + String.fromCharCode(10) + '출력 요구: 위 units의 한국어 원문만 분석하세요. request_id/results JSON 객체 외에 코드블록이나 설명을 출력하지 마세요. title/statement/details는 한국어로 쓰세요. 담당 부서 미정은 unknown으로 분류하고 결정기한·승인절차·준비완료 여부를 추론하지 마세요. 2026-10-01 적용일, 시스템은 주문 초안만 작성, 사람이 최종 주문 실행, 자동 주문 금지를 각각 적용되는 후보에 보존하세요. 모호하지 않은 원문은 analyzed이며 담당 부서 미정은 unknown 후보입니다.');
  });
  const events = raw.trim().split(String.fromCharCode(10)).map(line => z.object({ type: z.string(), message: z.object({ model: z.string().optional() }).passthrough().optional() }).passthrough().parse(JSON.parse(line)));
  const response = envelope.parse(events.find(event => event.type === 'result'));
  const actualModels = [...new Set(events.filter(event => event.type === 'assistant').map(event => event.message?.model).filter(Boolean))];
  assert.equal(actualModels.length, 1);
  writeFileSync(join(evidence, 'ingestiger-observed-models.json'), JSON.stringify(actualModels));
  writeFileSync(join(evidence, 'ingestiger-response.json'), JSON.stringify(response, null, 2));
  assert.notEqual(response.is_error, true);
  const model = z.string().parse(actualModels[0]);
  const { gatewayResponseText } = await import('../src/server/ai-gateway-response.js');
  return { text: gatewayResponseText(response, Boolean(options.jsonSchema)), model, costUsd: response.total_cost_usd, durationMs: response.duration_ms, usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } };
});
try {
  const analyzed = await execution.analyze(job.id, { scope, requestId: job.payload.requests[0].request_id });
  writeFileSync(join(evidence, 'analysis.json'), JSON.stringify(analyzed, null, 2));
  console.log(JSON.stringify({ ...manifest, candidates: analyzed.job.candidates.length, actual: JSON.parse(readFileSync(join(evidence, 'ingestiger-response.json'), 'utf8')).modelUsage }));
} catch (error) {
  writeFileSync(join(evidence, 'analysis-error.json'), JSON.stringify({ error: error instanceof Error ? error.message : String(error), cause: error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined }));
  throw error;
}
process.exit(0);
