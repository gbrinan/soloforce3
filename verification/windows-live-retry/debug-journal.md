# Job identity investigation
Runtime: native Node 24.14, tsx, isolated home. No debugger port or temporary production logging.
Hypotheses: (1) jobs.ts substitutes a fixed label before the adapter; (2) MCP transport overwrites the actual ID; (3) an old session retains a prior token.
Evidence plan: fresh createJob with an observing adapter distinguishes (1) without MCP or old session. Actual model usage receipt later verifies end-to-end.
Artifacts: persistent regression script and minimal jobs.ts fix if reproduced. User requested evidence retention; logs stay ignored locally.

Result: fresh job c721b376-9d74-4033-967c-a5c57e12e551 reached adapter as identity-probe-job (red). After six execute call sites pass existing jobId, job b63cda6b-3fab-4c23-83c0-1a74603f7dec reached adapter unchanged (green). Production logging, debugger ports, and runtime instrumentation were not added. The adapter is synthetic; a real model's downstream Wiki receipt remains unverified because source analysis was rejected before canonical publication.

Separate parsing hypothesis disproved: pure fenced JSON is accepted by existing WikiExecution. Actual attempt two contained trailing prose, so no parsing relaxation or production parser change was made.
