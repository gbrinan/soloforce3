import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

function resolve(p: string): string {
  return p.startsWith("~") ? p.replace("~", homedir()) : p;
}

// 자기 자신의 디렉토리 (src/config.ts → 프로젝트 루트)
const __dirname = dirname(fileURLToPath(import.meta.url));
export const PROJECT_SELF_DIR = dirname(__dirname);
// MYCREW_HOME: 영속 데이터 루트(history/). 미설정 시 PROJECT_SELF_DIR (기존 단일 인스턴스 동작 유지).
// 두 인스턴스 동시 운영 시 인스턴스 B에 별도 디렉토리를 지정해 데이터 격리.
export const MYCREW_HOME = process.env.MYCREW_HOME ? resolve(process.env.MYCREW_HOME) : PROJECT_SELF_DIR;
export const HISTORY_DIR = join(MYCREW_HOME, "history");
export const PROMPTS_DIR = join(PROJECT_SELF_DIR, "prompts");

const root = resolve(process.env.WORKSPACE_ROOT || dirname(PROJECT_SELF_DIR));

export const WORKSPACE_ROOT = root;
export const PROJECTS_DIR = join(root, process.env.PROJECTS_FOLDER || "mycrew-works");
export const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";
export const CLAUDE_BIN_DIR = dirname(CLAUDE_PATH);

// [로컬 패치 2026-07-13 — v0.2.29 업데이트 후 재이식] safefs MCP 서버 실행용 tsx 진입점.
// node_modules/.bin/tsx(확장자 없음)는 POSIX 셸 스크립트라 Windows에서 claude CLI가
// --mcp-config로 shell 없이 직접 spawn하면 ENOENT로 조용히 실패한다 — DelegateTask·
// Read/Write 등 safefs 도구 전체가 누락되던 원인(2026-07-10 실증). node.exe로 tsx의
// 실제 진입점(cli.mjs)을 직접 로드해 셸/cmd 래퍼를 완전히 우회한다.
const tsxCliPath = join(PROJECT_SELF_DIR, "node_modules", "tsx", "dist", "cli.mjs");
export const TSX_BIN = process.execPath;
export const TSX_CLI_ARGS: string[] = existsSync(tsxCliPath) ? [tsxCliPath] : [];
if (TSX_CLI_ARGS.length === 0) {
  console.error(
    `[config] 치명 경고: tsx 진입점을 찾을 수 없음 (${tsxCliPath}). ` +
    "safefs MCP·워커 PTY가 모두 실패합니다. npm install 또는 tsx 버전을 확인하세요.",
  );
}

// KST 유틸
// KST 기준 날짜 문자열 반환 (YYYY-MM-DD)
// toISOString()은 항상 UTC 반환이므로 +9h offset 후 읽어야 KST 날짜가 나옴
export function toKstDate(d: Date = new Date()): string {
  const kstMs = d.getTime() + 9 * 60 * 60 * 1000;
  return new Date(kstMs).toISOString().slice(0, 10);
}

export function getTodayKST(): string {
  return toKstDate();
}

// KST 기준 N일 전 날짜 문자열 (scheduler 등 날짜 연산용)
export function kstDaysAgo(days: number, from: Date = new Date()): string {
  const shifted = new Date(from.getTime() + 9 * 60 * 60 * 1000);
  shifted.setUTCDate(shifted.getUTCDate() - days);
  return shifted.toISOString().slice(0, 10);
}
