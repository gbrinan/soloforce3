import { WikiWorkerService } from './worker-service.js';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { join } from 'node:path';
import { HISTORY_DIR } from '../../config.js';
import { CorpusError } from '../corpus/extract.js';
import { corpusAccessAllowed } from '../corpus/routes.js';
import { corpusSourceAllowed, getCorpusService } from '../corpus/runtime.js';
import { callWikiCore, UPSTREAM_COMMIT } from './bridge.js';
import { WikiScopeSchema, WikiService } from './service.js';
import { WikiKnowledgeStore } from './knowledge.js';
import { WikiExecution, WIKI_MODEL, type WikiModelRunner } from './execution.js';
import { getRequestUserKey } from '../auth-google.js';

export function createWikiRoutes(options: { service?: WikiService; authorize?: (c: Context, mutation: boolean) => boolean; runner?: WikiModelRunner } = {}): Hono {
  const app = new Hono();
  const service = options.service ?? new WikiService(join(HISTORY_DIR, 'wiki'), getCorpusService().store, corpusSourceAllowed);
  const authorize = options.authorize ?? corpusAccessAllowed;
  const knowledge = new WikiKnowledgeStore(service);
  const execution = new WikiExecution(service, options.runner);
  let busy = false;
  const scope = (c: Context) => WikiScopeSchema.parse({ orgId: c.req.query('orgId'), projectId: c.req.query('projectId') });
  app.use('*', async (c, next) => {
    if (!authorize(c, !['GET', 'HEAD'].includes(c.req.method))) return c.json({ error: 'owner_same_origin_required' }, 403);
    c.header('Cache-Control', 'no-store'); c.header('X-Content-Type-Options', 'nosniff');
    await next();
  });
  app.use('*', bodyLimit({ maxSize: 2 * 1024 * 1024, onError: c => c.json({ error: 'wiki_batch_too_large' }, 413) }));
  app.onError((error, c) => {
    if (error instanceof CorpusError) return c.json({ error: error.code }, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return c.json({ error: 'invalid_request' }, 400);
    return c.json({ error: 'wiki_operation_failed' }, 500);
  });
  app.get('/capabilities', async c => {
    try {
      const runtime = await callWikiCore<{ python: string }>({ operation: 'probe' });
      return c.json({ available: true, python: runtime.python, upstreamCommit: UPSTREAM_COMMIT, candidateBuild: true, publish: true, driveSync: false, model: WIKI_MODEL, analyze: true, modelConnection: 'not_checked', accessMode: 'owner_workspace' });
    } catch (error) {
      return c.json({ available: false, error: error instanceof CorpusError ? error.code : 'wiki_core_failed', upstreamCommit: UPSTREAM_COMMIT, candidateBuild: false, publish: false, driveSync: false });
    }
  });
  app.get('/jobs', c => c.json({ jobs: service.list(scope(c), c.req.query('sourceId') ?? '') }));
  app.get('/jobs/:id', c => c.json({ job: service.read(scope(c), c.req.param('id')) }));
  app.get('/jobs/:id/reviews', c => c.json({ reviews: knowledge.reviews(scope(c), c.req.param('id')) }));
  app.post('/jobs/:id/analyze', async c => c.json(await execution.analyze(c.req.param('id'), await c.req.json())));
  app.get('/knowledge', c => c.json(knowledge.list(scope(c))));
  app.get('/knowledge/:id/usage', c => c.json(new WikiWorkerService(knowledge).usage(scope(c), c.req.param('id'))));
  app.get('/knowledge/:id', c => c.json(knowledge.read(scope(c), c.req.param('id'))));
  app.post('/reviews', async c => c.json({ review: knowledge.review(await c.req.json(), getRequestUserKey(c)) }, 201));
  app.post('/commit', async c => {
    const input = z.object({ scope: WikiScopeSchema, reviewId: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(await c.req.json());
    return c.json(await knowledge.commit(input.scope, input.reviewId));
  });
  app.post('/prepare', async c => {
    if (busy) throw new CorpusError('wiki_busy_retry', 409);
    busy = true;
    try { return c.json({ job: await service.prepare(await c.req.json()) }, 201); }
    finally { busy = false; }
  });
  app.post('/jobs/:id/submit', async c => {
    if (busy) throw new CorpusError('wiki_busy_retry', 409);
    busy = true;
    try { return c.json({ job: await service.submit(c.req.param('id'), await c.req.json()) }, 201); }
    finally { busy = false; }
  });
  app.get('/jobs/:id/backup', c => {
    const bytes = service.backup(scope(c), c.req.param('id'));
    c.header('Content-Type', 'application/zip'); c.header('Content-Disposition', 'attachment; filename="ingestiger-candidates.zip"');
    return c.body(new Uint8Array(bytes));
  });
  return app;
}
