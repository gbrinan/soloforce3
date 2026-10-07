import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AgentConfig } from "../types.js";
import { PROMPTS_DIR, HISTORY_DIR } from "../config.js";

function loadGeniePrompt(): string {
  const promptPath = join(PROMPTS_DIR, "genie.md");
  if (existsSync(promptPath)) return readFileSync(promptPath, "utf-8");
  return "";
}

interface GenieRuntimeConfig {
  readPaths: string[];
  readSensitivePaths?: string[];
  writePaths: string[];
  writeSensitivePaths?: string[];
  bashCommands?: string[];
  bashPaths?: string[];
  bashSensitivePatterns?: string[];
  maxCacheTokens: number;
  maxTurns: number;
  maxConcurrentDelegations: number;
  allowedTools?: string[];
  externalDelegateAllowed?: boolean;
  model?: string | null;
  effort?: string | null;
  workerIdleTimeoutSec: number;
  workerQuestionWindowSec: number;
  mcpServers?: string[];
}

const FALLBACK_CONFIG: GenieRuntimeConfig = {
  readPaths: ["/**"],
  readSensitivePaths: [
    "/.env", "/.env.*", "/.ssh/**", "/.aws/**", "/.gnupg/**",
    "/**/id_rsa*", "/**/id_ed25519*", "/**/id_ecdsa*",
    "/**/*.pem", "/**/*.key", "/**/*.crt", "/**/*.p12", "/**/*.pfx", "/**/*.jks", "/**/*.keychain-db",
  ],
  writePaths: [
    "/history/agents.json",
    "/history/genie-config.json",
    "/history/attachments/**",
    "/history/external/**",
    "/history/skills/**",
  ],
  writeSensitivePaths: ["/**"],
  bashCommands: ["ls", "cat", "head", "tail", "wc", "find", "pwd", "which", "echo", "diff", "git"],
  bashPaths: ["/**"],
  bashSensitivePatterns: [
    "rm\\s+-rf", "\\bsudo\\b", "\\bchmod\\b", "\\bkill\\b", "\\beval\\b", "\\bexec\\b",
    "/\\.ssh/", "/\\.aws/", "/\\.env\\b",
    "git\\s+push", "git\\s+reset", "git\\s+checkout", "git\\s+merge", "git\\s+rebase", "git\\s+commit", "git\\s+stash", "git\\s+add",
  ],
  maxCacheTokens: 3_000_000,
  maxTurns: 35,
  maxConcurrentDelegations: 3,
  allowedTools: ["DelegateTask", "Agent", "WebSearch", "WebFetch"],
  externalDelegateAllowed: false,
  model: "claude-opus-4-7",
  effort: null,
  workerIdleTimeoutSec: 300,
  workerQuestionWindowSec: 180,
};

const CONFIG_FILE = join(HISTORY_DIR, "genie-config.json");
let cfgCache: GenieRuntimeConfig | null = null;
let lastMtime = 0;

// agent-registry.ts loadAgents와 동일 패턴 — mtime 변경 시 재로드, 동일하면 캐시 hit.
function loadGenieConfig(): GenieRuntimeConfig {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(CONFIG_FILE).mtimeMs;
  } catch {
    if (cfgCache) return cfgCache;
    console.warn(`[genie] config 없음, fallback 사용: ${CONFIG_FILE}`);
    return FALLBACK_CONFIG;
  }
  if (cfgCache && mtimeMs === lastMtime) return cfgCache;
  try {
    const cfg = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
    cfgCache = {
      readPaths: Array.isArray(cfg.readPaths) ? cfg.readPaths : FALLBACK_CONFIG.readPaths,
      readSensitivePaths: Array.isArray(cfg.readSensitivePaths) ? cfg.readSensitivePaths : FALLBACK_CONFIG.readSensitivePaths,
      writePaths: Array.isArray(cfg.writePaths) ? cfg.writePaths : FALLBACK_CONFIG.writePaths,
      writeSensitivePaths: Array.isArray(cfg.writeSensitivePaths) ? cfg.writeSensitivePaths : FALLBACK_CONFIG.writeSensitivePaths,
      bashCommands: Array.isArray(cfg.bashCommands) ? cfg.bashCommands : undefined,
      bashPaths: Array.isArray(cfg.bashPaths) ? cfg.bashPaths : undefined,
      bashSensitivePatterns: Array.isArray(cfg.bashSensitivePatterns) ? cfg.bashSensitivePatterns : FALLBACK_CONFIG.bashSensitivePatterns,
      maxCacheTokens: typeof cfg.maxCacheTokens === "number" ? cfg.maxCacheTokens : FALLBACK_CONFIG.maxCacheTokens,
      maxTurns: typeof cfg.maxTurns === "number" ? cfg.maxTurns : FALLBACK_CONFIG.maxTurns,
      maxConcurrentDelegations: typeof cfg.maxConcurrentDelegations === "number" && cfg.maxConcurrentDelegations > 0
        ? cfg.maxConcurrentDelegations : FALLBACK_CONFIG.maxConcurrentDelegations,
      allowedTools: Array.isArray(cfg.allowedTools) ? cfg.allowedTools : FALLBACK_CONFIG.allowedTools,
      externalDelegateAllowed: typeof cfg.externalDelegateAllowed === "boolean" ? cfg.externalDelegateAllowed : FALLBACK_CONFIG.externalDelegateAllowed,
      model: typeof cfg.model === "string" || cfg.model === null ? cfg.model : FALLBACK_CONFIG.model,
      effort: typeof cfg.effort === "string" || cfg.effort === null ? cfg.effort : FALLBACK_CONFIG.effort,
      workerIdleTimeoutSec: typeof cfg.workerIdleTimeoutSec === "number" ? cfg.workerIdleTimeoutSec : FALLBACK_CONFIG.workerIdleTimeoutSec,
      workerQuestionWindowSec: typeof cfg.workerQuestionWindowSec === "number" ? cfg.workerQuestionWindowSec : FALLBACK_CONFIG.workerQuestionWindowSec,
      mcpServers: Array.isArray(cfg.mcpServers) ? cfg.mcpServers : undefined,
    };
    lastMtime = mtimeMs;
    return cfgCache;
  } catch (err) {
    console.warn(`[genie] config 파싱 실패, fallback 사용: ${err instanceof Error ? err.message : err}`);
    return cfgCache ?? FALLBACK_CONFIG;
  }
}

/** 동시 위임 상한 — genie-config.json의 maxConcurrentDelegations (기본 3). 잡 디스패처가 사용. */
export function getMaxConcurrentDelegations(): number {
  return loadGenieConfig().maxConcurrentDelegations;
}

/** 워커 상주 PTY idle-kill 타임아웃(초) — genie-config.json의 workerIdleTimeoutSec (기본 300). (Phase2) */
export function getWorkerIdleTimeoutSec(): number {
  return loadGenieConfig().workerIdleTimeoutSec;
}

/** 워커 질문 마스터 응답 윈도우(초) — genie-config.json의 workerQuestionWindowSec (기본 180). (Phase2) */
export function getWorkerQuestionWindowSec(): number {
  return loadGenieConfig().workerQuestionWindowSec;
}

export function getGenieAgent(): AgentConfig {
  const cfg = loadGenieConfig();
  return {
    role: "orchestrator",
    name: "MyCrew",
    systemPrompt: loadGeniePrompt(),
    allowedTools: cfg.allowedTools ?? [],
    maxTurns: cfg.maxTurns,
    readPaths: cfg.readPaths,
    readSensitivePaths: cfg.readSensitivePaths,
    writePaths: cfg.writePaths,
    writeSensitivePaths: cfg.writeSensitivePaths,
    bashCommands: cfg.bashCommands,
    bashPaths: cfg.bashPaths,
    bashSensitivePatterns: cfg.bashSensitivePatterns,
    maxCacheTokens: cfg.maxCacheTokens,
    model: cfg.model,
    effort: cfg.effort,
    mcpServers: cfg.mcpServers,
  };
}

// 외부 위임 허용 플래그 (routes.ts에서 사용)
export function isExternalDelegateAllowed(): boolean {
  return loadGenieConfig().externalDelegateAllowed === true;
}
