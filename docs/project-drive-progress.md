# Project Drive implementation evidence

Base: d545e22c2c96933f471fdb0169707b61f29e147f. Feature remains uncommitted, isolated from the running release. WSL Node v22.22.3; Linux dependencies reused from the existing Linux release. No Windows node_modules were installed or mixed.

- Red: new bundle test initially failed because the requested implementation module did not exist.
- Green: `npm run test:project-drive` passes safe document round trip, secret/hidden exclusions, symlink rejection, traversal/reserved names, duplicate paths, checksum/size limits, actual project client/domain/session metadata, and real local HTTP service tests.
- Real HTTP tests use the production GoogleProjectDriveProvider against a local wire-level OAuth/Drive server: required write scope, one-time OAuth state, same-origin mutation denial, cross-site GET denial, hostile Host denial, resumable upload, snapshot download/import, invalid archive rejection and revocation.
- The hostile Host check initially used fetch, which normalized the Host header and returned 200. Replaced transport with raw node:http to send the intended hostile header; the real server denied it with 403. Production authentication was unchanged.
- `npm run test:google-readonly-connection`: all four scripts pass, retaining readonly default scopes and behavior.
- `npm run build`: server and client TypeScript checks plus production Vite build pass. Existing large main/ML bundle and plugin timing warnings remain unrelated to this feature.
- LSP unavailable because the user previously declined language-server installation; compiler checks are the type evidence.
- `git diff --check`: passes. New feature modules are each below 150 lines. No dependency or lockfile changes.

Scope: supported-document snapshot transfer, not a full source/runtime backup. Project metadata intentionally normalizes safe display fields. Drive write access is separate and opt-in; tokens remain encrypted under history/project-drive. UI preview is available before OAuth connection, actual upload requires connection and explicit consent.

No live Google upload or consent was performed by the implementation worker. Coordinating agent owns deployment, actual browser QA and user-assisted OAuth verification. Google Console needs the new authorized redirect URI shown on `/project-drive`; see project-drive.md. Existing personal files, .env, history, Gmail overlays and running service were not edited here.

Browser integration follow-up: coordinating agent found that the in-app browser returned a popup handle without exposing a usable OAuth tab. Replaced window.open with standard same-tab window.location.assign after the OAuth start request. Callback already contains a link back to the transfer screen. OAuth scopes and server behavior remain unchanged; coordinator verifies actual navigation after deployment.

Embedded Projects integration: the iframe's absolute /api/projects fetch reached the host's unrelated category endpoint, so its viewer showed no projects. When embedded under /api/apps/projects/proxy, the viewer now routes its list/detail/file requests to the existing canonical host /api/projects-query endpoints. Standalone app requests retain /api/projects. Generic proxy, host routes and security are unchanged.

The in-app browser also did not expose the iframe's new-tab link. Removed that duplicate link and added a Projects-only same-tab Drive transfer anchor in the existing host AppHostFrame toolbar. Projects toolbar wraps at narrow widths; iframe sandbox permissions are unchanged. The coordinator verifies final list, entry click and OAuth navigation on the actual host.
