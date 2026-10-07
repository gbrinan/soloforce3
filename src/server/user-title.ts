import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { HISTORY_DIR } from "../config.js";

const SESSIONS_FILE = join(HISTORY_DIR, "auth-sessions.json");
const USER_CONFIG_FILE = join(HISTORY_DIR, "user-config.json");

/** 이름에서 호칭 생성: 3자 이상이면 마지막 2글자 + "님", 1-2자면 전체 + "님" */
export function buildUserTitle(name: string): string {
  const t = name.trim();
  if (!t) return "사용자";
  return (t.length >= 3 ? t.slice(-2) : t) + "님";
}

let _cached: string | null = null;

/**
 * 현재 시스템 소유자(가입자)의 호칭을 반환한다.
 *
 * 우선순위:
 * 1. history/user-config.json의 userTitle 필드 (명시적 설정, 가장 우선)
 * 2. auth-sessions.json의 첫 번째 세션 이름 → buildUserTitle() 자동 생성
 * 3. "사용자" (폴백)
 *
 * 제3자 배포 환경에서는 그 환경 가입자의 설정/이름으로 자동 변경된다.
 */
export function getUserTitle(): string {
  if (_cached !== null) return _cached;
  try {
    // 1순위: user-config.json의 명시적 호칭 설정
    if (existsSync(USER_CONFIG_FILE)) {
      const cfg = JSON.parse(readFileSync(USER_CONFIG_FILE, "utf-8")) as Record<string, unknown>;
      if (typeof cfg.userTitle === "string" && cfg.userTitle.trim()) {
        _cached = cfg.userTitle.trim();
        return _cached;
      }
    }
    // 2순위: 세션 이름 → 자동 생성
    if (!existsSync(SESSIONS_FILE)) return "사용자";
    const sessions = JSON.parse(readFileSync(SESSIONS_FILE, "utf-8")) as Record<string, Record<string, unknown>>;
    const first = Object.values(sessions)[0];
    const name = typeof first?.name === "string" ? first.name : "";
    _cached = name ? buildUserTitle(name) : "사용자";
    return _cached;
  } catch {
    return "사용자";
  }
}

/** 호칭 캐시 무효화 — 사용자 정보 변경(재로그인 등) 시 호출 */
export function invalidateUserTitleCache(): void {
  _cached = null;
}
