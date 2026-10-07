# Re0 memo

## Preserve

- `prepare -> commit -> rollback` is the vocabulary for every ingest state change.
- Revision, manifest, and journal events are immutable; only `current.json` moves.
- `projectId`, `connectionId`, and `operationId` stay separate. No email equality is used as identity authority.
- Conflicts are typed outcomes, so stale work and operation-ID reuse fail closed.

## Anti-pattern: mutable append log as proof

A single JSONL journal looked append-only but its last line could tear during interruption. That would make the recovery evidence itself unreadable. The gate is now: each transition is a deterministic immutable event file, and duplicate transitions must produce identical bytes.

## Anti-pattern: nondeterministic immutable artifact

Putting wall-clock creation time inside a content-addressed manifest made a retry after “manifest written, journal missing” collide with different bytes. The gate is now: any artifact created before durable operation state must be byte-stable for the same operation input. Time belongs in the journal event, not the manifest identity.

## HATE result

- Root: pointer movement without a committed journal event was the unproved load-bearing recovery state.
- First nail: write that exact intermediate pointer state, recreate the store, then commit and rollback.
- Verdict: ITERATE once. The added rehearsal passed; retain this implementation for the next slice.

## First gate for the next cycle

Before a real provider connector is allowed to write a revision, prove a read-only Google authorization can bind a provider subject to an opaque `connectionId` for both same-email and different-email login scenarios without using email equality as authorization.
