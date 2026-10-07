# Next cycle contract

## Proposed slice

Mount the Google read-only route factory in the real SoloForce server for one explicitly selected project, then complete one live browser consent rehearsal with user-supplied Google Cloud credentials.

## Required inputs

- A stable owner principal resolver independent of email equality.
- An explicit project ID to filesystem-root resolver.
- A 32-byte connection encryption key provider with rotation/recovery procedure.
- Google OAuth client ID, client secret, and exact callback URL supplied outside Git.

## Gates

1. Real server start endpoint is not 404 and still requires owner mutation authority.
2. Callback URL exactly matches Google Cloud configuration.
3. One different-email live consent succeeds; a same-email account follows the identical path if tested later.
4. No token or authorization code appears in logs, Git, HTTP connection views, or ingest artifacts.
5. Disconnect marks the connection inactive, revokes local secret access, and blocks new revisions.
6. Failed or cancelled consent leaves no active connection.

## Counter-rationale

`drive.metadata.readonly` enables unattended full metadata inventory but is a restricted scope. If public Google verification cost is unacceptable, the product alternative is Google Picker plus `drive.file`; that is safer and easier to verify but cannot silently inventory the entire Drive. This is a product choice, not an exception handler.
