// 외부 위임 Bearer 인증 + 1회용 callback 토큰
// - Bearer: config/external-agents.json 화이트리스트 기반
// - Callback Token: ACK 시 발급, callback 도달 시 1회 사용 후 폐기 + 만료 검사

import { randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_SELF_DIR } from "../config.js";

interface ExternalAgent {
  id: string;
  name: string;
  bearerToken: string;
}

interface ExternalAgentsFile {
  agents: ExternalAgent[];
}

const CONFIG_FILE = join(PROJECT_SELF_DIR, "config", "external-agents.json");
let cachedAgents: ExternalAgent[] = [];
let lastMtime = 0;

function loadExternalAgents(): ExternalAgent[] {
  if (!existsSync(CONFIG_FILE)) return [];
  let mtimeMs: number;
  try {
    mtimeMs = statSync(CONFIG_FILE).mtimeMs;
  } catch {
    return cachedAgents;
  }
  if (mtimeMs === lastMtime && cachedAgents.length > 0) return cachedAgents;
  try {
    const data = JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) as ExternalAgentsFile;
    cachedAgents = Array.isArray(data.agents) ? data.agents : [];
    lastMtime = mtimeMs;
    return cachedAgents;
  } catch (err) {
    console.warn(`[ExternalAuth] config 파싱 실패: ${err instanceof Error ? err.message : err}`);
    return cachedAgents;
  }
}

// Bearer 검증: Authorization 헤더 → agentId | null
export function verifyBearer(authHeader?: string): string | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!m) return null;
  const token = m[1].trim();
  const tokenBuf = Buffer.from(token);
  const agents = loadExternalAgents();
  const found = agents.find((a) => {
    const expBuf = Buffer.from(a.bearerToken);
    if (expBuf.length !== tokenBuf.length) return false;
    return timingSafeEqual(expBuf, tokenBuf);
  });
  return found ? found.id : null;
}

// === 1회용 callback 토큰 ===
interface CallbackToken {
  jobId: string;
  expiresAt: number;
  used: boolean;
}
const tokens = new Map<string, CallbackToken>();
const TOKEN_TTL_MS = 30 * 60 * 1000; // 30분 (외부 위임 기본 timeout)

export function issueCallbackToken(jobId: string, ttlSec?: number): string {
  const token = randomUUID();
  const ttl = (ttlSec ?? 1800) * 1000;
  tokens.set(token, { jobId, expiresAt: Date.now() + ttl, used: false });
  return token;
}

export function verifyCallbackToken(
  token: string,
  jobId: string,
): { ok: boolean; reason: "valid" | "unknown" | "expired" | "used" | "jobid_mismatch" } {
  const entry = tokens.get(token);
  if (!entry) return { ok: false, reason: "unknown" };
  if (entry.used) return { ok: false, reason: "used" };
  if (entry.expiresAt < Date.now()) return { ok: false, reason: "expired" };
  if (entry.jobId !== jobId) return { ok: false, reason: "jobid_mismatch" };
  entry.used = true;
  return { ok: true, reason: "valid" };
}

// 매분 만료 토큰 정리
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of tokens.entries()) {
    if (entry.expiresAt < now) tokens.delete(token);
  }
}, 60 * 1000).unref?.();
