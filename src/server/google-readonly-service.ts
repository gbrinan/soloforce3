import { randomBytes, randomUUID } from "node:crypto";
import { ConnectionSecretError, type ConnectionSecretBroker } from "./connection-secret-broker.js";
import { GoogleConnectionRegistry } from "./google-connection-registry.js";
import {
  CompleteGoogleConnectionInputSchema,
  ActiveOAuthTransactionSchema,
  GoogleConnectionSchema,
  GoogleMetadataIngestInputSchema,
  OAuthStateSchema,
  OwnerPrincipalIdSchema,
  StartGoogleConnectionInputSchema,
  type CompleteGoogleConnectionInput,
  type GoogleConnection,
  type GoogleMetadataIngestInput,
  type StartGoogleConnectionInput,
} from "./google-readonly-schema.js";
import {
  GOOGLE_READONLY_SCOPES,
  GoogleProviderError,
  type GoogleReadonlyProvider,
  type GoogleTransferSink,
} from "./google-readonly-provider.js";
import { ConnectionIdSchema, ProjectIdSchema, type IngestManifest, type OperationResult } from "./reversible-ingest-schema.js";
import { ReversibleIngestStore } from "./reversible-ingest.js";
import { CorpusError } from './corpus/extract.js';

type ServiceOptions = {
  readonly requiredScopes?: readonly string[];
  readonly projectRoot: string;
  readonly projectId: string;
  readonly registry: GoogleConnectionRegistry;
  readonly broker: ConnectionSecretBroker;
  readonly provider: GoogleReadonlyProvider;
  readonly now?: () => string;
  readonly transactionTtlMs?: number;
};

export type CompleteConnectionResult =
  | { readonly kind: "connected"; readonly connection: GoogleConnection }
  | {
      readonly kind: "denied";
      readonly reason:
        | "invalid_oauth_transaction"
        | "required_scope_missing"
        | "email_unverified"
        | "offline_access_missing"
        | "provider_failure";
    };

export type MetadataIngestResult = OperationResult | {
  readonly kind: "denied";
  readonly reason: "connection_inactive" | "credential_unavailable" | "provider_failure";
};

export class GoogleReadonlyConnectionService {
  readonly #projectId: ReturnType<typeof ProjectIdSchema.parse>;
  readonly #registry: GoogleConnectionRegistry;
  readonly #broker: ConnectionSecretBroker;
  readonly #provider: GoogleReadonlyProvider;
  readonly #store: ReversibleIngestStore;
  readonly #now: () => string;
  readonly #transactionTtlMs: number;
  readonly #requiredScopes: readonly string[];

  constructor(options: ServiceOptions) {
    this.#projectId = ProjectIdSchema.parse(options.projectId);
    this.#registry = options.registry;
    this.#broker = options.broker;
    this.#provider = options.provider;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#transactionTtlMs = options.transactionTtlMs ?? 10 * 60 * 1000;
    this.#requiredScopes = options.requiredScopes ?? GOOGLE_READONLY_SCOPES;
    this.#store = new ReversibleIngestStore({
      projectRoot: options.projectRoot,
      projectId: this.#projectId,
      now: this.#now,
    });
  }

  startConnection(untrustedInput: StartGoogleConnectionInput): { readonly authorizationUrl: string } {
    const input = StartGoogleConnectionInputSchema.parse(untrustedInput);
    const state = OAuthStateSchema.parse(randomBytes(32).toString("hex"));
    const codeVerifier = randomBytes(48).toString("base64url");
    const transaction = ActiveOAuthTransactionSchema.parse({
      version: 1,
      state,
      projectId: this.#projectId,
      ownerPrincipalId: OwnerPrincipalIdSchema.parse(input.ownerPrincipalId),
      codeVerifier,
      status: "active",
      expiresAt: new Date(Date.parse(this.#now()) + this.#transactionTtlMs).toISOString(),
      usedAt: null,
    });
    this.#registry.createTransaction(transaction);
    return {
      authorizationUrl: this.#provider.buildAuthorizationUrl({
        state: transaction.state,
        codeVerifier: transaction.codeVerifier,
      }),
    };
  }

  async completeConnection(untrustedInput: CompleteGoogleConnectionInput): Promise<CompleteConnectionResult> {
    const input = CompleteGoogleConnectionInputSchema.parse(untrustedInput);
    const consumed = this.#registry.consumeTransaction(input.state);
    if (consumed.kind === "denied") return consumed;

    try {
      const tokens = await this.#provider.exchangeAuthorizationCode({
        code: input.code,
        codeVerifier: consumed.transaction.codeVerifier,
      });
      const hasRequiredScopes = this.#requiredScopes.every((scope) => tokens.grantedScopes.includes(scope));
      if (!hasRequiredScopes) return { kind: "denied", reason: "required_scope_missing" };
      if (tokens.refreshToken === null) return { kind: "denied", reason: "offline_access_missing" };
      const identity = await this.#provider.fetchIdentity(tokens.accessToken);
      if (!identity.emailVerified) return { kind: "denied", reason: "email_unverified" };

      const credentialHandle = this.#broker.store({ refreshToken: tokens.refreshToken });
      const connection = GoogleConnectionSchema.parse({
        version: 1,
        connectionId: ConnectionIdSchema.parse(randomUUID()),
        projectId: this.#projectId,
        ownerPrincipalId: consumed.transaction.ownerPrincipalId,
        provider: "google-drive",
        providerSubject: identity.providerSubject,
        displayEmail: identity.displayEmail,
        credentialHandle,
        state: "active",
        connectedAt: this.#now(),
        revokedAt: null,
      });
      try {
        this.#registry.saveConnection(connection);
      } catch (error) {
        this.#broker.revoke(credentialHandle);
        throw error;
      }
      return { kind: "connected", connection };
    } catch (error) {
      if (error instanceof GoogleProviderError) return { kind: "denied", reason: "provider_failure" };
      throw error;
    }
  }

  async ingestMetadata(untrustedInput: GoogleMetadataIngestInput): Promise<MetadataIngestResult> {
    const input = GoogleMetadataIngestInputSchema.parse(untrustedInput);
    const connection = this.#registry.getConnection(input.connectionId);
    if (connection === null || connection.projectId !== this.#projectId || connection.state !== "active") {
      return { kind: "denied", reason: "connection_inactive" };
    }
    let secret: ReturnType<ConnectionSecretBroker["read"]>;
    try {
      secret = this.#broker.read(connection.credentialHandle);
    } catch (error) {
      if (error instanceof ConnectionSecretError) return { kind: "denied", reason: "credential_unavailable" };
      throw error;
    }
    if (secret === null) return { kind: "denied", reason: "credential_unavailable" };

    try {
      const files = await this.#provider.listMetadata(secret.refreshToken);
      const orderedFiles = [...files].sort((left, right) => left.id.localeCompare(right.id));
      const prepared = this.#store.prepare({
        operationId: input.operationId,
        connectionId: connection.connectionId,
        targetPath: input.targetPath,
        content: `${JSON.stringify({
          version: 1,
          provider: "google-drive",
          connectionId: connection.connectionId,
          providerSubject: connection.providerSubject,
          files: orderedFiles,
        }, null, 2)}\n`,
      });
      return prepared.kind === "prepared" ? this.#store.commit(input.operationId) : prepared;
    } catch (error) {
      if (error instanceof GoogleProviderError) return { kind: "denied", reason: "provider_failure" };
      throw error;
    }
  }

  isConnectionActive(connectionId: string): boolean {
    const connection = this.#registry.getConnection(connectionId);
    return connection?.projectId === this.#projectId && connection.state === 'active';
  }

  listConnections() {
    return this.#registry.listConnections().filter(connection => connection.projectId === this.#projectId)
      .map(({ connectionId, displayEmail, state }) => ({ connectionId, displayEmail, state }));
  }

  async listFiles(connectionId: string) {
    const secret = this.contentCredential(connectionId);
    const files = await this.#provider.listMetadata(secret.refreshToken);
    if (!this.isConnectionActive(connectionId)) throw new CorpusError('connection_inactive', 403);
    return files;
  }

  async readFile(connectionId: string, fileId: string) {
    const secret = this.contentCredential(connectionId);
    if (!this.#provider.readFile) throw new CorpusError('drive_content_not_supported', 503);
    const file = await this.#provider.readFile(secret.refreshToken, fileId);
    if (!this.isConnectionActive(connectionId)) throw new CorpusError('connection_inactive', 403);
    return file;
  }

  async transferFile(connectionId: string, fileId: string, sink: GoogleTransferSink) {
    const secret = this.contentCredential(connectionId);
    if (!this.#provider.transferFile) throw new CorpusError('drive_content_not_supported', 503);
    const file = await this.#provider.transferFile(secret.refreshToken, fileId, {
      begin: metadata => { if (!this.isConnectionActive(connectionId)) throw new CorpusError('connection_inactive', 403); return sink.begin(metadata); },
      write: (offset, bytes) => { if (!this.isConnectionActive(connectionId)) throw new CorpusError('connection_inactive', 403); return sink.write(offset, bytes); },
    });
    if (!this.isConnectionActive(connectionId)) throw new CorpusError('connection_inactive', 403);
    return file;
  }

  private contentCredential(connectionId: string) {
    if (!this.isConnectionActive(connectionId)) throw new CorpusError('connection_inactive', 403);
    const connection = this.#registry.getConnection(connectionId)!;
    try {
      const secret = this.#broker.read(connection.credentialHandle);
      if (!secret) throw new CorpusError('credential_unavailable', 403);
      return secret;
    }
    catch { throw new CorpusError('credential_unavailable', 403); }
  }

  revokeConnection(untrustedConnectionId: string): void {
    const connectionId = ConnectionIdSchema.parse(untrustedConnectionId);
    const connection = this.#registry.getConnection(connectionId);
    if (connection === null || connection.projectId !== this.#projectId || connection.state === "revoked") return;
    this.#registry.revokeConnection(connectionId);
    this.#broker.revoke(connection.credentialHandle);
  }

  readCurrentManifest(): IngestManifest {
    return this.#store.readCurrentManifest();
  }
}
