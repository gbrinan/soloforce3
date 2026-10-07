# Project Google Drive transfer

Open `/project-drive` on the MyCrew host, or use **Drive 전송** in the host's Projects toolbar. This same-tab entry works without iframe popup support. This is an explicit snapshot transfer, not continuous sync. It uploads a selected project into an app-created **MyCrew Projects** Drive folder. Import creates a new category/slug without overwriting any existing project. Other Drive folders and arbitrary archives are not imported.

## OAuth setup

Reuse `GOOGLE_DRIVE_CONNECTOR_CLIENT_ID`, `GOOGLE_DRIVE_CONNECTOR_CLIENT_SECRET` and the 32-byte base64 `SOLOFORCE_CONNECTION_ENCRYPTION_KEY`. Add this authorized redirect URI to the same Google Cloud web OAuth client:

`http://localhost:3456/api/project-drive/oauth/callback`

The origin defaults to `GOOGLE_DRIVE_CONNECTOR_CALLBACK_URL`; override the complete new URI with `GOOGLE_PROJECT_DRIVE_CALLBACK_URL` when needed. Enable Drive API, configure the OAuth consent screen, and add the owner as a test user if the app is in testing mode. Use the screen's **Google Drive 연결 승인** button. The app requests `openid email https://www.googleapis.com/auth/drive.file`; the existing Drive read-only connection and credentials remain separate. An existing Claude Drive MCP login does not grant this OAuth client write access.

Refresh tokens are encrypted using the existing broker under `HISTORY_DIR/project-drive/.connections/secrets`. Preserve this history and encryption key across deployments. Do not commit them. A missing OAuth client or redirect registration is an operator setup requirement, not an upload success. Consent opens in the current tab; after approval use the callback page's project transfer link. The page displays the effective callback URL.

## Transfer contract

1. Choose a local project and preview files. Review the list and consent before upload.
2. Upload creates a new `.mycrew-project.json` snapshot; previous snapshots remain untouched. There is no automatic retry of a write request, avoiding duplicate uploads.
3. On another PC using the same OAuth client and Google account, connect and refresh the snapshot list. Preview a snapshot, enter a new category/name, consent and import.

Snapshots contain versioned metadata, base64 document bytes, and per-file SHA256 hashes. The allowed extensions are md, txt, json, csv, pdf, docx, xlsx, pptx, png, jpg, jpeg and webp. Project metadata includes name, client (including anandaraClient normalization), status, description, string domain labels (including object-label normalization) and bounded anandaraSessions display summaries. Runtime configuration, sync identities, hooks, absolute workstation paths and agent credentials are not part of the metadata contract. Local preview is available before connecting an account; actual upload requires a connection.

Limits: 1,000 files, 20 MiB decoded total, 5 MiB per file, 30 MiB transfer, five-minute previews, at most three live previews. Hidden entries, Git data, node_modules, history, credential/token/secret names and unsupported files are excluded. Symlinks, path traversal, drive letters, Windows reserved filenames, duplicate/case-colliding paths, malformed base64, hash mismatch and unsafe metadata are rejected. Common secret patterns in text cause rejection, but pattern detection cannot guarantee documents contain no personal or confidential content; the owner must review the preview and source documents.

Routes require local owner or authenticated SSO and same-origin mutation proof; agent grants and unauthenticated remote clients cannot upload. Tailscale alone does not grant this new write access. Connect on localhost or configure SSO. No public Drive links are created and no existing Drive files are overwritten or deleted.

## Verification

`npm run test:project-drive` covers snapshot boundaries and a real local HTTP server using a wire-level Google fixture, including owner/Origin denial, OAuth scope/replay handling, resumable upload and import. `npm run test:google-readonly-connection` protects existing behavior. `npm run build` checks server/client types and assets. A real Google account round trip additionally requires owner OAuth approval; fixture tests do not claim cloud authorization.
