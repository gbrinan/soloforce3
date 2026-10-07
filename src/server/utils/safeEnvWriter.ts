import { readFileSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_SELF_DIR } from "../../config.js";

const ENV_PATH = join(PROJECT_SELF_DIR, ".env");

// 키 검증: 대문자·숫자·언더스코어만, 첫 자는 대문자 또는 언더스코어
const KEY_RE = /^[A-Z_][A-Z0-9_]*$/;

export function validateEnvKey(key: string): void {
  if (!KEY_RE.test(key)) {
    throw new Error(`유효하지 않은 환경변수 키: "${key}" (대문자·숫자·언더스코어만 허용)`);
  }
}

/**
 * .env 파일에 KEY=VALUE를 안전하게 쓴다.
 * - 키 형식 검증 (소문자·특수문자 거부)
 * - 기존 동일 키가 있으면 해당 라인 교체, 없으면 마지막에 추가
 * - 저장 후 파일 권한을 0600(소유자 전용)으로 자동 설정
 */
export function writeEnvKey(key: string, value: string, envPath = ENV_PATH): void {
  validateEnvKey(key);

  let lines: string[] = [];
  if (existsSync(envPath)) {
    lines = readFileSync(envPath, "utf-8").split("\n");
  }

  const escaped = value.includes("\n") ? `"${value.replace(/"/g, '\\"')}"` : value;
  const newLine = `${key}=${escaped}`;
  const keyPrefix = `${key}=`;
  let replaced = false;

  lines = lines.map((line) => {
    if (line.startsWith(keyPrefix) || line.startsWith(`# ${keyPrefix}`)) {
      replaced = true;
      return newLine;
    }
    return line;
  });

  if (!replaced) {
    // 빈 마지막 라인 처리
    if (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.splice(lines.length - 1, 0, newLine);
    } else {
      lines.push(newLine);
    }
  }

  const content = lines.join("\n");
  writeFileSync(envPath, content, { encoding: "utf-8", mode: 0o600 });
  // 기존 파일이 더 열린 권한이었을 경우 명시적으로 재설정
  chmodSync(envPath, 0o600);
}
