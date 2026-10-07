import { randomUUID } from 'node:crypto';
import ky, { type KyInstance } from 'ky';
import { z } from 'zod';
import { GoogleReadonlyHttpProvider, type GoogleReadonlyProvider, type ProviderOptions } from '../google-readonly-provider.js';
import { GoogleTokenResponseSchema } from '../google-readonly-schema.js';
import { readBounded } from '../corpus/notion.js';
import { MAX_BUNDLE_BYTES, ProjectDriveError } from './bundle.js';

export const PROJECT_DRIVE_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/drive.file'] as const;
export const DriveIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/);
const snapshotSchema = z.object({ id: DriveIdSchema, name: z.string().max(1000), modifiedTime: z.string().optional(), size: z.string().optional() });
const listSchema = z.object({ files: z.array(snapshotSchema).default([]), nextPageToken: z.string().optional() });
export type DriveSnapshot = z.infer<typeof snapshotSchema>;
export interface ProjectDriveProvider extends GoogleReadonlyProvider {
  listSnapshots(refreshToken: string): Promise<readonly DriveSnapshot[]>;
  uploadSnapshot(refreshToken: string, input: { readonly name: string; readonly bytes: Buffer }): Promise<DriveSnapshot>;
  downloadSnapshot(refreshToken: string, fileId: string): Promise<Buffer>;
}
export class GoogleProjectDriveProvider extends GoogleReadonlyHttpProvider implements ProjectDriveProvider {
  readonly #config: ProviderOptions & { readonly uploadEndpoint: string };
  readonly #http: KyInstance;
  constructor(config: ProviderOptions & { readonly uploadEndpoint: string }) {
    super({ ...config, scopes: PROJECT_DRIVE_SCOPES });
    this.#config = config;
    this.#http = ky.create({ timeout: 60_000, totalTimeout: 120_000, retry: { limit: 1, methods: ['get'] } });
  }
  async #token(refreshToken: string): Promise<string> {
    const response: unknown = await this.#http.post(this.#config.tokenEndpoint, { retry: 0, body: new URLSearchParams({ client_id: this.#config.clientId, client_secret: this.#config.clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken }) }).json();
    return GoogleTokenResponseSchema.parse(response).access_token;
  }
  async listSnapshots(refreshToken: string): Promise<readonly DriveSnapshot[]> {
    const token = await this.#token(refreshToken);
    const files: DriveSnapshot[] = [];
    let pageToken = '';
    const seen = new Set<string>();
    do {
      const page = listSchema.parse(await this.#http.get(this.#config.driveFilesEndpoint, { headers: { authorization: `Bearer ${token}` }, searchParams: { q: "trashed = false and appProperties has { key='mycrewProjectSnapshot' and value='1' }", pageSize: '100', fields: 'files(id,name,modifiedTime,size),nextPageToken', ...(pageToken ? { pageToken } : {}) } }).json());
      files.push(...page.files);
      pageToken = page.nextPageToken ?? '';
      if (files.length > 1000 || (pageToken && seen.has(pageToken))) throw new ProjectDriveError('drive_listing_limit', 413);
      seen.add(pageToken);
    } while (pageToken);
    return files;
  }
  async uploadSnapshot(refreshToken: string, input: { readonly name: string; readonly bytes: Buffer }): Promise<DriveSnapshot> {
    if (input.bytes.length > MAX_BUNDLE_BYTES) throw new ProjectDriveError('project_too_large', 413);
    const token = await this.#token(refreshToken);
    const headers = { authorization: `Bearer ${token}` };
    const folders = listSchema.parse(await this.#http.get(this.#config.driveFilesEndpoint, { headers, searchParams: { q: "trashed = false and mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='mycrewProjectRoot' and value='1' }", fields: 'files(id,name)', pageSize: '10' } }).json());
    const folder = folders.files[0] ?? snapshotSchema.parse(await this.#http.post(this.#config.driveFilesEndpoint, { headers, retry: 0, json: { name: 'MyCrew Projects', mimeType: 'application/vnd.google-apps.folder', appProperties: { mycrewProjectRoot: '1' } } }).json());
    const session = await this.#http.post(this.#config.uploadEndpoint, { headers: { ...headers, 'X-Upload-Content-Type': 'application/json', 'X-Upload-Content-Length': String(input.bytes.length) }, retry: 0, searchParams: { uploadType: 'resumable', fields: 'id,name,modifiedTime,size' }, json: { name: input.name, mimeType: 'application/json', parents: [folder.id], appProperties: { mycrewProjectSnapshot: '1', transferId: randomUUID() } } });
    const location = session.headers.get('location');
    if (!location || new URL(location).origin !== new URL(this.#config.uploadEndpoint).origin) throw new ProjectDriveError('invalid_upload_session', 502);
    return snapshotSchema.parse(await this.#http.put(location, { headers: { ...headers, 'Content-Type': 'application/json' }, body: new Uint8Array(input.bytes), retry: 0 }).json());
  }
  async downloadSnapshot(refreshToken: string, untrustedId: string): Promise<Buffer> {
    const id = DriveIdSchema.parse(untrustedId), token = await this.#token(refreshToken);
    const headers = { authorization: `Bearer ${token}` }, url = `${this.#config.driveFilesEndpoint}/${id}`;
    const metadataSchema = z.object({ id: DriveIdSchema, mimeType: z.literal('application/json'), size: z.string().regex(/^\d+$/), version: z.string(), trashed: z.boolean().optional(), appProperties: z.object({ mycrewProjectSnapshot: z.literal('1') }) });
    const params = { fields: 'id,mimeType,size,version,trashed,appProperties' };
    const before = metadataSchema.parse(await this.#http.get(url, { headers, searchParams: params }).json());
    if (before.id !== id || before.trashed) throw new ProjectDriveError('snapshot_unavailable', 404);
    if (Number(before.size) > MAX_BUNDLE_BYTES) throw new ProjectDriveError('project_too_large', 413);
    const bytes = await readBounded(await this.#http.get(url, { headers, searchParams: { alt: 'media' } }), MAX_BUNDLE_BYTES);
    const after = metadataSchema.parse(await this.#http.get(url, { headers, searchParams: params }).json());
    if (after.version !== before.version) throw new ProjectDriveError('snapshot_changed_retry', 409);
    return bytes;
  }
}
