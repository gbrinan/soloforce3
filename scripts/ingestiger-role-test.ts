import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { relocateRoleLinks, syncRoleDirective } from '../src/role-directive.js';
import { loadWorkerIdentity } from '../src/server/worker-identity.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(join(tmpdir(), 'ingestiger role '));
// Set before importing the real registry: no existing user history is read or written.
process.env.MYCREW_HOME = temporary;
process.env.WORKSPACE_ROOT = temporary;
mkdirSync(join(temporary, 'history'), { recursive: true });
writeFileSync(join(temporary, 'history/agents.json'), '{"agents":[]}\n');
let groups = 0;
try {
  const { getWorkerAgent, ensureAgentDirs } = await import('../src/agent-registry.js');
  const agent = getWorkerAgent('ingestiger');
  assert.ok(agent, 'real registry must discover config/agents/ingestiger');
  assert.equal(agent.role, '기업·프로젝트 LLM Wiki 관리자');
  assert.equal(agent.adapter, 'claude-code');
  groups++;

  const seed = join(root, 'config/agents/ingestiger/role-directive.md');
  const target = join(temporary, 'history/agents/ingestiger/wiki/role-directive.md');
  const expected = relocateRoleLinks(readFileSync(seed, 'utf8').replaceAll('{{NAME}}', agent.name).replaceAll('{{GENIE}}', '마이크루'), seed);
  assert.equal(readFileSync(target, 'utf8'), expected);
  const links = [...expected.matchAll(/\]\(<([^>]+)>\)/g)];
  assert.equal(links.length, 4);
  for (const link of links) assert.ok(existsSync(link[1].split('#')[0]), link[1]);
  assert.ok(loadWorkerIdentity(agent.id, join(temporary, 'history')).includes(`[역할 지시서]\n${expected}\n[역할 지시서 끝]`));
  groups++;

  // Same seed is idempotent, and a newer user-edited role is preserved.
  ensureAgentDirs(agent, [agent]);
  assert.ok(!existsSync(`${target}.bak`));
  writeFileSync(target, 'Local custom role\n');
  const later = Date.now() / 1000 + 5;
  utimesSync(target, later, later);
  ensureAgentDirs(agent, [agent]);
  assert.equal(readFileSync(target, 'utf8'), 'Local custom role\n');
  groups++;

  // A stale runtime must fail verification without being overwritten by the checker.
  const runCheck = (report?: string) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/ingestiger-check.ts', '--runtime', ...(report ? ['--report', report] : [])], { cwd: root, env: process.env, encoding: 'utf8' });
  assert.equal(runCheck().status, 1);
  assert.equal(readFileSync(target, 'utf8'), 'Local custom role\n');
  // Restore only our synthetic test role, never a real user's history.
  writeFileSync(target, expected);
  const reportIndex = process.argv.indexOf('--report');
  const clean = runCheck(reportIndex >= 0 ? process.argv[reportIndex + 1] : undefined);
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  groups++;

  // Seed update uses the same function as the registry, preserving the previous body.
  const fixtureSeed = join(temporary, 'seed.md');
  const fixtureTarget = join(temporary, 'runtime.md');
  writeFileSync(fixtureSeed, '[skill](./skill with spaces.md)\n');
  writeFileSync(join(temporary, 'skill with spaces.md'), 'skill\n');
  assert.equal(syncRoleDirective(fixtureSeed, fixtureTarget, s => s), 'created');
  const before = readFileSync(fixtureTarget, 'utf8');
  writeFileSync(fixtureSeed, '[skill](./skill with spaces.md)\nNew role\n');
  utimesSync(fixtureSeed, later + 10, later + 10);
  assert.equal(syncRoleDirective(fixtureSeed, fixtureTarget, s => s), 'updated');
  assert.equal(readFileSync(`${fixtureTarget}.bak`, 'utf8'), before);
  assert.ok(readFileSync(fixtureTarget, 'utf8').includes('New role'));
  const nonFileLinks = '[anchor](#scope) [web](https://example.com/spec) [mail](mailto:example@example.com)';
  assert.equal(relocateRoleLinks(nonFileLinks, fixtureSeed), nonFileLinks);
  groups++;
  console.log(JSON.stringify({ passed: true, groups, actualRegistry: true, actualIdentityLoader: true, isolatedHistory: true, modelExecution: false, windowsExecution: process.platform === 'win32' }));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
