// 승인 + 화이트리스트 추가 — genie-config.json 갱신
// scope: 'file' = 정확 경로, 'folder' = dirname + "/**"
// 다음 워커 spawn부터 적용 (실시간 reload 없음)

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { HISTORY_DIR } from "../config.js";
import type { ApprovalRequest } from "./approvals.js";

const CONFIG_PATH = join(HISTORY_DIR, "genie-config.json");

const READ_TOOLS = new Set(["SafeRead", "SafeGlob", "SafeGrep", "SafeReadImage"]);
const WRITE_TOOLS = new Set(["SafeWrite", "SafeEdit", "SafeDelete"]);
const BASH_TOOLS = new Set(["SafeBash"]);

// 화이트리스트 추가 금지 — 민감 경로 보호
const FORBIDDEN_PATTERNS = [
  /\/\.env(\.|$|\/)/,
  /\/\.(ssh|aws|gnupg|gcp|netrc)(\/|$)/,
  /\/id_(rsa|ed25519|ecdsa)/,
  /\.(pem|key|crt|p12|pfx|jks|keychain-db)$/,
  /^\/(etc|usr|var|System|private)\//,
];

// 화이트리스트 추가 금지 — 위험 명령어
const FORBIDDEN_BASH = new Set([
  "rm", "sudo", "chmod", "chown", "kill", "killall", "pkill",
  "eval", "exec", "curl", "wget", "dd",
]);

export interface AddToWhitelistResult {
  ok: boolean;
  reason?: string;
  target?: string;
  field?: "readPaths" | "writePaths" | "bashCommands";
  duplicate?: boolean;
}

export function addToWhitelist(req: ApprovalRequest, scope: "file" | "folder"): AddToWhitelistResult {
  if (!existsSync(CONFIG_PATH)) {
    return { ok: false, reason: "genie-config.json not found" };
  }

  let target: string;
  let field: "readPaths" | "writePaths" | "bashCommands";

  if (BASH_TOOLS.has(req.tool)) {
    // bash: scope 무시, 첫 단어만 추출
    const firstWord = (req.path ?? "").trim().split(/\s+/)[0];
    if (!firstWord) return { ok: false, reason: "empty bash command" };
    if (FORBIDDEN_BASH.has(firstWord)) {
      return { ok: false, reason: `forbidden bash command: ${firstWord}` };
    }
    target = firstWord;
    field = "bashCommands";
  } else if (READ_TOOLS.has(req.tool) || WRITE_TOOLS.has(req.tool)) {
    for (const re of FORBIDDEN_PATTERNS) {
      if (re.test(req.path)) {
        return { ok: false, reason: `forbidden sensitive path: ${re}` };
      }
    }
    if (scope === "folder") {
      const dir = dirname(req.path);
      if (dir === "/" || dir === "" || dir === ".") {
        return { ok: false, reason: "root-level path too broad" };
      }
      target = dir + "/**";
    } else {
      target = req.path;
    }
    field = READ_TOOLS.has(req.tool) ? "readPaths" : "writePaths";
  } else {
    return { ok: false, reason: `unsupported tool: ${req.tool}` };
  }

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  } catch (err) {
    return { ok: false, reason: `config parse failed: ${err instanceof Error ? err.message : err}` };
  }

  const arr = (config[field] as string[] | undefined) ?? [];
  if (arr.includes(target)) {
    return { ok: true, target, field, duplicate: true };
  }
  arr.push(target);
  config[field] = arr;

  try {
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
  } catch (err) {
    return { ok: false, reason: `config write failed: ${err instanceof Error ? err.message : err}` };
  }

  console.log(`[Whitelist] 추가: ${field} += "${target}" (tool=${req.tool}, scope=${scope})`);
  return { ok: true, target, field };
}
