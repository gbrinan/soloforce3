# Evidence

## Red

- `npm run test:reversible-ingest` exited 1 because `src/server/reversible-ingest.js` did not exist. The test therefore failed for the intended missing behavior before implementation.

## Green

- `npm run test:reversible-ingest`: exit 0, `reversible ingest filesystem rehearsal: PASS`.
- `npm run build:server`: exit 0 under strict TypeScript settings.
- `npm run build`: exit 0 for server, client typecheck, and Vite production build.
- `npm test`: exit 0 for the full regression chain, including the 20/20 connected-ingest auth matrix and the reversible-ingest rehearsal.
- Existing `jobtype-template-test` reported its documented skip because `history/agents.json` is absent in this unprovisioned worktree.

## Real filesystem rehearsal

- Prepared state survived a new store process boundary without changing `current.json`.
- Rollback of prepared and committed operations restored the baseline manifest pointer.
- Revision content remained byte-identical after rollback.
- Same operation and input produced no duplicate journal events or revisions.
- A pointer-written/journal-missing crash state recovered to committed, then rolled back.
- A stale prepared operation returned `base_changed` and did not replace current.
- Reusing an operation ID with different content returned `operation_input_mismatch`.

## Residual observations

- `npm install` reported 34 dependency audit findings already present in the dependency tree; this slice did not run an automatic or breaking audit fix.
- Vite reported existing large-chunk warnings; this server-only slice did not change client bundling.
- Power-loss durability across storage-device cache loss is not claimed. The verified boundary is process interruption with atomic filesystem rename semantics.
