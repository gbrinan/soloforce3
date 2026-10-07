import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { EncryptedConnectionSecretBroker } from "../src/server/connection-secret-broker.js";
import { GoogleConnectionRegistry } from "../src/server/google-connection-registry.js";
import { GoogleReadonlyHttpProvider } from "../src/server/google-readonly-provider.js";
import { OAuthTransactionSchema } from "../src/server/google-readonly-schema.js";
import { GoogleReadonlyConnectionService } from "../src/server/google-readonly-service.js";

const REQUIRED_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const projectRoot = mkdtempSync(join(tmpdir(), "soloforce-google-readonly-"));
const providerApp = new Hono();
let currentTime = "2026-08-24T04:00:00.000Z";

const profiles = {
  "access-different": { sub: "google-sub-different", email: "drive@example.test", email_verified: true },
  "access-same": { sub: "google-sub-same", email: "same@example.test", email_verified: true },
  "access-fail": { sub: "google-sub-fail", email: "failure@example.test", email_verified: true },
  "access-unverified": { sub: "google-sub-unverified", email: "unverified@example.test", email_verified: false },
} as const;

providerApp.post("/token", async (c) => {
  const body = await c.req.parseBody();
  const grantType = body.grant_type;
  if (grantType === "refresh_token") {
    const refreshToken = body.refresh_token;
    if (typeof refreshToken !== "string") return c.json({ error: "invalid_grant" }, 400);
    return c.json({ access_token: refreshToken.replace("refresh-", "access-"), token_type: "Bearer", expires_in: 3600 });
  }
  const code = body.code;
  if (typeof code !== "string" || !code.startsWith("code-")) return c.json({ error: "invalid_grant" }, 400);
  const alias = code.slice("code-".length);
  const scope = alias === "missing-scope" ? "openid email" : `openid email ${REQUIRED_SCOPE}`;
  return c.json({
    access_token: `access-${alias}`,
    refresh_token: `refresh-${alias}`,
    token_type: "Bearer",
    expires_in: 3600,
    scope,
  });
});

providerApp.get("/userinfo", (c) => {
  const accessToken = c.req.header("authorization")?.replace("Bearer ", "") ?? "";
  const profile = accessToken === "access-different" ? profiles["access-different"]
    : accessToken === "access-same" ? profiles["access-same"]
    : accessToken === "access-fail" ? profiles["access-fail"]
    : accessToken === "access-unverified" ? profiles["access-unverified"]
    : undefined;
  return profile === undefined ? c.json({ error: "invalid_token" }, 401) : c.json(profile);
});

providerApp.get("/drive/files", (c) => {
  const accessToken = c.req.header("authorization")?.replace("Bearer ", "") ?? "";
  if (accessToken === "access-fail") return c.json({ error: { code: 503 } }, 503);
  if (c.req.query("pageToken") === "page-2") {
    return c.json({
      files: [
        { id: "file-2", name: "Course B", mimeType: "application/vnd.google-apps.document", modifiedTime: "2026-08-24T02:00:00.000Z", parents: ["folder-1"] },
      ],
    });
  }
  return c.json({
    files: [
      { id: "folder-1", name: "Education", mimeType: "application/vnd.google-apps.folder", modifiedTime: "2026-08-24T00:00:00.000Z", parents: [] },
      { id: "file-1", name: "Course A", mimeType: "application/vnd.google-apps.document", modifiedTime: "2026-08-24T01:00:00.000Z", parents: ["folder-1"] },
    ],
    nextPageToken: "page-2",
  });
});

const server = serve({ fetch: providerApp.fetch, port: 0 });
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
if (address === null || typeof address !== "object") throw new TypeError("Expected fake Google provider port");
const providerBaseUrl = `http://127.0.0.1:${address.port}`;

try {
  const registry = new GoogleConnectionRegistry({ projectRoot, now: () => currentTime });
  const broker = new EncryptedConnectionSecretBroker({
    rootDirectory: join(projectRoot, ".connections", "secrets"),
    encryptionKey: Buffer.alloc(32, 7),
  });
  const provider = new GoogleReadonlyHttpProvider({
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "http://127.0.0.1/callback",
    authorizationEndpoint: `${providerBaseUrl}/authorize`,
    tokenEndpoint: `${providerBaseUrl}/token`,
    userinfoEndpoint: `${providerBaseUrl}/userinfo`,
    driveFilesEndpoint: `${providerBaseUrl}/drive/files`,
  });
  const service = new GoogleReadonlyConnectionService({
    projectRoot,
    projectId: "project-alpha",
    registry,
    broker,
    provider,
    now: () => currentTime,
  });

  const differentStart = service.startConnection({ ownerPrincipalId: "owner-naver" });
  const differentUrl = new URL(differentStart.authorizationUrl);
  assert.equal(differentUrl.searchParams.get("scope")?.includes(REQUIRED_SCOPE), true);
  assert.equal(differentUrl.searchParams.get("access_type"), "offline");
  const differentState = differentUrl.searchParams.get("state");
  if (differentState === null) throw new TypeError("Expected OAuth state");
  const different = await service.completeConnection({ state: differentState, code: "code-different" });
  assert.equal(different.kind, "connected");
  if (different.kind !== "connected") throw new TypeError("Expected different-email connection");
  assert.equal(different.connection.providerSubject, "google-sub-different");
  assert.equal(different.connection.displayEmail, "drive@example.test");

  const sameStart = service.startConnection({ ownerPrincipalId: "owner-same" });
  const sameState = new URL(sameStart.authorizationUrl).searchParams.get("state");
  if (sameState === null) throw new TypeError("Expected same-email OAuth state");
  const same = await service.completeConnection({ state: sameState, code: "code-same" });
  assert.equal(same.kind, "connected");
  if (same.kind !== "connected") throw new TypeError("Expected same-email connection");
  assert.equal(same.connection.providerSubject, "google-sub-same");
  assert.notEqual(same.connection.connectionId, different.connection.connectionId);

  assert.deepEqual(await service.completeConnection({ state: sameState, code: "code-same" }), {
    kind: "denied",
    reason: "invalid_oauth_transaction",
  });

  const missingScopeStart = service.startConnection({ ownerPrincipalId: "owner-naver" });
  const missingScopeState = new URL(missingScopeStart.authorizationUrl).searchParams.get("state");
  if (missingScopeState === null) throw new TypeError("Expected missing-scope OAuth state");
  assert.deepEqual(await service.completeConnection({ state: missingScopeState, code: "code-missing-scope" }), {
    kind: "denied",
    reason: "required_scope_missing",
  });

  const unverifiedStart = service.startConnection({ ownerPrincipalId: "owner-naver" });
  const unverifiedState = new URL(unverifiedStart.authorizationUrl).searchParams.get("state");
  if (unverifiedState === null) throw new TypeError("Expected unverified OAuth state");
  const secretCountBeforeUnverified = readdirSync(join(projectRoot, ".connections", "secrets")).length;
  assert.deepEqual(await service.completeConnection({ state: unverifiedState, code: "code-unverified" }), {
    kind: "denied",
    reason: "email_unverified",
  });
  assert.equal(readdirSync(join(projectRoot, ".connections", "secrets")).length, secretCountBeforeUnverified);

  const successIngest = await service.ingestMetadata({
    connectionId: different.connection.connectionId,
    operationId: "operation-google-success",
    targetPath: "education/google-drive-metadata.json",
  });
  assert.equal(successIngest.kind, "committed");
  assert.equal(service.readCurrentManifest().connectionId, different.connection.connectionId);
  currentTime = "2026-08-24T05:00:00.000Z";
  assert.equal((await service.ingestMetadata({
    connectionId: different.connection.connectionId,
    operationId: "operation-google-success",
    targetPath: "education/google-drive-metadata.json",
  })).kind, "committed");

  const failureStart = service.startConnection({ ownerPrincipalId: "owner-naver" });
  const failureState = new URL(failureStart.authorizationUrl).searchParams.get("state");
  if (failureState === null) throw new TypeError("Expected failure OAuth state");
  const failureConnection = await service.completeConnection({ state: failureState, code: "code-fail" });
  if (failureConnection.kind !== "connected") throw new TypeError("Expected failure fixture connection");
  const revisionsBeforeFailure = readdirSync(join(projectRoot, ".ingest", "revisions")).length;
  assert.deepEqual(await service.ingestMetadata({
    connectionId: failureConnection.connection.connectionId,
    operationId: "operation-google-failure",
    targetPath: "projects/google-drive-metadata.json",
  }), { kind: "denied", reason: "provider_failure" });
  assert.equal(readdirSync(join(projectRoot, ".ingest", "revisions")).length, revisionsBeforeFailure);

  service.revokeConnection(different.connection.connectionId);
  assert.deepEqual(await service.ingestMetadata({
    connectionId: different.connection.connectionId,
    operationId: "operation-google-revoked",
    targetPath: "education/google-drive-metadata.json",
  }), { kind: "denied", reason: "connection_inactive" });
  assert.equal(readdirSync(join(projectRoot, ".ingest", "revisions")).length, revisionsBeforeFailure);

  const transactionDirectory = join(projectRoot, ".connections", "transactions");
  for (const name of readdirSync(transactionDirectory)) {
    const untrusted: unknown = JSON.parse(readFileSync(join(transactionDirectory, name), "utf8"));
    const transaction = OAuthTransactionSchema.parse(untrusted);
    if (transaction.status === "used") assert.equal(transaction.codeVerifier, null);
  }

  const persisted = readdirSync(join(projectRoot, ".connections", "secrets"))
    .map((name) => readFileSync(join(projectRoot, ".connections", "secrets", name), "utf8"))
    .join("\n");
  assert.equal(persisted.includes("refresh-different"), false);
  assert.equal(persisted.includes("access-different"), false);
  const revisionContent = readFileSync(join(projectRoot, ".ingest", "revisions", service.readCurrentManifest().revisionId ?? "", "content.md"), "utf8");
  assert.equal(revisionContent.includes("file-2"), true);
  assert.equal(revisionContent.includes("access-"), false);

  console.log("google read-only connection and reversible ingest: PASS");
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  rmSync(projectRoot, { recursive: true, force: true });
}
