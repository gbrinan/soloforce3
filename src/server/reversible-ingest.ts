import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { atomicWriteFileSync } from "./utils/atomic-write.js";
import {
  JournalEventSchema,
  ManifestIdSchema,
  ManifestSchema,
  OperationIdSchema,
  PointerSchema,
  PreparedJournalEventSchema,
  PrepareIngestInputSchema,
  ProjectIdSchema,
  RevisionIdSchema,
  type IngestManifest,
  type JournalEvent,
  type ManifestId,
  type OperationId,
  type OperationResult,
  type PreparedJournalEvent,
  type PrepareIngestInput,
} from "./reversible-ingest-schema.js";

type StoreOptions = {
  readonly projectRoot: string;
  readonly projectId: string;
  readonly now?: () => string;
};

type OperationState = {
  readonly prepared: PreparedJournalEvent;
  readonly state: JournalEvent["kind"];
};

export class ReversibleIngestStore {
  readonly #root: string;
  readonly #projectId: ReturnType<typeof ProjectIdSchema.parse>;
  readonly #now: () => string;

  constructor(options: StoreOptions) {
    this.#root = join(options.projectRoot, ".ingest");
    this.#projectId = ProjectIdSchema.parse(options.projectId);
    this.#now = options.now ?? (() => new Date().toISOString());
    mkdirSync(this.#journalDirectory(), { recursive: true });
    mkdirSync(this.#manifestDirectory(), { recursive: true });
    mkdirSync(this.#revisionDirectory(), { recursive: true });
    this.#initializeBaseline();
  }

  prepare(untrustedInput: PrepareIngestInput): OperationResult {
    const input = PrepareIngestInputSchema.parse(untrustedInput);
    const existing = this.#operationState(input.operationId);
    if (existing !== null) {
      const manifest = this.#readManifest(existing.prepared.manifestId);
      if (!this.#inputMatches(manifest, input)) {
        return this.#conflict(input.operationId, "operation_input_mismatch");
      }
      return this.#stateResult(existing.state, existing.prepared);
    }

    const current = this.readCurrentManifest();
    const contentHash = hash(input.content);
    const revisionId = RevisionIdSchema.parse(hash(`revision\0${contentHash}`));
    const manifestId = ManifestIdSchema.parse(hash([
      "manifest",
      input.operationId,
      this.#projectId,
      input.connectionId,
      input.targetPath,
      contentHash,
      current.manifestId,
    ].join("\0")));
    const manifest = ManifestSchema.parse({
      version: 1,
      manifestId,
      previousManifestId: current.manifestId,
      operationId: input.operationId,
      projectId: this.#projectId,
      connectionId: input.connectionId,
      revisionId,
      contentHash,
      targetPath: input.targetPath,
    });
    this.#writeImmutable(join(this.#revisionDirectory(), revisionId, "content.md"), input.content);
    this.#writeImmutable(this.#manifestPath(manifestId), serialize(manifest));
    const event = PreparedJournalEventSchema.parse({
      kind: "prepared",
      operationId: input.operationId,
      manifestId,
      recordedAt: this.#now(),
    });
    this.#appendEvent(event);
    return this.#stateResult("prepared", event);
  }

  commit(untrustedOperationId: string): OperationResult {
    const operationId = OperationIdSchema.parse(untrustedOperationId);
    const operation = this.#operationState(operationId);
    if (operation === null) return this.#conflict(operationId, "not_found");
    if (operation.state !== "prepared") return this.#stateResult(operation.state, operation.prepared);

    const manifest = this.#readManifest(operation.prepared.manifestId);
    const current = this.readCurrentManifest();
    if (current.manifestId !== manifest.manifestId) {
      if (current.manifestId !== manifest.previousManifestId) {
        return this.#conflict(operationId, "base_changed");
      }
      this.#writePointer(manifest.manifestId);
    }
    this.#appendTransition("committed", operation.prepared);
    return this.#stateResult("committed", operation.prepared);
  }

  rollback(untrustedOperationId: string): OperationResult {
    const operationId = OperationIdSchema.parse(untrustedOperationId);
    const operation = this.#operationState(operationId);
    if (operation === null) return this.#conflict(operationId, "not_found");
    if (operation.state === "rolled_back") return this.#stateResult("rolled_back", operation.prepared);

    const manifest = this.#readManifest(operation.prepared.manifestId);
    const current = this.readCurrentManifest();
    if (current.manifestId === manifest.manifestId) {
      const previousManifestId = manifest.previousManifestId;
      if (previousManifestId === null) return this.#conflict(operationId, "base_changed");
      this.#writePointer(previousManifestId);
    } else if (operation.state === "committed" && current.manifestId !== manifest.previousManifestId) {
      return this.#conflict(operationId, "base_changed");
    }
    this.#appendTransition("rolled_back", operation.prepared);
    return this.#stateResult("rolled_back", operation.prepared);
  }

  readCurrentManifest(): IngestManifest {
    const pointer = PointerSchema.parse(readJson(this.#pointerPath()));
    const manifest = this.#readManifest(pointer.manifestId);
    if (manifest.projectId !== this.#projectId) throw new TypeError("Current manifest belongs to another project");
    return manifest;
  }

  readJournal(): readonly JournalEvent[] {
    return readdirSync(this.#journalDirectory())
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => JournalEventSchema.parse(readJson(join(this.#journalDirectory(), name))));
  }

  #initializeBaseline(): void {
    if (existsSync(this.#pointerPath())) {
      this.readCurrentManifest();
      return;
    }
    const manifestId = ManifestIdSchema.parse(hash(`baseline\0${this.#projectId}`));
    const baseline = ManifestSchema.parse({
      version: 1,
      manifestId,
      previousManifestId: null,
      operationId: null,
      projectId: this.#projectId,
      connectionId: null,
      revisionId: null,
      contentHash: null,
      targetPath: null,
    });
    this.#writeImmutable(this.#manifestPath(manifestId), serialize(baseline));
    this.#writePointer(manifestId);
  }

  #operationState(operationId: OperationId): OperationState | null {
    const events = this.readJournal().filter((event) => event.operationId === operationId);
    const prepared = events.find((event): event is PreparedJournalEvent => event.kind === "prepared");
    if (prepared === undefined) return null;
    if (events.some((event) => event.kind === "rolled_back")) return { prepared, state: "rolled_back" };
    if (events.some((event) => event.kind === "committed")) return { prepared, state: "committed" };
    return { prepared, state: "prepared" };
  }

  #inputMatches(manifest: IngestManifest, input: ReturnType<typeof PrepareIngestInputSchema.parse>): boolean {
    return manifest.connectionId === input.connectionId
      && manifest.targetPath === input.targetPath
      && manifest.contentHash === hash(input.content);
  }

  #readManifest(manifestId: ManifestId): IngestManifest {
    return ManifestSchema.parse(readJson(this.#manifestPath(manifestId)));
  }

  #writePointer(manifestId: ManifestId): void {
    const pointer = PointerSchema.parse({ version: 1, manifestId });
    atomicWriteFileSync(this.#pointerPath(), serialize(pointer));
  }

  #appendTransition(kind: "committed" | "rolled_back", prepared: PreparedJournalEvent): void {
    this.#appendEvent(JournalEventSchema.parse({
      kind,
      operationId: prepared.operationId,
      manifestId: prepared.manifestId,
      recordedAt: this.#now(),
    }));
  }

  #appendEvent(event: JournalEvent): void {
    const eventId = hash([event.kind, event.operationId, event.manifestId].join("\0"));
    this.#writeImmutable(join(this.#journalDirectory(), `${eventId}.json`), serialize(event));
  }

  #writeImmutable(path: string, content: string): void {
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) {
      if (readFileSync(path, "utf8") !== content) throw new TypeError(`Immutable artifact conflict: ${path}`);
      return;
    }
    atomicWriteFileSync(path, content);
  }

  #stateResult(kind: JournalEvent["kind"], prepared: PreparedJournalEvent): OperationResult {
    return { kind, operationId: prepared.operationId, manifestId: prepared.manifestId };
  }

  #conflict(operationId: OperationId, reason: "operation_input_mismatch" | "base_changed" | "not_found"): OperationResult {
    return { kind: "conflict", reason, operationId };
  }

  #manifestDirectory(): string { return join(this.#root, "manifests"); }
  #revisionDirectory(): string { return join(this.#root, "revisions"); }
  #journalDirectory(): string { return join(this.#root, "journal"); }
  #manifestPath(manifestId: ManifestId): string { return join(this.#manifestDirectory(), `${manifestId}.json`); }
  #pointerPath(): string { return join(this.#root, "current.json"); }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readJson(path: string): unknown {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  return parsed;
}
