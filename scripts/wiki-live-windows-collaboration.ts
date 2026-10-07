import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { serve } from '@hono/node-server';
import { z } from 'zod';

if (!process.argv.includes('--confirm-real-call')) throw new Error('Explicit real-call opt-in required');
const evidence = resolve('verification/windows-schema-live');
const manifest = z.object({ root: z.string(), scope: z.object({ orgId: z.string(), projectId: z.string() }), jobId: z.string() }).parse(JSON.parse(readFileSync(join(evidence, 'run.json'), 'utf8')));
const { root, scope } = manifest;
process.env.MYCREW_HOME = root;
process.env.WORKSPACE_ROOT = root;
process.env.PORT = '3488';
process.env.AUTO_QA_TRIGGER = 'false';
process.env.CLAUDE_PATH = 'C:/Users/user/.local/bin/claude.exe';
process.env.INGESTIGER_PYTHON = 'C:/Users/user/AppData/Local/Python/pythoncore-3.14-64/python.exe';
process.env.INGESTIGER_MODEL = 'claude-sonnet-5';
process.env.MYCREW_AI_GW_WARM_POOL = '0';
const project = join(root, 'mycrew-works/windows-collaboration');
const data = join(project, '거래 자료');
mkdirSync(data, { recursive: true });
writeFileSync(join(data, '거래처 마스터.csv'), 'vendor_code,vendor_name\nV001,가상상사\nV002,예시물산\n');
writeFileSync(join(data, '거래 내역.csv'), 'vendor_code,amount_krw\nV001,1200\nV001,800\nV002,3000\n');
const common = { adapter: 'claude-code', maxTurns: 20, bashTagSupport: false, routeKeywords: [], planGate: false, readPaths: ['/**'], writePaths: [], allowedTools: [], permissionLevel: 'default', mcpServers: [] };
const agents = [
  { ...common, id: 'windows-analyst', name: '합성 전문 분석 직원', model: 'claude-opus-5[1m]', allowedTools: ['DelegateTask'], writePaths: ['/history/outputs/windows-analyst/**'], systemPrompt: '합성 프로젝트의 전문 분석 직원. 실제 WikiSearch/WikiRead/WikiHandoff를 사용한다. 자료의 제약/미결정을 유지하고 인계 ACK를 완료로 주장하지 않는다. 다른 자료나 설정은 변경하지 않는다.' },
  { ...common, id: 'corpus-keeper', name: 'Corpus Keeper', model: 'claude-sonnet-5', allowedTools: ['Bash'], bashCommands: ['node'], bashPaths: ['/**'], writePaths: ['/history/outputs/corpus-keeper/**', '/mycrew-works/windows-collaboration/**'], systemPrompt: '합성 CSV 조인·집계 직원. WikiRead로 모든 참조를 재조회하고 SafeRead로 실제 CSV를 읽는다. SafeWrite로 프로젝트에 Node 계산 스크립트를 작성하고 SafeBash로 node를 실행해 vendor_code 기준 조인·집계를 계산한다. 최종 Markdown은 자기 history/outputs/corpus-keeper 아래 저장한다. WikiRead의 citation을 관련 문구 바로 옆에 그대로 넣고 모든 refs에 대해 WikiRecordUsage를 호출한다. 완료 시 파일 경로/집계/usage 결과를 보고한다. 다른 자료/설정은 변경하지 않는다.' },
];
writeFileSync(join(root, 'history/agents.json'), JSON.stringify({ agents }, null, 2));
writeFileSync(join(evidence, 'employees.json'), JSON.stringify({ agents }, null, 2));
const { CorpusStore } = await import('../src/server/corpus/store.js');
const { WikiService } = await import('../src/server/wiki/service.js');
const { WikiKnowledgeStore } = await import('../src/server/wiki/knowledge.js');
const wiki = new WikiService(join(root, 'history/wiki'), new CorpusStore(join(root, 'history/corpus')), () => true);
const knowledge = new WikiKnowledgeStore(wiki);
const job = wiki.read(scope, manifest.jobId);
assert.equal(job.candidates.length, 1);
const candidate = job.candidates[0];
const result = candidate.response.results[0];
assert.equal(result.needs.length, 4);
assert.equal(result.needs[3].kind, 'unknown');
const reviewedFile = join(evidence, 'reviewed-knowledge.json');
if (!existsSync(reviewedFile)) {
  const reviewed = [];
  for (let index = 0; index < result.needs.length; index++) {
    const review = knowledge.review({ scope, jobId: job.id, candidateId: candidate.id, unitId: result.unit_id, needIndex: index, verdict: 'accept', conditionsChecked: true, reason: 'codex:synthetic-test: 실제 Sonnet 응답을 합성 원문과 대조. 적용일/초안 제한/사람의 최종 실행/자동 주문 금지/담당 부서 미정을 확인. 실제 사람의 업무 승인이 아니다.', baseSnapshot: knowledge.current(scope), knowledgeId: null, expectedRevision: null }, 'codex:synthetic-test');
    reviewed.push({ review, canonical: await knowledge.commit(scope, review.id) });
  }
  writeFileSync(reviewedFile, JSON.stringify(reviewed, null, 2));
}
const { createServerApp } = await import('../src/server/create-server-app.js');
const { getAllJobs } = await import('../src/server/jobs.js');
const app = createServerApp();
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 3488 });
await new Promise<void>(done => server.listening ? done() : server.once('listening', done));
writeFileSync(join(evidence, 'live-server.json'), JSON.stringify({ pid: process.pid, port: 3488, root, startedAt: new Date().toISOString() }, null, 2));
const request = `scope=${JSON.stringify(scope)}. 먼저 WikiSearch query="거래처별 금액 집계"로 검색하되 items가 비어도 mandatory 목록 전체를 확인하세요. 다음 WikiSearch query=""로 전체 지식을 찾고 관련 정본 4개를 모두 실제 WikiRead(id,revision)로 조회하세요. 모든 refs를 포함해 WikiHandoff로 corpus-keeper에게 목적 join_aggregate로 다음 구체적 요청을 전달하세요: ${data}의 거래처 마스터.csv와 거래 내역.csv를 vendor_code로 실제 조인·거래처별 합계와 전체 합계를 계산하고, 규정의 적용일·초안 작성만 허용·사람의 최종 실행·자동 주문 금지·담당 부서 미정을 모두 담은 Markdown 보고서를 ${join(root, 'history/outputs/corpus-keeper/거래처 집계 보고서.md')}에 저장. WikiRead citation을 관련 내용 바로 옆에 그대로 포함하고 WikiRecordUsage로 저장된 파일의 모든 지식 refs 사용을 기록. 인계 뒤 결과의 실제 jobId를 보고하되 ACK만으로 완료라고 하지 마세요. 이 요청은 가상 데이터 검증이며 실제 주문이나 업무 승인이 아닙니다.`;
const response = await fetch('http://127.0.0.1:3488/api/delegate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent: 'windows-analyst', request, projectName: scope.projectId, cwd: project, planGate: false, skipOutput: false, maxTurns: 20, leaseSec: 600 }) });
assert.equal(response.status, 200);
const acknowledgement: unknown = await response.json();
writeFileSync(join(evidence, 'analyst-ack.json'), JSON.stringify(acknowledgement, null, 2));
console.log(JSON.stringify({ stage: 'analyst_dispatched', acknowledgement }));
const timer = setInterval(() => {
  const jobs = getAllJobs();
  writeFileSync(join(evidence, 'jobs.json'), JSON.stringify(jobs, null, 2));
  console.log(JSON.stringify(jobs.map(job => ({ id: job.id, status: job.status, agent: job.agent }))));
  if (jobs.length >= 2 && jobs.every(job => ['done', 'failed', 'cancelled', 'completed'].includes(job.status))) clearInterval(timer);
}, 10000);
