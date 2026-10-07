import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = mkdtempSync(join(tmpdir(), 'wiki-job-identity-'));
process.env.MYCREW_HOME = root;
process.env.WORKSPACE_ROOT = root;
mkdirSync(join(root, 'history'), { recursive: true });
writeFileSync(join(root, 'history/agents.json'), JSON.stringify({ agents: [{ id: 'identity-probe', name: 'Identity probe', adapter: 'identity-observer', allowedTools: [], maxTurns: 1, bashTagSupport: false, routeKeywords: [], systemPrompt: 'Synthetic boundary test', readPaths: [], writePaths: [] }] }));
const { registerAdapter } = await import('../src/adapters/index.js');
const { createJob } = await import('../src/server/jobs.js');
const observed = Promise.withResolvers<string>();
registerAdapter({ id: 'identity-observer', supportedModels: [], async execute(config, taskId) {
  observed.resolve(taskId);
  return { agentRole: config.role, taskId, success: true, output: 'Synthetic boundary test completed; no model called.' };
} });
const job = createJob('Text-only synthetic boundary probe; no files needed.', undefined, undefined, 'identity-probe');
const timer = setTimeout(() => observed.reject(new Error('Adapter was not called')), 15000);
try {
  const actual = await observed.promise;
  assert.equal(actual, job.id, 'Worker adapter must receive actual job UUID for Wiki capability and usage attribution');
  console.log(JSON.stringify({ passed: true, jobId: job.id, adapterTaskId: actual, realModel: false }));
} finally { clearTimeout(timer); }
process.exit(0);
