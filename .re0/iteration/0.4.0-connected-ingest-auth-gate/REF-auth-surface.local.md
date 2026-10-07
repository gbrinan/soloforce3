# Existing auth surface reference

- `src/server/routes.ts`: global `ssoMiddleware()` is registered before authenticated API routes.
- `src/server/auth-google.ts`: loopback self-fetch bypasses the global SSO middleware.
- `src/server/routes.ts`: `/api/genie/*` demonstrates path-specific middleware registration.
- `/api/approval-token` and app pairing tokens are not owner or AgentGrant evidence.
- Hono middleware executes in registration order: <https://hono.dev/docs/guides/middleware>

The new module is intentionally not mounted on production routes yet. Provider routes must attach an explicit policy when they are introduced.
