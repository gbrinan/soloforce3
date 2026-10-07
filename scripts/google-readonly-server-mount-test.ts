import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGoogleReadonlyServerRoutes } from "../src/server/google-readonly-server.js";
import type {
  AuthorizationTokens,
  GoogleIdentity,
  GoogleReadonlyProvider,
} from "../src/server/google-readonly-provider.js";

class ServerMountProvider implements GoogleReadonlyProvider {
  buildAuthorizationUrl(input: { readonly state: string; readonly codeVerifier: string }): string {
    return `https://provider.test/authorize?state=${input.state}&verifier=${input.codeVerifier}`;
  }

  async exchangeAuthorizationCode(): Promise<AuthorizationTokens> {
    return {
      accessToken: "server-access-token",
      refreshToken: "server-refresh-token",
      grantedScopes: ["openid", "email", "https://www.googleapis.com/auth/drive.readonly"],
    };
  }

  async fetchIdentity(): Promise<GoogleIdentity> {
    return {
      providerSubject: "server-provider-subject",
      displayEmail: "provider-account@example.test",
      emailVerified: true,
    };
  }

  async listMetadata(): Promise<readonly []> {
    return [];
  }
}

const runtimeRoot = mkdtempSync(join(tmpdir(), "soloforce-google-server-"));
const projectsDirectory = join(runtimeRoot, "projects");
const projectId = "education/client-alpha";
mkdirSync(join(projectsDirectory, "education", "client-alpha"), { recursive: true });
const connector = createGoogleReadonlyServerRoutes({
  resolveRemoteAddress: () => "127.0.0.1",
  env: {
    GOOGLE_DRIVE_CONNECTOR_CLIENT_ID: "connector-client-id",
    GOOGLE_DRIVE_CONNECTOR_CLIENT_SECRET: "connector-client-secret",
    GOOGLE_DRIVE_CONNECTOR_CALLBACK_URL: "http://localhost/api/connections/google-drive/oauth/callback",
    GOOGLE_DRIVE_CONNECTOR_PROJECT_ID: projectId,
    SOLOFORCE_CONNECTION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  },
  storage: {
    historyDirectory: join(runtimeRoot, "history"),
    projectsDirectory,
  },
  provider: new ServerMountProvider(),
});

try {
  // Given: a complete connector configuration and an existing selected project.
  assert.equal((await connector.request("http://localhost/status")).status, 200);

  // When: a local owner starts OAuth without or with a same-origin browser proof.
  assert.equal((await connector.request("http://localhost/oauth/start", { method: "POST" })).status, 403);
  const startResponse = await connector.request("http://localhost/oauth/start", {
    method: "POST",
    headers: { origin: "http://localhost" },
  });

  // Then: the stored one-time transaction authorizes callback without trusting a caller header.
  assert.equal(startResponse.status, 200);
  const startBody: unknown = await startResponse.json();
  if (typeof startBody !== "object" || startBody === null || !("authorizationUrl" in startBody)) {
    throw new TypeError("Expected server authorization URL");
  }
  const authorizationUrl = startBody.authorizationUrl;
  if (typeof authorizationUrl !== "string") throw new TypeError("Expected server authorization URL string");
  const state = new URL(authorizationUrl).searchParams.get("state");
  if (state === null) throw new TypeError("Expected server OAuth state");
  const callbackResponse = await connector.request(`http://localhost/oauth/callback?state=${state}&code=server-code`);
  assert.equal(callbackResponse.status, 201);
  const callbackBody: unknown = await callbackResponse.json();
  if (typeof callbackBody !== "object" || callbackBody === null || !("connection" in callbackBody)) {
    throw new TypeError("Expected server connection response");
  }
  const connection = callbackBody.connection;
  if (typeof connection !== "object" || connection === null || !("connectionId" in connection)) {
    throw new TypeError("Expected server connection ID");
  }
  const connectionId = connection.connectionId;
  if (typeof connectionId !== "string") throw new TypeError("Expected server connection ID string");
  assert.equal((await connector.request(`http://localhost/oauth/callback?state=${state}&code=server-code`)).status, 400);
  const wrongKeyConnector = createGoogleReadonlyServerRoutes({
  resolveRemoteAddress: () => "127.0.0.1",
    env: {
      GOOGLE_DRIVE_CONNECTOR_CLIENT_ID: "connector-client-id",
      GOOGLE_DRIVE_CONNECTOR_CLIENT_SECRET: "connector-client-secret",
      GOOGLE_DRIVE_CONNECTOR_CALLBACK_URL: "http://localhost/api/connections/google-drive/oauth/callback",
      GOOGLE_DRIVE_CONNECTOR_PROJECT_ID: projectId,
      SOLOFORCE_CONNECTION_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64"),
    },
    storage: { historyDirectory: join(runtimeRoot, "history"), projectsDirectory },
    provider: new ServerMountProvider(),
  });
  const wrongKeyResponse = await wrongKeyConnector.request(`http://localhost/${connectionId}/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify({ operationId: "wrong-key-operation", targetPath: "education/wrong-key.json" }),
  });
  assert.equal(wrongKeyResponse.status, 403);
  assert.deepEqual(await wrongKeyResponse.json(), { kind: "denied", reason: "credential_unavailable" });
  assert.equal((await connector.request(`http://localhost/${connectionId}/revoke`, { method: "POST" })).status, 403);
  assert.equal((await connector.request(`http://localhost/${connectionId}/revoke`, {
    method: "POST",
    headers: { origin: "http://localhost" },
  })).status, 204);

  // Given: the same configured project is exposed on a non-loopback origin without SSO.
  const externalConnector = createGoogleReadonlyServerRoutes({
  resolveRemoteAddress: () => "127.0.0.1",
    env: {
      GOOGLE_DRIVE_CONNECTOR_CLIENT_ID: "connector-client-id",
      GOOGLE_DRIVE_CONNECTOR_CLIENT_SECRET: "connector-client-secret",
      GOOGLE_DRIVE_CONNECTOR_CALLBACK_URL: "https://solo.example.test/api/connections/google-drive/oauth/callback",
      GOOGLE_DRIVE_CONNECTOR_PROJECT_ID: projectId,
      SOLOFORCE_CONNECTION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    },
    storage: { historyDirectory: join(runtimeRoot, "history"), projectsDirectory },
    provider: new ServerMountProvider(),
  });

  // When: an unauthenticated browser sends a same-origin start request.
  const externalStart = await externalConnector.request("https://solo.example.test/oauth/start", {
    method: "POST",
    headers: { origin: "https://solo.example.test" },
  });

  // Then: same-origin alone cannot become owner authority outside loopback.
  assert.equal(externalStart.status, 401);
} finally {
  rmSync(runtimeRoot, { recursive: true, force: true });
}

console.log("google read-only real server mount: PASS");
process.exit(0);
