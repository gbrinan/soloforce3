import assert from "node:assert/strict";
import { isOAuthExpiredError, retryOnceOnOAuthExpiration } from "../src/claude-error-retry.js";

assert.equal(
  isOAuthExpiredError("Failed to authenticate. API Error: 401 OAuth access token has expired. Re-authenticate to continue."),
  true,
  "expired OAuth output must force a fresh Claude PTY",
);
assert.equal(isOAuthExpiredError("API Error: 401 invalid API key"), false);
assert.equal(isOAuthExpiredError("HTTP 429 rate_limit_error"), false);

let calls = 0;
let resets = 0;
const recovered = await retryOnceOnOAuthExpiration(
  async () => ++calls === 1
    ? "Failed to authenticate. API Error: 401 OAuth access token has expired. Re-authenticate to continue."
    : "AUTH_RECOVERED",
  () => { resets++; },
);
assert.equal(recovered, "AUTH_RECOVERED");
assert.equal(calls, 2, "OAuth failure must be retried exactly once");
assert.equal(resets, 1, "OAuth retry must reset the stale PTY/session");

await assert.rejects(
  retryOnceOnOAuthExpiration(
    async () => "API Error: 401 OAuth access token has expired",
    () => undefined,
  ),
  /still expired after session reset/,
);

console.log("claude-auth-retry-test: PASS");
