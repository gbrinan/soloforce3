# Pinned IngesTiger runtime

`manifest.json` records the upstream commit, plugin version, and SHA-256 of the unmodified runtime skill, references, and agent metadata. Runtime paths remain inside the pinned tree. The host bridge lives in `scripts/ingestiger-bridge.py` and `src/server/wiki/`; usage and limitations are in [config/wiki/README.md](../../config/wiki/README.md).

Update from an explicitly selected upstream commit, refresh the manifest and `UPSTREAM_COMMIT` together, then run `npm run test:wiki`. Do not edit this copy of the upstream contracts or pipeline independently. Runtime documents and customer data belong under `HISTORY_DIR`, never in this vendor directory.
