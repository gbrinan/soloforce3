import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const runtimeRoot = mkdtempSync(join(tmpdir(), "soloforce-real-server-"));
process.env.MYCREW_HOME = runtimeRoot;
process.env.WORKSPACE_ROOT = runtimeRoot;
process.env.PROJECTS_FOLDER = "projects";

try {
  // Given: the shipped Hono composition without connector secrets.
  const { createServerApp } = await import("../src/server/create-server-app.js");
  const app = createServerApp();

  // When: the real connector start surface is requested.
  const response = await app.request("http://localhost/api/connections/google-drive/oauth/start", {
    method: "POST",
    headers: { origin: "http://localhost" },
  });

  // Then: the route exists and fails closed instead of disappearing or crashing the server.
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "google_connector_not_configured" });
  assert.equal((await app.request("http://localhost/api/health")).status, 200);
} finally {
  rmSync(runtimeRoot, { recursive: true, force: true });
}

console.log("google read-only real server mount: PASS");
process.exit(0);
