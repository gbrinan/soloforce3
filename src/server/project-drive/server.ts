import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { HISTORY_DIR, PROJECTS_DIR } from '../../config.js';
import { corpusAccessAllowed } from '../corpus/routes.js';
import { EncryptedConnectionSecretBroker } from '../connection-secret-broker.js';
import { GoogleConnectionRegistry } from '../google-connection-registry.js';
import { GoogleReadonlyConnectionService } from '../google-readonly-service.js';
import { OwnerPrincipalStore } from '../owner-principal-store.js';
import { GoogleProjectDriveProvider, PROJECT_DRIVE_SCOPES, type ProjectDriveProvider } from './provider.js';
import { createProjectDriveRoutes } from './routes.js';
import { MAX_PROJECT_BYTES } from './bundle.js';

export const PROJECT_DRIVE_CALLBACK = '/api/project-drive/oauth/callback';
const configSchema = z.object({ clientId: z.string().min(1), clientSecret: z.string().min(1), callback: z.url().refine(value => { const url = new URL(value); return (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) && url.pathname === PROJECT_DRIVE_CALLBACK && !url.search && !url.hash; }), encryptionKey: z.string().regex(/^[A-Za-z0-9+/]{43}=$/).transform(value => Buffer.from(value, 'base64')).refine(value => value.length === 32) });
type Options = { readonly env: NodeJS.ProcessEnv; readonly history: string; readonly projects: string; readonly authorize?: (c: Context, mutation: boolean) => boolean; readonly provider?: ProjectDriveProvider };
export function createProjectDriveServer(options: Options = { env: process.env, history: HISTORY_DIR, projects: PROJECTS_DIR }): Hono {
  const app = new Hono();
  const authorize = options.authorize ?? corpusAccessAllowed;
  const oldCallback = z.url().safeParse(options.env.GOOGLE_DRIVE_CONNECTOR_CALLBACK_URL);
  const callback = options.env.GOOGLE_PROJECT_DRIVE_CALLBACK_URL ?? (oldCallback.success ? new URL(PROJECT_DRIVE_CALLBACK, oldCallback.data).toString() : undefined);
  const config = configSchema.safeParse({ clientId: options.env.GOOGLE_DRIVE_CONNECTOR_CLIENT_ID, clientSecret: options.env.GOOGLE_DRIVE_CONNECTOR_CLIENT_SECRET, callback, encryptionKey: options.env.SOLOFORCE_CONNECTION_ENCRYPTION_KEY });
  app.get('/status', c => {
    if (!authorize(c, false)) return c.json({ error: 'owner_required' }, 403);
    return c.json({ configured: config.success, callbackUrl: config.success ? config.data.callback : null, scope: PROJECT_DRIVE_SCOPES[2], maxProjectBytes: MAX_PROJECT_BYTES });
  });
  if (!config.success) { app.all('*', c => c.json({ error: 'project_drive_not_configured' }, 503)); return app; }
  const root = join(options.history, 'project-drive');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const registry = new GoogleConnectionRegistry({ projectRoot: root });
  const broker = new EncryptedConnectionSecretBroker({ rootDirectory: join(root, '.connections', 'secrets'), encryptionKey: config.data.encryptionKey });
  const provider = options.provider ?? new GoogleProjectDriveProvider({ clientId: config.data.clientId, clientSecret: config.data.clientSecret, redirectUri: config.data.callback, authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth', tokenEndpoint: 'https://oauth2.googleapis.com/token', userinfoEndpoint: 'https://openidconnect.googleapis.com/v1/userinfo', driveFilesEndpoint: 'https://www.googleapis.com/drive/v3/files', uploadEndpoint: 'https://www.googleapis.com/upload/drive/v3/files' });
  const service = new GoogleReadonlyConnectionService({ projectRoot: root, projectId: 'project-drive', registry, broker, provider, requiredScopes: PROJECT_DRIVE_SCOPES });
  const owner = new OwnerPrincipalStore({ historyDirectory: options.history });
  app.route('/', createProjectDriveRoutes({ root: options.projects, registry, broker, provider, service, authorize, owner: () => owner.getOrCreate() }));
  return app;
}
export function projectDrivePage(c: Context): Response {
  if (!corpusAccessAllowed(c)) return c.text('이 PC의 localhost 또는 로그인한 소유자 세션에서 열어 주세요.', 403);
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  return c.html(readFileSync(new URL('../../../apps/projects/drive.html', import.meta.url), 'utf8'));
}
