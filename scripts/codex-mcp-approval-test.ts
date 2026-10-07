// codex 설정의 safefs MCP 서버에 도구 자동 승인이 들어 있는지 (2026-09-28)
// 재현 근거: codex 0.144.5 exec에서 approval_policy="never"만으로는 MCP 도구 호출이 "user cancelled MCP tool call"로
// 자동 취소돼 QA의 SafeRead/SafeWrite가 전부 실패. [mcp_servers.safefs] default_tools_approval_mode="approve"로 해결 확인.
// 승인·허용 목록은 safefs가 자체 수행하므로 codex 단 승인은 생략해도 통제가 유지된다.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const src = readFileSync("src/adapters/codex-cli.ts", "utf-8");
const i = src.indexOf("`[mcp_servers.safefs]`");
assert.ok(i > 0, "safefs MCP 섹션 생성 코드가 없다");
const section = src.slice(i, src.indexOf("`[mcp_servers.safefs.env]`", i));
assert.match(section, /default_tools_approval_mode = "approve"/, "safefs 도구 자동 승인 줄이 없다 — codex exec에서 MCP 호출이 취소된다");
assert.match(src, /approval_policy = "never"/, "approval_policy never가 빠졌다");
console.log("codex mcp approval: PASS");
