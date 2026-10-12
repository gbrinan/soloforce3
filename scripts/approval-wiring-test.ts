// 승인 배선 테스트 (G15) — 헤드리스 MCP 권한, 정책 도구 분류, PreToolUse 승인 훅의 실제 동작.
//   npx tsx scripts/approval-wiring-test.ts
// 훅은 로컬 루프백 스텁 서버를 띄워 실제 프로세스로 실행한다(외부 네트워크 없음).
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { headlessMcpGrants } from "../src/server/mcp-registry.js";
import { getPolicyDisallowedTools, getPolicyToolSets } from "../src/server/service-policies.js";

let n = 0;
const test = async (name: string, fn: () => void | Promise<void>): Promise<void> => { await fn(); n++; console.log(`PASS ${name}`); };

const defs = {
  notion: { mode: "allow" as const },
  supabase: { mode: "approval" as const, readTools: ["list_tables", "execute_sql_readonly"] },
  hermes: { mode: "approval" as const },
};

await test("allow 서버는 통째로 허용", () => {
  const g = headlessMcpGrants(["notion"], defs, { allowlistActive: true, bypass: false });
  assert.deepEqual(g, { allow: ["mcp__notion"], disallow: [] });
});
await test("approval 서버는 readTools만 허용", () => {
  const g = headlessMcpGrants(["supabase"], defs, { allowlistActive: true, bypass: false });
  assert.deepEqual(g, { allow: ["mcp__supabase__list_tables", "mcp__supabase__execute_sql_readonly"], disallow: [] });
});
await test("readTools 없는 approval 서버는 아무 도구도 허용하지 않음", () => {
  const g = headlessMcpGrants(["hermes"], defs, { allowlistActive: true, bypass: false });
  assert.deepEqual(g, { allow: [], disallow: [] });
});
await test("bypassPermissions면 approval 서버를 통째로 막음(목록 밖 도구도 실행되므로)", () => {
  const g = headlessMcpGrants(["notion", "supabase", "hermes"], defs, { allowlistActive: true, bypass: true });
  assert.deepEqual(g, { allow: ["mcp__notion"], disallow: ["mcp__supabase", "mcp__hermes"] });
});
await test("allowlist가 꺼진 잡도 approval 서버를 통째로 막음", () => {
  const g = headlessMcpGrants(["supabase"], defs, { allowlistActive: false, bypass: false });
  assert.deepEqual(g, { allow: [], disallow: ["mcp__supabase"] });
});
await test("레지스트리에 없는 서버는 무시", () => {
  assert.deepEqual(headlessMcpGrants(["ghost"], defs, { allowlistActive: true, bypass: false }), { allow: [], disallow: [] });
});

await test("정책: gmail 발송은 approval 묶음(헤드리스 금지·PTY 승인 카드)", () => {
  const { approval, blocked } = getPolicyToolSets();
  for (const t of ["send_message", "reply", "forward"]) assert.ok(approval.includes(`mcp__claude_ai_Gmail__${t}`), t);
  assert.ok(approval.includes("mcp__claude_ai_Google_Calendar__create_event"));
  assert.ok(!approval.some((t) => t.startsWith("mcp__claude_ai_Notion__")), "notion writePolicy=auto");
  assert.ok(!blocked.some((t) => approval.includes(t)), "blocked와 approval은 겹치지 않는다");
});
await test("정책: 헤드리스 금지 목록 = blocked + approval", () => {
  const { approval, blocked } = getPolicyToolSets();
  assert.deepEqual(getPolicyDisallowedTools(), [...blocked, ...approval]);
});

// ── 승인 훅 — 실제 프로세스 ───────────────────────────────────────────────────
type Stub = { base: string; seen: Array<Record<string, unknown>>; close: () => Promise<void> };
async function stubServer(finalStatus: string): Promise<Stub> {
  const seen: Array<Record<string, unknown>> = [];
  let polls = 0;
  const srv = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.method === "POST" && req.url === "/api/approvals") {
        seen.push(JSON.parse(body));
        res.end(JSON.stringify({ id: "abcdef1234" }));
      } else if (req.method === "GET" && req.url === "/api/approvals/abcdef1234/status") {
        polls++;
        res.end(JSON.stringify({ status: polls < 2 ? "pending_chat" : finalStatus }));
      } else { res.statusCode = 404; res.end("{}"); }
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as AddressInfo).port;
  return { base: `http://127.0.0.1:${port}`, seen, close: () => new Promise((r) => srv.close(() => r())) };
}

function runHook(env: Record<string, string>, args: string[] = []): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ["scripts/mcp-approval-hook.mjs", ...args], { env: { ...process.env, ...env } });
    let out = "";
    p.stdout.on("data", (c) => { out += c; });
    p.on("close", (code) => resolve({ code, out }));
    p.stdin.end(JSON.stringify({ tool_name: "mcp__claude_ai_Gmail__send_message", tool_input: { to: "x@example.com", body: "hi" } }));
  });
}
const decision = (out: string): string => JSON.parse(out).hookSpecificOutput.permissionDecision;

await test("훅: 승인되면 allow", async () => {
  const s = await stubServer("allowed");
  const r = await runHook({ MYCREW_APPROVAL_BASE: s.base, MYCREW_AGENT_ROLE: "orchestrator" });
  await s.close();
  assert.equal(r.code, 0);
  assert.equal(decision(r.out), "allow");
  assert.equal(s.seen[0].tool, "mcp__claude_ai_Gmail__send_message");
  assert.equal(s.seen[0].external, undefined, "--external 없으면 일반 승인");
});
await test("훅: 거부되면 deny", async () => {
  const s = await stubServer("denied");
  const r = await runHook({ MYCREW_APPROVAL_BASE: s.base });
  await s.close();
  assert.equal(decision(r.out), "deny");
});
await test("훅: --external이면 사람 전용 승인으로 요청", async () => {
  const s = await stubServer("allowed");
  await runHook({ MYCREW_APPROVAL_BASE: s.base }, ["--external"]);
  await s.close();
  assert.equal(s.seen[0].external, true);
});
await test("훅: 승인 서버 주소가 없으면 deny(닫힌 쪽)", async () => {
  const env = { ...process.env };
  delete env.MYCREW_APPROVAL_BASE;
  const r = spawnSync(process.execPath, ["scripts/mcp-approval-hook.mjs"], { input: "{\"tool_name\":\"x\"}", env, encoding: "utf-8" });
  assert.equal(decision(r.stdout), "deny");
});
await test("훅: 승인 서버에 연결할 수 없으면 deny(닫힌 쪽)", async () => {
  const r = await runHook({ MYCREW_APPROVAL_BASE: "http://127.0.0.1:9" });
  assert.equal(decision(r.out), "deny");
});
await test("훅: 입력이 깨졌으면 deny", () => {
  const r = spawnSync(process.execPath, ["scripts/mcp-approval-hook.mjs"], { input: "not json", env: { ...process.env, MYCREW_APPROVAL_BASE: "http://127.0.0.1:9" }, encoding: "utf-8" });
  assert.equal(decision(r.stdout), "deny");
});

console.log(`approval-wiring: ${n} passed, 0 failed`);
process.exit(0);
