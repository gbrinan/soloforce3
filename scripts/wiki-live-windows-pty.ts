import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { serve } from '@hono/node-server';
import { WebSocket } from 'ws';
import { z } from 'zod';
if (!process.argv.includes('--confirm-real-call')) throw new Error('Explicit real-call opt-in required');
const evidence = resolve('verification/windows-schema-live');
const { root, scope } = z.object({ root: z.string(), scope: z.object({ orgId: z.string(), projectId: z.string() }) }).parse(JSON.parse(readFileSync(join(evidence, 'run.json'), 'utf8')));
Object.assign(process.env, { MYCREW_HOME: root, WORKSPACE_ROOT: root, PORT: '3489', AUTO_QA_TRIGGER: 'false', CLAUDE_PATH: 'C:/Users/user/.local/bin/claude.exe', INGESTIGER_PYTHON: 'C:/Users/user/AppData/Local/Python/pythoncore-3.14-64/python.exe', INGESTIGER_MODEL: 'claude-sonnet-5', MYCREW_AI_GW_WARM_POOL: '0' });
const file = join(root, 'history/agents.json');
const saved = z.object({ agents: z.array(z.record(z.string(), z.unknown())) }).parse(JSON.parse(readFileSync(file, 'utf8')));
const agent = { id: 'windows-pty-probe', name: '합성 PTY 직원', adapter: 'claude-code', model: 'claude-sonnet-5', allowedTools: [], maxTurns: 10, bashTagSupport: false, routeKeywords: [], readPaths: ['/**'], writePaths: ['/history/outputs/windows-pty-probe/**'], systemPrompt: '합성 Wiki PTY 검사 직원. 요청된 Wiki 조회와 자신의 인용 문서 저장·사용 기록만 수행한다. 완료는 submit_response로 보고한다.', mcpServers: [] };
writeFileSync(file, JSON.stringify({ agents: [...saved.agents.filter(a => a.id !== agent.id), agent] }));
const { createServerApp } = await import('../src/server/create-server-app.js');
const { runInteractiveWorker, resetWorker, attachWorkerTerminalWS, handleWorkerTerminalUpgrade } = await import('../src/server/worker-pty.js');
const { toAgentConfig } = await import('../src/agent-registry.js');
const app = createServerApp();
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 3489 });
attachWorkerTerminalWS();
server.on('upgrade', handleWorkerTerminalUpgrade);
await new Promise<void>(done => server.listening ? done() : server.once('listening', done));
const ws = new WebSocket('ws://127.0.0.1:3489/ws/worker/windows-pty-probe');
let terminal = '';
ws.on('message', bytes => { terminal += bytes.toString(); writeFileSync(join(evidence, 'pty-terminal.log'), terminal); });
const rounds = [];
try {
  for (let round = 1; round <= 2; round++) {
    const taskId = randomUUID();
    const timer = setTimeout(() => resetWorker(agent.id), 150000);
    const result = await runInteractiveWorker(toAgentConfig(agent), taskId, `검증 작업 ${taskId}. scope=${JSON.stringify(scope)}. WikiSearch query="PTY 재시작 확인"으로 mandatory를 확인하고 그중 1개를 WikiRead로 조회하세요. 읽은 statement와 citation을 그대로 ${join(root, 'history/outputs/windows-pty-probe', `한글 인용 ${round}_windows-pty-probe.md`)} 에 SafeWrite로 저장하고, 실제 반환된 저장 경로로 WikiRecordUsage(refs=[읽은 id/판])를 호출하세요. 그 후 submit_response에 작업 UUID, 조회 id/판, usage 성공 여부를 담아 완료 보고하세요. 다른 도구/파일은 필요 없습니다.`);
    clearTimeout(timer);
    rounds.push({ round, taskId, result });
    writeFileSync(join(evidence, 'pty-results.json'), JSON.stringify(rounds, null, 2));
    resetWorker(agent.id);
    if (!result.success) break;
  }
} finally { resetWorker(agent.id); ws.close(); server.close(); }
const sessionDir = join(homedir(), '.claude/projects', process.cwd().replace(/[^a-zA-Z0-9-]/g, '-'));
const observed = [];
if (existsSync(sessionDir)) for (const name of readdirSync(sessionDir).filter(n => n.endsWith('.jsonl'))) {
  const text = readFileSync(join(sessionDir, name), 'utf8');
  const matching = rounds.find(r => text.includes(r.taskId));
  if (!matching) continue;
  const events = text.trim().split('\n').map(line => JSON.parse(line));
  const messages = events.filter(e => ['assistant', 'user'].includes(e.type)).map(e => ({ type: e.type, model: e.message?.model, content: e.message?.content, usage: e.message?.usage }));
  observed.push({ round: matching.round, taskId: matching.taskId, sessionId: name.slice(0, -6), actualModels: [...new Set(messages.map(e => e.model).filter(Boolean))], messages });
}
writeFileSync(join(evidence, 'pty-observed.json'), JSON.stringify(observed, null, 2));
console.log(JSON.stringify({ rounds, observed: observed.map(({ messages, ...entry }) => entry) }));
process.exit(rounds.length === 2 && rounds.every(r => r.result.success) ? 0 : 1);
