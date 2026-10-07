import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReversibleIngestStore } from "../src/server/reversible-ingest.js";

const projectRoot = mkdtempSync(join(tmpdir(), "soloforce-reversible-ingest-"));
const fixedClock = (): string => "2026-08-24T03:00:00.000Z";

function eventCount(store: ReversibleIngestStore): number {
  return store.readJournal().length;
}

try {
  const store = new ReversibleIngestStore({
    projectRoot,
    projectId: "project-alpha",
    now: fixedClock,
  });
  const baseline = store.readCurrentManifest();
  assert.equal(baseline.operationId, null);

  const crashPrepared = store.prepare({
    operationId: "operation-crash",
    connectionId: "connection-drive",
    targetPath: "education/course-a/source.md",
    content: "immutable source A",
  });
  assert.equal(crashPrepared.kind, "prepared");
  assert.equal(store.readCurrentManifest().manifestId, baseline.manifestId);

  const restarted = new ReversibleIngestStore({
    projectRoot,
    projectId: "project-alpha",
    now: fixedClock,
  });
  assert.equal(restarted.readCurrentManifest().manifestId, baseline.manifestId);
  assert.equal(restarted.rollback("operation-crash").kind, "rolled_back");
  assert.equal(restarted.readCurrentManifest().manifestId, baseline.manifestId);

  const prepared = restarted.prepare({
    operationId: "operation-happy",
    connectionId: "connection-drive",
    targetPath: "education/course-a/source.md",
    content: "immutable source B",
  });
  assert.equal(prepared.kind, "prepared");
  const committed = restarted.commit("operation-happy");
  assert.equal(committed.kind, "committed");
  const active = restarted.readCurrentManifest();
  assert.equal(active.operationId, "operation-happy");
  assert.equal(active.connectionId, "connection-drive");
  assert.equal(active.previousManifestId, baseline.manifestId);
  const revisionPath = join(projectRoot, ".ingest", "revisions", active.revisionId ?? "", "content.md");
  assert.equal(readFileSync(revisionPath, "utf8"), "immutable source B");

  const beforeRetryEvents = eventCount(restarted);
  const beforeRetryRevisions = readdirSync(join(projectRoot, ".ingest", "revisions")).length;
  assert.equal(restarted.prepare({
    operationId: "operation-happy",
    connectionId: "connection-drive",
    targetPath: "education/course-a/source.md",
    content: "immutable source B",
  }).kind, "committed");
  assert.equal(restarted.commit("operation-happy").kind, "committed");
  assert.equal(eventCount(restarted), beforeRetryEvents);
  assert.equal(readdirSync(join(projectRoot, ".ingest", "revisions")).length, beforeRetryRevisions);

  assert.equal(restarted.rollback("operation-happy").kind, "rolled_back");
  assert.equal(restarted.readCurrentManifest().manifestId, baseline.manifestId);
  assert.equal(existsSync(revisionPath), true);
  const beforeSecondRollback = eventCount(restarted);
  assert.equal(restarted.rollback("operation-happy").kind, "rolled_back");
  assert.equal(eventCount(restarted), beforeSecondRollback);

  const pointerCrash = restarted.prepare({
    operationId: "operation-pointer-crash",
    connectionId: "connection-drive",
    targetPath: "education/course-a/source.md",
    content: "pointer crash source",
  });
  if (pointerCrash.kind !== "prepared") throw new TypeError("Expected pointer crash operation to prepare");
  writeFileSync(
    join(projectRoot, ".ingest", "current.json"),
    `${JSON.stringify({ version: 1, manifestId: pointerCrash.manifestId }, null, 2)}\n`,
    "utf8",
  );
  const pointerCrashRestart = new ReversibleIngestStore({
    projectRoot,
    projectId: "project-alpha",
    now: fixedClock,
  });
  assert.equal(pointerCrashRestart.commit("operation-pointer-crash").kind, "committed");
  assert.equal(pointerCrashRestart.rollback("operation-pointer-crash").kind, "rolled_back");
  assert.equal(pointerCrashRestart.readCurrentManifest().manifestId, baseline.manifestId);

  assert.equal(pointerCrashRestart.prepare({
    operationId: "operation-stale",
    connectionId: "connection-drive",
    targetPath: "consulting/client-a/source.md",
    content: "stale source",
  }).kind, "prepared");
  assert.equal(pointerCrashRestart.prepare({
    operationId: "operation-current",
    connectionId: "connection-notion",
    targetPath: "projects/internal/source.md",
    content: "current source",
  }).kind, "prepared");
  assert.equal(pointerCrashRestart.commit("operation-current").kind, "committed");
  const currentManifestId = pointerCrashRestart.readCurrentManifest().manifestId;
  const staleCommit = pointerCrashRestart.commit("operation-stale");
  assert.deepEqual(staleCommit, {
    kind: "conflict",
    reason: "base_changed",
    operationId: "operation-stale",
  });
  assert.equal(pointerCrashRestart.readCurrentManifest().manifestId, currentManifestId);

  const mismatchedRetry = pointerCrashRestart.prepare({
    operationId: "operation-current",
    connectionId: "connection-notion",
    targetPath: "projects/internal/source.md",
    content: "different content",
  });
  assert.deepEqual(mismatchedRetry, {
    kind: "conflict",
    reason: "operation_input_mismatch",
    operationId: "operation-current",
  });

  console.log("reversible ingest filesystem rehearsal: PASS");
} finally {
  rmSync(projectRoot, { recursive: true, force: true });
}
