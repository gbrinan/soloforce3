# Execution ledger

- Schema argument regression red: CLI schema absent. Green: draft-07 schema argument equals generated schema, evidence type array, structured_output consumed, absent/error envelope rejected, ordinary text preserved.
- One transient assertion wrongly depended on JSON property ordering; replaced with parsed property lookup. One local Python edit failed under cp949 before modifying the harness; rerun with PYTHONUTF8=1.
- Installed CLI rejected draft2020-12 before inference. Captured stderr identified dialect incompatibility; fixed without relaxing Wiki/Python validation.
- Actual Sonnet call completed, observer parser failed on model-less user event. Exact raw output retained and replayed through WikiExecution after observer fix. Four needs saved and accepted by synthetic test reviewer.
- Actual Opus specialist delegated to actual Sonnet Corpus Keeper via production HTTP/Wiki MCP and job queue. Awaiting report and usage verification.
