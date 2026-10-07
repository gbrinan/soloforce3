// /api/approvals/:id/resolve 게이트용 토큰 검증
// fail-secure: APPROVAL_RESOLVE_TOKEN 미설정 시 모든 요청 거부.
// 토큰 비교는 timing-safe.
import { timingSafeEqual, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { HISTORY_DIR } from "../config.js";

let warned = false;

// 대시보드 전용 승인 토큰 — 마스터 APPROVAL_RESOLVE_TOKEN을 브라우저에 노출하지 않기 위한 대체 자격.
// history/.dashboard-approval-token(0600)에 영속(서버 재시작에도 유지), 30일 경과 시 재발급,
// 파일 삭제로 즉시 폐기 가능. 마스터 토큰은 외부 파트너/스크립트 전용으로 분리된다.
const DASHBOARD_TOKEN_FILE = join(HISTORY_DIR, ".dashboard-approval-token");
const DASHBOARD_TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
let dashboardToken: string | null = null;

export function getDashboardApprovalToken(): string {
  if (dashboardToken) return dashboardToken;
  try {
    const st = statSync(DASHBOARD_TOKEN_FILE);
    if (Date.now() - st.mtimeMs < DASHBOARD_TOKEN_MAX_AGE_MS) {
      const tok = readFileSync(DASHBOARD_TOKEN_FILE, "utf8").trim();
      if (tok.length >= 32) {
        dashboardToken = tok;
        return tok;
      }
    }
  } catch { /* 파일 없음/만료/손상 → 아래에서 재발급 */ }
  const fresh = randomBytes(32).toString("hex");
  mkdirSync(HISTORY_DIR, { recursive: true });
  writeFileSync(DASHBOARD_TOKEN_FILE, fresh, { mode: 0o600 });
  dashboardToken = fresh;
  return fresh;
}

function safeEqual(provided: string, expected: string): boolean {
  const provBuf = Buffer.from(provided);
  const expBuf = Buffer.from(expected);
  if (provBuf.length !== expBuf.length) return false;
  return timingSafeEqual(provBuf, expBuf);
}

export function verifyApprovalToken(headers: Record<string, string | undefined>): boolean {
  const expected = process.env.APPROVAL_RESOLVE_TOKEN;
  if (!expected) {
    if (!warned) {
      console.warn("⚠️ APPROVAL_RESOLVE_TOKEN 미설정 — 승인 API 거부 모드");
      warned = true;
    }
    return false;
  }
  const provided = headers["x-approval-token"]
    || headers["authorization"]?.replace(/^Bearer\s+/i, "")
    || "";
  if (!provided) return false;
  // 대시보드 토큰 우선 인정 (발급된 적 있는 경우에만)
  if (dashboardToken && safeEqual(provided, dashboardToken)) return true;
  return safeEqual(provided, expected);
}
