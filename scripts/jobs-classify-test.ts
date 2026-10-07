import assert from "node:assert/strict";
import { classifyExit } from "../src/server/jobs.classify.js";

assert.deepEqual(
  classifyExit("AUTH_RECOVERED", [], true, undefined, true),
  { status: "completed" },
  "a successful text-only job must not require a structured report",
);
assert.deepEqual(
  classifyExit("AUTH_RECOVERED", [], true),
  { status: "outputs_missing", reason: "exit 0 but 보고 형식 누락" },
  "jobs that require outputs must retain report validation",
);
assert.deepEqual(
  classifyExit("AUTH_RECOVERED", ["[ERROR] FATAL"], true, undefined, true),
  { status: "failed", reason: "stderr 치명 에러: FATAL" },
  "text-only mode must not hide fatal errors",
);

console.log("jobs-classify-test: PASS");
