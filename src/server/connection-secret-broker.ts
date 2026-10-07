import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFileSync } from "./utils/atomic-write.js";
import {
  ConnectionSecretSchema,
  CredentialHandleSchema,
  EncryptedSecretRecordSchema,
  type ConnectionSecret,
  type CredentialHandle,
} from "./google-readonly-schema.js";

type BrokerOptions = {
  readonly rootDirectory: string;
  readonly encryptionKey: Uint8Array;
};

export interface ConnectionSecretBroker {
  store(secret: ConnectionSecret): CredentialHandle;
  read(handle: CredentialHandle): ConnectionSecret | null;
  revoke(handle: CredentialHandle): void;
}

export class ConnectionSecretError extends Error {
  readonly name = "ConnectionSecretError";

  constructor(readonly reason: "invalid_key" | "secret_missing" | "secret_unreadable", options?: ErrorOptions) {
    super(`Connection secret broker failure: ${reason}`, options);
  }
}

export class EncryptedConnectionSecretBroker implements ConnectionSecretBroker {
  readonly #rootDirectory: string;
  readonly #key: Buffer;

  constructor(options: BrokerOptions) {
    if (options.encryptionKey.byteLength !== 32) throw new ConnectionSecretError("invalid_key");
    this.#rootDirectory = options.rootDirectory;
    this.#key = Buffer.from(options.encryptionKey);
    mkdirSync(this.#rootDirectory, { recursive: true });
  }

  store(untrustedSecret: ConnectionSecret): CredentialHandle {
    const secret = ConnectionSecretSchema.parse(untrustedSecret);
    const handle = CredentialHandleSchema.parse(randomUUID());
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(secret), "utf8"),
      cipher.final(),
    ]);
    const record = EncryptedSecretRecordSchema.parse({
      version: 1,
      iv: iv.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    });
    const path = this.#secretPath(handle);
    atomicWriteFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
    chmodSync(path, 0o600);
    return handle;
  }

  read(handle: CredentialHandle): ConnectionSecret | null {
    if (existsSync(this.#revokedPath(handle))) return null;
    const path = this.#secretPath(handle);
    if (!existsSync(path)) throw new ConnectionSecretError("secret_missing");
    try {
      const untrusted: unknown = JSON.parse(readFileSync(path, "utf8"));
      const record = EncryptedSecretRecordSchema.parse(untrusted);
      const decipher = createDecipheriv("aes-256-gcm", this.#key, Buffer.from(record.iv, "base64"));
      decipher.setAuthTag(Buffer.from(record.authTag, "base64"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(record.ciphertext, "base64")),
        decipher.final(),
      ]).toString("utf8");
      const parsed: unknown = JSON.parse(plaintext);
      return ConnectionSecretSchema.parse(parsed);
    } catch (error) {
      if (error instanceof ConnectionSecretError) throw error;
      throw new ConnectionSecretError("secret_unreadable", { cause: error });
    }
  }

  revoke(handle: CredentialHandle): void {
    atomicWriteFileSync(this.#revokedPath(handle), `${JSON.stringify({ revoked: true })}\n`);
    const path = this.#secretPath(handle);
    if (existsSync(path)) rmSync(path);
  }

  #secretPath(handle: CredentialHandle): string {
    return join(this.#rootDirectory, `${handle}.json`);
  }

  #revokedPath(handle: CredentialHandle): string {
    return join(this.#rootDirectory, `${handle}.revoked.json`);
  }
}
