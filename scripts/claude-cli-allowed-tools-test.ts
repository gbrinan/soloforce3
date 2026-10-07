import assert from "node:assert/strict";
import { buildClaudeArgs } from "../src/server/claude-cli.js";

// Given: a non-interactive Claude request with one explicitly approved Gmail read tool.
const prompt = "check inbox";
const gmailReadTool = "mcp__claude_ai_Gmail__search_threads";

// When: CLI arguments are built for the request.
const args = buildClaudeArgs(prompt, {
  system: "return JSON",
  allowedTools: [gmailReadTool],
});

// Then: the exact read tool is allow-listed without enabling bypass mode.
assert.deepEqual(args, [
  "-p",
  prompt,
  "--append-system-prompt",
  "return JSON",
  "--allowedTools",
  gmailReadTool,
]);
assert.equal(args.includes("--dangerously-skip-permissions"), false);
