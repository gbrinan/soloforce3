import { spawn } from "node:child_process";
import * as pty from "node-pty";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentAdapter, AdapterModelOption, AdapterOptions, AdapterResult } from "./types.js";
import type { AgentConfig, AgentResult } from "../types.js";
import { safeKill } from "../server/utils/platform.js";

const AGY_PATH = process.env.AGY_PATH || join(homedir(), ".local", "bin", "agy");
const PROCESS_TIMEOUT = 60 * 60 * 1000;
const MODEL_LIST_TIMEOUT = 20_000;

const SAFE_ENV_KEYS = [
  "PATH", "HOME", "USER", "SHELL", "TERM", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TMPDIR",
  // Windows 필수 시스템 변수 — 누락 시 node 계열 자식이 0xC0000142(DLL init)로 죽는다 (공용 safeChildEnv와 동일 픽스)
  "SystemRoot", "windir", "SystemDrive", "ComSpec", "PATHEXT",
  "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP",
  "NODE_OPTIONS", "NODE_PATH", "NODE_ENV",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY",
  "SSL_CERT_FILE", "SSL_CERT_DIR",
];

function safeChildEnv(extra?: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of SAFE_ENV_KEYS) {
    const v = process.env[key];
    if (typeof v === "string") out[key] = v;
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (typeof v === "string") out[k] = v;
    }
  }
  return out;
}

interface AgyJsonResponse {
  response?: string;
  stats?: {
    input_tokens?: number;
    output_tokens?: number;
    latency_ms?: number;
  };
  error?: string | null;
}


function estimateTokens(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if ((code >= 0xac00 && code <= 0xd7a3) || (code >= 0x1100 && code <= 0x11ff) || (code >= 0x3130 && code <= 0x318f)) {
      count += 1.8; // Korean characters take more tokens
    } else if (code >= 0x20 && code <= 0x7e) {
      count += 0.35; // English, spaces, and standard ASCII punctuation
    } else {
      count += 1.0; // Newlines and other characters
    }
  }
  return Math.ceil(count);
}

const AGY_GEMINI_MODELS: Record<string, string> = {
  "Gemini 3.5 Flash (Medium)": "gemini-3.5-flash",
  "Gemini 3.5 Flash (High)": "gemini-3.5-flash-high",
  "Gemini 3.5 Flash (Low)": "gemini-3.5-flash-low",
  "Gemini 3.1 Pro (Low)": "gemini-3.1-pro-low",
  "Gemini 3.1 Pro (High)": "gemini-3.1-pro-high",
};

export function parseAgyModels(output: string): AdapterModelOption[] {
  return Object.entries(AGY_GEMINI_MODELS)
    .map(([label, id]) => ({ id, label, index: output.indexOf(label) }))
    .filter((model) => model.index >= 0)
    .sort((a, b) => a.index - b.index)
    .map(({ id, label }) => ({ id, label }));
}

function listAgyModels(): Promise<AdapterModelOption[]> {
  return new Promise((resolve, reject) => {
    let output = "";
    let settled = false;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (idleTimer) clearTimeout(idleTimer);
      try { proc.kill(); } catch { /* 이미 종료됨 */ }
      const models = parseAgyModels(output);
      if (models.length > 0) resolve(models);
      else reject(error ?? new Error("agy models returned no recognized Gemini models"));
    };
    const timeout = setTimeout(() => finish(new Error("agy models timed out")), MODEL_LIST_TIMEOUT);
    let proc: pty.IPty;
    try {
      // Windows에는 SHELL env가 없어 /bin/zsh 폴백이 항상 ENOENT — cmd.exe로 분기.
      const shellBin = process.platform === "win32"
        ? (process.env.ComSpec || "cmd.exe")
        : (process.env.SHELL || "/bin/zsh");
      const shellArgs = process.platform === "win32" ? [] : ["-f"];
      proc = pty.spawn(shellBin, shellArgs, {
        name: "xterm-color",
        cols: 120,
        rows: 30,
        cwd: homedir(),
        env: safeChildEnv(),
      });
    } catch (error) {
      clearTimeout(timeout);
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    proc.onData((data) => {
      output += data;
      if (parseAgyModels(output).length > 0) {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => finish(), 500);
      }
    });
    proc.onExit(() => finish());
    proc.write(`'${AGY_PATH.replace(/'/g, "'\\''")}' models\r`);
  });
}

export const antigravityCliAdapter: AgentAdapter = {
  id: "antigravity-cli",
  supportedModels: [
    { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash (Medium)" },
    { id: "gemini-3.5-flash-high", label: "Gemini 3.5 Flash (High)" },
    { id: "gemini-3.5-flash-low", label: "Gemini 3.5 Flash (Low)" },
    { id: "gemini-3.1-pro-low", label: "Gemini 3.1 Pro (Low)" },
    { id: "gemini-3.1-pro-high", label: "Gemini 3.1 Pro (High)" },
  ],
  listModels: listAgyModels,
  async execute(config: AgentConfig, taskId: string, prompt: string, options?: AdapterOptions): Promise<AdapterResult> {
    const startTime = Date.now();
    const modelId = (config.model && config.model !== "default") ? config.model : "gemini-3.5-flash";
    // agy 플래그: 모델은 `--model`(‑m 미지원), 비대화 출력은 `-p`(플레인 텍스트, --output-format 미지원),
    // print 모드에서 권한 프롬프트로 멈추지 않도록 --dangerously-skip-permissions. (출력은 아래 stdout 폴백으로 파싱)
    const args: string[] = ["--model", modelId, "--dangerously-skip-permissions", "-p", prompt];

    const childEnv = safeChildEnv({
      ANTIGRAVITY_API_KEY: process.env.ANTIGRAVITY_API_KEY,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    });

    console.log(`\n[${config.name}] (antigravity) 작업 시작: ${prompt.slice(0, 80)}...`);

    return new Promise((resolve) => {
      let proc: ReturnType<typeof spawn>;
      try {
        proc = spawn(AGY_PATH, args, {
          stdio: ["ignore", "pipe", "pipe"],
          env: childEnv,
          windowsHide: true,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        resolve({ agentRole: config.role, taskId, success: false, output: "", error: `agy 시작 실패: ${msg}` });
        return;
      }

      if (proc.pid && options?.onSpawn) {
        try { options.onSpawn(proc.pid); } catch { /* */ }
      }

      let stdout = "";
      const errChunks: Buffer[] = [];
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        safeKill(proc, "SIGTERM");
        // SIGTERM 무시 프로세스 좀비화 방지 — agent.ts와 동일한 SIGKILL 에스컬레이션
        setTimeout(() => { if (proc.exitCode === null && proc.signalCode === null) safeKill(proc, "SIGKILL"); }, 5000).unref?.();
        resolve({ agentRole: config.role, taskId, success: false, output: "", error: "antigravity 타임아웃 (60분)" });
      }, PROCESS_TIMEOUT);

      proc.stdout!.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf-8");
        stdout += text;
        if (options?.onText) {
          try { options.onText(text); } catch { /* */ }
        }
      });

      proc.stderr!.on("data", (d: Buffer) => errChunks.push(d));

      proc.on("error", (err) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        resolve({ agentRole: config.role, taskId, success: false, output: "", error: `agy 실행 오류: ${err.message}` });
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;

        let parsed: AgyJsonResponse = {};
        try {
          parsed = JSON.parse(stdout.trim()) as AgyJsonResponse;
        } catch { /* JSON 파싱 실패 시 raw 출력 사용 */ }

        const stderr = Buffer.concat(errChunks).toString("utf-8");
        const output = parsed.response ?? stdout.trim();
        const durationMs = Date.now() - startTime;
        
        // 구독제라 달러를 모른다 — 두 분기 모두 산정 방식을 unpriced 로 명시한다(cost-ledger.ts).
        const cost: AgentResult["cost"] = parsed.stats ? {
          costUsd: 0,
          costMethod: "unpriced",
          inputTokens: parsed.stats.input_tokens ?? 0,
          outputTokens: parsed.stats.output_tokens ?? 0,
          cacheReadTokens: 0,
          cacheCreateTokens: 0,
          durationMs: parsed.stats.latency_ms ?? durationMs,
          model: modelId,
        } : {
          costUsd: 0,
          costMethod: "unpriced",
          inputTokens: estimateTokens(prompt),
          outputTokens: estimateTokens(output),
          cacheReadTokens: 0,
          cacheCreateTokens: 0,
          durationMs,
          model: modelId,
        };

        if (parsed.error || (code !== 0 && !output)) {
          console.error(`[${config.name}] (antigravity) 실패: exit ${code}`);
          resolve({ agentRole: config.role, taskId, success: false, output: output || "", error: parsed.error ?? (stderr || `exit ${code}`), cost });
        } else {
          console.log(`[${config.name}] (antigravity) 완료`);
          resolve({ agentRole: config.role, taskId, success: true, output, cost });
        }
      });
    });
  },
};
