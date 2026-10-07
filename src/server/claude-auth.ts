// Claude Code CLI 로그인 상태 체크 — 두 모드.
//  - fast(기본): OS별 토큰 저장소 존재 확인 (~50ms). UX 우선.
//      만료 토큰은 못 잡지만, 실제 claude 호출 실패 시점에 잡으면 됨.
//  - verify(실제 호출): claude -p "ok" --max-turns 1 (~3-7초). 만료까지 정확.
//
// NOTE: v0.1.6 원본은 CLAUDE_SPAWN_EXE/CLAUDE_SPAWN_PREFIX 사용. v0.1.0 config.ts에는
//   아직 그 심볼이 없어서 CLAUDE_PATH 단독으로 대체했다. 2단계에서 SPAWN 헬퍼가 도입되면
//   원본 형태로 복원할 것.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { CLAUDE_PATH } from "../config.js";

const TIMEOUT_MS = 8000;  // claude -p 응답 시간 + 여유
const KEYCHAIN_TIMEOUT_MS = 2000;

// 다국어/다버전 견고성 — exit code 우선, 키워드는 보조 안전망
const NOT_LOGGED_IN_RE = /not logged in|login required|please log in|authenticate|로그인.*필요|로그인.*안.*됨|인증.*필요/i;

// 빠른 체크 — OS별 토큰 저장소 존재 여부만 확인. 만료 검증 X.
export async function checkClaudeLoginFast(): Promise<{ loggedIn: boolean; reason?: string }> {
  const os = platform();

  // macOS: Keychain — `security find-generic-password -s 'Claude Code-credentials'`
  if (os === "darwin") {
    return new Promise((resolve) => {
      let resolved = false;
      const child = spawn("security", ["find-generic-password", "-s", "Claude Code-credentials"], { stdio: "ignore" });
      const timer = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        try { child.kill("SIGKILL"); } catch { /* */ }
        resolve({ loggedIn: false, reason: "keychain timeout" });
      }, KEYCHAIN_TIMEOUT_MS);
      child.on("exit", (code) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        resolve(code === 0 ? { loggedIn: true } : { loggedIn: false, reason: `keychain exit ${code}` });
      });
      child.on("error", (err) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        resolve({ loggedIn: false, reason: `security cmd: ${err.message}` });
      });
    });
  }

  // Linux / WSL2 / Windows — 파일 기반. 가능한 경로 다 확인.
  const home = homedir();
  const paths = [
    join(home, ".claude", ".credentials.json"),
    join(home, ".claude", "credentials.json"),
    join(home, ".config", "claude-code", "credentials.json"),
    join(home, ".config", "claude-code", ".credentials.json"),
  ];
  if (os === "win32") {
    const appdata = process.env.APPDATA;
    if (appdata) {
      paths.push(join(appdata, "Claude", ".credentials.json"));
      paths.push(join(appdata, "claude-code", "credentials.json"));
    }
  }
  for (const p of paths) {
    if (existsSync(p)) return { loggedIn: true };
  }
  return { loggedIn: false, reason: "no credential file" };
}

export async function checkClaudeLogin(timeoutMs = TIMEOUT_MS): Promise<{ loggedIn: boolean; reason?: string }> {
  return new Promise((resolve) => {
    let resolved = false;
    let child;
    try {
      child = spawn(CLAUDE_PATH, ["-p", "ok", "--max-turns", "1"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      resolve({ loggedIn: false, reason: `spawn failed: ${e instanceof Error ? e.message : e}` });
      return;
    }

    let stdout = "";
    let stderr = "";

    const finish = (loggedIn: boolean, reason?: string): void => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try { child!.kill("SIGKILL"); } catch { /* */ }
      resolve({ loggedIn, reason });
    };

    const timer = setTimeout(() => finish(false, "timeout"), timeoutMs);

    child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("error", (err) => finish(false, `error: ${err.message}`));
    child.on("exit", (code) => {
      const combined = `${stdout}\n${stderr}`;
      if (NOT_LOGGED_IN_RE.test(combined)) {
        finish(false, "not logged in (keyword)");
        return;
      }
      if (code !== 0) {
        finish(false, `exit ${code}`);
        return;
      }
      // exit 0인데 본문 너무 짧으면 의심 (정상 응답은 보통 한 줄 이상)
      if (stdout.trim().length === 0) {
        finish(false, "empty output");
        return;
      }
      finish(true);
    });
  });
}
