import { strict as assert } from "node:assert";
import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import {
  connectedIngestAuth,
  type ConnectedIngestCredential,
  type ConnectedIngestPolicy,
  type ConnectionResource,
} from "../src/server/connected-ingest-auth.js";

const RESOURCE: ConnectionResource = {
  projectId: { value: "project-alpha" },
  connectionId: { value: "connection-drive" },
};

const POLICIES = {
  ownerMutation: { kind: "owner_mutation" },
  ownerRead: { kind: "owner_read" },
  oauthCallback: { kind: "oauth_callback", provider: "google-drive" },
  ingest: { kind: "agent_or_owner", capability: "ingest.run", resource: RESOURCE },
  status: { kind: "agent_or_owner", capability: "ingest.read_status", resource: RESOURCE },
} as const satisfies Record<string, ConnectedIngestPolicy>;

type ProbeCase = {
  readonly name: string;
  readonly method: "GET" | "POST" | "DELETE";
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly expectedStatus: number;
  readonly expectedCode?: string;
  readonly expectedHandlerHits: number;
};

const GRANT_CREDENTIALS: Readonly<Record<string, ConnectedIngestCredential>> = {
  "grant-run": {
    kind: "agent_grant",
    state: "active",
    capability: "ingest.run",
    resource: RESOURCE,
  },
  "grant-status": {
    kind: "agent_grant",
    state: "active",
    capability: "ingest.read_status",
    resource: RESOURCE,
  },
  "grant-wrong-project": {
    kind: "agent_grant",
    state: "active",
    capability: "ingest.run",
    resource: { projectId: { value: "project-beta" }, connectionId: RESOURCE.connectionId },
  },
  "grant-wrong-connection": {
    kind: "agent_grant",
    state: "active",
    capability: "ingest.run",
    resource: { projectId: RESOURCE.projectId, connectionId: { value: "connection-notion" } },
  },
  "grant-revoke": {
    kind: "agent_grant",
    state: "active",
    capability: "connection.revoke",
    resource: RESOURCE,
  },
  "grant-expired": {
    kind: "agent_grant",
    state: "expired",
    capability: "ingest.run",
    resource: RESOURCE,
  },
  "grant-revoked": {
    kind: "agent_grant",
    state: "revoked",
    capability: "ingest.run",
    resource: RESOURCE,
  },
};

function resolveCredential(c: Context, oauthTransactionConsumed: boolean): ConnectedIngestCredential {
  const owner = c.req.header("x-test-owner");
  const authorization = c.req.header("authorization");
  const oauth = c.req.header("x-test-oauth");
  const presented = [owner, authorization, oauth].filter((value) => value !== undefined);
  if (presented.length > 1) return { kind: "ambiguous" };

  if (owner !== undefined) {
    if (owner === "valid") return { kind: "owner", csrfValid: true, recentAuth: true };
    if (owner === "bad-csrf") return { kind: "owner", csrfValid: false, recentAuth: true };
    if (owner === "stale") return { kind: "owner", csrfValid: true, recentAuth: false };
    return { kind: "invalid" };
  }

  if (authorization !== undefined) {
    const prefix = "Bearer ";
    if (!authorization.startsWith(prefix)) return { kind: "invalid" };
    const alias = authorization.slice(prefix.length);
    return GRANT_CREDENTIALS[alias] ?? { kind: "invalid" };
  }

  if (oauth !== undefined) {
    if (oauth === "transaction") {
      return {
        kind: "oauth_transaction",
        state: oauthTransactionConsumed ? "used" : "active",
        provider: "google-drive",
      };
    }
    if (oauth === "expired") return { kind: "oauth_transaction", state: "expired", provider: "google-drive" };
    return { kind: "invalid" };
  }

  return { kind: "none" };
}

function createProbeApp(events: string[]): Hono {
  const app = new Hono();
  let oauthTransactionConsumed = false;
  app.use("*", async (_c, next) => {
    events.push("sso:next");
    await next();
  });

  const register = (
    method: "get" | "post" | "delete",
    path: string,
    policy: ConnectedIngestPolicy,
  ): void => {
    app[method](
      path,
      connectedIngestAuth({
        resolvePolicy: () => policy,
        resolveCredential: (context) => resolveCredential(context, oauthTransactionConsumed),
        onDecision: (decision) => events.push(`gate:${decision.kind}`),
      }),
      (c) => {
        if (policy.kind === "oauth_callback") oauthTransactionConsumed = true;
        events.push("handler");
        return c.json({ ok: true });
      },
    );
  };

  register("post", "/api/connections/oauth/google-drive/start", POLICIES.ownerMutation);
  register("get", "/api/connections/oauth/google-drive/callback", POLICIES.oauthCallback);
  register("get", "/api/connections", POLICIES.ownerRead);
  register("post", "/api/connections/connection-drive/ingest", POLICIES.ingest);
  register("get", "/api/connections/connection-drive/status", POLICIES.status);
  register("delete", "/api/connections/connection-drive", POLICIES.ownerMutation);
  register("post", "/api/connections/grant-requests/request-one/approve", POLICIES.ownerMutation);
  return app;
}

const CASES: readonly ProbeCase[] = [
  { name: "loopback origin alone is not authority", method: "GET", path: "/api/connections", expectedStatus: 401, expectedCode: "missing_credentials", expectedHandlerHits: 0 },
  { name: "owner lists connections", method: "GET", path: "/api/connections", headers: { "x-test-owner": "valid" }, expectedStatus: 200, expectedHandlerHits: 1 },
  { name: "owner starts OAuth with CSRF and recent auth", method: "POST", path: "/api/connections/oauth/google-drive/start", headers: { "x-test-owner": "valid" }, expectedStatus: 200, expectedHandlerHits: 1 },
  { name: "owner mutation rejects missing CSRF", method: "DELETE", path: "/api/connections/connection-drive", headers: { "x-test-owner": "bad-csrf" }, expectedStatus: 403, expectedCode: "csrf_required", expectedHandlerHits: 0 },
  { name: "owner mutation rejects stale auth", method: "POST", path: "/api/connections/grant-requests/request-one/approve", headers: { "x-test-owner": "stale" }, expectedStatus: 403, expectedCode: "recent_auth_required", expectedHandlerHits: 0 },
  { name: "exact grant runs ingest", method: "POST", path: "/api/connections/connection-drive/ingest", headers: { authorization: "Bearer grant-run" }, expectedStatus: 200, expectedHandlerHits: 1 },
  { name: "status needs its own capability", method: "GET", path: "/api/connections/connection-drive/status", headers: { authorization: "Bearer grant-run" }, expectedStatus: 403, expectedCode: "capability_forbidden", expectedHandlerHits: 0 },
  { name: "exact status grant reads status", method: "GET", path: "/api/connections/connection-drive/status", headers: { authorization: "Bearer grant-status" }, expectedStatus: 200, expectedHandlerHits: 1 },
  { name: "wrong project is forbidden", method: "POST", path: "/api/connections/connection-drive/ingest", headers: { authorization: "Bearer grant-wrong-project" }, expectedStatus: 403, expectedCode: "resource_forbidden", expectedHandlerHits: 0 },
  { name: "wrong connection is forbidden", method: "POST", path: "/api/connections/connection-drive/ingest", headers: { authorization: "Bearer grant-wrong-connection" }, expectedStatus: 403, expectedCode: "resource_forbidden", expectedHandlerHits: 0 },
  { name: "revoke capability cannot run ingest", method: "POST", path: "/api/connections/connection-drive/ingest", headers: { authorization: "Bearer grant-revoke" }, expectedStatus: 403, expectedCode: "capability_forbidden", expectedHandlerHits: 0 },
  { name: "expired grant is unauthenticated", method: "POST", path: "/api/connections/connection-drive/ingest", headers: { authorization: "Bearer grant-expired" }, expectedStatus: 401, expectedCode: "invalid_credentials", expectedHandlerHits: 0 },
  { name: "revoked grant is unauthenticated", method: "POST", path: "/api/connections/connection-drive/ingest", headers: { authorization: "Bearer grant-revoked" }, expectedStatus: 401, expectedCode: "invalid_credentials", expectedHandlerHits: 0 },
  { name: "grant cannot list connections", method: "GET", path: "/api/connections", headers: { authorization: "Bearer grant-run" }, expectedStatus: 403, expectedCode: "owner_required", expectedHandlerHits: 0 },
  { name: "malformed bearer is unauthenticated", method: "POST", path: "/api/connections/connection-drive/ingest", headers: { authorization: "Basic alias" }, expectedStatus: 401, expectedCode: "invalid_credentials", expectedHandlerHits: 0 },
  { name: "multiple credential kinds fail closed", method: "POST", path: "/api/connections/connection-drive/ingest", headers: { authorization: "Bearer grant-run", "x-test-owner": "valid" }, expectedStatus: 400, expectedCode: "ambiguous_credentials", expectedHandlerHits: 0 },
  { name: "active OAuth transaction reaches callback once", method: "GET", path: "/api/connections/oauth/google-drive/callback", headers: { "x-test-oauth": "transaction" }, expectedStatus: 200, expectedHandlerHits: 1 },
  { name: "the same OAuth transaction cannot be reused", method: "GET", path: "/api/connections/oauth/google-drive/callback", headers: { "x-test-oauth": "transaction" }, expectedStatus: 400, expectedCode: "invalid_oauth_transaction", expectedHandlerHits: 0 },
  { name: "expired OAuth transaction is rejected", method: "GET", path: "/api/connections/oauth/google-drive/callback", headers: { "x-test-oauth": "expired" }, expectedStatus: 400, expectedCode: "invalid_oauth_transaction", expectedHandlerHits: 0 },
  { name: "owner session is not callback authority", method: "GET", path: "/api/connections/oauth/google-drive/callback", headers: { "x-test-owner": "valid" }, expectedStatus: 400, expectedCode: "invalid_oauth_transaction", expectedHandlerHits: 0 },
];

async function main(): Promise<void> {
  const events: string[] = [];
  const server = serve({ fetch: createProbeApp(events).fetch, port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (address === null) throw new TypeError("Expected the probe server to be listening");
  if (typeof address !== "object") throw new TypeError("Expected an ephemeral TCP address");
  const port = address.port;

  let passed = 0;
  try {
    for (const probe of CASES) {
      events.length = 0;
      const response = await fetch(`http://127.0.0.1:${port}${probe.path}`, {
        method: probe.method,
        headers: probe.headers,
      });
      const body: unknown = await response.json();
      assert.equal(response.status, probe.expectedStatus, probe.name);
      assert.equal(events.filter((event) => event === "handler").length, probe.expectedHandlerHits, probe.name);
      assert.equal(events[0], "sso:next", probe.name);
      assert.equal(events[1], probe.expectedStatus === 200 ? "gate:allow" : "gate:deny", probe.name);
      if (probe.expectedCode !== undefined) {
        assert.equal(
          typeof body === "object" && body !== null && "error" in body ? body.error : undefined,
          probe.expectedCode,
          probe.name,
        );
      }
      passed += 1;
      console.log(`[PASS] ${probe.name} status=${response.status} events=${events.join(",")}`);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  console.log(`connected-ingest auth HTTP matrix: ${passed}/${CASES.length} PASS`);
}

await main();
