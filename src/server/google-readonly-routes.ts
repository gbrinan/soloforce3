import { Hono, type Context } from "hono";
import {
  connectedIngestAuth,
  type ConnectedIngestCredential,
  type ConnectedIngestPolicy,
} from "./connected-ingest-auth.js";
import {
  CompleteGoogleConnectionInputSchema,
  GoogleMetadataIngestInputSchema,
} from "./google-readonly-schema.js";
import {
  GoogleReadonlyConnectionService,
  type CompleteConnectionResult,
  type MetadataIngestResult,
} from "./google-readonly-service.js";
import { ConnectionIdSchema } from "./reversible-ingest-schema.js";
import { z } from 'zod';
import { bodyLimit } from 'hono/body-limit';
import { CorpusError, hash } from './corpus/extract.js';
import type { CorpusService } from './corpus/service.js';
import { CorpusLabelsSchema, getCorpusIntake } from './corpus/routes.js';
import { fileHash } from './corpus/files.js';
import { join } from 'node:path';
import type { CorpusIntake } from '../shared/corpus-intake.js';

type RouteOptions = {
  readonly corpus?: CorpusService;
  readonly projectId: string;
  readonly service: GoogleReadonlyConnectionService;
  readonly resolveCredential: (context: Context) => ConnectedIngestCredential | Promise<ConnectedIngestCredential>;
  readonly resolveOwnerPrincipalId: (context: Context) => string | null;
};

export function createGoogleReadonlyRoutes(options: RouteOptions): Hono {
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof CorpusError) return c.json({ error: error.code }, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return c.json({ error: 'invalid_request' }, 400);
    return c.json({ error: 'google_operation_failed' }, 502);
  });
  app.get('/connections', auth(options, () => ({ kind: 'owner_read' })), c => c.json({ connections: options.service.listConnections() }));
  app.get('/:connectionId/files', auth(options, () => ({ kind: 'owner_read' })), async c =>
    c.json({ files: await options.service.listFiles(c.req.param('connectionId')) }));
  app.post('/:connectionId/import', auth(options, () => ({ kind: 'owner_mutation' })), bodyLimit({ maxSize: 8192 }), async c => {
    if (!options.corpus) throw new CorpusError('corpus_not_configured', 503);
    const body = z.object({ fileId: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/), labels: CorpusLabelsSchema }).strict().parse(await c.req.json());
    const connectionId = c.req.param('connectionId');
    const file = await options.service.readFile(connectionId, body.fileId);
    const source = await options.corpus.import({ provider: 'google-drive', externalId: file.id, connectionId,
      name: file.name, mime: file.mime, bytes: file.bytes, providerRevision: file.revision, labels: body.labels,
      sourceUrl: `https://drive.google.com/file/d/${file.id}/view`, backup: file.exported ? 'export' : 'original' },
    () => options.service.isConnectionActive(connectionId));
    return c.json({ source }, 201);
  });
  app.post('/:connectionId/intake', auth(options, () => ({ kind: 'owner_mutation' })), bodyLimit({ maxSize: 8192 }), async c => {
    if (!options.corpus) throw new CorpusError('corpus_not_configured', 503);
    const body = z.object({ fileId: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/), labels: CorpusLabelsSchema, intakeId: z.string().regex(/^[a-f0-9]{32}$/).optional() }).strict().parse(await c.req.json());
    const connectionId = c.req.param('connectionId');
    const intake = getCorpusIntake(options.corpus, source => source.provider !== 'google-drive' || Boolean(source.connectionId && options.service.isConnectionActive(source.connectionId)));
    let job: CorpusIntake | undefined = body.intakeId ? intake.read(body.intakeId) : undefined;
    if (job && (job.provider !== 'google-drive' || job.connectionId !== connectionId || job.externalId !== body.fileId || job.state !== 'uploading')) throw new CorpusError('intake_origin_conflict', 409);
    const file = await options.service.transferFile(connectionId, body.fileId, {
      begin: async meta => {
        if (job) {
          if (job.providerRevision !== meta.revision || job.bytes !== meta.bytes || job.mime !== meta.mime) throw new CorpusError('source_changed_retry', 409);
        } else job = intake.create({ name: meta.name, bytes: meta.bytes, mime: meta.mime, labels: body.labels }, {
          provider: 'google-drive', externalId: meta.id, connectionId, providerRevision: meta.revision,
          sourceUrl: `https://drive.google.com/file/d/${meta.id}/view`, backup: meta.exported ? 'export' : 'original',
        });
        return job.uploadedBytes;
      },
      write: async (offset, bytes) => { job = await intake.append(job!.id, offset, bytes, hash(bytes)); },
    });
    if (!job) throw new CorpusError('drive_content_fetch_failed', 502);
    if (file.md5Checksum && await fileHash(join(intake.directory(job.id), 'original.bin'), 'md5') !== file.md5Checksum) throw new CorpusError('drive_checksum_mismatch', 409);
    return c.json({ job: await intake.finish(job.id) }, 201);
  });

  app.post(
    "/oauth/start",
    auth(options, () => ({ kind: "owner_mutation" })),
    (c) => {
      const ownerPrincipalId = options.resolveOwnerPrincipalId(c);
      if (ownerPrincipalId === null) return c.json({ error: "owner_principal_missing" }, 401);
      return c.json(options.service.startConnection({ ownerPrincipalId }));
    },
  );

  app.get(
    "/oauth/callback",
    auth(options, () => ({ kind: "oauth_callback", provider: "google-drive" })),
    async (c) => {
      const input = CompleteGoogleConnectionInputSchema.safeParse({
        state: c.req.query("state"),
        code: c.req.query("code"),
      });
      if (!input.success) return c.json({ error: "invalid_oauth_callback" }, 400);
      return completeResponse(c, await options.service.completeConnection(input.data));
    },
  );

  app.post(
    "/:connectionId/ingest",
    auth(options, (c) => ({
      kind: "agent_or_owner",
      capability: "ingest.run",
      resource: {
        projectId: { value: options.projectId },
        connectionId: { value: c.req.param("connectionId") ?? "" },
      },
    })),
    async (c) => {
      let body: unknown;
      try {
        body = await c.req.json<unknown>();
      } catch (error) {
        if (error instanceof SyntaxError) return c.json({ error: "invalid_json" }, 400);
        throw error;
      }
      const input = GoogleMetadataIngestInputSchema.safeParse({
        ...(typeof body === "object" && body !== null ? body : {}),
        connectionId: c.req.param("connectionId"),
      });
      if (!input.success) return c.json({ error: "invalid_ingest_request" }, 400);
      return ingestResponse(c, await options.service.ingestMetadata(input.data));
    },
  );

  app.post(
    "/:connectionId/revoke",
    auth(options, () => ({ kind: "owner_mutation" })),
    (c) => {
      const connectionId = ConnectionIdSchema.safeParse(c.req.param("connectionId"));
      if (!connectionId.success) return c.json({ error: "invalid_connection_id" }, 400);
      options.service.revokeConnection(connectionId.data);
      return c.body(null, 204);
    },
  );

  return app;
}

function auth(
  options: RouteOptions,
  resolvePolicy: (context: Context) => ConnectedIngestPolicy,
) {
  return connectedIngestAuth({
    resolvePolicy,
    resolveCredential: options.resolveCredential,
  });
}

function completeResponse(c: Context, result: CompleteConnectionResult): Response {
  switch (result.kind) {
    case "connected":
      if (c.req.header('Accept')?.includes('text/html')) {
        return c.html('<!doctype html><html lang="ko"><meta charset="utf-8"><title>Drive 연결 완료</title><body><h1>Drive 연결을 완료했습니다.</h1><p>이 창을 닫고 Soloforce2 자료 화면에서 목록 새로고침을 누르세요.</p></body></html>', 201);
      }
      return c.json({
        connection: {
          connectionId: result.connection.connectionId,
          provider: result.connection.provider,
          displayEmail: result.connection.displayEmail,
          state: result.connection.state,
        },
      }, 201);
    case "denied":
      return c.json({ error: result.reason }, result.reason === "provider_failure" ? 502 : 400);
    default:
      return assertNever(result);
  }
}

function ingestResponse(c: Context, result: MetadataIngestResult): Response {
  switch (result.kind) {
    case "prepared":
    case "committed":
    case "rolled_back":
      return c.json(result, 200);
    case "conflict":
      return c.json(result, 409);
    case "denied":
      return c.json(result, result.reason === "provider_failure" ? 502 : 403);
    default:
      return assertNever(result);
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unhandled Google read-only route result: ${JSON.stringify(value)}`);
}
