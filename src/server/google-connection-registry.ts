import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ConnectionIdSchema } from "./reversible-ingest-schema.js";
import { atomicWriteFileSync } from "./utils/atomic-write.js";
import {
  GoogleConnectionSchema,
  OAuthStateSchema,
  OAuthTransactionSchema,
  ActiveOAuthTransactionSchema,
  type ActiveOAuthTransaction,
  type GoogleConnection,
  type OAuthState,
} from "./google-readonly-schema.js";

type RegistryOptions = {
  readonly projectRoot: string;
  readonly now?: () => string;
};

export type TransactionResult =
  | { readonly kind: "consumed"; readonly transaction: ActiveOAuthTransaction }
  | { readonly kind: "denied"; readonly reason: "invalid_oauth_transaction" };

export class GoogleConnectionRegistry {
  readonly #root: string;
  readonly #now: () => string;

  constructor(options: RegistryOptions) {
    this.#root = join(options.projectRoot, ".connections");
    this.#now = options.now ?? (() => new Date().toISOString());
    mkdirSync(this.#transactionDirectory(), { recursive: true });
    mkdirSync(this.#connectionDirectory(), { recursive: true });
  }

  createTransaction(untrustedTransaction: ActiveOAuthTransaction): void {
    const transaction = ActiveOAuthTransactionSchema.parse(untrustedTransaction);
    const path = this.#transactionPath(transaction.state);
    if (existsSync(path)) throw new TypeError("OAuth transaction state already exists");
    atomicWriteFileSync(path, serialize(transaction));
  }

  consumeTransaction(untrustedState: string): TransactionResult {
    const parsedState = OAuthStateSchema.safeParse(untrustedState);
    if (!parsedState.success) return { kind: "denied", reason: "invalid_oauth_transaction" };
    const transaction = this.#readTransaction(parsedState.data);
    if (transaction === null) return { kind: "denied", reason: "invalid_oauth_transaction" };
    if (transaction.status !== "active" || Date.parse(transaction.expiresAt) <= Date.parse(this.#now())) {
      return { kind: "denied", reason: "invalid_oauth_transaction" };
    }
    const consumed = OAuthTransactionSchema.parse({
      ...transaction,
      codeVerifier: null,
      status: "used",
      usedAt: this.#now(),
    });
    atomicWriteFileSync(this.#transactionPath(parsedState.data), serialize(consumed));
    return { kind: "consumed", transaction };
  }

  hasActiveTransaction(untrustedState: string): boolean {
    const parsedState = OAuthStateSchema.safeParse(untrustedState);
    if (!parsedState.success) return false;
    const transaction = this.#readTransaction(parsedState.data);
    return transaction?.status === "active"
      && Date.parse(transaction.expiresAt) > Date.parse(this.#now());
  }

  saveConnection(untrustedConnection: GoogleConnection): void {
    const connection = GoogleConnectionSchema.parse(untrustedConnection);
    const path = this.#connectionPath(connection.connectionId);
    if (existsSync(path)) throw new TypeError("Google connection already exists");
    atomicWriteFileSync(path, serialize(connection));
  }

  getConnection(untrustedConnectionId: string): GoogleConnection | null {
    const parsedId = ConnectionIdSchema.safeParse(untrustedConnectionId);
    if (!parsedId.success) return null;
    const path = this.#connectionPath(parsedId.data);
    return existsSync(path) ? GoogleConnectionSchema.parse(readJson(path)) : null;
  }

  listConnections(): GoogleConnection[] {
    return readdirSync(this.#connectionDirectory()).filter(name => name.endsWith('.json'))
      .flatMap(name => { const connection = this.getConnection(name.slice(0, -5)); return connection ? [connection] : []; });
  }

  revokeConnection(untrustedConnectionId: string): GoogleConnection | null {
    const connection = this.getConnection(untrustedConnectionId);
    if (connection === null) return null;
    if (connection.state === "revoked") return connection;
    const revoked = GoogleConnectionSchema.parse({
      ...connection,
      state: "revoked",
      revokedAt: this.#now(),
    });
    atomicWriteFileSync(this.#connectionPath(revoked.connectionId), serialize(revoked));
    return revoked;
  }

  #transactionDirectory(): string { return join(this.#root, "transactions"); }
  #connectionDirectory(): string { return join(this.#root, "records"); }
  #transactionPath(state: OAuthState): string { return join(this.#transactionDirectory(), `${state}.json`); }
  #connectionPath(connectionId: ReturnType<typeof ConnectionIdSchema.parse>): string {
    return join(this.#connectionDirectory(), `${connectionId}.json`);
  }
  #readTransaction(state: OAuthState): ReturnType<typeof OAuthTransactionSchema.parse> | null {
    const path = this.#transactionPath(state);
    return existsSync(path) ? OAuthTransactionSchema.parse(readJson(path)) : null;
  }
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readJson(path: string): unknown {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  return parsed;
}
