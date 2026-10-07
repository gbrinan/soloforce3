import { gatewayResponseText } from './ai-gateway-response.js';
// 호스트 AI 게이트웨이 — 앱 AI 호출을 코어 한 곳으로 모아 인증·합산 레이트리밋·비용을 일원화한다.
// @mycrew/ai-client가 MYCREW_AI_GATEWAY_URL 설정 시 로컬 claude 스폰 대신 이 엔드포인트로 위임한다.
// 서버는 127.0.0.1 바인딩이라 로컬 앱↔코어 전용이지만, 토큰으로 임의 로컬 프로세스의 무단 소모를 차단한다.
import { spawn } from "node:child_process";
import { timingSafeEqual, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, delimiter } from "node:path";
import { HISTORY_DIR, CLAUDE_PATH } from "../config.js";
import { safeChildEnvForCli } from "./utils/safeChildEnv.js";
import { safeKill } from "./utils/platform.js";

// [로컬 패치] 하드코딩 macOS 경로(/opt/homebrew) 제거 — 다른 모듈과 동일하게 config의
// CLAUDE_PATH(기본 "claude", PATH 탐색)를 사용. Windows에서 게이트웨이 전멸(ENOENT) 원인이었다.
const CLAUDE_BIN = CLAUDE_PATH;
// [로컬 패치] 자식 env 화이트리스트 — 이 파일만 전체 process.env를 상속해
// 서버 시크릿(APPROVAL_RESOLVE_TOKEN 등)·유료 API키 차단이 뚫려 있었다.
const gatewayChildEnv = (): Record<string, string> =>
  safeChildEnvForCli({ PATH: `${process.env.PATH ?? ""}${delimiter}${dirname(CLAUDE_BIN)}` });

// ── 인증 토큰 (history/.ai-gateway-token, 0600, 재시작에도 유지) ──────────────
const TOKEN_FILE = join(HISTORY_DIR, ".ai-gateway-token");
let cachedToken: string | null = null;

export function getGatewayToken(): string {
  if (cachedToken) return cachedToken;
  try {
    const tok = readFileSync(TOKEN_FILE, "utf8").trim();
    if (tok.length >= 32) { cachedToken = tok; return tok; }
  } catch { /* 없음/손상 → 재발급 */ }
  const fresh = randomBytes(32).toString("hex");
  mkdirSync(HISTORY_DIR, { recursive: true });
  writeFileSync(TOKEN_FILE, fresh, { mode: 0o600 });
  cachedToken = fresh;
  return fresh;
}

export function verifyGatewayToken(provided: string | undefined): boolean {
  if (!provided) return false;
  const exp = Buffer.from(getGatewayToken());
  const prov = Buffer.from(provided);
  if (exp.length !== prov.length) return false;
  return timingSafeEqual(exp, prov);
}

// ── 합산 레이트리밋 (호스트 전역: 모든 앱 합산 동시 실행 상한) ────────────────
const MAX_CONCURRENT = Math.max(1, Number(process.env.MYCREW_AI_GW_MAX_CONCURRENT) || 6);
// 일일 예산(USD). 0=무제한. 초과 시 429. 실제 today 지출은 라우트가 cost-log에서 계산해 넘긴다.
const DAILY_BUDGET_USD = Number(process.env.MYCREW_AI_GW_DAILY_BUDGET_USD) || 0;

let active = 0;
const queue: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((r) => queue.push(r));
  active++;
}
function release(): void {
  active--;
  const next = queue.shift();
  if (next) next();
}

export function getDailyBudget(): number { return DAILY_BUDGET_USD; }
export function isOverDailyBudget(todaySpentUsd: number): boolean {
  return DAILY_BUDGET_USD > 0 && todaySpentUsd >= DAILY_BUDGET_USD;
}

export interface GatewayRunResult {
  text: string;
  costUsd?: number;
  usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheCreateTokens?: number };
  model?: string;
  durationMs?: number;
}

interface ClaudeJsonEnvelope {
  structured_output?: unknown; is_error?: boolean;
  result?: string; total_cost_usd?: number; duration_ms?: number; model?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
}

export interface GatewayRunOptions {
  prompt: string;
  model?: string;
  systemPrompt?: string;
  timeoutMs?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  maxTurns?: number;
  permissionMode?: string;
  /** P0-②: 토큰 단위 스트리밍 콜백 — 지정 시 생성 중간 텍스트 델타를 실시간 수신 */
  onText?: (delta: string) => void;
  /** P1-③: 프로바이더 선택 — 기본 claude. ollama는 로컬 무료(비용 0), 실패 시 claude 폴백 */
  provider?: "claude" | "ollama";
  /** Structured ingestion: no tools, MCP, slash commands, persistence or warm-up calls. */
  isolatedText?: boolean;
  jsonSchema?: Record<string, unknown>;
}

// 프롬프트는 stdin(`-p -`)으로 전달해 대용량(디자인 클론 등)에서도 argv 한도에 걸리지 않게 한다.
// onText 지정 시 stream-json 라인에서 텍스트 델타를 실시간 콜백한다 (전체 stdout은 그대로 반환).
function spawnClaudeStdin(args: string[], stdin: string, timeoutMs: number, onText?: (delta: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(CLAUDE_BIN, args, { stdio: ["pipe", "pipe", "pipe"], env: gatewayChildEnv(), windowsHide: true });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      safeKill(proc, "SIGTERM");
      setTimeout(() => { if (proc.exitCode === null && proc.signalCode === null) safeKill(proc, "SIGKILL"); }, 5000).unref?.();
      reject(new Error(`claude timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let lineBuf = "";
    proc.stdout.on("data", (b: Buffer) => {
      out.push(b);
      if (!onText) return;
      lineBuf += b.toString("utf-8");
      let nl: number;
      while ((nl = lineBuf.indexOf("\n")) >= 0) {
        const line = lineBuf.slice(0, nl).trim();
        lineBuf = lineBuf.slice(nl + 1);
        if (!line) continue;
        try {
          const delta = extractTextDelta(JSON.parse(line));
          if (delta !== null) onText(delta);
        } catch { /* JSON 아닌 라인 무시 */ }
      }
    });
    proc.stderr.on("data", (b: Buffer) => err.push(b));
    proc.on("error", (e) => { if (!settled) { settled = true; clearTimeout(timer); reject(e); } });
    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdout = Buffer.concat(out).toString("utf-8");
      if (code !== 0) {
        reject(new Error(`claude exited ${code}: ${Buffer.concat(err).toString("utf-8").trim().slice(0, 500)}`));
        return;
      }
      resolve(stdout);
    });
    if (proc.stdin) {
      proc.stdin.on("error", () => { /* EPIPE는 close에서 처리 */ });
      try { proc.stdin.write(stdin, "utf-8"); proc.stdin.end(); }
      catch (e) { if (!settled) { settled = true; clearTimeout(timer); reject(e instanceof Error ? e : new Error(String(e))); } }
    }
  });
}

// ── 스폰 지연 최적화 ─────────────────────────────────────────────────────────
// claude CLI 스폰은 사용자 훅·플러그인 로드로 이 환경 실측 턴당 30초+가 걸렸다.
// 두 단계로 해결한다 (QA ISSUE-008-b):
// 1) --setting-sources "": 게이트웨이 스폰은 사용자 훅·플러그인을 로드하지 않는다
//    (게이트웨이 요청은 순수 텍스트 생성이라 불필요). 실측 35s → 10.5s.
// 2) 워밍 풀: 동일 구성(모델·시스템프롬프트·도구)의 프로세스를 미리 부팅 + 프라이밍
//    턴까지 마쳐두고, 실제 요청은 두 번째 턴으로 처리. 실측 전송→응답 ~2.3s.
// MYCREW_AI_GW_LOAD_SETTINGS=1 로 (1)을, MYCREW_AI_GW_WARM_POOL=0 으로 (2)를 끌 수 있다.
const GW_SKIP_SETTINGS = process.env.MYCREW_AI_GW_LOAD_SETTINGS !== "1";
const WARM_POOL_ENABLED = process.env.MYCREW_AI_GW_WARM_POOL !== "0";
// 모델 미지정 시 기본값 — CLI 기본(사용자 설정 모델, 보통 Opus)은 분류·경량 생성엔 과하고 느리다.
// 무거운 작업이 필요한 앱은 요청에 model을 명시하면 그대로 쓴다.
const GW_DEFAULT_MODEL = process.env.MYCREW_AI_GW_DEFAULT_MODEL || "claude-haiku-4-5";
const WARM_MAX_KEYS = 4; // 구성별 유휴 프로세스 상한 (LRU 아님 — 초과 구성은 콜드 경로)
const WARM_IDLE_TTL_MS = 10 * 60_000; // 유휴 10분 후 종료 (다음 요청 시 재워밍)
const WARM_PRIME_PROMPT = "Reply with exactly: ok";

interface WarmEntry {
  key: string;
  proc: import("node:child_process").ChildProcessWithoutNullStreams;
  state: "warming" | "ready" | "busy";
  warmCostUsd: number;
  buf: string;
  resultCount: number;
  onResult: ((env: ClaudeJsonEnvelope) => void) | null;
  onDelta: ((text: string) => void) | null;
  idleTimer: NodeJS.Timeout | null;
}

// --include-partial-messages의 stream_event에서 텍스트 델타 추출 (다른 이벤트는 null)
function extractTextDelta(ev: unknown): string | null {
  const e = ev as { type?: string; event?: { type?: string; delta?: { type?: string; text?: string } } };
  if (e.type !== "stream_event") return null;
  if (e.event?.type !== "content_block_delta" || e.event.delta?.type !== "text_delta") return null;
  return e.event.delta.text ?? null;
}

const warmPool = new Map<string, WarmEntry>();

export function buildBaseArgs(opts: GatewayRunOptions): string[] {
  const args: string[] = [];
  if (opts.jsonSchema) args.push("--json-schema", JSON.stringify(opts.jsonSchema));
  if (opts.isolatedText) args.push('--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disable-slash-commands', '--no-session-persistence');
  args.push("--model", opts.model || GW_DEFAULT_MODEL);
  if (opts.systemPrompt) args.push("--append-system-prompt", opts.systemPrompt);
  if (opts.maxTurns) args.push("--max-turns", String(opts.maxTurns));
  if (opts.permissionMode) args.push("--permission-mode", opts.permissionMode);
  if (opts.disallowedTools?.length) args.push("--disallowedTools", opts.disallowedTools.join(","));
  if (opts.allowedTools?.length) args.push("--allowedTools", opts.allowedTools.join(","));
  if (GW_SKIP_SETTINGS || opts.isolatedText) args.push("--setting-sources", "");
  return args;
}

function killWarm(entry: WarmEntry): void {
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  if (warmPool.get(entry.key) === entry) warmPool.delete(entry.key);
  safeKill(entry.proc, "SIGTERM");
  setTimeout(() => { if (entry.proc.exitCode === null && entry.proc.signalCode === null) safeKill(entry.proc, "SIGKILL"); }, 5000).unref?.();
}

function sendUserMessage(entry: WarmEntry, text: string): void {
  entry.proc.stdin.write(
    JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } }) + "\n",
  );
}

// 동일 구성의 유휴 프로세스를 미리 부팅+프라이밍해 둔다. 실패는 조용히 무시(콜드 폴백).
function ensureWarm(key: string, baseArgs: string[]): void {
  if (!WARM_POOL_ENABLED || warmPool.has(key) || warmPool.size >= WARM_MAX_KEYS) return;
  let proc: WarmEntry["proc"];
  try {
    proc = spawn(CLAUDE_BIN, ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages", ...baseArgs], {
      stdio: ["pipe", "pipe", "pipe"],
      env: gatewayChildEnv(),
      windowsHide: true,
    }) as WarmEntry["proc"];
  } catch {
    return;
  }
  const entry: WarmEntry = { key, proc, state: "warming", warmCostUsd: 0, buf: "", resultCount: 0, onResult: null, onDelta: null, idleTimer: null };
  warmPool.set(key, entry);

  proc.stdout.on("data", (c: Buffer) => {
    entry.buf += c.toString("utf-8");
    let nl: number;
    while ((nl = entry.buf.indexOf("\n")) >= 0) {
      const line = entry.buf.slice(0, nl).trim();
      entry.buf = entry.buf.slice(nl + 1);
      if (!line) continue;
      let ev: ClaudeJsonEnvelope & { type?: string };
      try { ev = JSON.parse(line); } catch { continue; }
      // 요청 턴(프라이밍 이후)의 텍스트 델타 → 스트리밍 콜백 (P0-②)
      if (entry.resultCount >= 1 && entry.onDelta) {
        const delta = extractTextDelta(ev);
        if (delta !== null) { entry.onDelta(delta); continue; }
      }
      if (ev.type !== "result") continue;
      entry.resultCount++;
      if (entry.resultCount === 1) {
        // 프라이밍 턴 완료 — 요청 대기 상태로 전환
        entry.warmCostUsd = ev.total_cost_usd ?? 0;
        entry.state = "ready";
        entry.idleTimer = setTimeout(() => killWarm(entry), WARM_IDLE_TTL_MS);
        entry.idleTimer.unref?.();
      } else {
        entry.onResult?.(ev);
      }
    }
  });
  proc.stderr.on("data", () => { /* 소음 무시 — 실패는 close에서 처리 */ });
  const drop = () => {
    if (warmPool.get(key) === entry && entry.state !== "busy") killWarm(entry);
  };
  proc.on("error", drop);
  proc.on("close", drop);
  sendUserMessage(entry, WARM_PRIME_PROMPT);
}

// 워밍된 프로세스에서 실제 요청을 두 번째 턴으로 실행. 프로세스는 1회용(사용 후 종료).
function runOnWarm(entry: WarmEntry, opts: GatewayRunOptions): Promise<GatewayRunResult> {
  return new Promise((resolve, reject) => {
    entry.state = "busy";
    entry.onDelta = opts.onText ?? null;
    if (entry.idleTimer) { clearTimeout(entry.idleTimer); entry.idleTimer = null; }
    warmPool.delete(entry.key);
    const started = Date.now();
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killWarm(entry);
      reject(new Error(`claude(warm) timeout after ${opts.timeoutMs ?? 120_000}ms`));
    }, opts.timeoutMs ?? 120_000);
    entry.onResult = (ev) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const totalCost = ev.total_cost_usd ?? 0;
      resolve({
        text: (ev.result ?? "").trim(),
        // total_cost_usd는 세션 누적 — 프라이밍 턴 비용을 차감해 요청 비용만 계상
        costUsd: Math.max(0, totalCost - entry.warmCostUsd) || undefined,
        durationMs: Date.now() - started,
        model: ev.model,
        usage: ev.usage ? {
          inputTokens: ev.usage.input_tokens,
          outputTokens: ev.usage.output_tokens,
          cacheReadTokens: ev.usage.cache_read_input_tokens,
          cacheCreateTokens: ev.usage.cache_creation_input_tokens,
        } : undefined,
      });
      killWarm(entry);
    };
    try {
      sendUserMessage(entry, opts.prompt);
      entry.proc.stdin.end();
    } catch (e) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        killWarm(entry);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    }
  });
}

export async function runGatewayClaude(opts: GatewayRunOptions): Promise<GatewayRunResult> {
  const baseArgs = buildBaseArgs(opts);
  const key = JSON.stringify(baseArgs);

  await acquire();
  try {
    // 1) 워밍 프로세스가 준비돼 있으면 두 번째 턴으로 즉시 처리 (~2초)
    const warm = warmPool.get(key);
    if (!opts.isolatedText && !opts.jsonSchema && WARM_POOL_ENABLED && warm?.state === "ready") {
      try {
        const result = await runOnWarm(warm, opts);
        ensureWarm(key, baseArgs); // 다음 요청 대비 보충
        return result;
      } catch (err) {
        console.warn("[ai-gateway] 워밍 실행 실패 — 콜드 폴백:", err instanceof Error ? err.message : err);
      }
    }
    // 2) 콜드 경로 (설정 미로드로 기존 대비 단축) + 다음 요청 대비 워밍 스폰
    if (!opts.isolatedText && !opts.jsonSchema) ensureWarm(key, baseArgs);
    // 스트리밍 요청은 콜드에서도 stream-json으로 델타를 흘린다 (P0-②)
    const outputArgs = opts.onText
      ? ["--output-format", "stream-json", "--verbose", "--include-partial-messages"]
      : ["--output-format", "json"];
    const stdout = await spawnClaudeStdin(["-p", "-", ...outputArgs, ...baseArgs], opts.prompt, opts.timeoutMs ?? 120_000, opts.onText);
    const env = opts.onText
      ? (stdout.trim().split("\n").map((l) => { try { return JSON.parse(l) as ClaudeJsonEnvelope & { type?: string }; } catch { return null; } })
          .find((e) => e?.type === "result") ?? {}) as ClaudeJsonEnvelope
      : JSON.parse(stdout.trim()) as ClaudeJsonEnvelope;
    return {
      text: gatewayResponseText(env, Boolean(opts.jsonSchema)),
      costUsd: env.total_cost_usd,
      durationMs: env.duration_ms,
      model: env.model,
      usage: env.usage ? {
        inputTokens: env.usage.input_tokens,
        outputTokens: env.usage.output_tokens,
        cacheReadTokens: env.usage.cache_read_input_tokens,
        cacheCreateTokens: env.usage.cache_creation_input_tokens,
      } : undefined,
    };
  } finally {
    release();
  }
}

// ── P1-③: Ollama 프로바이더 (로컬 무료 — 분류·경량 생성용) ────────────────────
const OLLAMA_URL = process.env.MYCREW_AI_GW_OLLAMA_URL || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.MYCREW_AI_GW_OLLAMA_MODEL || "qwen3.5:9b";

async function runGatewayOllama(opts: GatewayRunOptions): Promise<GatewayRunResult> {
  const started = Date.now();
  const model = opts.model && !opts.model.startsWith("claude") ? opts.model : OLLAMA_MODEL;
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt: opts.prompt,
      ...(opts.systemPrompt ? { system: opts.systemPrompt } : {}),
      stream: true,
      options: { num_predict: 2048 },
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
  });
  if (!res.ok || !res.body) throw new Error(`ollama ${res.status}: ${await res.text().catch(() => "")}`.slice(0, 300));

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  let promptTokens = 0;
  let outTokens = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let ev: { response?: string; done?: boolean; prompt_eval_count?: number; eval_count?: number };
      try { ev = JSON.parse(line); } catch { continue; }
      if (ev.response) { text += ev.response; opts.onText?.(ev.response); }
      if (ev.done) { promptTokens = ev.prompt_eval_count ?? 0; outTokens = ev.eval_count ?? 0; }
    }
  }
  return {
    text: text.trim(),
    costUsd: 0, // 로컬 실행 — API 비용 없음
    durationMs: Date.now() - started,
    model: `ollama:${model}`,
    usage: { inputTokens: promptTokens, outputTokens: outTokens },
  };
}

// ── 통합 진입점 — provider 라우팅 (ollama 실패 시 claude 자동 폴백) ─────────────
export async function runGateway(opts: GatewayRunOptions): Promise<GatewayRunResult> {
  if (opts.provider === "ollama") {
    try {
      return await runGatewayOllama(opts);
    } catch (err) {
      console.warn("[ai-gateway] ollama 실패 — claude 폴백:", err instanceof Error ? err.message : err);
    }
  }
  return runGatewayClaude(opts);
}
