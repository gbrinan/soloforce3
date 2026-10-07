import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { EncryptedConnectionSecretBroker } from "../src/server/connection-secret-broker.js";
import type { ConnectedIngestCredential } from "../src/server/connected-ingest-auth.js";
import { GoogleConnectionRegistry } from "../src/server/google-connection-registry.js";
import { createGoogleReadonlyRoutes } from "../src/server/google-readonly-routes.js";
import type {
  AuthorizationTokens,
  GoogleIdentity,
  GoogleReadonlyProvider,
} from "../src/server/google-readonly-provider.js";
import { GoogleReadonlyConnectionService } from "../src/server/google-readonly-service.js";

class RouteFixtureProvider implements GoogleReadonlyProvider {
  buildAuthorizationUrl(input: { readonly state: string; readonly codeVerifier: string }): string {
    return `https://provider.test/authorize?state=${input.state}&verifier=${input.codeVerifier}`;
  }

  async exchangeAuthorizationCode(): Promise<AuthorizationTokens> {
    return {
      accessToken: "route-access-token",
      refreshToken: "route-refresh-token",
      grantedScopes: ["openid", "email", "https://www.googleapis.com/auth/drive.readonly"],
    };
  }

  async fetchIdentity(): Promise<GoogleIdentity> {
    return { providerSubject: "route-google-sub", displayEmail: "route@example.test", emailVerified: true };
  }

  async listMetadata(): Promise<readonly []> {
    return [];
  }
}

function resolveCredential(c: Context): ConnectedIngestCredential {
  if (c.req.header("x-owner") === "valid") {
    return { kind: "owner", csrfValid: true, recentAuth: true };
  }
  if (c.req.header("x-oauth") === "active") {
    return { kind: "oauth_transaction", state: "active", provider: "google-drive" };
  }
  if (c.req.header("x-grant") === "wrong-project") {
    return {
      kind: "agent_grant",
      state: "active",
      capability: "ingest.run",
      resource: {
        projectId: { value: "project-other" },
        connectionId: { value: c.req.param("connectionId") },
      },
    };
  }
  return { kind: "none" };
}

const projectRoot = mkdtempSync(join(tmpdir(), "soloforce-google-routes-"));
const registry = new GoogleConnectionRegistry({ projectRoot });
const service = new GoogleReadonlyConnectionService({
  projectRoot,
  projectId: "project-alpha",
  registry,
  broker: new EncryptedConnectionSecretBroker({
    rootDirectory: join(projectRoot, ".connections", "secrets"),
    encryptionKey: Buffer.alloc(32, 9),
  }),
  provider: new RouteFixtureProvider(),
});
const app = new Hono();
app.route("/api/connections/google-drive", createGoogleReadonlyRoutes({
  projectId: "project-alpha",
  service,
  resolveCredential,
  resolveOwnerPrincipalId: (c) => c.req.header("x-owner-principal") ?? null,
}));
const server = serve({ fetch: app.fetch, port: 0 });
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
if (address === null || typeof address !== "object") throw new TypeError("Expected connector API port");
const baseUrl = `http://127.0.0.1:${address.port}/api/connections/google-drive`;

try {
  assert.equal((await fetch(`${baseUrl}/oauth/start`, { method: "POST" })).status, 401);
  const startResponse = await fetch(`${baseUrl}/oauth/start`, {
    method: "POST",
    headers: { "x-owner": "valid", "x-owner-principal": "owner-route" },
  });
  assert.equal(startResponse.status, 200);
  const startBody: unknown = await startResponse.json();
  if (typeof startBody !== "object" || startBody === null || !("authorizationUrl" in startBody)) {
    throw new TypeError("Expected authorization URL response");
  }
  const authorizationUrl = startBody.authorizationUrl;
  if (typeof authorizationUrl !== "string") throw new TypeError("Expected authorization URL string");
  const state = new URL(authorizationUrl).searchParams.get("state");
  if (state === null) throw new TypeError("Expected route OAuth state");

  assert.equal((await fetch(`${baseUrl}/oauth/callback?state=${state}&code=route-code`)).status, 400);
  const callbackResponse = await fetch(`${baseUrl}/oauth/callback?state=${state}&code=route-code`, {
    headers: { "x-oauth": "active" },
  });
  assert.equal(callbackResponse.status, 201);
  const callbackBody: unknown = await callbackResponse.json();
  if (typeof callbackBody !== "object" || callbackBody === null || !("connection" in callbackBody)) {
    throw new TypeError("Expected connection response");
  }
  const connection = callbackBody.connection;
  if (typeof connection !== "object" || connection === null || !("connectionId" in connection)) {
    throw new TypeError("Expected connection ID");
  }
  const connectionId = connection.connectionId;
  if (typeof connectionId !== "string") throw new TypeError("Expected connection ID string");
  assert.equal((await fetch(`${baseUrl}/oauth/callback?state=${state}&code=route-code`, {
    headers: { "x-oauth": "active" },
  })).status, 400);

  const ingestBody = JSON.stringify({ operationId: "operation-route", targetPath: "education/route.json" });
  assert.equal((await fetch(`${baseUrl}/${connectionId}/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-grant": "wrong-project" },
    body: ingestBody,
  })).status, 403);
  assert.equal((await fetch(`${baseUrl}/${connectionId}/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-owner": "valid" },
    body: ingestBody,
  })).status, 200);

  console.log("google read-only HTTP authorization matrix: PASS");
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  rmSync(projectRoot, { recursive: true, force: true });
}
