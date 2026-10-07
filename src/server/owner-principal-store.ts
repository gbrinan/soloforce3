import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { OwnerPrincipalIdSchema, type OwnerPrincipalId } from "./google-readonly-schema.js";
import { atomicWriteFileSync } from "./utils/atomic-write.js";

const OwnerPrincipalRecordSchema = z.object({
  version: z.literal(1),
  ownerPrincipalId: OwnerPrincipalIdSchema,
  createdAt: z.string().datetime(),
}).strict();

type OwnerPrincipalStoreOptions = {
  readonly historyDirectory: string;
  readonly now?: () => string;
};

export class OwnerPrincipalStore {
  readonly #path: string;
  readonly #now: () => string;

  constructor(options: OwnerPrincipalStoreOptions) {
    const directory = join(options.historyDirectory, "connected-ingest");
    mkdirSync(directory, { recursive: true });
    this.#path = join(directory, "owner-principal.json");
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  getOrCreate(): OwnerPrincipalId {
    if (existsSync(this.#path)) {
      const untrusted: unknown = JSON.parse(readFileSync(this.#path, "utf8"));
      return OwnerPrincipalRecordSchema.parse(untrusted).ownerPrincipalId;
    }
    const record = OwnerPrincipalRecordSchema.parse({
      version: 1,
      ownerPrincipalId: randomUUID(),
      createdAt: this.#now(),
    });
    atomicWriteFileSync(this.#path, `${JSON.stringify(record, null, 2)}\n`);
    return record.ownerPrincipalId;
  }
}
