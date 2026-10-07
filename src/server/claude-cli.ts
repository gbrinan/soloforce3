// Claude CLI 로컬 실행 — 노트 AI(Claude CLI provider)용.
// 비대화형 CLI 실행을 spawn/timeout/graceful 실패 패턴으로 감싼다.
// 감지: `claude --version`. 생성: `claude -p <prompt>`. 미설치/타임아웃은 ok:false 또는 installed:false로 graceful 반환.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { safeChildEnv } from "./utils/safeChildEnv.js";
import { safeKill } from "./utils/platform.js";

// 실행 파일 해석 — Windows에서 npm 전역 설치는 `claude.cmd`(셸 배치)만 PATH에 올린다.
// 그런데 아래 호출들은 shell 없이 spawn하므로 .cmd는 ENOENT로 죽는다(installClaudeCli가
// npm에서 같은 이유로 shell:true를 달아야 했던 그 문제). 프롬프트를 argv로 넘기는 runClaude에
// shell:true를 쓸 수는 없다 — 따옴표·줄바꿈이 cmd.exe에 재해석돼 프롬프트가 깨진다.
// 그래서 네이티브 실행 파일을 먼저 찾는다. 못 찾으면 "claude"로 두어 실패가 그대로 드러나게 한다.
function resolveClaudeBin(): string {
  if (process.env.CLAUDE_PATH) return process.env.CLAUDE_PATH;
  if (process.platform === "win32") {
    const exe = join(homedir(), ".local", "bin", "claude.exe");
    if (existsSync(exe)) return exe;
  }
  return "claude";
}

export interface ClaudeDetectResult {
  ok: boolean;
  installed: boolean;
  version?: string;
  authenticated?: boolean;
  error?: string;
}

// best-effort 인증 감지 (실제 검증은 generate 호출 시 이뤄짐).
// 주의: ~/.claude.json은 claude를 "실행만" 해도 생성된다(로그인 무관 설정 파일). 존재 여부만 보면
// 미로그인 상태가 인증됨으로 오판돼 온보딩 게이트가 반쪽 상태로 통과된다 — 실측(2026-07-13)
// 로그인 완료 시에만 생기는 oauthAccount 키를 확인한다. (mac은 자격을 Keychain에 저장하므로
// .credentials.json이 없고 이 키가 유일한 파일 시그널)
export function claudeAuthed(): boolean {
  const home = homedir();
  if (existsSync(join(home, ".claude", ".credentials.json"))) return true;
  if (existsSync(join(home, ".config", "claude", ".credentials.json"))) return true;
  try {
    const cfg = JSON.parse(readFileSync(join(home, ".claude.json"), "utf-8")) as Record<string, unknown>;
    return Boolean(cfg.oauthAccount);
  } catch {
    return false;
  }
}

export function detectClaudeCli(timeoutMs = 8_000): Promise<ClaudeDetectResult> {
  return new Promise<ClaudeDetectResult>((resolve) => {
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(resolveClaudeBin(), ["--version"], { stdio: ["ignore", "pipe", "pipe"], env: safeChildEnv(), windowsHide: true });
    } catch (e) {
      resolve({ ok: true, installed: false, error: e instanceof Error ? e.message : String(e) });
      return;
    }
    let out = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      safeKill(proc, "SIGTERM");
      resolve({ ok: false, installed: false, error: "claude --version 타임아웃" });
    }, timeoutMs);
    proc.stdout?.on("data", (d) => { out += String(d); });
    proc.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const code = (e as NodeJS.ErrnoException).code;
      resolve({ ok: true, installed: false, error: code === "ENOENT" ? "claude CLI 미설치" : e.message });
    });
    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ ok: true, installed: true, version: out.trim().slice(0, 80), authenticated: claudeAuthed() });
      } else {
        resolve({ ok: true, installed: false, error: `claude --version 종료코드 ${code}` });
      }
    });
  });
}

export interface ClaudeInstallResult {
  ok: boolean;
  already?: boolean;      // 이미 설치돼 있어 no-op
  version?: string;
  error?: string;
  needsManual?: boolean;  // 권한 등으로 서버 설치 불가 — 사용자가 터미널에서 직접 설치해야 함
}

// 클로드코드 CLI를 서버가 대신 설치 — 온보딩 게이트의 [연동 시작] 버튼용.
// 이미 설치돼 있으면 즉시 no-op(부작용 없음). EACCES(전역 prefix 권한) 등은
// needsManual로 반환해 UI가 수동 설치 명령어로 폴백하게 한다.
export async function installClaudeCli(timeoutMs = 300_000): Promise<ClaudeInstallResult> {
  const pre = await detectClaudeCli();
  if (pre.installed) return { ok: true, already: true, version: pre.version };

  return new Promise<ClaudeInstallResult>((resolve) => {
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn("npm", ["install", "-g", "@anthropic-ai/claude-code"], {
        stdio: ["ignore", "pipe", "pipe"],
        env: safeChildEnv(),
        // Windows: npm은 npm.cmd 배치라 shell 없이는 ENOENT — 설치 버튼이 항상 실패했다.
        shell: process.platform === "win32",
        windowsHide: true,
      });
    } catch (e) {
      resolve({ ok: false, error: e instanceof Error ? e.message : String(e), needsManual: true });
      return;
    }
    let err = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      safeKill(proc, "SIGTERM");
      resolve({ ok: false, error: `설치 타임아웃 (${Math.round(timeoutMs / 1000)}초)`, needsManual: true });
    }, timeoutMs);
    proc.stderr?.on("data", (d) => { err += String(d); });
    proc.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, error: e.message, needsManual: true });
    });
    proc.on("close", async (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        const post = await detectClaudeCli();
        resolve({ ok: post.installed, version: post.version, error: post.installed ? undefined : "설치 후 감지 실패" });
      } else {
        // EACCES/EPERM = 전역 설치 권한 부족 → 수동 폴백 안내
        const permIssue = /EACCES|EPERM|permission denied/i.test(err);
        resolve({ ok: false, error: err.slice(-300) || `npm 종료코드 ${code}`, needsManual: permIssue || true });
      }
    });
  });
}

export interface ClaudeRunResult { ok: boolean; text?: string; error?: string }

export interface ClaudeRunOptions {
  readonly system?: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly allowedTools?: readonly string[];
}

export function buildClaudeArgs(prompt: string, options: ClaudeRunOptions = {}): string[] {
  const args = ["-p", prompt];
  if (options.system?.trim()) args.push("--append-system-prompt", options.system);
  if (options.model?.trim()) args.push("--model", options.model);
  if (options.allowedTools?.length) args.push("--allowedTools", ...options.allowedTools);
  return args;
}

export function runClaude(prompt: string, options: ClaudeRunOptions = {}): Promise<ClaudeRunResult> {
  const args = buildClaudeArgs(prompt, options);
  const timeoutMs = options.timeoutMs ?? 120_000;
  return new Promise<ClaudeRunResult>((resolve) => {
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(resolveClaudeBin(), args, { stdio: ["ignore", "pipe", "pipe"], env: safeChildEnv(), windowsHide: true });
    } catch (e) {
      resolve({ ok: false, error: `claude 실행 불가: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }
    let out = "";
    let err = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      safeKill(proc, "SIGTERM");
      resolve({ ok: false, error: `Claude CLI 타임아웃 (${Math.round(timeoutMs / 1000)}초)` });
    }, timeoutMs);
    proc.stdout?.on("data", (d) => { out += String(d); });
    proc.stderr?.on("data", (d) => { err += String(d); });
    proc.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const code = (e as NodeJS.ErrnoException).code;
      resolve({ ok: false, error: code === "ENOENT" ? "claude CLI가 설치되어 있지 않습니다." : `claude 실행 오류: ${e.message}` });
    });
    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve({ ok: true, text: out.trim() });
      else resolve({ ok: false, error: `claude 종료 코드 ${code}${err ? `: ${err.slice(0, 300)}` : ""}` });
    });
  });
}
