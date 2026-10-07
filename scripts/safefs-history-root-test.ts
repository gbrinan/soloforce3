// 코드(릴리스)와 데이터(MYCREW_HOME)가 분리된 배치에서 history/ 전체가 데이터 루트로 해석되는지 검증(2026-09-28).
// 재현 근거: WSL 이전(9/8) 후 SafeGlob/SafeRead가 history/skills·cost-log 등을 코드 폴더에서 찾아 "no matches" —
// QA·리서치·비용 리포트가 데이터를 못 읽음. history/outputs·agents·external만 데이터 루트로 가던 것이 원인.
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const code = mkdtempSync(join(tmpdir(), "sf-code-"));
const data = mkdtempSync(join(tmpdir(), "sf-data-"));
mkdirSync(join(data, "history", "skills"), { recursive: true });
mkdirSync(join(data, "history", "outputs", "qa"), { recursive: true });
writeFileSync(join(data, "history", "skills", "spf-knowledge.md"), "# 정본\n셀링넘버\n");
writeFileSync(join(data, "history", "cost-log.jsonl"), '{"costUsd":1}\n');
writeFileSync(join(data, "history", "outputs", "qa", "r.md"), "ok\n");

const transport = new StdioClientTransport({
  command: "npx", args: ["tsx", "src/mcp/safefs-server.ts"],
  env: { ...process.env, MCP_CWD: code, MCP_SELF_DIR: code, MCP_MYCREW_HOME: data,
    MCP_READ_PATHS: "/history/**", MCP_WRITE_PATHS: "/history/outputs/**", MCP_APPROVAL_URL: "http://127.0.0.1:9/none" } as Record<string, string>,
});
const client = new Client({ name: "t", version: "0" });
await client.connect(transport);
const call = async (name: string, args: Record<string, unknown>) => {
  const r = await client.callTool({ name, arguments: args }) as { content: { text: string }[]; isError?: boolean };
  return { text: r.content.map((c) => c.text).join("\n"), isError: !!r.isError };
};

// 기존에도 되던 것(회귀 방지)
assert.match((await call("SafeGlob", { pattern: "history/outputs/**/*.md" })).text, /r\.md/);
// 버그: history/ 아래 다른 경로
const g = await call("SafeGlob", { pattern: "history/skills/*.md" });
assert.match(g.text, /spf-knowledge\.md/, `history/skills가 데이터 루트에서 안 보인다: ${g.text}`);
const r = await call("SafeRead", { path: "history/skills/spf-knowledge.md" });
assert.ok(!r.isError && /셀링넘버/.test(r.text), `SafeRead 실패: ${r.text}`);
const c = await call("SafeGlob", { pattern: "history/cost-log.jsonl" });
assert.match(c.text, /cost-log\.jsonl/, `cost-log가 안 보인다: ${c.text}`);
const s = await call("SafeGrep", { pattern: "셀링", path: "history/skills" });
assert.match(s.text, /spf-knowledge\.md/, `SafeGrep이 history/skills를 못 찾는다: ${s.text}`);

await client.close();
console.log("safefs history root: PASS");
