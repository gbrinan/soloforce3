# Next cycle contract

## Proposed slice

Read-only Google connection binding and a single metadata ingest into this reversible operation store.

## Must preserve

- AI login identity and provider identity are separate principals.
- A Google provider subject binds to one explicit project-scoped `connectionId`.
- Same email is allowed but grants no implicit authority; different email is equally valid.
- Provider tokens remain behind an owner-delegated broker and never enter agent prompts, Git, manifests, or journals.
- Every ingest uses one operation ID and reaches the local store through `prepare -> commit`.

## Required matrix

1. Different AI-login and Google emails: explicit owner binding succeeds.
2. Same AI-login and Google email: explicit owner binding succeeds without a shortcut path.
3. Connection from another project: denied.
4. Revoked or expired connection: denied before revision creation.
5. Replayed OAuth transaction: denied.
6. Provider read failure: operation remains uncommitted and current pointer is unchanged.

## Counter-rationale

Adding token brokering, Drive traversal, Notion, and multi-account UI in one cycle would produce more visible integration but weaken fault isolation. The next slice should stay Google read-only and project-scoped; a second provider is valuable only after the same identity and rollback contract survives the first connector.
