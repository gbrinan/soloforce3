// 시스템 보호 경로 deny-list (하드코딩, 화이트리스트 아닌 블랙리스트 확장 원칙 — QA §0.2)
// 절대 삭제/스캔 금지 대상. 사용자 설정으로 해제 불가.
import os from "node:os";
import { resolve } from "node:path";

const HOME = os.homedir();

const MACOS_DENY = ["/System", "/Library", "/Applications", "/usr", "/bin", "/sbin", "/etc", "/private"];
const WINDOWS_DENY = [
  "C:\\Windows",
  "C:\\Program Files",
  "C:\\Program Files (x86)",
  "C:\\ProgramData",
];

// 대용량 파일 스캔이 홈 디렉토리 전체를 훑기 때문에 추가로 보호해야 하는 사용자 영역
// (기획 스펙 §2, QA §3.1/3.2)
const PROTECTED_USER_DIRS = ["Documents", "Desktop", "Pictures", "Movies", "Music"].map((d) =>
  resolve(HOME, d),
);

// 소스코드/버전관리 폴더 — 스캔 대상에서 절대 제외 (R1 완화)
const EXCLUDED_DIR_NAMES = new Set([".git", "node_modules", ".venv", ".ipynb_checkpoints"]);
const EXCLUDED_DIR_SUFFIXES = [".xcodeproj", ".sln"];

function normalize(path: string): string {
  return resolve(path);
}

export function isDenied(targetPath: string): boolean {
  const p = normalize(targetPath);
  const denyList = process.platform === "win32" ? WINDOWS_DENY : MACOS_DENY;
  return denyList.some((d) => p === d || p.startsWith(`${d}/`) || p.startsWith(`${d}\\`));
}

export function isProtectedUserDir(targetPath: string): boolean {
  const p = normalize(targetPath);
  return PROTECTED_USER_DIRS.some((d) => p === d || p.startsWith(`${d}/`));
}

export function isExcludedDirName(name: string): boolean {
  if (EXCLUDED_DIR_NAMES.has(name)) return true;
  return EXCLUDED_DIR_SUFFIXES.some((suf) => name.endsWith(suf));
}
