import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { ConnectionSecretBroker } from '../connection-secret-broker.js';
import type { GoogleConnectionRegistry } from '../google-connection-registry.js';
import type { GoogleReadonlyConnectionService } from '../google-readonly-service.js';
import { CompleteGoogleConnectionInputSchema } from '../google-readonly-schema.js';
import { ConnectionIdSchema } from '../reversible-ingest-schema.js';
import { createProjectBundle, importProjectBundle, parseProjectBundle, ProjectCategorySchema, ProjectDriveError, ProjectSelectionSchema, type ProjectBundle } from './bundle.js';
import { DriveIdSchema, type ProjectDriveProvider } from './provider.js';

type Options = {
  readonly root: string;
  readonly service: GoogleReadonlyConnectionService;
  readonly registry: GoogleConnectionRegistry;
  readonly broker: ConnectionSecretBroker;
  readonly provider: ProjectDriveProvider;
  readonly authorize: (c: Context, mutation: boolean) => boolean;
  readonly owner: () => string;
};
type Preview = { readonly kind: 'upload' | 'import'; readonly bundle: ProjectBundle; readonly expires: number; readonly connectionId: string | null };
const confirmSchema = z.object({ confirm: z.literal(true) }).strict();
const uploadSchema = z.object({ previewId: z.string().uuid(), connectionId: ConnectionIdSchema, confirm: z.literal(true) }).strict();
const importSchema = z.object({ previewId: z.string().uuid(), target: ProjectSelectionSchema, confirm: z.literal(true) }).strict();

export function createProjectDriveRoutes(options: Options): Hono {
  const app = new Hono();
  const previews = new Map<string, Preview>();
  let busy = false;
  const credential = (id: string) => {
    if (!options.service.isConnectionActive(id)) throw new ProjectDriveError('connection_inactive', 403);
    const connection = options.registry.getConnection(id);
    if (!connection) throw new ProjectDriveError('connection_inactive', 403);
    const secret = options.broker.read(connection.credentialHandle);
    if (!secret) throw new ProjectDriveError('credential_unavailable', 403);
    return secret.refreshToken;
  };
  const savePreview = (preview: Preview) => {
    for (const [key, value] of previews) if (value.expires < Date.now()) previews.delete(key);
    if (previews.size >= 3) { const oldest = previews.keys().next().value; if (oldest) previews.delete(oldest); }
    const previewId = randomUUID(); previews.set(previewId, preview);
    return { previewId, project: preview.bundle.project, excludedCount: preview.bundle.excludedCount, createdAt: preview.bundle.createdAt,
      files: preview.bundle.files.map(file => ({ path: file.path, bytes: Buffer.from(file.data, 'base64').length })) };
  };
  const takePreview = (id: string, kind: Preview['kind']) => {
    const preview = previews.get(id);
    if (!preview || preview.expires < Date.now() || preview.kind !== kind) throw new ProjectDriveError('preview_expired_repeat_preview', 409);
    previews.delete(id);
    return preview;
  };
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store'); c.header('X-Content-Type-Options', 'nosniff');
    if (c.req.path.endsWith('/oauth/callback')) {
      if (!options.registry.hasActiveTransaction(c.req.query('state') ?? '')) return c.json({ error: 'invalid_oauth_transaction' }, 400);
    } else if (!options.authorize(c, !['GET', 'HEAD'].includes(c.req.method))) return c.json({ error: 'owner_same_origin_required' }, 403);
    await next();
  });
  app.use('*', bodyLimit({ maxSize: 8192 }));
  app.onError((error, c) => {
    if (error instanceof ProjectDriveError) return c.json({ error: error.code }, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return c.json({ error: 'invalid_project_request' }, 400);
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return c.json({ error: 'project_not_found' }, 404);
    return c.json({ error: 'project_drive_operation_failed' }, 502);
  });
  app.get('/connections', c => c.json({ connections: options.service.listConnections() }));
  app.post('/oauth/start', async c => { confirmSchema.parse(await c.req.json()); return c.json(options.service.startConnection({ ownerPrincipalId: options.owner() })); });
  app.get('/oauth/callback', async c => {
    const input = CompleteGoogleConnectionInputSchema.parse({ state: c.req.query('state'), code: c.req.query('code') });
    const result = await options.service.completeConnection(input);
    if (result.kind === 'denied') return c.json({ error: result.reason }, 400);
    if (c.req.header('Accept')?.includes('text/html')) return c.html('<!doctype html><html lang="ko"><meta charset="utf-8"><title>프로젝트 Drive 연결 완료</title><h1>프로젝트 Drive 연결 완료</h1><p>아래 링크로 프로젝트 전송 화면에 돌아가세요.</p><a href="/project-drive">프로젝트 전송 열기</a></html>', 201);
    return c.json({ connectionId: result.connection.connectionId }, 201);
  });
  app.post('/connections/:id/revoke', async c => { confirmSchema.parse(await c.req.json()); options.service.revokeConnection(ConnectionIdSchema.parse(c.req.param('id'))); return c.json({ ok: true }); });
  app.get('/local-projects', c => {
    const projects: { category: string; slug: string }[] = [];
    for (const category of ProjectCategorySchema.options) {
      try { for (const entry of readdirSync(`${options.root}/${category}`, { withFileTypes: true })) if (entry.isDirectory() && ProjectSelectionSchema.safeParse({ category, slug: entry.name }).success) projects.push({ category, slug: entry.name }); }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
    }
    return c.json({ projects });
  });
  app.get('/connections/:id/snapshots', async c => { const id = ConnectionIdSchema.parse(c.req.param('id')); const snapshots = await options.provider.listSnapshots(credential(id)); credential(id); return c.json({ snapshots }); });
  app.post('/preview-upload', async c => {
    const project = ProjectSelectionSchema.parse(await c.req.json());
    return c.json(savePreview({ kind: 'upload', bundle: createProjectBundle(options.root, project), expires: Date.now() + 300_000, connectionId: null }));
  });
  app.post('/upload', async c => {
    const body = uploadSchema.parse(await c.req.json());
    if (busy) throw new ProjectDriveError('transfer_busy', 409);
    const token = credential(body.connectionId), preview = takePreview(body.previewId, 'upload');
    busy = true;
    try {
      const name = `${preview.bundle.project.slug}-${new Date().toISOString().replace(/[:.]/g, '-')}.mycrew-project.json`;
      const snapshot = await options.provider.uploadSnapshot(token, { name, bytes: Buffer.from(JSON.stringify(preview.bundle)) });
      return c.json({ snapshot, url: `https://drive.google.com/file/d/${snapshot.id}/view` }, 201);
    } finally { busy = false; }
  });
  app.post('/preview-import', async c => {
    const body = z.object({ connectionId: ConnectionIdSchema, fileId: DriveIdSchema }).strict().parse(await c.req.json());
    if (busy) throw new ProjectDriveError('transfer_busy', 409);
    busy = true;
    try {
      const bytes = await options.provider.downloadSnapshot(credential(body.connectionId), body.fileId);
      credential(body.connectionId);
      return c.json(savePreview({ kind: 'import', bundle: parseProjectBundle(JSON.parse(bytes.toString('utf8'))), expires: Date.now() + 300_000, connectionId: body.connectionId }));
    } finally { busy = false; }
  });
  app.post('/import', async c => {
    const body = importSchema.parse(await c.req.json()), preview = takePreview(body.previewId, 'import');
    if (preview.connectionId) credential(preview.connectionId);
    return c.json({ project: importProjectBundle(options.root, body.target, preview.bundle) }, 201);
  });
  return app;
}
