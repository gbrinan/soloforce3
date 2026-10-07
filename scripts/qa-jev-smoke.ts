import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

// Isolated job lifecycle with a synthetic provider and workers. No paid model calls.
const root = mkdtempSync(join(tmpdir(), 'qa-jev-smoke-'));
process.env.MYCREW_HOME = root;
process.env.WORKSPACE_ROOT = root;
process.env.QA_JEV_ENABLED = 'true';
process.env.TYPESAFE_API_KEY = 'synthetic-key';
process.env.AUTO_QA_TRIGGER = 'true';
process.env.GEMINI_API_KEY = '';
mkdirSync(join(root, 'history'), { recursive: true });
writeFileSync(join(root, 'history/agents.json'), JSON.stringify({ agents: ['jev-probe', 'qa'].map(id => ({
  id, name: id, adapter: 'jev-observer', allowedTools: [], maxTurns: 1,
  bashTagSupport: false, routeKeywords: [], systemPrompt: 'Synthetic QA probe', readPaths: [], writePaths: [],
})) }));
let providerCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = input instanceof Request ? input.url : String(input);
  assert.equal(url, 'https://api.typesafe.ai/v1/systemone', 'No unrelated network allowed');
  providerCalls++;
  return Response.json({ model: 'jev-smoke', answers: { review_profile: {
    type: 'choice', choice: 'document', confidence: 0.95,
    probabilities: { code: 0, document: 1, data: 0, general: 0 },
  } }, usage: { input_tokens: 100, output_tokens: 10 } });
};
const { registerAdapter } = await import('../src/adapters/index.js');
const { createJob } = await import('../src/server/jobs.js');
const observed = Promise.withResolvers<string>();
const release = Promise.withResolvers<void>();
registerAdapter({ id: 'jev-observer', supportedModels: [], async execute(config, taskId) {
  if (config.role === 'qa') observed.resolve(taskId);
  else await release.promise;
  return { agentRole: config.role, taskId, success: true, output: '요청한 문서 요약을 완료했습니다.' };
} });
const job = createJob('문서 요약을 말로 설명해줘. 파일 생성 없이 답변만 작성.', undefined, undefined, 'jev-probe', process.cwd());
job.forceQa = true;
release.resolve();
const timer = setTimeout(() => observed.reject(new Error('QA worker not dispatched')), 15000);
try {
  const qaJobId = await observed.promise;
  const schema = z.object({ event: z.string(), jobId: z.string().optional(), profile: z.string().optional(), reason: z.string().optional() });
  const events = readFileSync(join(root, 'history/audit.jsonl'), 'utf8').trim().split('\n').map(line => schema.parse(JSON.parse(line)));
  const selected = events.find(event => event.event === 'qa.profile_selected' && event.jobId === job.id);
  assert.equal(selected?.profile, 'document');
  assert.equal(selected?.reason, 'jev-selected');
  assert.equal(providerCalls, 1);
  assert.notEqual(qaJobId, job.id);
  console.log(JSON.stringify({ passed: true, profile: selected.profile, providerCalls, qaDispatched: true, realModel: false, evidenceRoot: root }));
} finally { clearTimeout(timer); globalThis.fetch = originalFetch; }
process.exit(0);
