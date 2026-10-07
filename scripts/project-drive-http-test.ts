import { strict as assert } from 'node:assert';
import { createServer, request, type Server } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { z } from 'zod';
import { createProjectDriveServer } from '../src/server/project-drive/server.js';
import { GoogleProjectDriveProvider, PROJECT_DRIVE_SCOPES } from '../src/server/project-drive/provider.js';

const root = mkdtempSync(join(tmpdir(), 'project-drive-http-'));
let bytes = Buffer.alloc(0), writeCount = 0, grantWrite = true;
const google = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const json = (value: unknown) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)); };
  if (url.pathname === '/token') return json({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', token_type: 'Bearer', expires_in: 3600, scope: (grantWrite ? PROJECT_DRIVE_SCOPES : ['openid', 'email']).join(' ') });
  if (url.pathname === '/identity') return json({ sub: 'fixture-owner', email: 'owner@example.test', email_verified: true });
  if (url.pathname === '/files' && req.method === 'GET') return json({ files: url.searchParams.get('q')?.includes('mycrewProjectRoot') ? [{ id: 'folder1', name: 'MyCrew Projects' }] : bytes.length ? [{ id: 'snapshot1', name: 'fixture.mycrew-project.json' }] : [] });
  if (url.pathname === '/upload') { assert.equal(url.searchParams.get('uploadType'), 'resumable'); const metadata = JSON.parse(Buffer.concat(chunks).toString('utf8')); assert.deepEqual(metadata.parents, ['folder1']); res.setHeader('location', `${url.origin}/upload-session`); res.end(); return; }
  if (url.pathname === '/upload-session' && req.method === 'PUT') { bytes = Buffer.concat(chunks); writeCount++; return json({ id: 'snapshot1', name: 'fixture.mycrew-project.json', size: String(bytes.length) }); }
  if (url.pathname === '/files/snapshot1') {
    if (url.searchParams.get('alt') === 'media') { res.end(bytes); return; }
    return json({ id: 'snapshot1', mimeType: 'application/json', size: String(bytes.length), version: '1', trashed: false, appProperties: { mycrewProjectSnapshot: '1' } });
  }
  res.statusCode = 404; json({ error: 'fixture_unknown_route' });
});
google.listen(0, '127.0.0.1'); await once(google, 'listening');
function origin(server: Server): string { const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing test port'); return `http://127.0.0.1:${address.port}`; }
const googleOrigin = origin(google);
const provider = new GoogleProjectDriveProvider({ clientId: 'fixture-client', clientSecret: 'fixture-secret', redirectUri: 'http://localhost/api/project-drive/oauth/callback', authorizationEndpoint: `${googleOrigin}/authorize`, tokenEndpoint: `${googleOrigin}/token`, userinfoEndpoint: `${googleOrigin}/identity`, driveFilesEndpoint: `${googleOrigin}/files`, uploadEndpoint: `${googleOrigin}/upload` });
mkdirSync(join(root, 'projects/education/source/outputs'), { recursive: true });
writeFileSync(join(root, 'projects/education/source/project.json'), '{"name":"HTTP project"}');
writeFileSync(join(root, 'projects/education/source/outputs/report.md'), 'HTTP round trip');
const app = createProjectDriveServer({ history: join(root, 'history'), projects: join(root, 'projects'), provider, env: { GOOGLE_DRIVE_CONNECTOR_CLIENT_ID: 'fixture-client', GOOGLE_DRIVE_CONNECTOR_CLIENT_SECRET: 'fixture-secret', GOOGLE_PROJECT_DRIVE_CALLBACK_URL: 'http://localhost/api/project-drive/oauth/callback', SOLOFORCE_CONNECTION_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64') } });
const host = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
await once(host, 'listening');
const hostAddress = host.address(); if (!hostAddress || typeof hostAddress === 'string') throw new Error('Missing host port');
const base = `http://127.0.0.1:${hostAddress.port}`;
const post = (path: string, body: unknown, requestOrigin = base) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: requestOrigin }, body: JSON.stringify(body) });
const previewSchema = z.object({ previewId: z.string(), files: z.array(z.object({ path: z.string() })) });
try {
  assert.equal((await fetch(base + '/status')).status, 200);
  assert.equal((await fetch(base + '/status', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  const hostileHostStatus = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(base + '/status', { headers: { Host: 'attacker.test' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end();
  });
  assert.equal(hostileHostStatus, 403);
  assert.equal((await post('/oauth/start', { confirm: true }, 'https://attacker.test')).status, 403);
  assert.equal((await fetch(base + '/oauth/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"confirm":true}' })).status, 403);
  assert.equal((await post('/oauth/start', { confirm: false })).status, 400);
  const start = await post('/oauth/start', { confirm: true });
  const authUrl = new URL(z.object({ authorizationUrl: z.string() }).parse(await start.json()).authorizationUrl);
  assert.equal(authUrl.searchParams.get('scope'), PROJECT_DRIVE_SCOPES.join(' '));
  const state = authUrl.searchParams.get('state'); assert.ok(state);
  const callback = await fetch(`${base}/oauth/callback?state=${state}&code=fixture`);
  assert.equal(callback.status, 201);
  const connectionId = z.object({ connectionId: z.string() }).parse(await callback.json()).connectionId;
  assert.equal((await fetch(`${base}/oauth/callback?state=${state}&code=fixture`)).status, 400);
  const preview = previewSchema.parse(await (await post('/preview-upload', { category: 'education', slug: 'source' })).json());
  assert.equal((await post('/upload', { previewId: preview.previewId, connectionId, confirm: true }, 'https://attacker.test')).status, 403);
  assert.equal(writeCount, 0);
  assert.equal((await post('/upload', { previewId: preview.previewId, connectionId, confirm: true })).status, 201);
  assert.equal(writeCount, 1);
  assert.equal((await post('/upload', { previewId: preview.previewId, connectionId, confirm: true })).status, 409);
  const listed = await fetch(`${base}/connections/${connectionId}/snapshots`);
  assert.equal(z.object({ snapshots: z.array(z.unknown()) }).parse(await listed.json()).snapshots.length, 1);
  const imported = previewSchema.parse(await (await post('/preview-import', { connectionId, fileId: 'snapshot1' })).json());
  assert.equal((await post('/import', { previewId: imported.previewId, target: { category: 'education', slug: 'restored' }, confirm: true })).status, 201);
  assert.equal(readFileSync(join(root, 'projects/education/restored/outputs/report.md'), 'utf8'), 'HTTP round trip');
  const malicious = JSON.parse(bytes.toString('utf8')); malicious.files[0].path = '../escape.md'; bytes = Buffer.from(JSON.stringify(malicious));
  assert.equal((await post('/preview-import', { connectionId, fileId: 'snapshot1' })).status, 400);
  assert.equal(existsSync(join(root, 'projects/escape.md')), false);
  assert.equal((await post(`/connections/${connectionId}/revoke`, { confirm: true })).status, 200);
  assert.equal((await fetch(`${base}/connections/${connectionId}/snapshots`)).status, 403);
  grantWrite = false;
  const deniedStart = z.object({ authorizationUrl: z.string() }).parse(await (await post('/oauth/start', { confirm: true })).json());
  const deniedState = new URL(deniedStart.authorizationUrl).searchParams.get('state');
  assert.equal((await fetch(`${base}/oauth/callback?state=${deniedState}&code=fixture`)).status, 400);
  console.log('Project Drive HTTP owner/CSRF, OAuth scope/replay, resumable upload, import, malicious archive and revocation passed');
} finally {
  await Promise.all([new Promise<void>(resolve => host.close(() => resolve())), new Promise<void>(resolve => google.close(() => resolve()))]);
  rmSync(root, { recursive: true, force: true });
}
