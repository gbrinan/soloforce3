import { execFile, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { HISTORY_DIR } from "../config.js";
import { addGenieMessage, sendMessage } from "./chat.js";
import { getTodos, markTodoDone } from "./todos.js";

const GenieConfigSchema = z.object({
  writePaths: z.array(z.string()).optional(),
}).passthrough();

const NgrokResponseSchema = z.object({
  tunnels: z.array(z.object({ public_url: z.string() }).passthrough()).default([]),
}).passthrough();

const RestartResultSchema = z.object({ request: z.string() }).passthrough();
const RESTART_FLAG = join(HISTORY_DIR, ".self-restart");
const RESTART_RESULT = join(HISTORY_DIR, ".self-restart-result.json");

export function ensureGenieConfigExternalWritePath(): void {
  const path = join(HISTORY_DIR, "genie-config.json");
  if (!existsSync(path)) return;
  try {
    const untrusted: unknown = JSON.parse(readFileSync(path, "utf8"));
    const config = GenieConfigSchema.parse(untrusted);
    if (config.writePaths?.includes("/history/external/**") ?? false) return;
    const next = { ...config, writePaths: [...(config.writePaths ?? []), "/history/external/**"] };
    writeFileSync(path, JSON.stringify(next, null, 2));
    console.log("[Boot] history/genie-config.json writePaths에 /history/external/** 추가");
  } catch (error) {
    console.warn("[Boot] genie-config 마이그레이션 실패 (무시):", error instanceof Error ? error.message : String(error));
  }
}

export function ensureExternalDir(): void {
  try {
    mkdirSync(join(HISTORY_DIR, "external"), { recursive: true });
  } catch (error) {
    console.warn("[Boot] history/external 생성 실패:", error instanceof Error ? error.message : String(error));
  }
}

export function ensureStorePreseeded(): void {
  if (process.env.MYCREW_STORE_MANAGED === "1") return;
  const installedFile = join(HISTORY_DIR, "store", "installed.jsonl");
  if (existsSync(installedFile)) return;
  try {
    execFileSync("npx", ["tsx", join(process.cwd(), "scripts/store-preseed-installed.ts")], {
      stdio: "inherit",
      timeout: 30_000,
    });
    console.log("[Boot] 스토어 설치상태 프리시드 완료");
  } catch (error) {
    console.error("[Boot] 스토어 프리시드 실패 (다음 부팅에 재시도):", error instanceof Error ? error.message : String(error));
  }
}

function getNgrokUrl(): Promise<string | null> {
  return new Promise((complete) => {
    execFile("curl", ["-s", "http://127.0.0.1:4040/api/tunnels"], { timeout: 3000 }, (error, stdout) => {
      if (error !== null) return complete(null);
      let untrusted: unknown;
      try {
        untrusted = JSON.parse(stdout);
      } catch (parseError) {
        if (parseError instanceof SyntaxError) return complete(null);
        throw parseError;
      }
      const parsed = NgrokResponseSchema.safeParse(untrusted);
      if (!parsed.success) return complete(null);
      return complete(parsed.data.tunnels.find((tunnel) => tunnel.public_url.startsWith("https"))?.public_url ?? null);
    });
  });
}

function startNgrok(port: number): Promise<string | null> {
  return new Promise((complete) => {
    const args = ["http", String(port)];
    if (process.env.NGROK_URL) args.push("--url", process.env.NGROK_URL);
    args.push("--log=stdout");
    const child = spawn("ngrok", args, { detached: true, stdio: "ignore" });
    child.unref();
    let attempts = 0;
    const check = (): void => {
      attempts += 1;
      void getNgrokUrl().then((url) => {
        if (url !== null) return complete(url);
        if (attempts >= 10) return complete(null);
        setTimeout(check, 1000);
      });
    };
    setTimeout(check, 2000);
  });
}

async function ensureNgrok(port: number): Promise<string | null> {
  if (process.env.TUNNEL_URL) return null;
  const existing = await getNgrokUrl();
  if (existing !== null) return existing;
  if (!process.env.NGROK_URL) return null;
  console.log("[Ngrok] 시작 중...");
  return startNgrok(port);
}

export async function handleSelfRestart(port: number): Promise<void> {
  if (!existsSync(RESTART_FLAG)) return;
  unlinkSync(RESTART_FLAG);
  console.log("[Self] 자가 수정 후 재시작 감지");
  const localUrl = `http://localhost:${port}`;
  const tunnelUrl = process.env.TUNNEL_URL;
  const ngrokDomain = process.env.NGROK_URL;
  const ngrokUrl = await ensureNgrok(port);
  let message = `🚀 시스템 업데이트 완료! 서버가 재시작됐어요.\n\n- 로컬: ${localUrl}`;
  if (tunnelUrl) message += `\n- 네트워크: ${tunnelUrl}`;
  if (ngrokUrl) {
    message += ngrokDomain
      ? `\n- ngrok(고정): ${ngrokUrl}`
      : `\n- ngrok(변동): ${ngrokUrl}\n  ⚠️ 서버가 재부팅되면 주소가 변경됩니다. 친구(동료) 통신 API 사용 시 재부팅마다 변경해야 합니다.`;
  }
  if (existsSync(RESTART_RESULT)) {
    try {
      const untrusted: unknown = JSON.parse(readFileSync(RESTART_RESULT, "utf8"));
      const result = RestartResultSchema.parse(untrusted);
      message += `\n\n**완료된 작업:** ${result.request}`;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
    }
    unlinkSync(RESTART_RESULT);
  }
  addGenieMessage(message);
  console.log(`[Self] 로컬: ${localUrl}${tunnelUrl ? ` / 네트워크: ${tunnelUrl}` : ""}${ngrokUrl ? ` / ngrok: ${ngrokUrl}` : ""}`);
  try {
    const pending = getTodos({ origin: "genie", status: "pending" }).filter((todo) =>
      todo.instruction.startsWith("[재시작 후 이어가기]"),
    );
    const [target, ...rest] = pending;
    if (target === undefined) return;
    const summary = target.instruction.replace("[재시작 후 이어가기] ", "").slice(0, 500);
    console.log(`[Self] 이어가기 자동 트리거: ${summary.slice(0, 60)}`);
    void sendMessage(
      `재시작 완료됐어. 중단된 작업을 이어서 진행해줘.\n내용: ${summary}`,
      undefined,
      undefined,
      { internal: true },
    ).catch((error) => console.error("[Self] 이어가기 트리거 실패:", error));
    markTodoDone(target.id);
    for (const old of rest) {
      markTodoDone(old.id);
      console.log(`[Self] 과거 이어받기 TODO 자동 종료: ${old.id.slice(0, 8)}`);
    }
  } catch (error) {
    console.error("[Self] 이어가기 처리 실패:", error instanceof Error ? error.message : String(error));
  }
}

export function rotateLog(): void {
  const path = join(tmpdir(), "teamLGS.log");
  try {
    if (statSync(path).size <= 10 * 1024 * 1024) return;
    writeFileSync(path, readFileSync(path, "utf8").slice(-2 * 1024 * 1024));
    console.log("[Log] 로그 파일 로테이션 완료");
  } catch (error) {
    if (!(error instanceof Error)) throw error;
  }
}
