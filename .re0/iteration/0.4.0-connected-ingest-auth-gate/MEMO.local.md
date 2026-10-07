# Connected ingest auth gate memo

## Preserve

- Route-local policy declarations: credential type alone cannot authorize heterogeneous connection routes.
- Status taxonomy: absent/invalid state is 401, authenticated scope mismatch is 403, invalid callback transaction is 400.
- Negative corpus and handler-hit evidence on a real HTTP server.

## Reject

- Anti-pattern: loopback-as-owner. Gate: unauthenticated loopback must remain 401.
- Anti-pattern: generic connected-ingest bearer. Gate: every AgentGrant must match project, connection, and one exact capability.
- Anti-pattern: owner session as callback authority. Gate: callback accepts only an active provider-matched one-time transaction.

## Next cycle vocabulary

The next provider slice starts with `CredentialResolver`, opaque hashed token storage, one-time OAuth transaction consumption, and an explicit route policy. It must not reinterpret approval tokens, app pairing tokens, or network origin as authorization.

## Verdict

Keep the policy boundary and HTTP negative corpus. Do not yet keep any provider route or token-store shape because neither was exercised in this cycle.
