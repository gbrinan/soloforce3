/** Disposable browser fixture using the real Wiki UI, API and Python; never calls an AI account. */
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = realpathSync(mkdtempSync(join(tmpdir(), 'ingestiger-ui-')));
process.env.MYCREW_HOME = temporary; process.env.WORKSPACE_ROOT = temporary;
delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET; delete process.env.MYCREW_REQUIRE_SSO;
const { CorpusStore } = await import('../src/server/corpus/store.js');
const { CorpusService } = await import('../src/server/corpus/service.js');
const { WikiService } = await import('../src/server/wiki/service.js');
const { createWikiRoutes } = await import('../src/server/wiki/routes.js');
const { build } = await import('vite');
const { default: react } = await import('@vitejs/plugin-react');
const { Hono } = await import('hono');
const { serve } = await import('@hono/node-server');
const { serveStatic } = await import('@hono/node-server/serve-static');
const corpus = new CorpusStore(join(temporary, 'history/corpus'));
const importer = new CorpusService(corpus);
const source = await importer.import({ provider: 'local', externalId: 'synthetic.md', name: '합성 주문 절차.md', mime: 'text/markdown',
  bytes: Buffer.from('# 주문 절차\n\n초안 금액은 001200원이다. 최종 주문은 사람이 실행한다. 자동 주문은 금지한다.') });
const ui = join(temporary, 'ui'); mkdirSync(ui);
symlinkSync(join(project, 'node_modules'), join(ui, 'node_modules'), 'junction');
writeFileSync(join(ui, 'index.html'), '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>IngesTiger 합성 검증</title><div id="root"></div><script type="module" src="/main.tsx"></script></html>');
writeFileSync(join(ui, 'main.tsx'), `import React from 'react'; import {createRoot} from 'react-dom/client'; import {MantineProvider,Container,Alert} from '@mantine/core'; import '@mantine/core/styles.css'; import WikiPanel from ${JSON.stringify(join(project, 'src/client/components/Settings/WikiPanel.tsx'))}; const snapshot=${JSON.stringify(corpus.snapshot(source.sourceId))}; createRoot(document.getElementById('root')!).render(<MantineProvider><Container size="lg" py="md"><Alert mb="md">합성 자료와 고정 모델 응답으로 검증합니다. 실제 AI 호출과 개인 계정 접근은 없습니다.</Alert><WikiPanel snapshot={snapshot} close={()=>{}} /></Container></MantineProvider>);`);
try { await build({ configFile: false, root: ui, plugins: [react()], logLevel: 'warn', build: { outDir: join(temporary, 'dist'), emptyOutDir: true } }); }
catch (error) { rmSync(temporary, { recursive: true, force: true }); throw error; }
const app = new Hono();
const wiki = new WikiService(join(temporary, 'history/wiki'), corpus, () => true);
app.route('/api/wiki', createWikiRoutes({ service: wiki, runner: async options => {
  const request = JSON.parse(options.prompt);
  return { text: JSON.stringify({ request_id: request.request_id, results: request.units.map((unit: { unit_id: string; text: string }) => ({ unit_id: unit.unit_id, status: 'analyzed', needs: [{
    kind: 'constraint', title: '주문 실행 조건', statement: '초안을 작성한 후 사람이 최종 주문한다.', details: ['초안 금액은 001200원이다.', '자동 주문은 금지한다.'],
    departments: [], patterns: [], evidence: [unit.text], claim_status: 'source_reported',
  }] })) }), costUsd: 0, model: options.model };
} }));
app.use('*', serveStatic({ root: join(temporary, 'dist') }));
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: Number(process.env.WIKI_PREVIEW_PORT || 4877) });
console.log(`Synthetic Wiki preview: http://127.0.0.1:${process.env.WIKI_PREVIEW_PORT || 4877} (no real model)`);
const stop = () => server.close(() => { rmSync(temporary, { recursive: true, force: true }); process.exit(0); });
process.on('SIGINT', stop); process.on('SIGTERM', stop);
