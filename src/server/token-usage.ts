// 토큰/사용량 집계
// - Claude: claude.ai OAuth usage 엔드포인트(GET /api/oauth/usage)를 CLI 로그인 토큰으로 호출 → /usage 플랜 사용률(%)
// - Codex(GPT): ~/.codex/sessions rollout의 최신 token_count 스냅샷 rate_limits
// - Antigravity(Gemini): API 키 유무 + history/cost-log.jsonl 로컬 누적 사용량(agentId=wonyoung)
import { readdirSync, readFileSync, statSync, existsSync, type Dirent } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import { getWorkerAgent, resolveWorkerRuntime } from "../agent-registry.js";

const HOME = homedir();
const CODEX_SESSIONS = join(HOME, ".codex", "sessions");
const CLAUDE_CRED_FILE = join(HOME, ".claude", ".credentials.json");
const COST_LOG_FILE = join(process.cwd(), "history", "cost-log.jsonl");
const ANTIGRAVITY_AGENT_ID = "wonyoung";
// agy 경로는 antigravity-cli 어댑터와 동일 규칙(AGY_PATH > ~/.local/bin/agy).
const AGY_PATH = process.env.AGY_PATH || join(HOME, ".local", "bin", "agy");
const CACHE_TTL_MS = 60 * 1000;
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const KEYCHAIN_SERVICE = "Claude Code-credentials";

// ===== Claude 플랜 사용량 (path b: /usage 엔드포인트) =====
export interface ClaudeBucket {
  key: string;
  label: string;
  utilization: number; // %
  resetsAt: string | null; // ISO8601
}

export interface ClaudeUsage {
  available: boolean;
  reason?: string;
  subscriptionType: string | null;
  buckets: ClaudeBucket[];
  asOf: string;
}

// 버킷 키 → /usage 표시 라벨. seven_day_omelette는 /usage상 "Claude Design" 행과 값이 1:1 대응(0%·reset null).
const CLAUDE_LABELS: Record<string, string> = {
  five_hour: "5시간 제한",
  seven_day: "주간 · 전체 모델",
  seven_day_opus: "주간 · Opus",
  seven_day_omelette: "주간 · Claude Design",
  seven_day_sonnet: "주간 · Sonnet",
  seven_day_cowork: "주간 · Cowork",
  seven_day_oauth_apps: "주간 · 외부 앱",
};
const CLAUDE_ORDER = ["five_hour", "seven_day", "seven_day_opus", "seven_day_omelette", "seven_day_sonnet", "seven_day_cowork", "seven_day_oauth_apps"];

// Claude CLI 로그인 OAuth 토큰 로드 (macOS Keychain 우선, 파일 fallback).
// 읽기 전용 — refresh/write 안 함(CLI 토큰 회전 방지). 토큰 값은 반환만 하고 로깅 금지.
function loadClaudeToken(): { accessToken: string; expiresAt: number; subscriptionType: string | null } | null {
  const pick = (oauth: Record<string, unknown> | undefined) => {
    if (!oauth || typeof oauth.accessToken !== "string") return null;
    return {
      accessToken: oauth.accessToken,
      expiresAt: Number(oauth.expiresAt) || 0,
      subscriptionType: typeof oauth.subscriptionType === "string" ? oauth.subscriptionType : null,
    };
  };
  if (process.platform === "darwin") {
    try {
      const raw = execFileSync("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"], { encoding: "utf-8" });
      const got = pick((JSON.parse(raw) as Record<string, unknown>).claudeAiOauth as Record<string, unknown>);
      if (got) return got;
    } catch {
      /* Keychain 실패 → 파일 fallback */
    }
  }
  try {
    if (existsSync(CLAUDE_CRED_FILE)) {
      const got = pick((JSON.parse(readFileSync(CLAUDE_CRED_FILE, "utf-8")) as Record<string, unknown>).claudeAiOauth as Record<string, unknown>);
      if (got) return got;
    }
  } catch {
    /* */
  }
  return null;
}

let claudeCache: { ts: number; data: ClaudeUsage } | null = null;

export async function getClaudeUsage(force = false): Promise<ClaudeUsage> {
  const now = Date.now();
  if (!force && claudeCache && now - claudeCache.ts < CACHE_TTL_MS) return claudeCache.data;
  const asOf = new Date().toISOString();
  const fail = (reason: string, subscriptionType: string | null = null): ClaudeUsage => {
    const data: ClaudeUsage = { available: false, reason, subscriptionType, buckets: [], asOf };
    claudeCache = { ts: now, data };
    return data;
  };

  const cred = loadClaudeToken();
  if (!cred) return fail("Claude 로그인 토큰을 찾지 못함 (Keychain 'Claude Code-credentials' 없음)");
  if (cred.expiresAt && cred.expiresAt <= now) {
    return fail("로그인 토큰 만료 — claude CLI 실행 시 자동 갱신됨", cred.subscriptionType);
  }

  try {
    const res = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${cred.accessToken}`,
        "Content-Type": "application/json",
        "anthropic-beta": "oauth-2025-04-20",
      },
    });
    if (!res.ok) {
      return fail(`usage 엔드포인트 ${res.status}${res.status === 401 ? " (토큰 갱신 필요)" : ""}`, cred.subscriptionType);
    }
    const body = (await res.json()) as Record<string, unknown>;
    const buckets: ClaudeBucket[] = [];
    const pushBucket = (key: string) => {
      const b = body[key] as Record<string, unknown> | null | undefined;
      if (!b || typeof b !== "object") return;
      if (typeof b.utilization !== "number") return;
      buckets.push({
        key,
        label: CLAUDE_LABELS[key] ?? `주간 · ${key.replace(/^seven_day_/, "")}`,
        utilization: b.utilization,
        resetsAt: typeof b.resets_at === "string" ? b.resets_at : null,
      });
    };
    for (const k of CLAUDE_ORDER) pushBucket(k);
    // ORDER에 없는 비-null 버킷(코드네임 등)도 누락 없이 포함 (extra_usage는 구조가 달라 제외)
    for (const k of Object.keys(body)) {
      if (k === "extra_usage" || CLAUDE_ORDER.includes(k)) continue;
      pushBucket(k);
    }
    const data: ClaudeUsage = { available: true, subscriptionType: cred.subscriptionType, buckets, asOf };
    claudeCache = { ts: now, data };
    return data;
  } catch (e) {
    return fail(`usage 호출/파싱 실패: ${String(e).slice(0, 120)}`, cred.subscriptionType);
  }
}

// ===== Codex(GPT) rate limits (로컬 rollout 스냅샷) =====
export interface CodexRateWindow {
  usedPercent: number;
  windowMinutes: number;
  resetsAt: number | null; // epoch seconds
}

export interface CodexUsage {
  available: boolean;
  reason?: string;
  model: string | null;
  planType: string | null;
  primary: CodexRateWindow | null;
  secondary: CodexRateWindow | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  asOf: string | null;
}

// ===== Antigravity(Gemini) 사용량 (로컬 cost-log 누적) =====
// antigravity-cli 어댑터는 agy CLI 자체 인증을 사용한다(Claude Code/Codex CLI와 동일 패턴).
// 따라서 가용성은 환경변수가 아니라 agy 바이너리 존재 여부로 판단한다.
// 누적 토큰은 cost-log.jsonl의 wonyoung agentId 항목에서 24h/7d 윈도우로 집계.
export interface AntigravityUsage {
  available: boolean;
  reason?: string;
  configuredModel: string | null;
  recentActualModel: string | null;
  cliBinaryPath: string | null;
  recent24hTokens: number | null;
  recent7dTokens: number | null;
  recent7dCalls: number;
  asOf: string | null;
}

interface ParsedAntigravityCostLog {
  recent24hTokens: number;
  recent7dTokens: number;
  recent7dCalls: number;
  asOf: string | null;
  recentActualModel: string | null;
}

export function parseAntigravityCostLog(content: string, now = Date.now()): ParsedAntigravityCostLog {
  let recent24hTokens = 0;
  let recent7dTokens = 0;
  let recent7dCalls = 0;
  let asOf: string | null = null;
  let recentActualModel: string | null = null;
  let recentActualModelTs = -Infinity;
  const cutoff24h = now - 24 * 3_600_000;
  const cutoff7d = now - 7 * 24 * 3_600_000;

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    let record: Record<string, unknown>;
    try { record = JSON.parse(line); } catch { continue; }
    if (record.agentId !== ANTIGRAVITY_AGENT_ID) continue;
    const timestamp = typeof record.timestamp === "string" ? Date.parse(record.timestamp) : NaN;
    if (Number.isFinite(timestamp) && typeof record.model === "string" && record.model.trim() && timestamp >= recentActualModelTs) {
      recentActualModel = record.model.trim();
      recentActualModelTs = timestamp;
    }
    if (!Number.isFinite(timestamp) || timestamp < cutoff7d) continue;
    const tokens = num(record.inputTokens) + num(record.outputTokens);
    recent7dTokens += tokens;
    recent7dCalls += 1;
    if (timestamp >= cutoff24h) recent24hTokens += tokens;
    if (typeof record.timestamp === "string" && (!asOf || record.timestamp > asOf)) asOf = record.timestamp;
  }

  return { recent24hTokens, recent7dTokens, recent7dCalls, asOf, recentActualModel };
}

export interface TokenUsage {
  claude: ClaudeUsage;
  codex: CodexUsage;
  antigravity: AntigravityUsage;
}

// 디렉터리 재귀 순회하며 *.jsonl 경로 수집 (mtime이 cutoff 이후인 파일만)
function collectJsonl(dir: string, cutoffMs: number, out: string[]): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true }) as Dirent[];
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      collectJsonl(full, cutoffMs, out);
    } else if (e.isFile() && e.name.endsWith(".jsonl")) {
      try {
        if (statSync(full).mtimeMs >= cutoffMs) out.push(full);
      } catch {
        /* stat 실패 무시 */
      }
    }
  }
}

export function parseCodexSession(content: string): CodexUsage | null {
  let model: string | null = null;
  let latest: CodexUsage | null = null;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let record: Record<string, unknown>;
    try {
      record = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const payload = record.payload as Record<string, unknown> | undefined;
    if (record.type === "turn_context" && typeof payload?.model === "string") {
      model = payload.model;
      continue;
    }
    if (!payload || payload.type !== "token_count") continue;

    const rateLimits = payload.rate_limits as Record<string, unknown> | undefined;
    const info = payload.info as Record<string, unknown> | undefined;
    const totalUsage = (info?.total_token_usage ?? {}) as Record<string, unknown>;
    const primary = parseWindow(rateLimits?.primary);
    const secondary = parseWindow(rateLimits?.secondary);
    if (!primary && !secondary && !info) continue;

    latest = {
      available: true,
      model,
      planType: typeof rateLimits?.plan_type === "string" ? rateLimits.plan_type : null,
      primary,
      secondary,
      inputTokens: totalUsage.input_tokens != null ? num(totalUsage.input_tokens) : null,
      cachedInputTokens: totalUsage.cached_input_tokens != null ? num(totalUsage.cached_input_tokens) : null,
      outputTokens: totalUsage.output_tokens != null ? num(totalUsage.output_tokens) : null,
      totalTokens: totalUsage.total_tokens != null ? num(totalUsage.total_tokens) : null,
      asOf: typeof record.timestamp === "string" ? record.timestamp : null,
    };
  }

  return latest;
}

export function findLatestCodexUsage(sessionDir: string): CodexUsage | null {
  const files: string[] = [];
  collectJsonl(sessionDir, 0, files);
  files.sort((a, b) => safeMtime(b) - safeMtime(a));

  for (const file of files) {
    try {
      const usage = parseCodexSession(readFileSync(file, "utf-8"));
      if (usage) return usage;
    } catch {
      // 읽기 실패 파일은 건너뛰고 다음 세션을 확인한다.
    }
  }
  return null;
}

let codexCache: { ts: number; data: CodexUsage } | null = null;

export function getCodexUsage(force = false): CodexUsage {
  const now = Date.now();
  if (!force && codexCache && now - codexCache.ts < CACHE_TTL_MS) return codexCache.data;

  const unavailable = (reason: string): CodexUsage => ({
    available: false, reason, model: null, planType: null, primary: null, secondary: null,
    inputTokens: null, cachedInputTokens: null, outputTokens: null, totalTokens: null, asOf: null,
  });

  if (!existsSync(CODEX_SESSIONS)) {
    const data = unavailable("~/.codex/sessions 없음");
    codexCache = { ts: now, data };
    return data;
  }

  const usage = findLatestCodexUsage(CODEX_SESSIONS);
  if (usage) {
    codexCache = { ts: now, data: usage };
    return usage;
  }

  const data = unavailable("Codex 사용량 스냅샷을 찾지 못함");
  codexCache = { ts: now, data };
  return data;
}

function parseWindow(w: unknown): CodexRateWindow | null {
  if (!w || typeof w !== "object") return null;
  const o = w as Record<string, unknown>;
  if (o.used_percent == null) return null;
  return {
    usedPercent: num(o.used_percent),
    windowMinutes: num(o.window_minutes),
    resetsAt: o.resets_at != null ? num(o.resets_at) : null,
  };
}

function safeMtime(fp: string): number {
  try {
    return statSync(fp).mtimeMs;
  } catch {
    return 0;
  }
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

let antigravityCache: { ts: number; data: AntigravityUsage } | null = null;

export function getAntigravityUsage(force = false): AntigravityUsage {
  const now = Date.now();
  if (!force && antigravityCache && now - antigravityCache.ts < CACHE_TTL_MS) return antigravityCache.data;
  const wonyoung = getWorkerAgent(ANTIGRAVITY_AGENT_ID);
  const configuredModel = wonyoung ? resolveWorkerRuntime(wonyoung).model : null;

  // antigravity-cli 어댑터와 동일하게 agy 바이너리 존재 여부로 가용성 판정.
  if (!existsSync(AGY_PATH)) {
    const data: AntigravityUsage = {
      available: false,
      reason: `agy CLI 미설치 (확인 경로: ${AGY_PATH})`,
      configuredModel,
      recentActualModel: null,
      cliBinaryPath: null,
      recent24hTokens: null,
      recent7dTokens: null,
      recent7dCalls: 0,
      asOf: null,
    };
    antigravityCache = { ts: now, data };
    return data;
  }

  let parsed = parseAntigravityCostLog("", now);
  if (existsSync(COST_LOG_FILE)) {
    try { parsed = parseAntigravityCostLog(readFileSync(COST_LOG_FILE, "utf-8"), now); } catch { /* 0 유지 */ }
  }

  const data: AntigravityUsage = {
    available: true,
    configuredModel,
    recentActualModel: parsed.recentActualModel,
    cliBinaryPath: AGY_PATH,
    recent24hTokens: parsed.recent24hTokens,
    recent7dTokens: parsed.recent7dTokens,
    recent7dCalls: parsed.recent7dCalls,
    asOf: parsed.asOf,
  };
  antigravityCache = { ts: now, data };
  return data;
}

export async function getTokenUsage(force = false): Promise<TokenUsage> {
  const claude = await getClaudeUsage(force);
  const codex = getCodexUsage(force);
  const antigravity = getAntigravityUsage(force);
  return { claude, codex, antigravity };
}
