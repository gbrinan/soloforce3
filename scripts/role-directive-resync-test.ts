// role-directive 씨앗 → wiki 사본 재동기화 — 회귀 테스트
// 배경: ensureAgentDirs가 wiki 사본을 "없을 때만" 생성해서, config/agents/<id>/role-directive.md를
//       고쳐도 이미 만들어진 직원에게는 영원히 전달되지 않았다.
// 검증 항목: 최초 시딩, 씨앗 갱신 시 재동기화, 로컬 수정본 .bak 보존,
//            내용 동일 시 무동작(멱등), 로컬 수정본이 씨앗보다 최신이면 보존.
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { ensureAgentDirs, type WorkerAgentDef } from "../src/agent-registry.js";

const ROOT = process.cwd();
const CFG_AGENTS = join(ROOT, "config", "agents");
const HIST_AGENTS = join(ROOT, "history", "agents");
const HIST_OUTPUTS = join(ROOT, "history", "outputs");

const ID = "virt-resync-test";
const NAME = "리싱크";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`[PASS] ${name}`); pass++; }
  else { console.log(`[FAIL] ${name}${detail ? " — " + detail : ""}`); fail++; }
}

const agent: WorkerAgentDef = {
  id: ID,
  name: NAME,
  allowedTools: [],
  maxTurns: 30,
  bashTagSupport: false,
  routeKeywords: [],
  adapter: "claude-code",
  team: "테스트팀",
  role: "테스터",
};

const seedDir = join(CFG_AGENTS, ID);
const seedPath = join(seedDir, "role-directive.md");
const wikiPath = join(HIST_AGENTS, ID, "wiki", "role-directive.md");
const bakPath = `${wikiPath}.bak`;

// 씨앗 mtime을 wiki 사본보다 확실히 뒤로 밀기 위한 헬퍼 (같은 초에 쓰이면 비교가 무의미해진다)
function touchNewer(p: string): void {
  const t = Date.now() / 1000 + 5;
  utimesSync(p, t, t);
}

function cleanup(): void {
  rmSync(seedDir, { recursive: true, force: true });
  rmSync(join(HIST_AGENTS, ID), { recursive: true, force: true });
  rmSync(join(HIST_OUTPUTS, ID), { recursive: true, force: true });
}

cleanup();
mkdirSync(seedDir, { recursive: true });

try {
  // --- 1. 최초 시딩: 씨앗이 플레이스홀더 치환을 거쳐 wiki로 복사된다 ---
  writeFileSync(seedPath, "# {{NAME}} 역할 지시서\n\n버전 A\n", "utf-8");
  ensureAgentDirs(agent, [agent]);
  check("최초 시딩: wiki 사본 생성", existsSync(wikiPath));
  check(
    "최초 시딩: {{NAME}} 치환",
    existsSync(wikiPath) && readFileSync(wikiPath, "utf-8").includes(`# ${NAME} 역할 지시서`),
  );

  // --- 2. 멱등: 씨앗이 그대로면 아무것도 하지 않는다 ---
  ensureAgentDirs(agent, [agent]);
  check("멱등: 내용 동일 시 .bak 미생성", !existsSync(bakPath));

  // --- 3. 씨앗 갱신 → wiki 재동기화 (이 저장소의 회귀 지점) ---
  writeFileSync(seedPath, "# {{NAME}} 역할 지시서\n\n버전 B\n", "utf-8");
  touchNewer(seedPath);
  ensureAgentDirs(agent, [agent]);
  const after = existsSync(wikiPath) ? readFileSync(wikiPath, "utf-8") : "";
  check("씨앗 갱신: wiki 사본이 새 씨앗을 따라감", after.includes("버전 B"), `실제=${JSON.stringify(after)}`);
  check("씨앗 갱신: 이전 사본이 .bak으로 보존", existsSync(bakPath) && readFileSync(bakPath, "utf-8").includes("버전 A"));

  // --- 4. 로컬 수정본이 씨앗보다 최신이면 덮지 않는다 ---
  rmSync(bakPath, { force: true });
  writeFileSync(wikiPath, "# 손으로 고친 지시서\n\n로컬 수정\n", "utf-8");
  touchNewer(wikiPath);
  ensureAgentDirs(agent, [agent]);
  check(
    "로컬 수정본이 씨앗보다 최신이면 보존",
    readFileSync(wikiPath, "utf-8").includes("로컬 수정"),
  );
  check("로컬 수정본 보존 시 .bak 미생성", !existsSync(bakPath));
} finally {
  cleanup();
}

console.log(`\n통과 ${pass} · 실패 ${fail}`);
process.exit(fail > 0 ? 1 : 0);
