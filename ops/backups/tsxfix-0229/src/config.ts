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

// safefs MCP 서버 실행용 tsx 절대경로. 서버가 node_modules/.bin을 PATH에 포함하지 않은
// 방식으로 기동되면(예: npm 경유 아님) bare "tsx"가 해석되지 않아 safefs MCP가 죽고,
// 인터랙티브 마이크루 PTY(--strict-mcp-config)는 code=1로 크래시하며 직원 safefs도 무력화된다.
// 절대경로로 고정해 기동 방식과 무관하게 동작하도록 한다(파일 부재 시에만 bare로 폴백).
const tsxBinPath = join(PROJECT_SELF_DIR, "node_modules", ".bin", "tsx");
export const TSX_BIN = existsSync(tsxBinPath) ? tsxBinPath : "tsx";

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
