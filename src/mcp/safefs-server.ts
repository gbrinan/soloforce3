import { registerWikiTools } from './wiki-tools.js';
// SafeFS + SafeBash MCP 서버
// 모든 파일 접근과 셸 실행을 화이트리스트로 통제
// 환경변수:
//   MCP_WRITE_PATHS, MCP_READ_PATHS (콤마 구분, CWD 또는 SELF_DIR 기준 상대경로)
//   MCP_BASH_ENABLED, MCP_BASH_COMMANDS, MCP_BASH_PATHS
//   MCP_CWD (현재 작업 디렉토리 — self 또는 외부 프로젝트)
//   MCP_SELF_DIR (시스템 루트 — 항상 접근 가능한 base)
//   MCP_PROJECTS_DIR (외부 프로젝트 루트)
//   MCP_AGENT_ROLE, MCP_APPROVAL_URL

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { writeFileSync, readFileSync, mkdirSync, existsSync, realpathSync, statSync, unlinkSync } from "node:fs";
import { dirname, basename, join, resolve as pathResolve } from "node:path";
import { homedir } from "node:os";
import { configurePathMatcher, matchesAllowList } from "./path-matcher.js";
import { SENSITIVE_PATHS } from "./sensitive-paths.js";
import { withoutAnthropicKeys } from "../server/utils/safeChildEnv.js";
// SENSITIVE_PATHS — 코드 고정 deny-list. 직원 env(MCP_*_SENSITIVE) 누락/오주입에도 무조건 차단.

const WRITE_PATHS = (process.env.MCP_WRITE_PATHS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);
const READ_PATHS = (process.env.MCP_READ_PATHS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);
// [Windows 픽스] 루트 상수는 전부 "/" 구분자로 정규화한다. 역슬래시가 섞이면
// isUnderRoots·startsWith(root + "/")·path-matcher '**' 분기가 전부 미스나서
// '/**' 허용목록이 무효 → 모든 접근이 승인行이 된다(승인 폭주 + 워커 정지 → 잡 타임아웃).
const normSep = (p: string): string => p.replace(/\\/g, "/");
const CWD = normSep(process.env.MCP_CWD || process.cwd());
const SELF_DIR = normSep(process.env.MCP_SELF_DIR || CWD);
// MYCREW_HOME: 영속 데이터 루트(history/). 멀티 인스턴스 시 인스턴스별로 분리.
// 미설정 시 SELF_DIR 폴백 (단일 인스턴스 모드).
const MYCREW_HOME = normSep(process.env.MCP_MYCREW_HOME || SELF_DIR);
const PROJECTS_DIR = normSep(process.env.MCP_PROJECTS_DIR || "");
// 권한 레벨: whitelist(기본, 화이트리스트+승인) / workspace(워크스페이스 내 무제한·승인없음) / full(완전 무제한)
const PERM_LEVEL = (process.env.MCP_PERM_LEVEL || "whitelist") as "whitelist" | "workspace" | "full";
const APPROVAL_URL = process.env.MCP_APPROVAL_URL;
const DELEGATE_URL = process.env.MCP_DELEGATE_URL;
const SEND_PARTNER_URL = process.env.MCP_SEND_PARTNER_URL;
const REQUEST_PARTNERSHIP_URL = process.env.MCP_REQUEST_PARTNERSHIP_URL;
const ROTATE_TOKEN_URL = process.env.MCP_ROTATE_TOKEN_URL;
const MY_PROFILE_URL = process.env.MCP_MY_PROFILE_URL;
const SUBMIT_RESPONSE_URL = process.env.MCP_SUBMIT_RESPONSE_URL;
const POST_MESSAGE_URL = process.env.MCP_POST_MESSAGE_URL;
const ASK_URL = process.env.MCP_ASK_URL;
const GENIE_ACTION_BASE = process.env.MCP_GENIE_ACTION_BASE;
const AGENT_ROLE = process.env.MCP_AGENT_ROLE ?? "unknown";
const JOB_ID = process.env.MCP_JOB_ID || undefined;
// IS_GENIE 하드코딩 제거 — 마이크루/직원 모두 JSON 기반 센서티브로 통합

// 산출물/데이터 분기: history/outputs, history/agents, history/external 패턴은 MYCREW_HOME 기준 매칭/저장.
// 그 외 패턴(src/, tmp/, package.json 등)은 CWD 기준 유지.
// universal 패턴(/**, /*)은 양쪽 군에 모두 포함되어 잭키 readPaths=["/**"] 같은 케이스 보존.
// 멀티 인스턴스: MYCREW_HOME=.mycrew-B 일 때 자기 인스턴스 history만 매칭, 다른 인스턴스 차단.
// history/ 전체를 데이터 루트(MYCREW_HOME)로 본다. 코드(릴리스)와 데이터가 분리된 배치(WSL, 2026-09-08~)에서
// outputs·agents·external만 넘기면 history/skills·cost-log·conversations 등이 코드 폴더에서 찾아져 "no matches"가 된다.
const SELF_PATH_PREFIXES = ["history/"];
function isSelfPattern(p: string): boolean {
  const n = p.replace(/^\//, "");
  return SELF_PATH_PREFIXES.some((pre) => n.startsWith(pre));
}
function isUniversalPattern(p: string): boolean {
  const n = p.replace(/^\//, "");
  return n === "**" || n === "*";
}
const SELF_WRITE = WRITE_PATHS.filter((p) => isSelfPattern(p) || isUniversalPattern(p));
const CWD_WRITE = WRITE_PATHS.filter((p) => !isSelfPattern(p));
const SELF_READ = READ_PATHS.filter((p) => isSelfPattern(p) || isUniversalPattern(p));
const CWD_READ = READ_PATHS.filter((p) => !isSelfPattern(p));

// 경로 해석 기준: CWD(현재 작업), SELF_DIR(시스템 루트), MYCREW_HOME(데이터 루트)에서 resolve.
// EXTRA_BASES (예: claude memory 폴더)는 read 전용 — write/bash는 보안상 제외.
const EXTRA_BASES = (process.env.MCP_EXTRA_BASES || "")
  .split(",").map((s) => normSep(s.trim())).filter(Boolean);
// WRITE_EXTRA_BASES: 에이전트별 쓰기 확장 베이스 (agents.json writeExtraBases → MCP_WRITE_EXTRA_BASES).
// bashExtraBases와 동일 패턴 — 기존 writePaths 패턴(예: "/**")이 이 베이스들에도 그대로 적용된다.
// read에도 자동 포함(쓰기 가능하면 읽기도 가능해야 자연스러움). SENSITIVE_PATHS 하드 데니는 절대 우회하지 않음.
const WRITE_EXTRA_BASES = (process.env.MCP_WRITE_EXTRA_BASES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((p) => resolveReal(p));
const WRITE_BASES = [CWD, SELF_DIR, MYCREW_HOME, ...WRITE_EXTRA_BASES].filter((v, i, a) => v && a.indexOf(v) === i);
const READ_BASES = [CWD, SELF_DIR, MYCREW_HOME, ...EXTRA_BASES, ...WRITE_EXTRA_BASES].filter((v, i, a) => v && a.indexOf(v) === i);
// 디폴트 BASES = WRITE_BASES (안전 fail-closed). read 호출부에서 READ_BASES 명시 override.
const BASES = WRITE_BASES;
const BASH_EXTRA_BASES = (process.env.MCP_BASH_EXTRA_BASES || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean)
  .map(p => resolveReal(p));
const BASH_BASES = [...BASES, ...BASH_EXTRA_BASES].filter(Boolean);

// 권한 레벨 헬퍼 — abs 경로가 주어진 루트들 안에 있는지 (workspace 모드 경계 판정)
function isUnderRoots(abs: string, roots: string[]): boolean {
  return roots.some((root) => root && (abs === root || abs.startsWith(root + "/")));
}

// macOS /tmp → /private/tmp 같은 symlink 우회 방지
// [Windows 픽스] 출력은 항상 "/" 구분자 — realpathSync가 역슬래시를 돌려주면
// 루트 상수(정규화됨)와의 startsWith/isUnderRoots 비교가 전부 미스난다.
function resolveReal(p: string): string {
  try { return normSep(realpathSync(p)); } catch { /* 파일 없음 */ }
  try { return normSep(join(realpathSync(dirname(p)), basename(p))); } catch { /* 상위도 없음 */ }
  return normSep(p);
}

configurePathMatcher({ bases: BASES, projectsDir: PROJECTS_DIR });

// 산출물/데이터 패턴(SELF_*)은 MYCREW_HOME, 코드 패턴(CWD_*)은 CWD에서 매칭하여
// "데이터는 MYCREW_HOME(인스턴스별), 코드는 CWD"를 결정적으로 보장한다.
// 통과 시 절대경로 abs를 반환하여 호출자가 그대로 read/write에 사용.
function resolveWriteAllowed(targetPath: string): string | null {
  if (PERM_LEVEL === "full") return resolveReal(pathResolve(CWD, targetPath));  // 절대경로면 CWD 무시 — 어디든 허용
  if (PERM_LEVEL === "workspace") {
    for (const base of WRITE_BASES) {
      const abs = resolveReal(pathResolve(base, targetPath));
      if (isUnderRoots(abs, WRITE_BASES)) return abs;  // 워크스페이스 안이면 무조건 허용
    }
    return null;  // 워크스페이스 밖 차단
  }
  const selfAbs = resolveReal(pathResolve(MYCREW_HOME, targetPath));
  if (matchesAllowList(selfAbs, SELF_WRITE, [MYCREW_HOME])) return selfAbs;
  const cwdAbs = resolveReal(pathResolve(CWD, targetPath));
  if (matchesAllowList(cwdAbs, CWD_WRITE, [CWD])) return cwdAbs;
  // 멀티 인스턴스: ".mycrew-B/history/..." 형태(CWD-상대)도 MYCREW_HOME 내부면 SELF 패턴으로 흡수
  if (MYCREW_HOME !== CWD && cwdAbs.startsWith(MYCREW_HOME + "/")
      && matchesAllowList(cwdAbs, SELF_WRITE, [MYCREW_HOME])) return cwdAbs;
  for (const eb of WRITE_EXTRA_BASES) {
    const ebAbs = resolveReal(pathResolve(eb, targetPath));
    if (matchesAllowList(ebAbs, WRITE_PATHS, [eb])) return ebAbs;
  }
  return null;
}

// 직원용 SENSITIVE — agents.json의 readSensitivePaths / writeSensitivePaths
const READ_SENSITIVE = (process.env.MCP_READ_SENSITIVE || "")
  .split(",").map(s => s.trim()).filter(Boolean);
const WRITE_SENSITIVE = (process.env.MCP_WRITE_SENSITIVE || "")
  .split(",").map(s => s.trim()).filter(Boolean);

// 마이크루: 코드 고정 SENSITIVE (읽기/쓰기 공통) + 자기 wiki 외 전부 (쓰기)
// 직원: agents.json readSensitivePaths / writeSensitivePaths (에이전트별)
// 마이크루/직원 공통 — JSON 기반 센서티브 체크
//
// SENSITIVE_BASES: 시크릿 패턴(`/.ssh/**`, `/**/id_ed25519*` 등)을 홈디렉토리와 파일시스템 루트에서도
// 매칭하도록 한다. 프로젝트 BASES만 쓰면 `/.ssh/**`이 `/Users/.../mycrew-system/.ssh/**`로 해석되어
// 실제 `~/.ssh/...` 평문 노출을 막지 못한다. homedir+`/`를 추가하면 `/Users/.../.ssh/**` 및
// `/.ssh/**` 절대형 모두 매칭된다.
const SENSITIVE_BASES = [homedir(), "/", ...BASES].filter((v, i, a) => v && a.indexOf(v) === i);
const SENSITIVE_TARGET_BASES = [...READ_BASES, homedir(), "/"].filter((v, i, a) => v && a.indexOf(v) === i);

function isReadSensitive(targetPath: string): boolean {
  if (PERM_LEVEL !== "whitelist") return false;  // workspace/full → 승인 생략
  // role-directive는 쓰기 탈취(권한 상승) 방지용 민감 항목 — 읽기는 조직도 온디맨드 조회의
  // 정상 업무라 예외 처리한다 (쓰기는 isWriteSensitive에서 계속 차단).
  if (/role-directive\.md$/.test(normSep(targetPath))) return false;
  // 1차: 코드 고정 SENSITIVE_PATHS — env 누락/오주입에도 무조건 차단
  for (const b of SENSITIVE_TARGET_BASES) {
    const abs = resolveReal(pathResolve(b, targetPath));
    if (matchesAllowList(abs, SENSITIVE_PATHS, SENSITIVE_BASES)) return true;
  }
  // 2차: 직원별 추가 SENSITIVE (env 기반, 선택적)
  if (READ_SENSITIVE.length === 0) return false;
  for (const b of SENSITIVE_TARGET_BASES) {
    const abs = resolveReal(pathResolve(b, targetPath));
    if (matchesAllowList(abs, READ_SENSITIVE, SENSITIVE_BASES)) return true;
  }
  return false;
}

function isWriteSensitive(targetPath: string): boolean {
  if (PERM_LEVEL !== "whitelist") return false;  // workspace/full → 승인 생략
  // 1차: 코드 고정 SENSITIVE_PATHS — env 누락/오주입에도 무조건 차단
  for (const b of SENSITIVE_TARGET_BASES) {
    const abs = resolveReal(pathResolve(b, targetPath));
    if (matchesAllowList(abs, SENSITIVE_PATHS, SENSITIVE_BASES)) return true;
  }
  // 2차: 직원별 추가 SENSITIVE (env 기반, 선택적)
  if (WRITE_SENSITIVE.length === 0) return false;
  for (const b of SENSITIVE_TARGET_BASES) {
    const abs = resolveReal(pathResolve(b, targetPath));
    if (matchesAllowList(abs, WRITE_SENSITIVE, SENSITIVE_BASES)) return true;
  }
  return false;
}

function resolveReadAllowed(targetPath: string): string | null {
  if (PERM_LEVEL === "full") return resolveReal(pathResolve(CWD, targetPath));
  if (PERM_LEVEL === "workspace") {
    for (const base of READ_BASES) {
      const abs = resolveReal(pathResolve(base, targetPath));
      if (isUnderRoots(abs, READ_BASES)) return abs;
    }
    return null;
  }
  const selfAbs = resolveReal(pathResolve(MYCREW_HOME, targetPath));
  if (matchesAllowList(selfAbs, SELF_READ, [MYCREW_HOME])) return selfAbs;
  const cwdAbs = resolveReal(pathResolve(CWD, targetPath));
  if (matchesAllowList(cwdAbs, CWD_READ, [CWD])) return cwdAbs;
  // 멀티 인스턴스: ".mycrew-B/history/..." 형태(CWD-상대)도 MYCREW_HOME 내부면 SELF 패턴으로 흡수
  if (MYCREW_HOME !== CWD && cwdAbs.startsWith(MYCREW_HOME + "/")
      && matchesAllowList(cwdAbs, SELF_READ, [MYCREW_HOME])) return cwdAbs;
  for (const eb of [...EXTRA_BASES, ...WRITE_EXTRA_BASES]) {
    const ebAbs = resolveReal(pathResolve(eb, targetPath));
    if (matchesAllowList(ebAbs, READ_PATHS, [eb])) return ebAbs;
  }
  return null;
}

function deniedApprovalHint(target: string, tool: string) {
  return {
    isError: true,
    content: [{
      type: "text" as const,
      text: `DENIED: path '${target}' not in readPaths allow-list. Approval required (dashboard). tool=${tool} allow=${JSON.stringify(READ_PATHS)} cwd=${CWD}`,
    }],
  };
}

// MCP elicitation(2025-06-18 스펙) 승인 경로 — 연결 클라이언트가 elicitation capability를
// 선언한 경우에만 클라이언트에 직접 승인 폼을 띄운다.
// 반환: true=명시 승인 / null=미지원·거부·취소·에러 → 기존 POST 승인 흐름으로 폴백 (기본 경로 불변).
// 주의: stdout은 MCP 프로토콜 채널이므로 로그는 console.error 사용.
async function tryElicitApproval(action: string, target: string, reason?: string): Promise<boolean | null> {
  try {
    const caps = server.server.getClientCapabilities();
    if (!caps?.elicitation) return null; // capability 미선언 (claude CLI headless 등) → POST 폴백
    const result = await server.server.elicitInput({
      message: `[승인 요청] ${action}: ${target}${reason ? ` — 사유: ${reason}` : ""} 허용할까요?`,
      requestedSchema: {
        type: "object",
        properties: { approve: { type: "boolean", title: "승인" } },
        required: ["approve"],
      },
    });
    if (result.action === "accept" && result.content?.approve === true) {
      console.error(`[safefs] 승인 경로=elicitation (허용): ${action} ${target}`);
      return true;
    }
    // decline/cancel(또는 approve!==true) — 안전하게 기존 POST 승인 흐름으로 폴백
    console.error(`[safefs] elicitation 미승인 (action=${result.action}) → POST 폴백: ${action} ${target}`);
    return null;
  } catch (err) {
    console.error(`[safefs] elicitation 실패 → POST 폴백: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// readPaths 밖 접근 → 사장님 승인 요청
// 1차: elicitation (위 tryElicitApproval — 지원 클라이언트 한정)
// 2차(기본): POST mycrew /api/approvals + 500ms polling, 60s timeout. 승인=true / 거부·타임아웃·네트워크에러=false
async function requestApproval(tool: string, path: string, reason?: string, sensitive = false): Promise<boolean> {
  // [F1 픽스] 서버 repeat-캐시 키가 경로 문자열 비교라, 호출부마다 원시/해석 경로가 섞이면
  // 같은 파일도 매번 새 승인이 된다. 가능하면 실제 절대경로로 정규화해 보낸다.
  path = resolveReal(pathResolve(CWD, path));
  const elicited = await tryElicitApproval(tool, path, reason);
  if (elicited !== null) return elicited;
  if (!APPROVAL_URL) return false;
  console.error(`[safefs] 승인 경로=POST 폴링: ${tool} ${path}`);
  try {
    const createRes = await fetch(APPROVAL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentRole: AGENT_ROLE, tool, path, jobId: JOB_ID, reason, sensitive }),
    });
    if (!createRes.ok) return false;
    const { id } = await createRes.json() as { id?: string };
    if (!id) return false;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const statusRes = await fetch(`${APPROVAL_URL}/${id}/status`);
        if (!statusRes.ok) continue;
        const req = await statusRes.json() as { status?: string };
        if (req.status === "allowed") return true;
        if (req.status === "denied" || req.status === "timeout") return false;
      } catch { /* 네트워크 일시 장애 재시도 */ }
    }
    return false;
  } catch {
    return false;
  }
}

// ripgrep 미설치 fallback: fast-glob + readFileSync + RegExp
async function grepFallback(pattern: string, target: string, globPattern?: string): Promise<string[]> {
  const fg = (await import("fast-glob")).default;
  let files: string[];
  try {
    const st = statSync(target);
    if (st.isFile()) {
      files = [target];
    } else {
      files = await fg(globPattern || "**/*", { cwd: target, absolute: true, onlyFiles: true, dot: true });
    }
  } catch {
    return [];
  }
  const regex = new RegExp(pattern);
  const matches: string[] = [];
  for (const file of files) {
    const abs = resolveReal(file);
    if (!matchesAllowList(abs, READ_PATHS, READ_BASES)) continue;
    let content: string;
    try { content = readFileSync(abs, "utf-8"); } catch { continue; }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        matches.push(`${file}:${i + 1}: ${lines[i].trimEnd()}`);
      }
    }
  }
  return matches;
}

const server = new McpServer({ name: "safefs", version: "0.3.1" });

// F1 수정: WRITE_PATHS 없으면 SafeWrite/SafeEdit 미등록
registerWikiTools(server, process.env.MCP_WIKI_URL, process.env.MCP_WIKI_TOKEN);
if (WRITE_PATHS.length > 0) {
  server.tool(
    "SafeWrite",
    {
      path: z.string().describe("Absolute or CWD-relative file path to write"),
      content: z.string().describe("File content (UTF-8)"),
      reason: z.string().optional().describe("작업 범위 밖이라 승인이 필요할 때, 왜 이 작업이 필요한지 한 줄 사유 (예: '회귀 테스트 결과를 보고서로 저장하려고')"),
    },
    async ({ path, content, reason }: { path: string; content: string; reason?: string }) => {
      let abs = resolveWriteAllowed(path);
      if (!abs) {
        return { isError: true, content: [{ type: "text" as const, text: `DENIED: path '${path}' is not in writePaths allow-list.` }] };
      }
      if (isWriteSensitive(path)) {
        const approved = await requestApproval("SafeWrite", path, reason, true);
        if (!approved) return { isError: true, content: [{ type: "text" as const, text: `DENIED: sensitive path '${path}' requires user approval (denied/timeout)` }] };
      }
      const dir = dirname(abs);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(abs, content, "utf-8");
      return { content: [{ type: "text" as const, text: `SUCCESS: file written at ${abs}` }] };
    }
  );

  server.tool(
    "SafeDelete",
    {
      path: z.string().describe("Absolute or CWD-relative file path to delete"),
      reason: z.string().optional().describe("작업 범위 밖이라 승인이 필요할 때, 왜 이 작업이 필요한지 한 줄 사유"),
    },
    async ({ path, reason }: { path: string; reason?: string }) => {
      let abs = resolveWriteAllowed(path);
      if (!abs) {
        return { isError: true, content: [{ type: "text" as const, text: `DENIED: path '${path}' is not in writePaths allow-list.` }] };
      }
      if (isWriteSensitive(path)) {
        const approved = await requestApproval("SafeDelete", path, reason, true);
        if (!approved) return { isError: true, content: [{ type: "text" as const, text: `DENIED: sensitive path '${path}' requires user approval (denied/timeout)` }] };
      }
      try {
        unlinkSync(abs);
        return { content: [{ type: "text" as const, text: `SUCCESS: file deleted at ${abs}` }] };
      } catch (err) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `DENIED: delete failed: ${err instanceof Error ? err.message : String(err)}`,
          }],
        };
      }
    }
  );

  server.tool(
    "SafeEdit",
    {
      path: z.string().describe("Absolute or CWD-relative file path to edit"),
      old_string: z.string().describe("Exact string to replace (must match uniquely)"),
      new_string: z.string().describe("Replacement string"),
      reason: z.string().optional().describe("작업 범위 밖이라 승인이 필요할 때, 왜 이 작업이 필요한지 한 줄 사유"),
    },
    async ({ path, old_string, new_string, reason }: { path: string; old_string: string; new_string: string; reason?: string }) => {
      if (new_string === old_string) {
        return { isError: true, content: [{ type: "text" as const, text: "DENIED: new_string is identical to old_string" }] };
      }
      let abs = resolveWriteAllowed(path);
      if (!abs) {
        return { isError: true, content: [{ type: "text" as const, text: `DENIED: path '${path}' is not in writePaths allow-list.` }] };
      }
      if (isWriteSensitive(path)) {
        const approved = await requestApproval("SafeEdit", path, reason, true);
        if (!approved) return { isError: true, content: [{ type: "text" as const, text: `DENIED: sensitive path '${path}' requires user approval (denied/timeout)` }] };
      }
      let fileContent: string;
      try { fileContent = readFileSync(abs, "utf-8"); }
      catch { return { isError: true, content: [{ type: "text" as const, text: `DENIED: file not found or unreadable: ${abs}` }] }; }
      const idx = fileContent.indexOf(old_string);
      if (idx === -1) {
        return { isError: true, content: [{ type: "text" as const, text: `DENIED: String to replace not found. needle_length=${old_string.length}` }] };
      }
      if (fileContent.indexOf(old_string, idx + 1) !== -1) {
        return { isError: true, content: [{ type: "text" as const, text: "DENIED: Multiple matches found, cannot uniquely identify" }] };
      }
      const newContent = fileContent.slice(0, idx) + new_string + fileContent.slice(idx + old_string.length);
      writeFileSync(abs, newContent, "utf-8");
      return { content: [{ type: "text" as const, text: `SUCCESS: file edited at ${abs}` }] };
    }
  );
}

// F1 수정: READ_PATHS 없으면 SafeRead/SafeGlob/SafeGrep 미등록
if (READ_PATHS.length > 0) {
  // 동일 파일 반복 읽기 억제 (서버 수명 = 1턴): 같은 path+mtime 재읽기 시 안내문만 반환.
  // 파일이 변경되면(mtime 변동) 전체 내용 다시 반환 — 검증 목적 1회 읽기는 항상 허용.
  // 마이크루(orchestrator) 전용 — 장시간 워커 잡은 컨텍스트 압축으로 이전 내용이 사라질 수 있어 제외.
  const DUP_READ_GUARD = AGENT_ROLE === "orchestrator";
  const readSeen = new Map<string, number>(); // abs → mtimeMs
  const alreadyReadNotice = (abs: string) => ({
    content: [{ type: "text" as const, text: `NOTICE: 이 파일은 이 턴에서 이미 읽었고 변경되지 않았습니다: ${abs}\n앞서 읽은 내용을 그대로 참조하세요. (파일이 수정되면 다시 전체 내용이 반환됩니다)` }],
  });
  const checkDupRead = (abs: string): boolean => {
    if (!DUP_READ_GUARD) return false;
    try {
      const mt = statSync(abs).mtimeMs;
      if (readSeen.get(abs) === mt) return true;
      readSeen.set(abs, mt);
    } catch { /* stat 실패 → 기존 read 에러 경로에 맡김 */ }
    return false;
  };
  server.tool(
    "SafeRead",
    { path: z.string().describe("Absolute or CWD-relative file path to read") },
    async ({ path }: { path: string }) => {
      // 읽기 블랙리스트 체크 (민감 파일 승인 요청)
      if (isReadSensitive(path)) {
        const approved = await requestApproval("SafeRead", path, undefined, true);
        if (!approved) return deniedApprovalHint(path, "SafeRead");
      }
      let abs = resolveReadAllowed(path);
      if (!abs) {
        const approved = await requestApproval("SafeRead", path);
        if (!approved) return deniedApprovalHint(path, "SafeRead");
        abs = resolveReal(pathResolve(CWD, path));
      }
      if (checkDupRead(abs)) return alreadyReadNotice(abs);
      try {
        const content = readFileSync(abs, "utf-8");
        return { content: [{ type: "text" as const, text: content }] };
      } catch {
        return { isError: true, content: [{ type: "text" as const, text: `DENIED: file not found or unreadable: ${abs}` }] };
      }
    }
  );

  server.tool(
    "SafeReadImage",
    { path: z.string().describe("Absolute or CWD-relative image file path (png, jpg, jpeg, gif, webp)") },
    async ({ path }: { path: string }) => {
      if (isReadSensitive(path)) {
        const approved = await requestApproval("SafeReadImage", path, undefined, true);
        if (!approved) return deniedApprovalHint(path, "SafeReadImage");
      }
      let abs = resolveReadAllowed(path);
      if (!abs) {
        const approved = await requestApproval("SafeReadImage", path);
        if (!approved) return deniedApprovalHint(path, "SafeReadImage");
        abs = resolveReal(pathResolve(CWD, path));
      }
      const ext = abs.split(".").pop()?.toLowerCase() || "";
      const imageExts = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);
      if (!imageExts.has(ext)) {
        return { isError: true, content: [{ type: "text" as const, text: `DENIED: not an image file (ext=${ext}). Use SafeRead for text files.` }] };
      }
      if (checkDupRead(abs)) return alreadyReadNotice(abs);
      try {
        const data = readFileSync(abs);
        const base64 = data.toString("base64");
        const mimeMap: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml" };
        const mimeType = mimeMap[ext] || "image/png";
        return { content: [{ type: "image" as const, data: base64, mimeType }] };
      } catch {
        return { isError: true, content: [{ type: "text" as const, text: `DENIED: file not found or unreadable: ${abs}` }] };
      }
    }
  );

  server.tool(
    "SafeGlob",
    {
      pattern: z.string().describe("Glob pattern (e.g. '**/*.ts')"),
      cwd: z.string().optional().describe("Subdirectory under MCP_CWD to search"),
    },
    async ({ pattern, cwd: subCwd }: { pattern: string; cwd?: string }) => {
      const fg = (await import("fast-glob")).default;
      // pattern이 self 패턴(history/outputs/, history/agents/, history/external/)이면 MYCREW_HOME 기준 검색
      const useSelf = isSelfPattern(pattern);
      const base = useSelf
        ? MYCREW_HOME
        : (subCwd ? resolveReal(pathResolve(CWD, subCwd)) : CWD);
      let matches: string[];
      try {
        matches = await fg(pattern, { cwd: base, absolute: true, dot: true, onlyFiles: true });
      } catch (err) {
        return { isError: true, content: [{ type: "text" as const, text: `DENIED: glob error: ${err instanceof Error ? err.message : String(err)}` }] };
      }
      const usePatterns = useSelf ? SELF_READ : CWD_READ;
      const useBases = useSelf ? [MYCREW_HOME] : [CWD];
      let filtered = matches.filter((m) => matchesAllowList(m, usePatterns, useBases));
      // EXTRA_BASES 폴백 (memory dir 등 read 전용)
      if (filtered.length === 0 && matches.length > 0) {
        filtered = matches.filter((m) => matchesAllowList(m, READ_PATHS, READ_BASES));
      }
      if (filtered.length === 0 && matches.length > 0) {
        const approved = await requestApproval("SafeGlob", pattern);
        if (!approved) return deniedApprovalHint(pattern, "SafeGlob");
        // 승인됨 → 원본 matches 전체 반환 (필터 우회)
        return { content: [{ type: "text" as const, text: matches.join("\n") }] };
      }
      return {
        content: [{
          type: "text" as const,
          text: filtered.length === 0 ? "(no matches)" : filtered.join("\n"),
        }],
      };
    }
  );

  server.tool(
    "SafeGrep",
    {
      pattern: z.string().describe("Regex pattern"),
      path: z.string().optional().describe("File or directory to search (default: MCP_CWD)"),
      glob: z.string().optional().describe("Glob filter (e.g. '*.ts')"),
    },
    async ({ pattern, path, glob }: { pattern: string; path?: string; glob?: string }) => {
      // path가 self 패턴이면 MYCREW_HOME 기준 resolve, 아니면 CWD 기준
      const useSelf = path ? isSelfPattern(path) : false;
      const baseDir = useSelf ? MYCREW_HOME : CWD;
      const target = path ? resolveReal(pathResolve(baseDir, path)) : CWD;
      const usePatterns = useSelf ? SELF_READ : CWD_READ;
      const useBases = useSelf ? [MYCREW_HOME] : [CWD];
      let allowed = matchesAllowList(target, usePatterns, useBases);
      if (!allowed) allowed = matchesAllowList(target, READ_PATHS, READ_BASES); // EXTRA 폴백
      if (!allowed) {
        const approved = await requestApproval("SafeGrep", target);
        if (!approved) return deniedApprovalHint(target, "SafeGrep");
      }
      // v0.3.1: rg spawn 경로 제거. grepFallback(fast-glob + readFileSync + RegExp) 단독.
      // 이유: CLAUDE_CODE_EXECPATH 환경에서 rg spawn이 비결정적 결과를 낸 이력(잭키 F2 감사). rg 의존성 완전 제거로 결정성 확보.
      try {
        const matches = await grepFallback(pattern, target, glob);
        return {
          content: [{
            type: "text" as const,
            text: matches.length === 0 ? "(no matches)" : matches.join("\n"),
          }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `DENIED: grep failed: ${err instanceof Error ? err.message : String(err)}`,
          }],
        };
      }
    }
  );
}

// isReadOnlyBash / READONLY_BASH_PREFIXES 제거 — bashSensitivePatterns로 통합

// --- SafeBash: 에이전트별 명령어 + 경로 화이트리스트 기반 셸 실행 ---

const BASH_ENABLED = process.env.MCP_BASH_ENABLED === "1";
const BASH_COMMANDS = (process.env.MCP_BASH_COMMANDS || "")
  .split(",").map(s => s.trim()).filter(Boolean);
const BASH_PATHS = (process.env.MCP_BASH_PATHS || "")
  .split(",").map(s => s.trim()).filter(Boolean);

// bash 센서티브 — agents.json bashSensitivePatterns에서 로드 (정규식 문자열 → RegExp 컴파일)
const BASH_SENSITIVE_PATTERNS: RegExp[] = (process.env.MCP_BASH_SENSITIVE_PATTERNS || "")
  .split(",").map(s => s.trim()).filter(Boolean)
  .map(s => { try { return new RegExp(s); } catch { return null; } })
  .filter((r): r is RegExp => r !== null);

// 명령어에서 참조하는 경로를 추출 (간이 파서)
function extractPaths(cmd: string): string[] {
  const paths: string[] = [];
  // 절대 경로
  for (const m of cmd.matchAll(/(?:^|\s)(\/[^\s;|&>]+)/g)) paths.push(m[1]);
  // 상대 경로 → 절대로 변환
  for (const m of cmd.matchAll(/(?:^|\s)(\.\.?\/[^\s;|&>]+)/g)) {
    paths.push(pathResolve(CWD, m[1]));
  }
  return paths;
}

function isBashPathAllowed(path: string): boolean {
  if (BASH_PATHS.length === 0) return true; // bashPaths 미설정 → 경로 제한 없음
  for (const b of BASH_BASES) {
    const abs = resolveReal(pathResolve(b, path));
    if (matchesAllowList(abs, BASH_PATHS, BASH_BASES)) return true;
  }
  return false;
}

function isBashAllowed(cmd: string): { allowed: boolean; reason: string; sensitive?: boolean } {
  const trimmed = cmd.trim();
  if (!trimmed) return { allowed: false, reason: "empty command" };

  if (PERM_LEVEL === "full") return { allowed: true, reason: "unrestricted" };  // 치명 패턴 포함 전부 허용

  // bash 센서티브 패턴 매칭 → 승인 요청 (workspace에서도 치명 명령은 승인 거침)
  for (const re of BASH_SENSITIVE_PATTERNS) {
    if (re.test(trimmed)) return { allowed: false, reason: `sensitive pattern: ${re}`, sensitive: true };
  }

  if (PERM_LEVEL === "workspace") return { allowed: true, reason: "workspace" };  // 명령 자유 (치명 패턴만 위에서 거름)

  // bashCommands 화이트리스트: 파이프/세미콜론/개행으로 분리된 각 서브커맨드의 첫 단어 검증
  // 개행(\n \r)도 셸 명령 분리자이므로 반드시 포함해야 우회를 막는다 (예: "npm run x\nrm -rf ~").
  if (BASH_COMMANDS.length > 0) {
    const parts = trimmed.split(/\s*(?:[|;&]+|[\n\r]+)\s*/).map(s => s.trim()).filter(Boolean);
    for (const part of parts) {
      const tokens = part.split(/\s+/);
      const cmdToken = tokens.find(t => !/^[A-Z_][A-Z0-9_]*=/.test(t)) ?? tokens[0];
      if (!BASH_COMMANDS.includes(cmdToken)) {
        return { allowed: false, reason: `command not allowed: "${cmdToken}" (allowed: ${BASH_COMMANDS.join(", ")})` };
      }
    }
  }

  // bashPaths 경로 검증
  const paths = extractPaths(trimmed);
  for (const p of paths) {
    if (!isBashPathAllowed(p)) {
      return { allowed: false, reason: `path not allowed: "${p}"` };
    }
  }

  return { allowed: true, reason: "ok" };
}

if (BASH_ENABLED) {
  server.tool(
    "SafeBash",
    "Execute a shell command (whitelisted commands and paths only)",
    { command: z.string(), timeout: z.number().optional(), reason: z.string().optional().describe("승인이 필요한 명령일 때, 왜 이 명령이 필요한지 한 줄 사유 (예: '회귀 테스트 결과를 커밋하려고')") },
    async ({ command, timeout, reason: approvalReason }) => {
      const { allowed, reason, sensitive } = isBashAllowed(command);
      if (!allowed) {
        // 센서티브 매칭 → 승인 요청
        if (sensitive) {
          const approved = await requestApproval("SafeBash", command, approvalReason, true);
          if (!approved) {
            return { isError: true, content: [{ type: "text" as const, text: `DENIED: blacklisted command requires approval (denied/timeout)\ncommand: ${command}\nreason: ${reason}` }] };
          }
          // 승인됨 → 실행 계속
        } else {
          // 화이트리스트 밖 → 즉시 차단
          return { isError: true, content: [{ type: "text" as const, text: `DENIED: ${reason}\ncommand: ${command}` }] };
        }
      }

      // IS_GENIE bash 하드코딩 제거 — bashSensitivePatterns로 통합 (JSON 관리)

      try {
        const { execSync } = await import("node:child_process");
        const output = execSync(command, {
          cwd: CWD,
          timeout: timeout ?? 120_000,
          maxBuffer: 10 * 1024 * 1024,
          encoding: "utf-8",
          env: withoutAnthropicKeys({ ...process.env, PATH: process.env.PATH }),
        });
        return {
          content: [{
            type: "text" as const,
            text: output || "(no output)",
          }],
        };
      } catch (err: unknown) {
        const e = err as { status?: number; stdout?: string; stderr?: string; message?: string };
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `Exit code: ${e.status ?? "unknown"}\nstdout: ${(e.stdout ?? "").slice(0, 5000)}\nstderr: ${(e.stderr ?? "").slice(0, 5000)}`,
          }],
        };
      }
    }
  );
}

// === RenderMarkdownPdf: 마크다운(+Mermaid) → PDF 변환 — mermaid-pdf 스킬 이식 ===
// readPaths(입력 md)와 writePaths(출력 pdf/html) 둘 다 있는 에이전트에게만 등록.
// Puppeteer(시스템 Chrome/Edge, headless)로 렌더링 — 신규 브라우저 다운로드 없음.
if (READ_PATHS.length > 0 && WRITE_PATHS.length > 0) {
  const RENDER_SCRIPT = join(SELF_DIR, "scripts", "mermaid-pdf", "render_pdf.mjs");
  const MERMAID_PDF_TIMEOUT_MS = 120_000;

  server.tool(
    "RenderMarkdownPdf",
    "마크다운(Mermaid 다이어그램 포함 가능)을 고품질 PDF로 변환한다. Noto Sans KR 한글 폰트, GFM 테이블/코드블록 스타일 적용. 보고서·문서 산출물을 PDF로 전달할 때 사용.",
    {
      mdPath: z.string().describe("입력 마크다운 파일 경로 (readPaths 내)"),
      pdfPath: z.string().describe("출력 PDF 파일 경로 (writePaths 내)"),
      pageSize: z.enum(["A4", "Letter", "Legal"]).optional().describe("기본 A4"),
      orientation: z.enum(["portrait", "landscape"]).optional().describe("기본 portrait"),
      scale: z.number().min(0.5).max(2.0).optional().describe("기본 1.0"),
    },
    async ({ mdPath, pdfPath, pageSize, orientation, scale }) => {
      const mdAbs = resolveReadAllowed(mdPath);
      if (!mdAbs) return deniedApprovalHint(mdPath, "RenderMarkdownPdf(입력)");
      if (!existsSync(mdAbs)) {
        return { isError: true, content: [{ type: "text" as const, text: `FAILED: 입력 파일 없음: ${mdAbs}` }] };
      }
      const pdfAbs = resolveWriteAllowed(pdfPath);
      if (!pdfAbs) return deniedApprovalHint(pdfPath, "RenderMarkdownPdf(출력)");

      const args = [RENDER_SCRIPT, mdAbs, pdfAbs];
      if (pageSize) args.push("--page-size", pageSize);
      if (orientation) args.push("--orientation", orientation);
      if (scale !== undefined) args.push("--scale", String(scale));

      try {
        const { execFileSync } = await import("node:child_process");
        const output = execFileSync(process.execPath, args, {
          cwd: SELF_DIR,
          timeout: MERMAID_PDF_TIMEOUT_MS,
          encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024,
        });
        return {
          content: [{
            type: "text" as const,
            text: `${output}\n\nPDF 저장 위치: ${pdfAbs}`,
          }],
        };
      } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; message?: string };
        const detail = [e.stdout, e.stderr, e.message].filter(Boolean).join("\n");
        return {
          isError: true,
          content: [{ type: "text" as const, text: `FAILED: PDF 렌더링 실패\n${detail || String(err)}` }],
        };
      }
    }
  );
}


// === DelegateTask: 직원에게 작업 위임 (fire-and-forget + callback 양방향) ===
// 마이크루가 호출 → 즉시 ACK만 받고 진행. 결과는 다음 턴 task-notification으로 도착.
// (v2 §3-1, §4-1 — 동기 응답 패턴 절대 금지)
if (DELEGATE_URL) {
  const delegateDedup = new Map<string, { ack: string; expiresAt: number }>();
  const dedupKey = (request: string, agent?: string, cwd?: string) =>
    `${request}|${agent ?? ""}|${cwd ?? ""}`;

  server.tool(
    "DelegateTask",
    "Delegate a task to a worker agent. Returns ACK immediately (fire-and-forget). Result arrives via task-notification on next turn — DO NOT wait synchronously for the result.",
    {
      request: z.string().describe("작업 내용 (구체적으로)"),
      agent: z.string().optional().describe("담당 에이전트 ID (dev-pm, planner-researcher, qa)"),
      projectName: z.string().optional().describe("프로젝트명"),
      cwd: z.string().optional().describe("작업 디렉토리 절대 경로"),
      priority: z.enum(["high", "normal", "low"]).optional().describe("우선순위 (기본: normal)"),
      after: z.string().optional().describe("선행 Job ID (체이닝)"),
      planGate: z.boolean().optional().describe("false면 계획 단계 생략"),
      todoText: z.string().optional().describe("TODO 텍스트 (미지정 시 request로 자동 생성)"),
      timeoutSec: z.number().optional().describe("작업 타임아웃 초 (기본 600)"),
      leaseSec: z.number().optional().describe("Lease 만료 초 (기본 900=15분). 긴 작업일 때만 명시 — 미지정 시 기본값."),
      maxTurns: z.number().optional().describe("워커 한 턴당 최대 turns (미지정 시 에이전트 정의 기본값)"),
      effort: z.enum(["low", "medium", "high"]).optional().describe("추론 강도. 기본 low. leaseSec/maxTurns를 기본보다 크게 준 긴 작업은 자동으로 medium이 되므로 보통 생략한다. 명시하면 자동 승격보다 우선."),
      selfRestart: z.boolean().optional().describe("self 프로젝트(이 시스템 자체) 수정 작업일 때 true. 잡 완료 후 자동 재시작 큐에 적재."),
      skipOutput: z.boolean().optional().describe("산출물 파일 생성 생략 여부. 기본값 true(생략). 보고서/분석/리서치/감사 결과가 필요한 작업이면 false를 명시적으로 지정."),
      taskId: z.string().optional().describe("소속 Task ID. 같은 사용자 지시의 후속 위임이면 첫 위임 ACK의 taskId를 전달. 미지정 시 새 Task 자동 생성."),
      taskTitle: z.string().optional().describe("Task 제목 (UI에 표시될 사용자 지시 요약). 미지정 시 request에서 자동 생성."),
    },
    async (input: {
      request: string;
      agent?: string;
      projectName?: string;
      cwd?: string;
      priority?: "high" | "normal" | "low";
      after?: string;
      planGate?: boolean;
      todoText?: string;
      timeoutSec?: number;
      leaseSec?: number;
      maxTurns?: number;
      effort?: "low" | "medium" | "high";
      selfRestart?: boolean;
      skipOutput?: boolean;
      taskId?: string;
      taskTitle?: string;
    }) => {
      // 응답 단위 dedup window (60초) — 같은 응답 내 동일 (request,agent,cwd) 재호출은 첫 ACK 반환
      const key = dedupKey(input.request, input.agent, input.cwd);
      const now = Date.now();
      const cached = delegateDedup.get(key);
      if (cached && cached.expiresAt > now) {
        return {
          content: [{
            type: "text" as const,
            text: `${cached.ack}\n(dedup: 동일 (request,agent,cwd) 재호출 — 첫 ACK 반환)`,
          }],
        };
      }
      // 5xx 1회 재시도(500ms 백오프)
      let response: Response | undefined;
      let lastErr: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          response = await fetch(DELEGATE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          });
          if (response.status >= 500 && attempt === 0) {
            await new Promise((r) => setTimeout(r, 500));
            continue;
          }
          break;
        } catch (err) {
          lastErr = err;
          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, 500));
            continue;
          }
        }
      }
      if (!response) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `DELEGATE_FAILED: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
          }],
        };
      }
      if (response.status >= 500) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `DELEGATE_FAILED (5xx after retry): ${response.status} ${response.statusText}`,
          }],
        };
      }
      if (!response.ok) {
        const text = await response.text();
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `DELEGATE_FAILED (4xx): ${response.status} ${text.slice(0, 500)}`,
          }],
        };
      }
      const ack = await response.json() as {
        jobId: string;
        todoId: string;
        taskId: string;
        status: string;
        acceptedAt: string;
        callbackUrl: string;
        request: string;
      };
      const ackText = `SUCCESS: 작업 위임 완료 (fire-and-forget)
- Job ID: ${ack.jobId}
- TODO ID: ${ack.todoId}
- Task ID: ${ack.taskId}
- 담당: ${input.agent ?? "(자동 배정)"}
- 상태: ${ack.status}
- 접수 시각: ${ack.acceptedAt}
- 요청: ${ack.request}

⚠️ 결과를 동기로 기다리지 마세요. 다음 턴에 task-notification으로 자동 도착합니다.`;
      delegateDedup.set(key, { ack: ackText, expiresAt: now + 60_000 });
      return { content: [{ type: "text" as const, text: ackText }] };
    },
  );

  server.tool(
    "DelegatePlan",
    "Delegate a multi-step plan in ONE call. phases = array of phases; steps within a phase run in PARALLEL, phases run SEQUENTIALLY. All Todos register at once. Returns ACK immediately — DO NOT wait synchronously.",
    {
      phases: z.array(z.array(z.object({
        agent: z.string().optional().describe("담당 에이전트 ID (dev-pm, planner-researcher, qa 등)"),
        request: z.string().describe("작업 내용 (구체적으로)"),
        planGate: z.boolean().optional().describe("false면 계획 단계 생략"),
        skipOutput: z.boolean().optional().describe("산출물 파일 생성 생략 여부 (기본 true)"),
        effort: z.enum(["low", "medium", "high"]).optional().describe("추론 강도. 기본 low. 이 경로는 leaseSec/maxTurns를 받지 않아 자동 승격 신호가 없으므로, 긴 단계는 medium을 명시할 것."),
      }))).describe("작업 단계 배열. 순차=[[A],[B],[C]] / 병렬=[[A,B,C]] / 팬아웃→통합=[[A,B,C],[D]]"),
      projectName: z.string().optional().describe("프로젝트명 (전체 공통)"),
      cwd: z.string().optional().describe("작업 디렉토리 절대 경로 (전체 공통)"),
      taskId: z.string().optional().describe("기존 Task에 이어붙일 때 그 taskId (재작업 등)"),
    },
    async (input: {
      phases: { agent?: string; request: string; planGate?: boolean; skipOutput?: boolean; effort?: "low" | "medium" | "high" }[][];
      projectName?: string;
      cwd?: string;
      taskId?: string;
    }) => {
      let response: Response | undefined;
      try {
        response = await fetch(`${DELEGATE_URL}/plan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
      } catch (err) {
        return { isError: true, content: [{ type: "text" as const, text: `DELEGATE_PLAN_FAILED: ${err instanceof Error ? err.message : String(err)}` }] };
      }
      if (!response.ok) {
        const text = await response.text();
        return { isError: true, content: [{ type: "text" as const, text: `DELEGATE_PLAN_FAILED (${response.status}): ${text.slice(0, 500)}` }] };
      }
      const ack = await response.json() as {
        taskId: string;
        phases: { jobId: string; todoId: string; agent?: string }[][];
      };
      const lines = ack.phases
        .map((p, i) => `  phase ${i + 1}: ${p.map((s) => `${s.agent ?? "?"}(${s.jobId.slice(0, 8)})`).join(", ")}`)
        .join("\n");
      const ackText = `SUCCESS: 플랜 위임 완료 (fire-and-forget)
- Task ID: ${ack.taskId}
- 단계 ${ack.phases.length}개:
${lines}

⚠️ 결과를 동기로 기다리지 마세요. 각 단계 완료가 task-notification으로 자동 도착합니다.`;
      return { content: [{ type: "text" as const, text: ackText }] };
    },
  );
}

// === 동료 통합 도구 (마이크루 전용) ===
// SendToPartner / RequestPartnership / RotatePartnerToken — 5xx 1회 재시도(500ms 백오프) 패턴.

async function postPartnerJson(
  url: string,
  payload: unknown,
): Promise<{ ok: true; data: unknown; httpStatus: number } | { ok: false; text: string; httpStatus: number }> {
  let response: Response | undefined;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.status >= 500 && attempt === 0) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      break;
    } catch (err) {
      lastErr = err;
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
    }
  }
  if (!response) {
    return { ok: false, text: `network: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`, httpStatus: 0 };
  }
  if (!response.ok) {
    const t = await response.text().catch(() => "");
    return { ok: false, text: `http ${response.status}: ${t.slice(0, 500)}`, httpStatus: response.status };
  }
  let data: unknown;
  try { data = await response.json(); } catch { data = null; }
  return { ok: true, data, httpStatus: response.status };
}

if (SEND_PARTNER_URL) {
  server.tool(
    "SendToPartner",
    "Send a message to an external partner. Returns messageId on success (synchronous).",
    {
      partnerId: z.string().describe("동료 ID"),
      message: z.string().describe("발송할 메시지 본문"),
      messageType: z.enum(["request", "reply", "notification", "token_update", "profile_update"]).optional()
        .describe("메시지 타입 (기본: request)"),
      attachments: z.array(z.object({
        filePath: z.string().describe("첨부할 파일 경로 (프로젝트 상대경로 또는 절대경로)"),
      })).optional().describe("첨부파일 목록 (서버가 자동으로 base64 변환)"),
    },
    async (input: { partnerId: string; message: string; messageType?: "request" | "reply" | "notification" | "token_update" | "profile_update"; attachments?: Array<{ filePath: string }> }) => {
      const r = await postPartnerJson(SEND_PARTNER_URL, input);
      if (!r.ok) {
        return { isError: true, content: [{ type: "text" as const, text: `SEND_FAILED: ${r.text}` }] };
      }
      const data = r.data as { ok?: boolean; messageId?: string; status?: number; errorReason?: string } | null;
      if (!data?.ok) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `SEND_FAILED: ${data?.errorReason ?? "unknown"} (status=${data?.status ?? 0})` }],
        };
      }
      return {
        content: [{
          type: "text" as const,
          text: `SUCCESS: 메시지 발송 완료\n- 메시지 ID: ${data.messageId}\n- HTTP: ${data.status}\n- 동료: ${input.partnerId}\n- 타입: ${input.messageType ?? "request"}`,
        }],
      };
    },
  );
}

if (REQUEST_PARTNERSHIP_URL) {
  server.tool(
    "RequestPartnership",
    "Request a partnership with an external company. Only targetApiUrl is needed — our profile (company name, contact, etc.) is auto-filled from myProfile. Returns requestId.",
    {
      targetApiUrl: z.string().describe("상대방 동료의 API URL (예: https://partner.example.com)"),
    },
    async (input) => {
      const r = await postPartnerJson(REQUEST_PARTNERSHIP_URL, input);
      if (!r.ok) {
        return { isError: true, content: [{ type: "text" as const, text: `REQUEST_FAILED: ${r.text}` }] };
      }
      const data = r.data as { ok?: boolean; requestId?: string; expiresAt?: string; error?: string } | null;
      if (!data?.ok) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `REQUEST_FAILED: ${data?.error ?? "unknown"}` }],
        };
      }
      return {
        content: [{
          type: "text" as const,
          text: `SUCCESS: 거래 요청 발송 완료\n- 요청 ID: ${data.requestId}\n- 만료 시각: ${data.expiresAt ?? "(미지정)"}\n- 대상: ${input.targetApiUrl}\n\n상대방 승인 시 콜백으로 동료 등록됩니다.`,
        }],
      };
    },
  );
}

if (ROTATE_TOKEN_URL) {
  server.tool(
    "RotatePartnerToken",
    "Rotate inbound or outbound token for a partner. Returns plaintext newToken (one-time only — store immediately).",
    {
      partnerId: z.string().describe("동료 ID"),
      direction: z.enum(["inbound", "outbound"]).describe("inbound=외부가 우리 호출 시 토큰, outbound=우리가 외부 호출 시 토큰"),
      reason: z.string().optional().describe("회전 사유 (감사 로그)"),
      notify: z.boolean().optional().describe("outbound 회전 시 외부에 token_update 자동 통보 (기본 true)"),
    },
    async (input) => {
      const r = await postPartnerJson(ROTATE_TOKEN_URL, input);
      if (!r.ok) {
        return { isError: true, content: [{ type: "text" as const, text: `ROTATE_FAILED: ${r.text}` }] };
      }
      const data = r.data as { ok?: boolean; partner?: { id?: string; companyName?: string }; newToken?: string; error?: string } | null;
      if (!data?.ok) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `ROTATE_FAILED: ${data?.error ?? "unknown"}` }],
        };
      }
      return {
        content: [{
          type: "text" as const,
          text: `SUCCESS: 토큰 회전 완료\n- 동료: ${data.partner?.companyName ?? data.partner?.id ?? input.partnerId}\n- 방향: ${input.direction}\n- 새 토큰: ${data.newToken}\n\n⚠️ 이 토큰은 1회만 노출됩니다. 즉시 보관·전달하세요.`,
        }],
      };
    },
  );
}

if (MY_PROFILE_URL) {
  server.tool(
    "UpdateMyProfile",
    "Update my profile (company info). Automatically broadcasts profile_update to all active partners.",
    {
      companyName: z.string().optional().describe("회사명"),
      department: z.string().optional().describe("부서명"),
      contactName: z.string().optional().describe("담당자명"),
      secretaryName: z.string().optional().describe("비서명"),
      contactEmail: z.string().optional().describe("이메일"),
      contactPhone: z.string().optional().describe("전화번호"),
    },
    async (input) => {
      // 먼저 현재 프로필을 가져와서 변경된 필드만 병합
      let current: Record<string, string> = {};
      try {
        const res = await fetch(MY_PROFILE_URL!);
        if (res.ok) current = await res.json() as Record<string, string>;
      } catch { /* */ }
      const merged = { ...current, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };
      const r = await postPartnerJson(MY_PROFILE_URL!, merged);
      if (!r.ok) {
        return { isError: true, content: [{ type: "text" as const, text: `UPDATE_FAILED: ${r.text}` }] };
      }
      return {
        content: [{
          type: "text" as const,
          text: `SUCCESS: 내 프로필 업데이트 완료. 활성 동료에게 자동 통보됨.\n- 회사: ${merged.companyName}\n- 담당자: ${merged.contactName}\n- 비서: ${merged.secretaryName}`,
        }],
      };
    },
  );
}

if (SUBMIT_RESPONSE_URL) {
  server.tool(
    "submit_response",
    "매 응답을 완료한 직후 반드시 호출하세요. content에 방금 작성한 응답 전체 텍스트를 넣어주세요. 사용자에게 선택지 있는 질문을 할 때는 options에 선택지를 넣으면 번호 목록(1, 2, …)으로 표시되고 사용자가 번호를 입력해 선택합니다 — 질문이어도 이 도구로 턴을 끝내세요.",
    {
      content: z.string().describe("완성된 응답 전체 내용 (질문이면 질문 본문)"),
      summary: z.string().optional().describe("위임 작업 보고 시: 핵심 결과를 한두 줄로 요약(머리만 자르지 말고 진짜 요약). 카드·보고엔 이 요약이 표시되고 전체는 content에. 실패·불가면 그 사유를 요약에. (대화 응답엔 불필요)"),
      options: z.array(z.string()).optional().describe("질문일 때 선택지 목록 — 주면 사용자에게 번호 목록으로 표시됨(번호 입력으로 선택)"),
    },
    async ({ content, summary, options }) => {
      try {
        await fetch(SUBMIT_RESPONSE_URL!, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, summary, options }),
        });
        return { content: [{ type: "text" as const, text: "OK" }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text" as const, text: String(e) }] };
      }
    },
  );
}

// 중간 메시지 출력 도구 — submit_response와 달리 턴을 끝내지 않음. genie PTY에만 등록.
if (POST_MESSAGE_URL) {
  server.tool(
    "post_message",
    "작업 도중 사용자에게 보여줄 중간 메시지를 대화창에 출력합니다. 턴을 끝내지 않으므로 도구 호출 전 진행 안내 등에 쓰세요. 최종 답변·턴 종료는 submit_response를 사용하세요.",
    { content: z.string().describe("대화창에 표시할 중간 메시지") },
    async ({ content }) => {
      try {
        await fetch(POST_MESSAGE_URL!, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        });
        return { content: [{ type: "text" as const, text: "OK" }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text" as const, text: String(e) }] };
      }
    },
  );
}

// 워커 질문 도구 — 작업 중 막혔을 때 사람 결정을 요청. 워커 PTY에만 등록.
if (ASK_URL) {
  server.tool(
    "ask",
    "작업 중 정말 막혀서 사람의 결정·정보가 필요할 때만 호출하세요. 사소한 판단은 스스로 하세요. question(막힌 내용)과 options(선택지, 선택사항)를 주면 마이크루/사용자의 답을 받아 반환합니다. 최대 약 4분 대기하며, 그 안에 응답이 없으면 본인 판단 안내가 반환됩니다. 받은 답에 따라 작업을 계속하세요.",
    {
      question: z.string().describe("막힌 지점과 결정이 필요한 내용"),
      options: z.array(z.string()).optional().describe("선택지 목록 (있으면)"),
    },
    async ({ question, options }) => {
      try {
        const createRes = await fetch(ASK_URL!, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId: AGENT_ROLE, question, options: options ?? [] }),
        });
        if (!createRes.ok) {
          return { isError: true, content: [{ type: "text" as const, text: `ASK_FAILED: ${createRes.status}` }] };
        }
        const { id } = await createRes.json() as { id?: string };
        if (!id) return { isError: true, content: [{ type: "text" as const, text: "ASK_FAILED: no id" }] };
        const deadline = Date.now() + 240_000;  // 4분 (윈도우 3분 + 여유)
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 2000));
          try {
            const st = await fetch(`${ASK_URL}/${id}`);
            if (!st.ok) continue;
            const q = await st.json() as { status?: string; answer?: string };
            if (q.status === "answered") {
              return { content: [{ type: "text" as const, text: q.answer || "(빈 응답 — 본인 판단으로 진행하세요.)" }] };
            }
          } catch { /* 네트워크 일시 장애 — 재시도 */ }
        }
        return { content: [{ type: "text" as const, text: "(응답 시간 초과 — 본인 판단으로 진행하세요.)" }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text" as const, text: String(e) }] };
      }
    },
  );
}

// 마이크루 액션 도구 (태그 시스템 → MCP 일원화). genie PTY에만 등록.
if (GENIE_ACTION_BASE) {
  server.tool(
    "resolve_approval",
    "대기 중인 승인 요청에 응답합니다.",
    {
      id: z.string().describe("승인 요청 ID"),
      decision: z.enum(["allow", "deny"]).describe("승인 여부"),
      reason: z.string().optional().describe("결정 이유"),
    },
    async ({ id, decision, reason }) => {
      try {
        const res = await fetch(`${GENIE_ACTION_BASE}/api/genie/resolve-approval`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, decision, reason }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return { isError: true, content: [{ type: "text" as const, text: `FAILED: ${data.error ?? res.status}` }] };
        return { content: [{ type: "text" as const, text: `OK: ${id} → ${data.status}` }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text" as const, text: String(e) }] };
      }
    },
  );

  server.tool(
    "set_auto_mode",
    "자동 진행 모드를 켜거나 끕니다.",
    { enabled: z.boolean().describe("true=켜기, false=끄기") },
    async ({ enabled }) => {
      try {
        const res = await fetch(`${GENIE_ACTION_BASE}/api/auto-mode`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled }),
        });
        if (!res.ok) return { isError: true, content: [{ type: "text" as const, text: `FAILED: ${res.status}` }] };
        return { content: [{ type: "text" as const, text: `OK: 자동 진행 ${enabled ? "ON" : "OFF"}` }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text" as const, text: String(e) }] };
      }
    },
  );

  server.tool(
    "reset_session",
    "에이전트 세션을 리셋합니다. agentId 미지정/'all'이면 전체, 특정 ID면 해당 에이전트만. 마이크루 자신은 현재 응답을 마친 뒤 리셋됩니다. 호출 후 즉답은 '리셋 진행할게' 정도로 짧게 — '완료'는 리셋 끝난 뒤 새 세션이 직접 알립니다(미리 말하지 마세요).",
    { agentId: z.string().optional().describe("에이전트 ID (genie, dev-pm 등). 미지정/all이면 전체") },
    async ({ agentId }) => {
      try {
        const res = await fetch(`${GENIE_ACTION_BASE}/api/genie/reset-session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(agentId ? { agentId } : {}),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return { isError: true, content: [{ type: "text" as const, text: `FAILED: ${data.error ?? res.status}` }] };
        const parts: string[] = [];
        if (data.reset?.length) parts.push(`리셋: ${data.reset.join(", ")}`);
        if (data.skipped?.length) parts.push(`건너뜀(작업중): ${data.skipped.join(", ")}`);
        return { content: [{ type: "text" as const, text: `OK — ${parts.join(" / ") || "(없음)"}` }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text" as const, text: String(e) }] };
      }
    },
  );

  server.tool(
    "restart_server",
    "이 시스템 서버를 재시작합니다. 현재 응답을 마친 뒤 안전 검증(타입검사→빌드→임시서버 health)을 거쳐 재시작합니다. self 코드 변경을 반영할 때 사용.",
    {},
    async () => {
      try {
        const res = await fetch(`${GENIE_ACTION_BASE}/api/genie/restart`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (!res.ok) return { isError: true, content: [{ type: "text" as const, text: `FAILED: ${res.status}` }] };
        return { content: [{ type: "text" as const, text: "OK: 응답 종료 후 안전 검증 거쳐 재시작합니다." }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text" as const, text: String(e) }] };
      }
    },
  );

  server.tool(
    "save_wiki",
    "위키 페이지를 저장합니다 (마이크루 장기 기억). content는 5KB 이하 — 큰 산출물은 history/outputs/genie/에 SafeWrite.",
    {
      page: z.string().describe("페이지명"),
      content: z.string().describe("페이지 내용 (5KB 이하)"),
    },
    async ({ page, content }) => {
      try {
        const res = await fetch(`${GENIE_ACTION_BASE}/api/genie/wiki`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ page, content }),
        });
        if (!res.ok) return { isError: true, content: [{ type: "text" as const, text: `FAILED: ${res.status}` }] };
        return { content: [{ type: "text" as const, text: `OK: 위키 "${page}" 저장` }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text" as const, text: String(e) }] };
      }
    },
  );

  server.tool(
    "manage_schedule",
    "스케줄(리마인더/반복 작업)을 추가·수정·삭제합니다. entry 형식: 'YYYY-MM-DD HH:MM: 내용'(일회성), 'cron EXPR: 내용'(반복). 예약 작업은 '... [TASK:프로젝트명]: 작업내용'.",
    {
      action: z.enum(["add", "update", "delete"]).describe("작업 종류"),
      entry: z.string().optional().describe("add/update 시 — 스케줄 내용 (update는 새 내용)"),
      id: z.string().optional().describe("update/delete 시 — 스케줄 ID (s-xxxx)"),
    },
    async ({ action, entry, id }) => {
      try {
        const res = await fetch(`${GENIE_ACTION_BASE}/api/genie/schedule`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, entry, id }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return { isError: true, content: [{ type: "text" as const, text: `FAILED: ${data.error ?? res.status}` }] };
        return { content: [{ type: "text" as const, text: `OK: 스케줄 ${action}` }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text" as const, text: String(e) }] };
      }
    },
  );

  server.tool(
    "manage_task",
    "Task(사용자 지시 단위) 상태 관리. 조율자 원칙: Task done은 사용자 최종 보고 후 명시 호출.",
    {
      action: z.enum(["done", "cancel", "delete"]).describe("done=완료 선언, cancel=취소, delete=삭제"),
      id: z.string().describe("대상 Task ID"),
      summary: z.string().optional().describe("done 시 — 완료 요약 한 줄 (선택)"),
    },
    async ({ action, id, summary }) => {
      try {
        const res = await fetch(`${GENIE_ACTION_BASE}/api/tasks/${id}/${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ summary }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false) return { isError: true, content: [{ type: "text" as const, text: `FAILED: ${data.error ?? res.status}` }] };
        return { content: [{ type: "text" as const, text: `OK: Task ${action} (${id})` }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text" as const, text: String(e) }] };
      }
    },
  );

  server.tool(
    "advance_task",
    "DelegatePlan의 다음 phase(마이크루 승인 대기 중인 paused Job 묶음)를 활성화. 매 phase 완료 보고를 받고 다음 진행을 결정할 때 호출. 의존성 미충족이면 0 반환.",
    {
      id: z.string().describe("대상 Task ID"),
    },
    async ({ id }) => {
      try {
        const res = await fetch(`${GENIE_ACTION_BASE}/api/tasks/${id}/advance`, { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return { isError: true, content: [{ type: "text" as const, text: `FAILED: ${data.error ?? res.status}` }] };
        return { content: [{ type: "text" as const, text: `OK: ${data.activated}건 활성화${data.message ? " — " + data.message : ""}` }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text" as const, text: String(e) }] };
      }
    },
  );

  server.tool(
    "get_job_result",
    "Job의 전체 결과 본문(fullResult) 조회. 직원 보고가 3줄 요약만으론 부족할 때 호출.",
    {
      id: z.string().describe("대상 Job ID"),
    },
    async ({ id }) => {
      try {
        const res = await fetch(`${GENIE_ACTION_BASE}/api/jobs/${id}/result`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return { isError: true, content: [{ type: "text" as const, text: `FAILED: ${data.error ?? res.status}` }] };
        const lines = [
          `Job: ${data.id} (${data.status})`,
          `담당: ${data.agent ?? "?"}`,
          `요청: ${(data.request ?? "").slice(0, 200)}`,
          ``,
          `--- 결과 ---`,
          data.fullResult ?? data.error ?? "(결과 없음)",
        ];
        return { content: [{ type: "text" as const, text: lines.join("\n").slice(0, 8000) }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text" as const, text: String(e) }] };
      }
    },
  );

  server.tool(
    "manage_mcp",
    "MCP 서버 설치/할당 관리. install=레지스트리에 설치(사용자 승인카드 거침, ~60초 대기), assign/unassign=직원에게 켜기/끄기(해당 직원 재시작), list=현황. 설치는 임의 명령 실행이라 반드시 사용자 승인이 필요합니다.",
    {
      action: z.enum(["install", "uninstall", "assign", "unassign", "list"]),
      name: z.string().optional().describe("install/uninstall 시 서버 이름"),
      command: z.string().optional().describe("install 시 실행 명령 (예: npx)"),
      args: z.array(z.string()).optional().describe("install 시 명령 인자"),
      mode: z.enum(["allow", "approval"]).optional().describe("install 시 권한 처리 (기본 approval)"),
      agentId: z.string().optional().describe("assign/unassign 시 대상 직원 id (genie 포함)"),
      server: z.string().optional().describe("assign/unassign 시 서버 이름"),
      reason: z.string().optional().describe("install 시 설치 사유 한 줄"),
    },
    async ({ action, name, command, args, mode, agentId, server, reason }) => {
      const base = GENIE_ACTION_BASE;
      try {
        if (action === "list") {
          const [reg, asg] = await Promise.all([
            fetch(`${base}/api/mcp/registry`).then((r) => r.json()).catch(() => ({})),
            fetch(`${base}/api/mcp/assignments`).then((r) => r.json()).catch(() => ({})),
          ]);
          return { content: [{ type: "text" as const, text: `설치됨: ${Object.keys(reg).join(", ") || "(없음)"}\n할당: ${JSON.stringify(asg)}` }] };
        }
        if (action === "install") {
          if (!name || !command) return { isError: true, content: [{ type: "text" as const, text: "install엔 name·command 필요" }] };
          const res = await fetch(`${base}/api/mcp/install`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, command, args, mode, reason, agentRole: AGENT_ROLE }),
          });
          const data = await res.json().catch(() => ({}));
          if (data.ok) return { content: [{ type: "text" as const, text: `설치 완료: ${name} (mode=${data.mode}). 이제 manage_mcp(assign)으로 직원에게 할당하세요.` }] };
          return { content: [{ type: "text" as const, text: `설치 안 됨 (${data.status ?? "거부"}). 사용자가 승인하지 않았습니다.` }] };
        }
        if (action === "uninstall") {
          if (!name) return { isError: true, content: [{ type: "text" as const, text: "uninstall엔 name 필요" }] };
          const res = await fetch(`${base}/api/mcp/uninstall`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
          const data = await res.json().catch(() => ({}));
          return { content: [{ type: "text" as const, text: data.ok ? `제거됨: ${name}` : `제거 실패: ${name}` }] };
        }
        // assign / unassign
        if (!agentId || !server) return { isError: true, content: [{ type: "text" as const, text: `${action}엔 agentId·server 필요` }] };
        const res = await fetch(`${base}/api/mcp/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentId, server }) });
        const data = await res.json().catch(() => ({}));
        if (data.ok) return { content: [{ type: "text" as const, text: `${action === "assign" ? "할당" : "해제"} 완료: ${server} ${action === "assign" ? "→" : "✗"} ${agentId} (재시작됨)` }] };
        return { isError: true, content: [{ type: "text" as const, text: `실패: ${data.reason ?? "unknown"}` }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text" as const, text: String(e) }] };
      }
    },
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
