# Evidence

## Red corpus

- Initial `npm run test:google-readonly-connection`: connector modules did not exist.
- Clock-advanced retry: returned `conflict` because `collectedAt` made the same operation nondeterministic.
- Consumed transaction audit: PKCE verifier remained in the used transaction file.
- Two-page Drive response: second page was absent from the ingest revision.
- HTTP route matrix: route factory did not exist.

Each red failed before its corresponding production change.

## Green

- `npm run test:google-readonly-connection`: exit 0.
  - `google read-only connection and reversible ingest: PASS`
  - `google read-only HTTP authorization matrix: PASS`
- `npm run build:server`: exit 0 under strict TypeScript.
- `npm run build`: exit 0 for server, client typecheck, and Vite production build.
- `npm test`: exit 0 for the full regression chain.
- Existing `jobtype-template-test` retained its documented SKIP because this isolated worktree has no provisioned `history/agents.json`.

## Observed surface

- Owner mutation without credentials returned 401.
- OAuth callback required an active one-time transaction and replay returned 400.
- Wrong-project ingest grant returned 403; owner ingest returned 200.
- Same-account-shaped and different-account-shaped fixtures both used the same `sub` binding path.
- Missing scope and unverified email created no credential secret.
- Refresh token ciphertext did not contain plaintext token bytes.
- Used transaction files contained no PKCE verifier.
- Provider 503 and revoked connection created no revision.
- Successful Drive pagination committed both pages to one deterministic revision.

## Residual observations

- No live Google credential or personal account was used. The downstream was a real local HTTP provider implementing Google's wire shapes.
- The route factory is not mounted in the existing monolithic application server yet; this PR is not a user-visible settings UI.
- `drive.metadata.readonly` is a restricted scope and can require Google verification for public distribution.
- Encryption-key provisioning and rotation remain an application-integration responsibility.
- The existing dependency tree still reports 34 npm audit findings; no automatic breaking audit fix was run.
