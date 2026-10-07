import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getConnInfo } from '@hono/node-server/conninfo';
import { z } from 'zod';
import { getCurrentSession, isSsoEnabled } from '../auth-google.js';
import { CorpusError, MAX_SOURCE_BYTES } from './extract.js';
import { NotionReadonlyProvider } from './notion.js';
import { type CorpusService } from './service.js';
import { searchCorpus } from './search.js';
import { corpusSourceAllowed, getCorpusService } from './runtime.js';
import type { CorpusSnapshot } from '../../shared/corpus.js';
import { CorpusIntakeService } from './intake.js';
import { INTAKE_LIMITS } from '../../shared/corpus-intake.js';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { join } from 'node:path';

export const CorpusLabelsSchema = z.array(z.string().trim().min(1).max(80)).max(20).default([]);
export function corpusAccessAllowed(c: Context, mutation = false): boolean {
  const url = new URL(c.req.url);
  if (c.req.header('Sec-Fetch-Site') === 'cross-site') return false;
  if (mutation && c.req.header('Origin') !== url.origin) return false;
  if (isSsoEnabled()) return getCurrentSession(c) !== null;
  try {
    const address = getConnInfo(c).remote.address;
    return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address ?? '') && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch { return false; }
}

interface Options {
  service?: CorpusService;
  notion?: NotionReadonlyProvider;
  authorize?: (c: Context, mutation: boolean) => boolean;
  allowed?: (snapshot: CorpusSnapshot) => boolean;
}
export function createCorpusRoutes(options: Options = {}): Hono {
  const app = new Hono();
  const service = options.service ?? getCorpusService();
  const authorize = options.authorize ?? corpusAccessAllowed;
  const allowed = options.allowed ?? corpusSourceAllowed;
  const intake = getCorpusIntake(service, allowed);
  const notion = options.notion ?? (process.env.NOTION_ACCESS_TOKEN ? new NotionReadonlyProvider(process.env.NOTION_ACCESS_TOKEN) : undefined);
  let busy = false;
  app.use('*', async (c, next) => {
    if (!authorize(c, !['GET', 'HEAD'].includes(c.req.method))) return c.json({ error: 'owner_same_origin_required' }, 403);
    c.header('Cache-Control', 'no-store'); c.header('X-Content-Type-Options', 'nosniff');
    await next();
  });
  app.use('*', bodyLimit({ maxSize: MAX_SOURCE_BYTES + 64 * 1024, onError: c => c.json({ error: 'file_too_large' }, 413) }));
  app.onError((error, c) => {
    if (error instanceof CorpusError) return c.json({ error: error.code }, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return c.json({ error: 'invalid_request' }, 400);
    return c.json({ error: 'corpus_operation_failed' }, 500);
  });
  app.get('/status', c => c.json({ maxFileBytes: MAX_SOURCE_BYTES, maxOriginalBytes: INTAKE_LIMITS.originalBytes, uploadPartBytes: INTAKE_LIMITS.partBytes, notionConfigured: Boolean(notion), embeddingConfigured: Boolean(service.embedder), embeddingModel: service.embedder?.model ?? null }));
  app.get('/intakes', c => c.json({ jobs: intake.list() }));
  app.post('/intakes', async c => c.json({ job: intake.create(await c.req.json()) }, 201));
  app.get('/intakes/:id', c => c.json({ job: intake.read(c.req.param('id')) }));
  app.patch('/intakes/:id/content', async c => {
    if (intake.read(c.req.param('id')).provider !== 'local') throw new CorpusError('intake_remote_transfer_required', 403);
    const reader = c.req.raw.body?.getReader(); if (!reader) throw new CorpusError('empty_file', 400);
    const parts: Buffer[] = []; let size = 0;
    try {
      for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length;
        if (size > INTAKE_LIMITS.partBytes) throw new CorpusError('intake_part_too_large', 413); parts.push(Buffer.from(part.value)); }
    } finally { await reader.cancel(); reader.releaseLock(); }
    const job = await intake.append(c.req.param('id'), Number(c.req.query('offset')), Buffer.concat(parts), c.req.header('X-Chunk-SHA256') ?? '');
    return c.json({ job });
  });
  app.post('/intakes/:id/complete', async c => {
    if (intake.read(c.req.param('id')).provider !== 'local') throw new CorpusError('intake_remote_transfer_required', 403);
    return c.json({ job: await intake.finish(c.req.param('id')) });
  });
  app.post('/intakes/:id/process', async c => {
    const body = z.object({ unitLimit: z.number().int().min(1).max(1000).optional(), continueBatches: z.boolean().default(true) }).strict().parse(await c.req.json());
    return c.json({ job: intake.start(c.req.param('id'), body.unitLimit, body.continueBatches) }, 202);
  });
  app.post('/intakes/:id/pause', c => c.json({ job: intake.pause(c.req.param('id')) }));
  app.get('/intakes/:id/original', async c => {
    const job = intake.read(c.req.param('id')); if (!job.contentHash) throw new CorpusError('intake_upload_incomplete', 409);
    const path = join(intake.directory(job.id), 'original.bin');
    if (await import('./files.js').then(files => files.fileHash(path)) !== job.contentHash) throw new CorpusError('intake_original_changed', 409);
    const stream = (Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>).pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(bytes, controller) { if (!intake.allowed(job)) throw new CorpusError('connection_inactive', 403); controller.enqueue(bytes); },
    }));
    return new Response(stream, {
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(job.name)}`, 'Content-Length': String(job.bytes), 'Cache-Control': 'no-store' },
    });
  });
  app.get('/sources', c => c.json({ sources: service.store.list().map(source => ({ ...source, retrievalAllowed: allowed(service.store.snapshot(source.sourceId)!) })) }));
  app.post('/import/local', async c => {
    const form = await c.req.formData(); const file = form.get('file');
    if (!(file instanceof File)) throw new CorpusError('file_required', 400);
    const labels = CorpusLabelsSchema.parse(JSON.parse(String(form.get('labels') ?? '[]')));
    const source = await service.import({ provider: 'local', externalId: file.name, name: file.name, mime: file.type, bytes: Buffer.from(await file.arrayBuffer()), labels });
    return c.json({ source }, 201);
  });
  app.post('/import/notion', async c => {
    if (!notion) throw new CorpusError('notion_not_configured', 503);
    const body = z.object({ page: z.string().min(1).max(1000), labels: CorpusLabelsSchema }).strict().parse(await c.req.json());
    if (busy) throw new CorpusError('import_busy_retry', 409);
    busy = true;
    try { return c.json({ source: await service.import(await notion.readPage(body.page, body.labels)) }, 201); }
    finally { busy = false; }
  });
  app.get('/search', async c => c.json(await searchCorpus(service.store, c.req.query('q') ?? '', { embedder: service.embedder, allowed })));
  app.get('/sources/:id', c => {
    const snapshot = service.store.snapshot(c.req.param('id'), c.req.query('revision'));
    if (!snapshot) throw new CorpusError('source_not_found', 404);
    if (!allowed(snapshot)) throw new CorpusError('connection_inactive', 403);
    return c.json({ snapshot, revisions: service.store.revisions(snapshot.sourceId) });
  });
  app.post('/sources/:id/enabled', async c => {
    const body = z.object({ enabled: z.boolean() }).strict().parse(await c.req.json());
    service.store.setEnabled(c.req.param('id'), body.enabled); return c.json({ ok: true });
  });
  app.post('/sources/:id/vectors', async c => {
    if (busy) throw new CorpusError('import_busy_retry', 409);
    busy = true;
    try { return c.json(await service.indexVectors(c.req.param('id'), allowed)); }
    finally { busy = false; }
  });
  app.get('/sources/:id/backup', c => {
    const bytes = service.store.backup(c.req.param('id'));
    c.header('Content-Type', 'application/zip');
    c.header('Content-Disposition', 'attachment; filename="corpus-source-backup.zip"');
    return c.body(new Uint8Array(bytes));
  });
  return app;
}

const intakes = new WeakMap<CorpusService, CorpusIntakeService>();
export function getCorpusIntake(service: CorpusService, allowed: (source: CorpusSnapshot) => boolean = corpusSourceAllowed): CorpusIntakeService {
  let intake = intakes.get(service);
  if (!intake) {
    intake = new CorpusIntakeService(service.store, job => job.provider === 'local' || allowed({ provider: job.provider, connectionId: job.connectionId } as CorpusSnapshot));
    intakes.set(service, intake);
  }
  return intake;
}
