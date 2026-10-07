# Findings
- Fresh Git checkout of origin/main at 390872c70b310d2d9f1a5732ccc596ac18c326f7; requested commit is current remote HEAD.
- Windows native Node v24.14.0, npm 11.9.0. Python launcher resolves Python 3.14.6. Bare python is a Windows App Execution Alias and fails.
- Existing checkouts include unrelated staged/unstaged work; untouched. Port 3456 has an existing listener; use a separate port.
- New checkout has no .env; credentials will not be copied. Set INGESTIGER_PYTHON to the native interpreter and isolated MYCREW_HOME/WORKSPACE_ROOT/PORT in process environment.
- Collaboration docs explicitly distinguish callback-based tests from real jobs. config/wiki/README.md contains outdated prose saying MCP is not connected, contradicted by its final section.
- Both Windows Claude binaries report loggedIn=false. Native 2.1.263 actual isolated Haiku probe exits 1: OAuth session expired and could not be refreshed. API time/tokens/cost zero; modelUsage empty. No actual model is confirmed available.
- Host real-call script failed wiki_model_failed; fixed-contract Haiku was preserved, no model substitution. Asked for user-side login only; no secrets requested or copied.
