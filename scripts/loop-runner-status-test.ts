import assert from "node:assert/strict";
import { classifyTerminalLoopJob } from "../src/server/loops/runner.js";

assert.deepEqual(classifyTerminalLoopJob("completed"), { exitReason: "done" });
assert.deepEqual(classifyTerminalLoopJob("failed", "upstream failed"), {
  exitReason: "error",
  error: "upstream failed",
});
assert.deepEqual(classifyTerminalLoopJob("outputs_missing", "OAuth access token has expired"), {
  exitReason: "error",
  error: "OAuth access token has expired",
});
assert.deepEqual(classifyTerminalLoopJob("outputs_missing"), {
  exitReason: "error",
  error: "outputs_missing: 보고 형식 누락(실행 실패 가능성)",
});

console.log("loop-runner-status-test: PASS");
process.exit(0);
