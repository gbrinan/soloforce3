import { createHash } from "node:crypto";
import ky, { type KyInstance } from "ky";
import { CorpusError, MAX_SOURCE_BYTES } from './corpus/extract.js';
import { readBounded } from './corpus/notion.js';
import { INTAKE_LIMITS } from '../shared/corpus-intake.js';
import {
  GoogleDriveFileListSchema,
  GoogleTokenResponseSchema,
  GoogleUserinfoSchema,
  type GoogleDriveFile,
} from "./google-readonly-schema.js";

export const GOOGLE_DRIVE_METADATA_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
export const GOOGLE_READONLY_SCOPES = ["openid", "email", GOOGLE_DRIVE_METADATA_SCOPE] as const;

export type ProviderOptions = {
  readonly scopes?: readonly string[];
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly userinfoEndpoint: string;
  readonly driveFilesEndpoint: string;
};

export type AuthorizationTokens = {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly grantedScopes: readonly string[];
};

export type GoogleIdentity = {
  readonly providerSubject: string;
  readonly displayEmail: string;
  readonly emailVerified: boolean;
};

export interface GoogleReadonlyProvider {
  buildAuthorizationUrl(input: { readonly state: string; readonly codeVerifier: string }): string;
  exchangeAuthorizationCode(input: { readonly code: string; readonly codeVerifier: string }): Promise<AuthorizationTokens>;
  fetchIdentity(accessToken: string): Promise<GoogleIdentity>;
  listMetadata(refreshToken: string): Promise<readonly GoogleDriveFile[]>;
  readFile?(refreshToken: string, fileId: string): Promise<GoogleFileContent>;
  transferFile?(refreshToken: string, fileId: string, sink: GoogleTransferSink): Promise<GoogleTransferMetadata>;
}
export interface GoogleTransferMetadata { id: string; name: string; mime: string; bytes: number; revision: string; exported: boolean; md5Checksum?: string }
export interface GoogleTransferSink {
  begin(metadata: GoogleTransferMetadata): Promise<number>;
  write(offset: number, bytes: Buffer): Promise<void>;
}

export interface GoogleFileContent {
  id: string; name: string; mime: string; bytes: Buffer; revision: string; exported: boolean;
}

export class GoogleProviderError extends Error {
  readonly name = "GoogleProviderError";

  constructor(readonly operation: "token_exchange" | "userinfo" | "token_refresh" | "drive_list", options?: ErrorOptions) {
    super(`Google provider request failed: ${operation}`, options);
  }
}

export class GoogleReadonlyHttpProvider implements GoogleReadonlyProvider {
  readonly #options: ProviderOptions;
  readonly #http: KyInstance;

  constructor(options: ProviderOptions) {
    this.#options = options;
    this.#http = ky.create({
      timeout: 10_000,
      totalTimeout: 20_000,
      retry: {
        limit: 1,
        methods: ["get"],
        statusCodes: [408, 429, 500, 502, 503, 504],
      },
    });
  }

  buildAuthorizationUrl(input: { readonly state: string; readonly codeVerifier: string }): string {
    const url = new URL(this.#options.authorizationEndpoint);
    url.searchParams.set("client_id", this.#options.clientId);
    url.searchParams.set("redirect_uri", this.#options.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", (this.#options.scopes ?? GOOGLE_READONLY_SCOPES).join(" "));
    url.searchParams.set("state", input.state);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent select_account");
    url.searchParams.set("code_challenge", createHash("sha256").update(input.codeVerifier).digest("base64url"));
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  }

  async exchangeAuthorizationCode(input: { readonly code: string; readonly codeVerifier: string }): Promise<AuthorizationTokens> {
    try {
      const untrusted: unknown = await this.#http.post(this.#options.tokenEndpoint, {
        retry: { limit: 0 },
        body: new URLSearchParams({
          code: input.code,
          client_id: this.#options.clientId,
          client_secret: this.#options.clientSecret,
          redirect_uri: this.#options.redirectUri,
          grant_type: "authorization_code",
          code_verifier: input.codeVerifier,
        }),
      }).json();
      const token = GoogleTokenResponseSchema.parse(untrusted);
      return {
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? null,
        grantedScopes: (token.scope ?? "").split(" ").filter((scope) => scope.length > 0)
          // Google은 축약 스코프(email/profile)를 전체 URL로 반환한다 — 요구 목록의 축약형과 맞춰 정규화.
          .map((scope) => scope === "https://www.googleapis.com/auth/userinfo.email" ? "email"
            : scope === "https://www.googleapis.com/auth/userinfo.profile" ? "profile" : scope),
      };
    } catch (error) {
      throw new GoogleProviderError("token_exchange", { cause: error });
    }
  }

  async fetchIdentity(accessToken: string): Promise<GoogleIdentity> {
    try {
      const untrusted: unknown = await this.#http.get(this.#options.userinfoEndpoint, {
        headers: { authorization: `Bearer ${accessToken}` },
      }).json();
      const profile = GoogleUserinfoSchema.parse(untrusted);
      return {
        providerSubject: profile.sub,
        displayEmail: profile.email,
        emailVerified: profile.email_verified,
      };
    } catch (error) {
      throw new GoogleProviderError("userinfo", { cause: error });
    }
  }

  async listMetadata(refreshToken: string): Promise<readonly GoogleDriveFile[]> {
    const accessToken = await this.#refreshAccessToken(refreshToken);
    try {
      const files: GoogleDriveFile[] = [];
      const seenPageTokens = new Set<string>();
      let pageToken: string | undefined;
      do {
        const searchParams: Record<string, string> = {
          q: "trashed = false",
          pageSize: "1000",
          fields: "nextPageToken,files(id,name,mimeType,modifiedTime,parents)",
        };
        if (pageToken !== undefined) searchParams.pageToken = pageToken;
        const untrusted: unknown = await this.#http.get(this.#options.driveFilesEndpoint, {
          headers: { authorization: `Bearer ${accessToken}` },
          searchParams,
        }).json();
        const page = GoogleDriveFileListSchema.parse(untrusted);
        files.push(...page.files);
        pageToken = page.nextPageToken;
        if (pageToken !== undefined) {
          if (seenPageTokens.has(pageToken)) throw new GoogleProviderError("drive_list");
          seenPageTokens.add(pageToken);
        }
      } while (pageToken !== undefined);
      return files;
    } catch (error) {
      if (error instanceof GoogleProviderError) throw error;
      throw new GoogleProviderError("drive_list", { cause: error });
    }
  }

  async #refreshAccessToken(refreshToken: string): Promise<string> {
    try {
      const untrusted: unknown = await this.#http.post(this.#options.tokenEndpoint, {
        retry: { limit: 0 },
        body: new URLSearchParams({
          client_id: this.#options.clientId,
          client_secret: this.#options.clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      }).json();
      return GoogleTokenResponseSchema.parse(untrusted).access_token;
    } catch (error) {
      throw new GoogleProviderError("token_refresh", { cause: error });
    }
  }

  async readFile(refreshToken: string, fileId: string): Promise<GoogleFileContent> {
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(fileId)) throw new CorpusError('invalid_drive_file_id', 400);
    const accessToken = await this.#refreshAccessToken(refreshToken);
    const url = `${this.#options.driveFilesEndpoint}/${encodeURIComponent(fileId)}`;
    const headers = { authorization: `Bearer ${accessToken}` };
    type Metadata = { id: string; name: string; mimeType: string; version: string; size?: string; md5Checksum?: string; trashed?: boolean; capabilities?: { canDownload?: boolean } };
    const metadata = async (): Promise<Metadata> => {
      const response = await this.#http.get(url, { headers, searchParams: { fields: 'id,name,mimeType,version,size,md5Checksum,trashed,capabilities(canDownload)', supportsAllDrives: 'true' } });
      const file = await response.json<Metadata>();
      if (file.id !== fileId || !file.name || !file.mimeType || !file.version) throw new CorpusError('invalid_drive_metadata', 502);
      if (file.trashed || file.capabilities?.canDownload !== true) throw new CorpusError('drive_download_forbidden', 403);
      if (Number(file.size) > MAX_SOURCE_BYTES) throw new CorpusError('file_too_large', 413);
      return file;
    };
    try {
      const before = await metadata();
      const formats: Record<string, { mime: string; ext: string }> = {
        'application/vnd.google-apps.document': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: '.docx' },
        'application/vnd.google-apps.spreadsheet': { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: '.xlsx' },
        'application/vnd.google-apps.presentation': { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: '.pptx' },
      };
      const format = formats[before.mimeType];
      if (before.mimeType.startsWith('application/vnd.google-apps.') && !format) throw new CorpusError('unsupported_drive_native_type', 422);
      const response = await this.#http.get(format ? `${url}/export` : url, { headers,
        searchParams: format ? { mimeType: format.mime } : { alt: 'media', supportsAllDrives: 'true' } });
      const bytes = await readBounded(response, format ? 10 * 1024 * 1024 : MAX_SOURCE_BYTES);
      const after = await metadata();
      if (before.version !== after.version || before.mimeType !== after.mimeType) throw new CorpusError('source_changed_retry', 409);
      if (!format && before.md5Checksum && createHash('md5').update(bytes).digest('hex') !== before.md5Checksum) throw new CorpusError('drive_checksum_mismatch', 409);
      return { id: fileId, name: `${before.name}${format && !before.name.endsWith(format.ext) ? format.ext : ''}`, mime: format?.mime ?? before.mimeType, bytes, revision: before.version, exported: Boolean(format) };
    } catch (error) {
      if (error instanceof CorpusError) throw error;
      throw new CorpusError('drive_content_fetch_failed', 502);
    }
  }

  async transferFile(refreshToken: string, fileId: string, sink: GoogleTransferSink): Promise<GoogleTransferMetadata> {
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(fileId)) throw new CorpusError('invalid_drive_file_id', 400);
    const accessToken = await this.#refreshAccessToken(refreshToken);
    const url = `${this.#options.driveFilesEndpoint}/${encodeURIComponent(fileId)}`;
    const headers = { authorization: `Bearer ${accessToken}` };
    type Metadata = { id: string; name: string; mimeType: string; version: string; size?: string; md5Checksum?: string; trashed?: boolean; capabilities?: { canDownload?: boolean } };
    const metadata = async () => {
      const file = await this.#http.get(url, { headers, redirect: 'error', searchParams: { fields: 'id,name,mimeType,version,size,md5Checksum,trashed,capabilities(canDownload)', supportsAllDrives: 'true' } }).json<Metadata>();
      if (file.id !== fileId || !file.name || !file.version || !file.mimeType) throw new CorpusError('invalid_drive_metadata', 502);
      if (file.trashed || file.capabilities?.canDownload !== true) throw new CorpusError('drive_download_forbidden', 403);
      return file;
    };
    try {
      const before = await metadata();
      if (before.mimeType.startsWith('application/vnd.google-apps.')) {
        // Workspace export has its own provider limit and no byte-range support.
        const file = await this.readFile(refreshToken, fileId);
        const meta: GoogleTransferMetadata = { id: file.id, name: file.name, mime: file.mime, bytes: file.bytes.length, revision: file.revision, exported: true };
        const savedOffset = await sink.begin(meta);
        if (!Number.isSafeInteger(savedOffset) || savedOffset < 0 || savedOffset > file.bytes.length) throw new CorpusError('intake_offset_invalid', 400);
        // Exports can differ at the byte level even at one revision. Replay accepted
        // parts through the sink's hash check before appending a new export's tail.
        let offset = 0;
        while (offset < file.bytes.length) { const part = file.bytes.subarray(offset, offset + INTAKE_LIMITS.partBytes); await sink.write(offset, part); offset += part.length; }
        return meta;
      }
      const size = Number(before.size);
      if (!Number.isSafeInteger(size) || size < 1) throw new CorpusError('invalid_drive_metadata', 502);
      if (size > INTAKE_LIMITS.originalBytes) throw new CorpusError('intake_original_too_large', 413);
      const meta: GoogleTransferMetadata = { id: fileId, name: before.name, mime: before.mimeType, bytes: size, revision: before.version, exported: false, md5Checksum: before.md5Checksum };
      let offset = await sink.begin(meta);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > size) throw new CorpusError('intake_offset_invalid', 400);
      while (offset < size) {
        const end = Math.min(size, offset + INTAKE_LIMITS.partBytes) - 1;
        const response = await this.#http.get(url, { headers: { ...headers, Range: `bytes=${offset}-${end}` }, redirect: 'error', searchParams: { alt: 'media', supportsAllDrives: 'true' } });
        const range = response.headers.get('content-range');
        if (!(response.status === 206 && range === `bytes ${offset}-${end}/${size}`) && !(response.status === 200 && offset === 0 && end + 1 === size)) { await response.body?.cancel(); throw new CorpusError('drive_range_not_supported', 502); }
        const part = await readBounded(response, INTAKE_LIMITS.partBytes);
        if (part.length !== end - offset + 1) throw new CorpusError('drive_range_incomplete', 502);
        await sink.write(offset, part); offset += part.length;
      }
      const after = await metadata();
      if (before.version !== after.version || before.mimeType !== after.mimeType || before.size !== after.size || before.md5Checksum !== after.md5Checksum) throw new CorpusError('source_changed_retry', 409);
      return meta;
    } catch (error) {
      if (error instanceof CorpusError) throw error;
      throw new CorpusError('drive_content_fetch_failed', 502);
    }
  }
}
