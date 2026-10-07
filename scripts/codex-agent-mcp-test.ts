// codex 실행기가 에이전트의 mcpServers(레지스트리)를 codex 설정에 싣는지 (2026-09-28)
// 재현 근거: codex QA가 safefs만 받아 playwright·notion 등 할당된 도구를 못 씀 → Notion 기반 작업을 재확인 못 함.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { renderCodexMcpServers } from "../src/adapters/codex-cli.js";

const toml = renderCodexMcpServers(
  {
    playwright: { command: "/n/node", args: ["/n/npx-cli.js", "-y", "@playwright/mcp@latest"] },
    notion: { command: "/n/node", args: ["/n/npx-cli.js", "-y", "@notionhq/notion-mcp-server"], env: { NOTION_TOKEN: "tok\"en" } },
    risky: { command: "/bin/x", args: [] },
    safefs: { command: "/should/not/duplicate", args: [] },
  },
  ["playwright", "notion"],   // allow
);
assert.match(toml, /\[mcp_servers\."playwright"\]\ncommand = "\/n\/node"\nargs = \["\/n\/npx-cli\.js","-y","@playwright\/mcp@latest"\]\ndefault_tools_approval_mode = "approve"/);
assert.match(toml, /\[mcp_servers\."notion"\.env\]\nNOTION_TOKEN = "tok\\"en"/, "env가 TOML 문자열로 안전하게 들어가야 한다");
assert.ok(!toml.includes('"risky"'), "approval 모드 서버는 비대화형 codex에서 승인 불가 → 넣지 않는다");
assert.ok(!toml.includes('"safefs"'), "safefs는 별도 블록이 있으므로 중복 금지");

// 배선: makeIsolatedCodexHome이 config.mcpServers를 받아 렌더 결과를 설정에 붙이는지
const src = readFileSync("src/adapters/codex-cli.ts", "utf-8");
assert.match(src, /makeIsolatedCodexHome\(safefsEnv, config\.mcpServers\)/, "호출부가 mcpServers를 넘기지 않는다");
assert.match(src, /renderCodexMcpServers\(/);
console.log("codex agent mcp: PASS");
