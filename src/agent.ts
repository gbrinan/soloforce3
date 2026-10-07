import { issueWikiWorkerAccess, WIKI_WORKER_GUIDANCE } from './server/wiki/worker-access.js';
import { spawn } from "node:child_process";
import { writeFileSync, existsSync, statSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import type { AgentConfig, AgentResult } from "./types.js";
import { CLAUDE_PATH, CLAUDE_BIN_DIR, PROJECT_SELF_DIR, PROJECTS_DIR, MYCREW_HOME, TSX_BIN, TSX_CLI_ARGS } from "./config.js";
import { computeMemoryDir } from "./mcp/memory-dir.js";
import { safeChildEnvForCli } from "./server/utils/safeChildEnv.js";
import { safeKill } from "./server/utils/platform.js";
import { OVERLOAD_BACKOFFS_MS, isApiOverloadError, sleep, withJitter } from "./claude-error-retry.js";
import { startAgentSpan } from "./server/otel-trace.js";
import { listManifests } from "./server/app-registry.js";
import { buildMcpServerEntry, getMcpServerDef, resolveCommandPath } from "./server/mcp-registry.js";
import { resolveEffort } from "./server/effort-policy.js";
import { computeInvocationCost, SessionCostTracker } from "./server/invocation-cost.js";

// 세션별 CLI 누적 비용 기억 — 재개 호출의 «이번 호출분» 차분 산정용(invocation-cost.ts).
const sessionCostTracker = new SessionCostTracker();

export interface RunAgentOptions {
  cwd?: string;
  resumeSessionId?: string;
  /** 세션 파일이 아직 없을 때 --session-id 로 지정 (--resume 대신) */
  sessionId?: string;
  onProgress?: (message: string) => void;
  onText?: (chunk: string) => void;
  onSystemMessage?: (event: unknown) => void;
  onSpawn?: (pid: number) => void;
  /** 이 호출에 한해 모델 오버라이드 (config.model보다 우선) — 경량 내부 알림 콜용 */
  model?: string;
  /** 이 호출에 한해 effort 오버라이드 (config.effort보다 우선). 잡 단위 지정은 jobs.ts가 config에 주입한다. */
  effort?: string;
  /** 토큰 단위 부분 델타 스트리밍 (--include-partial-messages). onText가 있을 때만 유효. */
  partialStream?: boolean;
}

const TOOL_LABELS: Record<string, string> = {
  Read: "파일 읽는 중", Write: "파일 생성 중", Edit: "파일 수정 중",
  Glob: "파일 검색 중", Grep: "코드 검색 중", Bash: "명령 실행 중",
  Agent: "서브에이전트 실행 중", WebSearch: "웹 검색 중", WebFetch: "웹 페이지 읽는 중",
  mcp__safefs__SafeRead: "파일 읽는 중", mcp__safefs__SafeWrite: "파일 생성 중",
  mcp__safefs__SafeEdit: "파일 수정 중", mcp__safefs__SafeDelete: "파일 삭제 중",
  mcp__safefs__SafeGlob: "파일 검색 중", mcp__safefs__SafeGrep: "코드 검색 중",
  mcp__safefs__SafeBash: "명령 실행 중",
};

// 도구 인자 중 "값"에 해당하는 것(검색 패턴·명령 인자·질의·프롬프트·URL 쿼리)은
// 진행 로그와 OTel 스팬에 원문으로 남기지 않는다.
// WHY: 이 함수가 만든 문자열 하나가 jobs.json(onProgress)과 otel-spans.jsonl(addToolSpan)
// 양쪽에 그대로 기록된다. 그래서 비밀값을 찾으려고 Grep을 돌리면 그 검색어가 상태 파일에
// 새로 심긴다 — 청소 행위가 오염을 만든다(2026-08-08 실사고, ingest-crab 발견).
// 길이도 단서가 되므로 `<...:N chars>` 같은 형태를 쓰지 않고 고정 문자열로 가린다.
// 경로는 위치 정보라 남긴다(진행 표시가 무의미해지지 않도록) — 다만 URL은 쿼리스트링을 자른다.
const REDACTED_ARG = "<redacted>";

export function describeToolUse(tool: string, input: Record<string, unknown>): string {
  const label = TOOL_LABELS[tool] || `${tool} 실행 중`;
  const tail = (v: unknown, n = 60): string => String(v).slice(-n);
  /** 명령은 실행 파일명(첫 토큰)만 남기고 인자를 가린다 — 인자에 토큰·비밀번호가 실린다. */
  const cmdHead = (v: unknown): string => {
    const head = String(v).trim().split(/\s+/)[0] ?? "";
    return `${head.slice(-40)} ${REDACTED_ARG}`;
  };

  if (tool === "Read" && input.file_path) return `${label}: ${tail(input.file_path)}`;
  if (tool === "Write" && input.file_path) return `${label}: ${tail(input.file_path)}`;
  if (tool === "Edit" && input.file_path) return `${label}: ${tail(input.file_path)}`;
  if (tool === "Grep" && input.pattern) return `${label}: ${REDACTED_ARG}${input.path ? ` in ${tail(input.path, 40)}` : ''}`;
  if (tool === "Glob" && input.pattern) return `${label}: ${REDACTED_ARG}`;
  if (tool === "Bash" && input.command) return `${label}: ${cmdHead(input.command)}`;
  if (tool === "WebSearch" && input.query) return `${label}: ${REDACTED_ARG}`;
  if (tool === "WebFetch" && input.url) return `${label}: ${tail(String(input.url).split("?")[0])}`;
  if (tool === "Agent" && input.prompt) return `${label}: ${REDACTED_ARG}`;
  // MCP SafeFS 도구 — path는 위치라 유지, pattern/command는 값이라 가린다
  if (input.path) return `${label}: ${tail(input.path)}`;
  if (input.pattern) return `${label}: ${REDACTED_ARG}`;
  if (input.command) return `${label}: ${cmdHead(input.command)}`;
  return label;
}

function buildPermissionSettings(
  writePaths?: string[],
  denyPaths?: string[],
): { permissions: { allow?: string[]; deny?: string[] } } | null {
  // cwd 무관한 매칭을 위해 각 경로당 (cwd 상대, any-prefix) 2가지 glob 생성
  // PoC R3(절대경로) 실패, R4(**/) 성공 확증 — macOS symlink 회피
  const expand = (p: string): string[] => {
    const rel = p.replace(/^\//, "");
    return [rel, `**/${rel}`];
  };
  const allow: string[] = [];
  const deny: string[] = [];
  for (const p of writePaths ?? []) {
    for (const g of expand(p)) allow.push(`Edit(${g})`, `Write(${g})`);
  }
  for (const p of denyPaths ?? []) {
    for (const g of expand(p)) deny.push(`Edit(${g})`, `Write(${g})`);
  }
  if (allow.length === 0 && deny.length === 0) return null;
  const permissions: { allow?: string[]; deny?: string[] } = {};
  if (allow.length) permissions.allow = [...new Set(allow)];
  if (deny.length) permissions.deny = [...new Set(deny)];
  return { permissions };
}

// MCP config 캐시: 동일 내용이면 tmp 파일 1회 생성 후 재사용 (콜드스타트 비용 절감).
// pid를 파일명에 포함하므로 다른 프로세스와 충돌 없음. OS tmp 자동 정리에 위임.
const mcpConfigPathCache = new Map<string, string>();
/**
 * npx 기반 레지스트리 MCP 서버를 node.exe 직접 실행으로 변환한다.
 * Windows에서 claude가 MCP 서버를 셸 없이 직접 spawn할 때 "npx"는 PATH 미해석,
 * "npx.cmd" 절대경로는 Node 24의 .cmd spawn 금지(EINVAL) + 경로 공백 문제로 실패한다.
 * 설치된 패키지의 bin 진입점을 mycrew node_modules에서 찾아 process.execPath(node.exe
 * 절대경로)로 실행하면 PATH·셸 비의존으로 안정 기동한다. 해석 실패 시 null.
 */
function resolveNpxToNode(args: string[]): { command: string; args: string[] } | null {
  const flagless = args.findIndex((a) => !a.startsWith("-"));
  if (flagless < 0) return null;
  const spec = args[flagless];
  const rest = args.slice(flagless + 1);
  // 선행 @scope는 유지하고 후행 @version만 제거
  const atIdx = spec.lastIndexOf("@");
  const pkgName = atIdx > 0 ? spec.slice(0, atIdx) : spec;
  const pkgDir = join(PROJECT_SELF_DIR, "node_modules", ...pkgName.split("/"));
  const pjPath = join(pkgDir, "package.json");
  if (!existsSync(pjPath)) return null;
  try {
    const pj = JSON.parse(readFileSync(pjPath, "utf-8")) as { bin?: string | Record<string, string>; main?: string };
    const binRel = typeof pj.bin === "string" ? pj.bin : pj.bin ? Object.values(pj.bin)[0] : pj.main;
    if (!binRel) return null;
    const binAbs = join(pkgDir, binRel);
    if (!existsSync(binAbs)) return null;
    return { command: process.execPath, args: [binAbs, ...rest] };
  } catch {
    return null;
  }
}

function getOrCreateMcpConfigPath(content: string, role: string): string {
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
  const cached = mcpConfigPathCache.get(hash);
  if (cached && existsSync(cached)) return cached;
  const path = join(tmpdir(), `mycrew-mcp-${role}-${process.pid}-${hash}.json`);
  if (!existsSync(path)) writeFileSync(path, content, { encoding: "utf-8", mode: 0o600 });
  mcpConfigPathCache.set(hash, path);
  return path;
}

// A2: MCP 서버 실행 커맨드 — 컴파일된 dist 우선 (tsx 트랜스파일 스폰 1~3초 제거).
// src/mcp/*.ts 중 하나라도(의존 파일 포함) dist보다 새로우면 tsx 폴백 — "느리지만 정확" 방향 실패.
// dist 부재(클린 설치·빌드 전)도 tsx 폴백. node는 process.execPath (LaunchAgent PATH 제한 회피).
function resolveMcpCommand(entryBase: string): { command: string; args: string[] } {
  const srcDir = join(PROJECT_SELF_DIR, "src", "mcp");
  const srcEntry = join(srcDir, `${entryBase}.ts`);
  const distEntry = join(PROJECT_SELF_DIR, "dist", "mcp", `${entryBase}.js`);
  try {
    const distMtime = statSync(distEntry).mtimeMs;
    let srcMax = 0;
    for (const f of readdirSync(srcDir)) {
      if (!f.endsWith(".ts")) continue;
      const m = statSync(join(srcDir, f)).mtimeMs;
      if (m > srcMax) srcMax = m;
    }
    if (srcMax <= distMtime) return { command: process.execPath, args: [distEntry] };
    console.warn("[MCP] src/mcp이 dist보다 최신 — tsx 폴백 (npm run build:server 실행 필요)");
  } catch {
    /* dist 없음 등 → tsx 폴백 */
  }
  return { command: TSX_BIN, args: [...TSX_CLI_ARGS, srcEntry] };
}
const resolveSafefsCommand = () => resolveMcpCommand("safefs-server");

/**
 * StaffPanel에서 변경 가능한 권한 레벨 → claude CLI --permission-mode 매핑.
 * admin: 모든 도구 자동 승인 (기존 기본값)
 * standard: edit/write 자동 승인, 그 외 ask
 * restricted: 모든 액션 ask (사실상 워커 헤드리스에선 블록될 수 있음 — 사용자에게 보고)
 * 미지정/알 수 없는 값 → bypassPermissions (하위호환).
 */
export function permissionModeFor(level: string | undefined): "bypassPermissions" | "acceptEdits" | "default" {
  // fail-closed: 명시 개방(admin·workspace)만 bypass. 그 외(normal 포함)은 확인을 거친다.
  // 경계(allowedTools·readPaths/writePaths)가 정의된 직원은 allowlist로 무프롬프트 동작 유지.
  if (level === "admin" || level === "workspace") return "bypassPermissions";
  if (level === "standard" || level === "normal") return "acceptEdits";
  return "default";
}

// 도구 권한 args — runAgent(-p 워커)와 spawnPty(마이크루 PTY)가 공유. (Phase2 신규 PTY 파일 호환)
// 경로가 갈라지면 권한 누락 회귀가 생기므로 한 곳에서 빌드한다.
/**
 * 도구 0 상태 조기 차단 — 실패가 성공으로 집계되는 경로를 막는다.
 *
 * 권한 미설정(allowedTools=[] + readPaths/writePaths 미설정)이면 safefs MCP 서버가 아예
 * 부착되지 않는데 --disallowedTools(Read,Write,Bash…)는 무조건 전달된다. 결과는
 * "도구를 뺏고 대체재도 안 주는" 상태 — 워커는 아무 파일도 못 만지면서 텍스트만 반환하고,
 * 잡은 completed로 마감돼 실패가 조용히 은폐된다.
 * (2026-08-08 자동등재 11명 사고. 2026-08-06 회고 직원 '저장 실패'의 진짜 원인도 이것이다.)
 *
 * 여기서 던져야 jobs.ts 재시도 루프가 잡을 failed로 마감하고 사유를 남긴다.
 * 도입 전 전 직원(29명) 스캔으로 오탐 0(TOOLSET_EMPTY_COUNT=0)을 확인했다.
 */
export function assertToolsetNotEmpty(config: AgentConfig, mcpTools: string[]): void {
  // 텍스트 전용 내부 유틸은 애초에 도구가 필요 없다. 이들까지 막으면 요약·메모리 플러시·
  // 라이브러리안이 조용히 전멸한다(2026-08-08 가드 도입 이후 2026-09-26까지 실제로 그랬다).
  if (config.textOnly === true) return;
  if (mcpTools.length > 0 || config.allowedTools.length > 0) return;
  throw new Error(
    `toolset-empty: ${config.role}(${config.name}) — 권한 미설정으로 가용 도구가 0개입니다. `
    + `history/agents.json 또는 config/agents/${config.role}/meta.json에 `
    + `allowedTools / readPaths / writePaths 중 하나 이상을 설정하세요.`,
  );
}

export function buildPermissionArgs(config: AgentConfig, opts?: { interactive?: boolean; hooks?: Record<string, unknown>; extraAllowedTools?: string[] }): string[] {
  const args: string[] = [];
  if (!opts?.interactive) {
    args.push("--permission-mode", permissionModeFor(config.permissionLevel));
  }
  const hasWritePaths = (config.writePaths?.length ?? 0) > 0;
  const hasReadPaths = (config.readPaths?.length ?? 0) > 0;
  const hasBash = config.allowedTools.includes("Bash") || (config.bashCommands?.length ?? 0) > 0;
  const mcpTools: string[] = [];
  if (hasWritePaths) mcpTools.push("mcp__safefs__SafeWrite", "mcp__safefs__SafeEdit", "mcp__safefs__SafeDelete");
  if (hasReadPaths) mcpTools.push("mcp__safefs__SafeRead", "mcp__safefs__SafeReadImage", "mcp__safefs__SafeGlob", "mcp__safefs__SafeGrep");
  if (hasReadPaths && hasWritePaths) mcpTools.push("mcp__safefs__RenderMarkdownPdf");
  if (hasReadPaths) mcpTools.push("mcp__safefs__WikiSearch", "mcp__safefs__WikiRead", "mcp__safefs__WikiRecordUsage");
  if (hasReadPaths && config.allowedTools.includes("DelegateTask")) mcpTools.push("mcp__safefs__WikiHandoff");
  if (hasBash) mcpTools.push("mcp__safefs__SafeBash");
  if (config.allowedTools.includes("DelegateTask")) mcpTools.push("mcp__safefs__DelegateTask", "mcp__safefs__DelegatePlan");
  if (config.allowedTools.includes("SendToPartner")) mcpTools.push("mcp__safefs__SendToPartner");
  if (config.allowedTools.includes("RequestPartnership")) mcpTools.push("mcp__safefs__RequestPartnership");
  if (config.allowedTools.includes("RotatePartnerToken")) mcpTools.push("mcp__safefs__RotatePartnerToken");
  if (config.allowedTools.includes("UpdateMyProfile")) mcpTools.push("mcp__safefs__UpdateMyProfile");
  if (opts?.interactive) {
    mcpTools.push(
      "mcp__safefs__submit_response",
      "mcp__safefs__post_message",
      "mcp__safefs__ask",
      "mcp__safefs__resolve_approval",
      "mcp__safefs__set_auto_mode",
      "mcp__safefs__reset_session",
      "mcp__safefs__restart_server",
      "mcp__safefs__save_wiki",
      "mcp__safefs__manage_schedule",
      "mcp__safefs__manage_task",
      "mcp__safefs__advance_task",
      "mcp__safefs__get_job_result",
      "mcp__safefs__manage_mcp",
    );
  }
  // registry MCP(notion/excel/lighthouse 등): allow 모드 서버의 도구를 서버 단위로 허용.
  for (const _mcpName of config.mcpServers ?? []) {
    const _def = getMcpServerDef(_mcpName);
    if (_def && _def.mode === "allow") mcpTools.push(`mcp__${_mcpName}`);
  }
  assertToolsetNotEmpty(config, mcpTools);
  const effectiveAllowedTools = mcpTools.length > 0
    ? [...config.allowedTools.filter(t => !["DelegateTask", "SendToPartner", "RequestPartnership", "RotatePartnerToken", "UpdateMyProfile"].includes(t)), ...mcpTools]
    : config.allowedTools;
  const withExtra = opts?.extraAllowedTools?.length
    ? [...effectiveAllowedTools, ...opts.extraAllowedTools]
    : effectiveAllowedTools;
  if (withExtra.length > 0) {
    args.push("--allowedTools", withExtra.join(","));
  }
  const disallowed: string[] = [
    "Read", "Write", "Edit", "Glob", "Grep",
    "MultiEdit", "NotebookEdit",
    "Bash", "TodoRead", "TodoWrite", "SendUserMessage",
    "CronCreate", "CronDelete", "CronList", "ScheduleWakeup",
    "AskUserQuestion", "ExitPlanMode",
    ...(config.extraDisallowedTools ?? []),
  ];
  args.push("--disallowedTools", disallowed.join(","));
  const permSettings = buildPermissionSettings(config.writePaths, config.denyPaths);
  const settings: Record<string, unknown> = permSettings ? { ...permSettings } : {};
  if (opts?.hooks) settings.hooks = opts.hooks;
  if (Object.keys(settings).length > 0) {
    args.push("--settings", JSON.stringify(settings));
  }
  return args;
}

export async function runAgent(
  config: AgentConfig,
  taskId: string,
  prompt: string,
  cwdOrOptions?: string | RunAgentOptions,
): Promise<AgentResult> {
  const options: RunAgentOptions =
    typeof cwdOrOptions === "string"
      ? { cwd: cwdOrOptions }
      : cwdOrOptions ?? {};

  const args: string[] = [];

  if (options.resumeSessionId) {
    args.push("--resume", options.resumeSessionId, "-p", "-");
  } else if (options.sessionId) {
    args.push("--session-id", options.sessionId, "-p", "-");
  } else {
    args.push("-p", "-");
  }

  // onProgress 또는 onText가 있으면 stream-json
  const streaming = !!(options.onProgress || options.onText);
  if (streaming) args.push("--verbose");
  // A1: 토큰 단위 델타 (stream_event) — 스트리밍 + partialStream 요청 시에만
  const partialStream = streaming && options.partialStream === true && !!options.onText;
  if (partialStream) args.push("--include-partial-messages");
  args.push(
    "--output-format",
    streaming ? "stream-json" : "json",
    "--max-turns",
    String(config.maxTurns),
    "--permission-mode",
    permissionModeFor(config.permissionLevel),
  );
  const model = options.model ?? config.model;
  if (model) {
    args.push("--model", model);
    console.log(`[${config.name}] model: ${model}${options.model ? " (call override)" : ""}`);
  }
  // effort — 미지정 시 코드 기본값 low. 세 조립 지점(여기·worker-pty·terminal-ws)이
  // 같은 함수를 부르므로 경로마다 값이 갈라질 수 없다. effort-policy.ts 주석 참고.
  const effort = resolveEffort({ jobEffort: options.effort, configEffort: config.effort }).effort;
  args.push("--effort", effort);
  console.log(`[${config.name}] effort: ${effort}${options.effort ? " (call override)" : ""}`);
  // MCP 하이브리드: writePaths/readPaths 있는 에이전트는 MCP 도구만 허용하고 내장 Read/Write/Edit 차단
  // (CLI 권한 엔진 비결정성 우회 — MCP 진입점에서 결정적 path 검증)
  const hasWritePaths = (config.writePaths?.length ?? 0) > 0;
  const hasReadPaths = (config.readPaths?.length ?? 0) > 0;

  const hasBash = config.allowedTools.includes("Bash") || (config.bashCommands?.length ?? 0) > 0;
  const mcpTools: string[] = [];
  if (hasWritePaths) mcpTools.push("mcp__safefs__SafeWrite", "mcp__safefs__SafeEdit", "mcp__safefs__SafeDelete");
  if (hasReadPaths) mcpTools.push("mcp__safefs__SafeRead", "mcp__safefs__SafeReadImage", "mcp__safefs__SafeGlob", "mcp__safefs__SafeGrep");
  if (hasReadPaths && hasWritePaths) mcpTools.push("mcp__safefs__RenderMarkdownPdf");
  if (hasReadPaths) mcpTools.push("mcp__safefs__WikiSearch", "mcp__safefs__WikiRead", "mcp__safefs__WikiRecordUsage");
  if (hasReadPaths && config.allowedTools.includes("DelegateTask")) mcpTools.push("mcp__safefs__WikiHandoff");
  if (hasBash) mcpTools.push("mcp__safefs__SafeBash");
  if (config.allowedTools.includes("DelegateTask")) mcpTools.push("mcp__safefs__DelegateTask");
  if (config.allowedTools.includes("SendToPartner")) mcpTools.push("mcp__safefs__SendToPartner");
  if (config.allowedTools.includes("RequestPartnership")) mcpTools.push("mcp__safefs__RequestPartnership");
  if (config.allowedTools.includes("RotatePartnerToken")) mcpTools.push("mcp__safefs__RotatePartnerToken");

  assertToolsetNotEmpty(config, mcpTools);
  const effectiveAllowedTools = mcpTools.length > 0
    ? [...config.allowedTools.filter(t => !["DelegateTask", "SendToPartner", "RequestPartnership", "RotatePartnerToken"].includes(t)), ...mcpTools]
    : [...config.allowedTools];
  // 할당된 registry MCP 서버(notion 등)의 도구를 allowlist에 포함한다.
  // 서버는 하단(line ~401)에서 자식 claude에 부착되지만, --allowedTools 화이트리스트가
  // 활성(길이>0)일 때 mcp__<server> 와일드카드가 없으면 그 서버 도구 호출이 전부 차단된다.
  // (로컬 @notionhq 쓰기 도구 mcp__notion__API-post-page 등이 미동작하던 근본 원인.)
  // allowlist가 비어 있으면(=전체 허용) 손대지 않는다 — 축소 회귀 방지.
  if (effectiveAllowedTools.length > 0 && (config.mcpServers?.length ?? 0) > 0) {
    for (const _srv of config.mcpServers!) {
      const _wild = `mcp__${_srv}`;
      if (!effectiveAllowedTools.includes(_wild)) effectiveAllowedTools.push(_wild);
    }
  }
  if (effectiveAllowedTools.length > 0) {
    args.push("--allowedTools", effectiveAllowedTools.join(","));
  }

  // CLI 내장 도구 전역 차단 — Agent, WebSearch, WebFetch + MCP 도구만 허용
  // (2026-04-24 사장님 지시: 내장 도구 전부 막고 MCP 강제)
  const disallowed: string[] = [
    "Read", "Write", "Edit", "Glob", "Grep",
    "MultiEdit", "NotebookEdit",
    "Bash", "TodoRead", "TodoWrite", "SendUserMessage",
    "CronCreate", "CronDelete", "CronList", "ScheduleWakeup",
    ...(config.extraDisallowedTools ?? []),
  ];
  args.push("--disallowedTools", disallowed.join(","));

  const permSettings = buildPermissionSettings(config.writePaths, config.denyPaths);
  if (permSettings) {
    args.push("--settings", JSON.stringify(permSettings));
  }

  const wikiGrant = hasReadPaths ? issueWikiWorkerAccess({ agent: config.role, jobId: taskId, home: MYCREW_HOME,
    readPaths: config.readPaths ?? [], sensitivePaths: config.readSensitivePaths ?? [], canDelegate: config.allowedTools.includes("DelegateTask") }) : undefined;
  let mcpConfigPath: string | undefined;
  try {
  // MCP 서버 config 임시 파일 (writePaths or readPaths or bash 있는 에이전트)
  // 동일 내용은 캐시 재사용 — 매 호출마다 write/unlink 생략.
  if (hasWritePaths || hasReadPaths || hasBash) {
    const safefsCmd = resolveSafefsCommand();
    const mcpServers: Record<string, unknown> = {
        safefs: {
          command: safefsCmd.command,
          args: safefsCmd.args,
          env: {
            // 멀티 인스턴스: 자기 인스턴스의 partners.json은 writePaths 가진 모든 직원에 자동 허용.
            // SELF prefix 라우팅(MYCREW_HOME 기준)이 인스턴스 간 격리를 보장.
            MCP_WRITE_PATHS: (() => {
              const base = config.writePaths ?? [];
              if (base.length === 0) return "";
              const augmented = new Set(base);
              augmented.add("/history/external/partners.json");
              return Array.from(augmented).join(",");
            })(),
            MCP_READ_PATHS: config.readPaths?.join(",") ?? "",
            MCP_BASH_ENABLED: hasBash ? "1" : "",
            MCP_BASH_COMMANDS: config.bashCommands?.join(",") ?? "",
            MCP_BASH_PATHS: config.bashPaths?.join(",") ?? "",
            MCP_BASH_EXTRA_BASES: config.bashExtraBases?.join(",") ?? "",
            MCP_WRITE_EXTRA_BASES: config.writeExtraBases?.join(",") ?? "",
            MCP_READ_SENSITIVE: config.readSensitivePaths?.join(",") ?? "",
            MCP_WRITE_SENSITIVE: config.writeSensitivePaths?.join(",") ?? "",
            MCP_BASH_SENSITIVE_PATTERNS: config.bashSensitivePatterns?.join(",") ?? "",
            MCP_APPROVAL_URL: `http://127.0.0.1:${process.env.PORT ?? 3456}/api/approvals`,
            MCP_DELEGATE_URL: `http://127.0.0.1:${process.env.PORT ?? 3456}/api/delegate`,
            MCP_SEND_PARTNER_URL: `http://127.0.0.1:${process.env.PORT ?? 3456}/api/genie/external-send`,
            MCP_REQUEST_PARTNERSHIP_URL: `http://127.0.0.1:${process.env.PORT ?? 3456}/api/genie/external-partner-request`,
            MCP_ROTATE_TOKEN_URL: `http://127.0.0.1:${process.env.PORT ?? 3456}/api/genie/external-rotate-token`,
            MCP_AGENT_ROLE: config.role,
            MCP_JOB_ID: taskId,
            MCP_WIKI_URL: `http://127.0.0.1:${process.env.PORT ?? 3456}/api/wiki-worker`,
            MCP_WIKI_TOKEN: wikiGrant?.token ?? "",
            MCP_CWD: options.cwd ?? PROJECT_SELF_DIR,
            MCP_SELF_DIR: PROJECT_SELF_DIR,
            MCP_MYCREW_HOME: MYCREW_HOME,
            MCP_PROJECTS_DIR: PROJECTS_DIR,
            MCP_EXTRA_BASES: (() => {
              const memDir = computeMemoryDir(options.cwd ?? PROJECT_SELF_DIR);
              return existsSync(memDir) ? memDir : "";
            })(),
          },
        },
    };
    if (config.enablePlaywright === true) {
      mcpServers.playwright = resolveCommandPath("playwright", "npx", ["-y", "@playwright/mcp@latest", "--headless"]);
    }
    const mcpConfig = { mcpServers };
    // legal-counsel 전용: 한국 법령/판례 조회 MCP(korean-law-mcp).
    // LAW_OC(국가법령정보 OpenAPI OC키)가 있을 때만 부착 — 키 없으면 미동작.
    const lawOc = process.env.LAW_OC;
    if (config.role === "legal-counsel" && lawOc) {
      (mcpConfig.mcpServers as Record<string, unknown>)["korean-law"] = {
        command: "npx",
        args: ["-y", "korean-law-mcp"],
        env: { LAW_OC: lawOc },
      };
    }
    // genie(오케스트레이터) 전용: 앱 데이터(ledger/bookshelf/booking) 통합 질의 MCP (읽기 전용 GET).
    // 앱 프록시(/api/apps/:id/proxy)를 경유하므로 호스트 포트만 전달, 설치 앱 목록은 app-registry가 제공.
    if (config.role === "orchestrator") {
      const appdataCmd = resolveMcpCommand("appdata-server");
      (mcpConfig.mcpServers as Record<string, unknown>)["appdata"] = {
        command: appdataCmd.command,
        args: appdataCmd.args,
        env: {
          MCP_APPDATA_BASE_URL: `http://127.0.0.1:${process.env.PORT ?? 3456}`,
          MCP_APPDATA_APPS: listManifests().map((m) => m.id).join(","),
        },
      };
      // 앱 AI 라우트를 도구로 노출 (appdata의 AI/쓰기 버전). 앱 프록시 경유 POST.
      const appsAiCmd = resolveMcpCommand("apps-ai-server");
      (mcpConfig.mcpServers as Record<string, unknown>)["apps-ai"] = {
        command: appsAiCmd.command,
        args: appsAiCmd.args,
        env: {
          MCP_APPSAI_BASE_URL: `http://127.0.0.1:${process.env.PORT ?? 3456}`,
          MCP_APPSAI_APPS: listManifests().map((m) => m.id).join(","),
        },
      };
    }
    // registry MCP 서버(notion 등) 부착 — 워커 mcpServers 필드를 실제 Claude CLI spawn에 반영.
    // Windows: claude가 MCP 서버를 셸 없이 직접 spawn하므로 bare "npx"/"npm"은 해석 불가
    // ("npx는 실행 가능한 프로그램이 아닙니다"). cmd /c 로 감싸 PATH 해석을 위임한다.
    for (const _mcpName of config.mcpServers ?? []) {
      if ((mcpConfig.mcpServers as Record<string, unknown>)[_mcpName]) continue;
      const _def = getMcpServerDef(_mcpName);
      if (!_def) continue;
      let _cmd: string = _def.command;
      let _args: string[] = _def.args ? [..._def.args] : [];
      // npx/npm 기반 서버는 node.exe 직접 실행으로 변환(PATH·셸 비의존, Windows spawn 안정).
      // 1순위: 로컬 node_modules에 설치돼 있으면 그 bin (다운로드 없음).
      const _local = (_cmd === "npx" || _cmd === "npm" || _cmd === "npx.cmd" || _cmd === "npm.cmd")
        ? resolveNpxToNode(_args) : null;
      if (_local) { _cmd = _local.command; _args = _local.args; }
      else {
        // 2순위: 공용 해석기 — npx-cli.js 직접 호출 / cmd 래퍼 제거 / PATH·~/.claude.json 조회.
        const _resolved = resolveCommandPath(_mcpName, _cmd, _args);
        _cmd = _resolved.command; _args = _resolved.args;
      }
      (mcpConfig.mcpServers as Record<string, unknown>)[_mcpName] = buildMcpServerEntry(_cmd, _args, _def);
    }
    mcpConfigPath = getOrCreateMcpConfigPath(JSON.stringify(mcpConfig), config.role);
    args.push("--mcp-config", mcpConfigPath);
  }

  if (!options.resumeSessionId) {
    args.push("--append-system-prompt", config.systemPrompt + (hasReadPaths ? WIKI_WORKER_GUIDANCE : ""));
  } else if (hasReadPaths) {
    args.push("--append-system-prompt", WIKI_WORKER_GUIDANCE);
  }

  console.log(`\n[${config.name}] 작업 시작: ${prompt.slice(0, 80)}...`);

  const maxOverloadRetries = OVERLOAD_BACKOFFS_MS.length;
  for (let overloadAttempt = 0; overloadAttempt <= maxOverloadRetries; overloadAttempt++) {
   let rawOutput = "";
   // OTel GenAI 스팬: 시도(attempt)당 1개 — 재시도 시 이전 스팬은 continue 전에 에러로 종료.
   // startAgentSpan/addToolSpan/end는 내부 try/catch로 절대 throw하지 않음 (실행 경로 무영향).
   const otelSpan = startAgentSpan({ agentName: config.name, agentRole: config.role, taskId, model: model ?? undefined });
   try {
    const extraFromConfig: Record<string, string> = Object.fromEntries(
      (config.allowedEnvKeys ?? [])
        .map((k) => [k, process.env[k]])
        .filter((e): e is [string, string] => typeof e[1] === "string"),
    );
    const output = streaming
      ? await spawnClaudeStream(args, prompt, options.cwd, options.onProgress, options.onText, options.onSystemMessage, options.onSpawn, extraFromConfig, partialStream, (toolName, desc) => otelSpan.addToolSpan(toolName, desc))
      : await spawnClaude(args, prompt, options.cwd, options.onSpawn, extraFromConfig);
    rawOutput = output;

    const parsed = JSON.parse(output);
    const result = parsed.result ?? output;
    const sessionId = parsed.session_id as string | undefined;

    // 비용/토큰 데이터 추출
    // ★ 2026-10-02: total_cost_usd 는 세션 누적값이다(--resume 시 직전 비용까지 포함).
    //   이번 호출분만 남기도록 invocation-cost.ts 로 환산한다(근거는 그 파일 머리말).
    const cliTotalUsd = typeof parsed.total_cost_usd === "number" ? parsed.total_cost_usd : 0;
    const usedModel = model ?? (parsed.modelUsage && typeof parsed.modelUsage === "object" ? Object.keys(parsed.modelUsage)[0] : undefined);
    const invocation = computeInvocationCost({
      cliTotalUsd,
      resumed: !!options.resumeSessionId,
      prevCumulativeUsd: sessionCostTracker.get(options.resumeSessionId),
      usage: {
        inputTokens: parsed.usage?.input_tokens ?? 0,
        outputTokens: parsed.usage?.output_tokens ?? 0,
        cacheReadTokens: parsed.usage?.cache_read_input_tokens ?? 0,
        cacheCreateTokens: parsed.usage?.cache_creation_input_tokens ?? 0,
      },
      model: usedModel,
    });
    sessionCostTracker.set(sessionId, cliTotalUsd);
    const cost = {
      costUsd: invocation.costUsd,
      costMethod: invocation.costMethod,
      inputTokens: parsed.usage?.input_tokens ?? 0,
      outputTokens: parsed.usage?.output_tokens ?? 0,
      cacheReadTokens: parsed.usage?.cache_read_input_tokens ?? 0,
      cacheCreateTokens: parsed.usage?.cache_creation_input_tokens ?? 0,
      durationMs: typeof parsed.duration_ms === "number" ? parsed.duration_ms : 0,
      // 이 호출이 실제로 CLI 에 넘긴 모델(--model). logCost 가 `...cost` 로 펼쳐
      // cost-log.jsonl 에 그대로 적재되고, agent-model-usage.ts 가 읽는다.
      //
      // 왜 필요한가: 모델 정책(internal-source-tier 등)의 라이브 검증이 그동안 단가 지문
      // 역추정에 의존했다. 지문은 "이 행이 싼 모델이었다"까지만 말하고 "어느 발화였다"를
      // 말하지 못해 3회 연속 판정 불가로 끝났다. 여기서 모델명을 직접 남긴다.
      //
      // ⚠️ 미지정(에이전트 기본 모델 사용)은 반드시 undefined 로 남긴다. 항상 채우면
      // "기본 모델 유지" 축의 음성 대조가 통째로 무의미해진다.
      model: model ?? undefined,
    };

    const subtype = typeof parsed.subtype === "string" ? parsed.subtype : "";
    
    // subtype이 "success"면 무조건 성공 (QA 보고서 기반 안정화)
    if (subtype === "success") {
      console.log(`[${config.name}] 작업 완료 ($${cost.costUsd.toFixed(4)})`);
      otelSpan.end({ success: true, inputTokens: cost.inputTokens, outputTokens: cost.outputTokens, cacheReadTokens: cost.cacheReadTokens, costUsd: cost.costUsd });
      return {
        agentRole: config.role,
        taskId,
        success: true,
        output: result,
        sessionId,
        cost,
      };
    }

    const isError =
      parsed.is_error === true ||
      subtype.startsWith("error_") ||
      (Array.isArray(parsed.errors) && parsed.errors.length > 0);

    if (isError) {
      const errMsg =
        Array.isArray(parsed.errors) && parsed.errors.length > 0
          ? String(parsed.errors[0])
          : subtype || "알 수 없는 에러";
      const resultStr = typeof result === "string" ? result : "";
      if (overloadAttempt < maxOverloadRetries && (isApiOverloadError(errMsg) || isApiOverloadError(resultStr))) {
        const backoff = withJitter(OVERLOAD_BACKOFFS_MS[overloadAttempt]);
        console.warn(`[${config.name}] API 과부하(529/429) 감지 — ${backoff}ms 후 재시도 (${overloadAttempt + 1}/${maxOverloadRetries})`);
        otelSpan.end({ success: false, errorMessage: errMsg });
        await sleep(backoff);
        continue;
      }
      console.error(`[${config.name}] 작업 실패 (CLI 에러): ${errMsg}`);
      otelSpan.end({ success: false, inputTokens: cost.inputTokens, outputTokens: cost.outputTokens, cacheReadTokens: cost.cacheReadTokens, costUsd: cost.costUsd, errorMessage: errMsg });
      return {
        agentRole: config.role,
        taskId,
        success: false,
        output: typeof result === "string" ? result : "",
        error: errMsg,
        sessionId,
        cost,
      };
    }

    console.log(`[${config.name}] 작업 완료 ($${cost.costUsd.toFixed(4)})`);

    otelSpan.end({ success: true, inputTokens: cost.inputTokens, outputTokens: cost.outputTokens, cacheReadTokens: cost.cacheReadTokens, costUsd: cost.costUsd });
    return {
      agentRole: config.role,
      taskId,
      success: true,
      output: result,
      sessionId,
      cost,
    };
   } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (overloadAttempt < maxOverloadRetries && (isApiOverloadError(errorMsg) || isApiOverloadError(rawOutput))) {
      const backoff = withJitter(OVERLOAD_BACKOFFS_MS[overloadAttempt]);
      console.warn(`[${config.name}] API 과부하(529/429) 감지 — ${backoff}ms 후 재시도 (${overloadAttempt + 1}/${maxOverloadRetries})`);
      otelSpan.end({ success: false, errorMessage: errorMsg });
      await sleep(backoff);
      continue;
    }
    const shortErr = errorMsg.slice(0, 300);
    console.error(`[${config.name}] 작업 실패: ${shortErr}`);

    otelSpan.end({ success: false, errorMessage: errorMsg });
    return {
      agentRole: config.role,
      taskId,
      success: false,
      output: "",
      error: errorMsg,
    };
   }
  }
  // 재시도 루프 소진 — 마지막 시도는 항상 return하므로 도달 불가. 타입 안정성용 fallback.
  return {
    agentRole: config.role,
    taskId,
    success: false,
    output: "",
    error: "API 과부하 재시도 소진",
  };
  } finally {
    wikiGrant?.revoke();
    if (wikiGrant && mcpConfigPath) {
      rmSync(mcpConfigPath, { force: true });
      for (const [key, value] of mcpConfigPathCache) if (value === mcpConfigPath) mcpConfigPathCache.delete(key);
    }
  }
  // Wiki capability configs are removed above; configs without a capability remain cached.
}

// 기존 방식 (buffered)
// claude CLI 자식 프로세스 강제 kill 타이머.
// 60분 — DocuSeal 전체 번역, appstore 클로닝 등 장시간 작업 수용.
// 잡 시스템의 leaseSec/timeoutSec(routes.ts)와는 독립적 — 이 상수는 단일 claude 호출 단위 한도.
const PROCESS_TIMEOUT = 60 * 60 * 1000;

// 자식 프로세스(claude CLI)에 전달할 환경변수 화이트리스트
// APPROVAL_RESOLVE_TOKEN 등 mycrew 서버 비밀이 자식에 누출되지 않도록 명시 키만 통과.


function spawnClaude(args: string[], stdinData?: string, cwd?: string, onSpawn?: (pid: number) => void, extraEnv?: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(CLAUDE_PATH, args, {
      cwd: cwd || undefined,
      env: safeChildEnvForCli({ PATH: `${process.env.PATH ?? ""}${process.platform === "win32" ? ";" : ":"}${CLAUDE_BIN_DIR}`, ...extraEnv }),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    if (proc.pid && onSpawn) { try { onSpawn(proc.pid); } catch { /* 콜백 실패 무시 */ } }

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // SIGTERM 후 유예 시간 내 종료 안 되면 SIGKILL 에스컬레이션 (SIGTERM 무시 프로세스 좀비화 방지).
      safeKill(proc, "SIGTERM");
      setTimeout(() => {
        if (proc.exitCode === null && proc.signalCode === null) safeKill(proc, "SIGKILL");
      }, 5000).unref?.();
      reject(new Error("claude 프로세스 타임아웃 (60분)"));
    }, PROCESS_TIMEOUT);

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    proc.stdout.on("data", (d: Buffer) => chunks.push(d));
    proc.stderr.on("data", (d: Buffer) => errChunks.push(d));

    proc.on("close", (code, signal) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      const stdout = Buffer.concat(chunks).toString("utf-8");
      const stderr = Buffer.concat(errChunks).toString("utf-8");
      if (code === 0) { resolve(stdout); return; }
      try {
        const parsed = JSON.parse(stdout);
        if (parsed.result) { resolve(stdout); return; }
      } catch { /* */ }
      // code=null이면 시그널로 종료된 것(SIGKILL=리스 회수기/사용자 취소 등). signal을 명시해 오진 방지.
      const cause = code === null && signal
        ? `시그널 ${signal}로 종료됨(외부 kill — 리스 만료/취소 가능성)`
        : `exit ${code}`;
      reject(new Error(`claude ${cause}: ${stderr || stdout || "(출력 없음)"}${cwd ? ` (cwd: ${cwd})` : ""}`));
    });

    if (stdinData && proc.stdin) {
      // EPIPE 방지: stream error 핸들러 (stream pipe 강건화)
      // 2026-06-11: dev-pm stdin EPIPE 방지 완료
      proc.stdin.on("error", (err) => {
        // EPIPE는 보통 "거대 프롬프트"가 아니라 자식 claude가 이미 죽어서(SIGKILL/인증실패/CLI오류)
        // stdin을 못 받는 것. 여기서 단정하지 말고 'close' 핸들러가 실제 code/stderr로 reject하도록 양보.
        // (2026-06-24: 오진 라벨 제거 — EPIPE를 즉시 실패로 보지 않고 close의 정확한 원인을 기다림)
        console.error(`[STDIN] write 실패 (자식 조기종료 추정): ${(err as NodeJS.ErrnoException).code || err.message}`);
      });

      // backpressure 처리: write가 false 반환 시 drain 대기
      const writePromise = new Promise<void>((resolveWrite, rejectWrite) => {
        if (!proc.stdin) { resolveWrite(); return; }
        const written = proc.stdin.write(stdinData, "utf-8", (err) => {
          if (err) rejectWrite(err);
        });
        if (written) {
          proc.stdin.end();
          resolveWrite();
        } else {
          proc.stdin.once("drain", () => {
            proc.stdin!.end();
            resolveWrite();
          });
        }
      });
      writePromise.catch((err) => {
        // EPIPE 등 write 실패는 자식 조기종료의 증상 — close 핸들러가 실제 exit code/stderr로
        // reject하도록 양보하고 여기선 로깅만. (2026-06-24: 진단 가림 방지)
        const code = (err as NodeJS.ErrnoException)?.code;
        console.error(`[STDIN] write 실패 (${code || (err instanceof Error ? err.message : String(err))}) — close에서 실제 원인 판정`);
        // 자식이 끝내 close되지 않는 드문 경우를 위한 안전망: 3초 후에도 미해결이면 그때 reject.
        setTimeout(() => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(new Error(`stdin write 실패 후 자식 무응답: ${code || "EPIPE"}`));
          }
        }, 3000);
      });
    }
  });
}

// 스트리밍 방식 (실시간 진행 + 텍스트 스트리밍)
function spawnClaudeStream(
  args: string[],
  stdinData: string | undefined,
  cwd: string | undefined,
  onProgress?: (message: string) => void,
  onText?: (chunk: string) => void,
  onSystemMessage?: (event: unknown) => void,
  onSpawn?: (pid: number) => void,
  extraEnv?: Record<string, string>,
  partialStream?: boolean,
  onToolUse?: (toolName: string, desc: string) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(CLAUDE_PATH, args, {
      cwd: cwd || undefined,
      env: safeChildEnvForCli({ PATH: `${process.env.PATH ?? ""}${process.platform === "win32" ? ";" : ":"}${CLAUDE_BIN_DIR}`, ...extraEnv }),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    if (proc.pid && onSpawn) { try { onSpawn(proc.pid); } catch { /* 콜백 실패 무시 */ } }

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // SIGTERM 후 유예 시간 내 종료 안 되면 SIGKILL 에스컬레이션 (SIGTERM 무시 프로세스 좀비화 방지).
      safeKill(proc, "SIGTERM");
      setTimeout(() => {
        if (proc.exitCode === null && proc.signalCode === null) safeKill(proc, "SIGKILL");
      }, 5000).unref?.();
      reject(new Error("claude 프로세스 타임아웃 (60분)"));
    }, PROCESS_TIMEOUT);

    let lastResult = "";
    let sessionId = "";
    let buffer = "";

    proc.stdout.on("data", (data: Buffer) => {
      buffer += data.toString("utf-8");
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);

          // tool_use 이벤트 → 진행 상황 + OTel 도구 스팬 (onProgress 없이 스트리밍만 해도 스팬은 수집)
          if (event.type === "assistant" && (onProgress || onToolUse)) {
            const contents = event.message?.content;
            if (Array.isArray(contents)) {
              const last = contents[contents.length - 1];
              if (last?.type === "tool_use" && last.name) {
                try {
                  const desc = describeToolUse(last.name, last.input || {});
                  if (onToolUse) {
                    try { onToolUse(last.name, desc); } catch { /* 스팬 실패 무시 */ }
                  }
                  if (onProgress) {
                    console.log(`[Stream] tool_use: ${desc}`);
                    onProgress(desc);
                  }
                } catch { /* 콜백 실패 무시 */ }
              }
            }
          }

          // 텍스트 스트리밍 (블록 단위) — partialStream 시엔 델타로 대체 (이중 출력 방지)
          if (event.type === "assistant" && onText && !partialStream) {
            const contents = event.message?.content;
            if (Array.isArray(contents)) {
              for (const c of contents) {
                if (c.type === "text" && c.text) {
                  try { onText(c.text); } catch { /* 콜백 실패 무시 */ }
                }
              }
            }
          }

          // 텍스트 스트리밍 (토큰 단위 델타) — thinking_delta 등은 제외, text_delta만
          if (event.type === "stream_event" && onText && partialStream) {
            const ev = event.event;
            if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
              try { onText(ev.delta.text); } catch { /* 콜백 실패 무시 */ }
            }
          }

          // task-notification 등 시스템 메시지 캐치 (백그라운드 Agent 결과 영구 저장)
          // type=system: SDK system 메시지 (init/task-notification 등)
          // type=user + tool_result: subagent 결과 회수 (마이크루 답변 인용 무관 영구 보존)
          if (onSystemMessage) {
            try {
              if (event.type === "system") {
                onSystemMessage(event);
              } else if (event.type === "user") {
                const contents = event.message?.content;
                const hasToolResult = Array.isArray(contents)
                  && contents.some((c: { type?: string }) => c?.type === "tool_result");
                if (hasToolResult) onSystemMessage(event);
              }
            } catch { /* 콜백 실패 무시 */ }
          }

          // 결과 수집
          if (event.type === "result") {
            lastResult = JSON.stringify(event);
            sessionId = event.session_id || "";
          }
        } catch {
          // JSON 파싱 실패 무시
        }
      }
    });

    const errChunks: Buffer[] = [];
    proc.stderr.on("data", (d: Buffer) => errChunks.push(d));

    proc.on("close", (code, signal) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      // 남은 버퍼 처리
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer);
          if (event.type === "result") lastResult = JSON.stringify(event);
        } catch { /* */ }
      }

      if (lastResult) {
        resolve(lastResult);
        return;
      }

      const stderr = Buffer.concat(errChunks).toString("utf-8");
      if (code === 0) {
        // 결과 없이 정상 종료 — exit 0이지만 실제 실패일 수 있음.
        // stderr를 결과 본문에 포함시켜 가시화하고, subtype을 error_no_result로 마킹.
        console.warn("[Claude] stream-json: result 이벤트 없이 종료됨 — stderr 길이=" + stderr.length);
        const errSnippet = stderr.trim().slice(0, 2000);
        const body = errSnippet
          ? `(claude 빈 결과로 종료 — stderr 인용)\n${errSnippet}`
          : "(claude 빈 결과로 종료 — stderr 없음)";
        resolve(JSON.stringify({
          result: body,
          session_id: sessionId,
          subtype: "error_no_result",
          is_error: true,
        }));
      } else {
        const cause = code === null && signal
          ? `시그널 ${signal}로 종료됨(외부 kill — 리스 만료/취소 가능성)`
          : `exit ${code}`;
        reject(new Error(`claude ${cause}: ${stderr || "(stderr 없음)"}${cwd ? ` (cwd: ${cwd})` : ""}`));
      }
    });

    if (stdinData && proc.stdin) {
      // EPIPE 방지: stream error 핸들러 (stream pipe 강건화)
      // 2026-06-11: dev-pm stdin EPIPE 방지 완료
      proc.stdin.on("error", (err) => {
        // EPIPE는 보통 "거대 프롬프트"가 아니라 자식 claude가 이미 죽어서(SIGKILL/인증실패/CLI오류)
        // stdin을 못 받는 것. 여기서 단정하지 말고 'close' 핸들러가 실제 code/stderr로 reject하도록 양보.
        // (2026-06-24: 오진 라벨 제거 — EPIPE를 즉시 실패로 보지 않고 close의 정확한 원인을 기다림)
        console.error(`[STDIN] write 실패 (자식 조기종료 추정): ${(err as NodeJS.ErrnoException).code || err.message}`);
      });

      // backpressure 처리: write가 false 반환 시 drain 대기
      const writePromise = new Promise<void>((resolveWrite, rejectWrite) => {
        if (!proc.stdin) { resolveWrite(); return; }
        const written = proc.stdin.write(stdinData, "utf-8", (err) => {
          if (err) rejectWrite(err);
        });
        if (written) {
          proc.stdin.end();
          resolveWrite();
        } else {
          proc.stdin.once("drain", () => {
            proc.stdin!.end();
            resolveWrite();
          });
        }
      });
      writePromise.catch((err) => {
        // EPIPE 등 write 실패는 자식 조기종료의 증상 — close 핸들러가 실제 exit code/stderr로
        // reject하도록 양보하고 여기선 로깅만. (2026-06-24: 진단 가림 방지)
        const code = (err as NodeJS.ErrnoException)?.code;
        console.error(`[STDIN] write 실패 (${code || (err instanceof Error ? err.message : String(err))}) — close에서 실제 원인 판정`);
        // 자식이 끝내 close되지 않는 드문 경우를 위한 안전망: 3초 후에도 미해결이면 그때 reject.
        setTimeout(() => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(new Error(`stdin write 실패 후 자식 무응답: ${code || "EPIPE"}`));
          }
        }, 3000);
      });
    }
  });
}
