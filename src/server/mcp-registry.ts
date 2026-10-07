// MCP 레지스트리 — 설치 가능한 MCP 서버 "정의"의 중앙 저장소.
// ★ 시드/런타임 구분: config/mcp-base.json 은 .mcp.json 시드용 템플릿일 뿐이고,
//   런타임이 실제로 읽는 파일은 history/mcp-registry.json 이다 (워커는 --strict-mcp-config
//   라 .mcp.json 을 아예 안 읽는다). 커맨드를 고치려면 후자를 고쳐라 — 전자만 고치면
//   아무 일도 일어나지 않는다. 2026-08-08 실제로 두 번 반복된 실수다.
// 설치 = 여기 항목 추가 / 할당 = 각 에이전트 config의 mcpServers에 이름 참조.
// (safefs는 시스템 기반 서버라 레지스트리에 없음 — spawn 코드가 항상 직접 포함)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { atomicWriteFileSync } from "./utils/atomic-write.js";
import { basename, delimiter, dirname, join } from "node:path";
import { homedir } from "node:os";
import { HISTORY_DIR } from "../config.js";

export interface McpServerDef {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  // allow: allowedTools에 넣어 승인 없이 사용 / approval: PreToolUse 훅 → 승인카드 경유
  mode?: "allow" | "approval";
}

const REGISTRY_FILE = join(HISTORY_DIR, "mcp-registry.json");

// 최초 실행 시 현행 기본값(playwright)을 시드 — 기존 동작 보존
const DEFAULT_REGISTRY: Record<string, McpServerDef> = {
  // playwright는 E2E 브라우저 자동화 전용 — 호출 하나하나 승인받으면 E2E가 사실상 불가(승인 폭탄).
  // 내부 신뢰 워커(qa/dev-pm/planner)만 할당되므로 allow로 둬 승인 없이 사용.
  playwright: { command: "npx", args: ["@playwright/mcp@latest", "--headless"], mode: "allow" },
};

export function loadMcpRegistry(): Record<string, McpServerDef> {
  if (!existsSync(REGISTRY_FILE)) {
    try {
      if (!existsSync(HISTORY_DIR)) mkdirSync(HISTORY_DIR, { recursive: true });
      writeFileSync(REGISTRY_FILE, JSON.stringify(DEFAULT_REGISTRY, null, 2), "utf-8");
      console.log("[McpRegistry] 기본 레지스트리 시드 (playwright)");
    } catch (e) { console.error("[McpRegistry] 시드 실패:", e); }
    return { ...DEFAULT_REGISTRY };
  }
  try {
    const parsed = JSON.parse(readFileSync(REGISTRY_FILE, "utf-8")) as Record<string, McpServerDef>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    console.error("[McpRegistry] 로드 실패:", e);
    return {};
  }
}

export function getMcpServerDef(name: string): McpServerDef | undefined {
  return loadMcpRegistry()[name];
}

function saveMcpRegistry(reg: Record<string, McpServerDef>): void {
  if (!existsSync(HISTORY_DIR)) mkdirSync(HISTORY_DIR, { recursive: true });
  writeFileSync(REGISTRY_FILE, JSON.stringify(reg, null, 2), "utf-8");
}

export function addMcpServer(name: string, def: McpServerDef): void {
  const reg = loadMcpRegistry();
  reg[name] = def;
  saveMcpRegistry(reg);
  console.log(`[McpRegistry] 설치: ${name} (mode=${def.mode ?? "approval"})`);
}

export function removeMcpServer(name: string): boolean {
  const reg = loadMcpRegistry();
  if (!(name in reg)) return false;
  delete reg[name];
  saveMcpRegistry(reg);
  console.log(`[McpRegistry] 제거: ${name}`);
  return true;
}

const AGENTS_FILE = join(HISTORY_DIR, "agents.json");
const GENIE_CONFIG_FILE = join(HISTORY_DIR, "genie-config.json");
const GENIE_IDS = new Set(["genie", "orchestrator"]);

// 에이전트 config의 mcpServers 목록을 수정(add=true 추가 / add=false 제거) + 해당 에이전트 재spawn.
async function editAssignment(agentId: string, serverName: string, add: boolean): Promise<{ ok: boolean; reason?: string }> {
  if (add && !getMcpServerDef(serverName)) return { ok: false, reason: `미설치 서버: ${serverName}` };
  const apply = (list: unknown): string[] => {
    const arr = Array.isArray(list) ? (list as string[]) : [];
    if (add) return arr.includes(serverName) ? arr : [...arr, serverName];
    return arr.filter((s) => s !== serverName);
  };
  try {
    if (GENIE_IDS.has(agentId)) {
      const cfg = JSON.parse(readFileSync(GENIE_CONFIG_FILE, "utf-8"));
      cfg.mcpServers = apply(cfg.mcpServers);
      writeFileSync(GENIE_CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf-8");
      const tw = await import("./terminal-ws.js");
      void tw.ptyRespawnForReset();   // 새 config로 즉시 재spawn
    } else {
      const data = JSON.parse(readFileSync(AGENTS_FILE, "utf-8")) as { agents: Array<{ id: string; mcpServers?: string[] }> };
      const agent = data.agents.find((a) => a.id === agentId);
      if (!agent) return { ok: false, reason: `미존재 에이전트: ${agentId}` };
      agent.mcpServers = apply(agent.mcpServers);
      atomicWriteFileSync(AGENTS_FILE, JSON.stringify(data, null, 2));
      const wp = await import("./worker-pty.js");
      wp.resetWorker(agentId);        // 종료 → 다음 위임 시 새 config로 재spawn
    }
    console.log(`[McpRegistry] ${add ? "할당" : "해제"}: ${serverName} ${add ? "→" : "✗"} ${agentId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export function assignMcpServer(agentId: string, serverName: string): Promise<{ ok: boolean; reason?: string }> {
  return editAssignment(agentId, serverName, true);
}

// 서버 mode 변경(allow/approval) + 요청 에이전트 재spawn — 승인카드 "항상 허용"이 호출.
export async function setMcpServerModeForAgent(serverName: string, mode: "allow" | "approval", agentId: string): Promise<{ ok: boolean; reason?: string }> {
  const reg = loadMcpRegistry();
  if (!reg[serverName]) return { ok: false, reason: `미설치 서버: ${serverName}` };
  reg[serverName].mode = mode;
  saveMcpRegistry(reg);
  console.log(`[McpRegistry] mode 변경: ${serverName} → ${mode} (요청: ${agentId})`);
  try {
    if (GENIE_IDS.has(agentId)) {
      const tw = await import("./terminal-ws.js");
      void tw.ptyRespawnForReset();
    } else {
      const wp = await import("./worker-pty.js");
      wp.resetWorker(agentId);
    }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  return { ok: true };
}
export function unassignMcpServer(agentId: string, serverName: string): Promise<{ ok: boolean; reason?: string }> {
  return editAssignment(agentId, serverName, false);
}

// ── 커맨드 절대경로 해석 ──────────────────────────────────────────────────────
// 워커/지니 PTY는 safeChildEnv의 PATH만 상속받는다. 이 머신의 서버 PATH에는
// npx·npm·cmd·opencrab이 하나도 없어서, 레지스트리에 command:"npx"로 적혀 있으면
// MCP 서버가 spawn ENOENT로 죽고 도구가 0개로 등록된다(ingest-crab 적재 0/35의 원인).
// 해결은 config마다 머신 경로를 박는 게 아니라 여기서 한 번 해석하는 것 —
// 그래야 다른 머신에서도 그 머신의 실제 경로로 자동 해석된다.
// 관련: procedure_bash-enoent-windows, procedure_safefs-permission-model.

const NODE_DIR = dirname(process.execPath);
const NPM_BIN_DIR = join(NODE_DIR, "node_modules", "npm", "bin");

/** PATH를 훑어 실행파일 절대경로를 찾는다 (없으면 null). 경로 구분자가 있으면 존재 확인만. */
function findOnPath(cmd: string): string | null {
  if (cmd.includes("/") || cmd.includes("\\")) return existsSync(cmd) ? cmd : null;
  const exts = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const full = join(dir, cmd + ext);
      try { if (existsSync(full)) return full; } catch { /* 접근 불가 디렉터리 무시 */ }
    }
  }
  return null;
}

/**
 * 사용자가 이미 동작을 확인해 둔 커맨드를 ~/.claude.json에서 빌려온다.
 * opencrab처럼 PATH에도 없고 node에서 유도할 수도 없는 서드파티 바이너리의
 * 위치는 머신마다 다르다 — 그 진실이 이미 적혀 있는 유일한 곳이 여기다.
 */
function lookupUserScopeCommand(name: string): { command: string; args?: string[] } | null {
  try {
    const f = join(homedir(), ".claude.json");
    if (!existsSync(f)) return null;
    const j = JSON.parse(readFileSync(f, "utf-8")) as { mcpServers?: Record<string, { command?: string; args?: string[] }> };
    const def = j.mcpServers?.[name];
    if (!def?.command) return null;
    return { command: def.command, args: def.args };
  } catch { return null; }
}

/**
 * MCP 서버 커맨드를 spawn 가능한 절대경로 형태로 정규화.
 * - `cmd /c <실커맨드> ...` 래퍼는 벗긴다 (래퍼의 목적이 PATH 해석이었는데 cmd 자체가 PATH에 없다).
 * - npx/npm은 node.exe + npm의 *-cli.js 직접 호출로 바꾼다 (.cmd는 shell 없이 spawn 불가).
 * - 그 외는 PATH 조회 → 실패 시 ~/.claude.json 조회.
 * 해석 실패 시 원본을 그대로 돌려준다 (동작 변화 없음 — 기존과 똑같이 실패하되 경고를 남긴다).
 */
export function resolveCommandPath(
  name: string,
  command: string,
  args: string[] = [],
): { command: string; args: string[] } {
  const bare = basename(command).replace(/\.(exe|cmd|bat)$/i, "").toLowerCase();

  // `cmd /c npx -y pkg` → `npx -y pkg` 로 벗긴 뒤 재해석
  if (bare === "cmd" && args[0] && /^\/c$/i.test(args[0]) && args[1]) {
    return resolveCommandPath(name, args[1], args.slice(2));
  }

  if (bare === "npx" || bare === "npm") {
    const cli = join(NPM_BIN_DIR, `${bare}-cli.js`);
    if (existsSync(cli)) return { command: process.execPath, args: [cli, ...args] };
  }

  const onPath = findOnPath(command);
  if (onPath) return { command: onPath, args };

  const borrowed = lookupUserScopeCommand(name);
  if (borrowed) {
    console.log(`[McpRegistry] ${name}: '${command}' 해석 불가 → ~/.claude.json의 경로 사용 (${borrowed.command})`);
    return { command: borrowed.command, args: borrowed.args ?? args };
  }

  console.warn(`[McpRegistry] ${name}: 커맨드 '${command}' 를 PATH에서도 ~/.claude.json에서도 못 찾음 — spawn 실패 예상`);
  return { command, args };
}

/**
 * spawn `--mcp-config` 에 실을 서버 엔트리 1건 조립 (순수 함수).
 *
 * ★ 여기가 CP949 오디코딩 교정(2026-08-11)의 실배선 지점이다. `env`가 빠지면
 * 파이썬 MCP 자식이 stdin을 CP949로 디코드해 한글 도구 인자가 복구 불가하게 깨진다.
 * runAgent(src/agent.ts)가 유일한 잡 실행 경로이므로 이 함수가 유일한 방어선이다.
 * 계약 테스트: scripts/mcp-env-passthrough-test.ts T3
 * 정본: history/agents/dev-pm/wiki/procedure_cp949-mojibake-is-irreversible.md
 */
export function buildMcpServerEntry(
  command: string,
  args: string[],
  def: Pick<McpServerDef, "env"> | undefined,
): { command: string; args: string[]; env?: Record<string, string> } {
  return { command, args, ...(def?.env ? { env: def.env } : {}) };
}

/**
 * 에이전트의 mcpServers 할당을 레지스트리 정의로 해석.
 * 반환: spawn --mcp-config에 넣을 서버 맵 + allow/approval 분류.
 */
export function resolveAgentMcpServers(assigned: string[] | undefined): {
  servers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
  allowNames: string[];     // mode=allow → allowedTools에 mcp__<name> 추가
  approvalNames: string[];  // mode=approval → PreToolUse 훅 매처 추가
} {
  const reg = loadMcpRegistry();
  const servers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }> = {};
  const allowNames: string[] = [];
  const approvalNames: string[] = [];
  for (const name of assigned ?? []) {
    const def = reg[name];
    if (!def) { console.warn(`[McpRegistry] 미정의 서버 할당 무시: ${name}`); continue; }
    const resolved = resolveCommandPath(name, def.command, def.args ?? []);
    servers[name] = { command: resolved.command, args: resolved.args, env: def.env };
    if (def.mode === "allow") allowNames.push(name);
    else approvalNames.push(name);  // 기본 approval (안전)
  }
  return { servers, allowNames, approvalNames };
}
