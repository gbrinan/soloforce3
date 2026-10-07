# Re0 memo

## Preserve

- Owner principal, Google `sub`, project, and connection ID are four separate identities.
- Email is display metadata only; no same-email shortcut or different-email rejection exists.
- Callback authority is a consumed transaction, not an owner cookie or loopback origin.
- Provider tokens remain behind an encrypted broker handle and never enter HTTP responses, connection views, manifests, journals, or revisions.
- Provider reads complete before reversible `prepare`; failure therefore leaves current unchanged.

## Anti-pattern: convenient identity equality

Comparing login email with provider email would make the demonstrated Naver/Google case fail and would also make the same-email case deceptively privileged. The hard gate is structural: the connection service does not accept the owner's email at all, and binds the verified Google `sub` to an opaque owner principal from the consumed transaction.

## Anti-pattern: immutable output containing observation time

Including `collectedAt` inside the content-addressed ingest payload made the same operation ID conflict one hour later. The gate is: identical provider metadata for the same operation must serialize to identical bytes; collection time belongs in operation evidence, not content identity.

## Anti-pattern: consumed secret retained as history

A used OAuth transaction initially preserved its PKCE verifier. Historical audit data does not justify retaining a replay-sensitive secret. The gate is: transition to `used` must atomically replace the verifier with null before any provider request continues.

## Anti-pattern: first-page success

A green first page can hide an incomplete Drive inventory. The gate is a two-page wire fixture and a revision assertion for the second page, with repeated page tokens failing closed.

## Load-bearing objection

The route factory passes a real HTTP matrix but is not mounted in the shipped server. Calling this user-ready would be false. The next cycle's first nail is to boot the real server with an explicit project resolver and secret-key provider, then observe the start endpoint through that surface before adding UI.
