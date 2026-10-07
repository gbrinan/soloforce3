/**
 * worker-pty.ts — 워커를 인터랙티브 PTY로 실행 (claude -p 대안).
 *
 * AgentPty 위에 워커별 PTY를 관리. 어댑터(claude-code)가 config.interactive
 * 일 때 runInteractiveWorker로 분기.
 *
 * lease/생명주기 (#10):
 * - 상주 PTY는 childPid로 등록 안 함 — 잡 lease 만료·cancel로 죽이지 않음.
 *   잡 종료 시 abortWorker(ESC)로 현재 작업만 중단, PTY는 유지/재사용.
 * - 작업 중 PTY 출력은 /ws/worker/:agentId WebSocket으로 라이브 전송 (#12).
 */
import { WebSocketServer, type WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { AgentPty, claudeSessionExists, SUBMIT_RESPONSE_DIRECTIVE } from "./agent-pty.js";
import { buildPermissionArgs } from "../agent.js";
import { resolveAgentMcpServers } from "./mcp-registry.js";
import { CLAUDE_PATH, CLAUDE_BIN_DIR, PROJECT_SELF_DIR, MYCREW_HOME, PROJECTS_DIR, TSX_BIN } from "../config.js";
import { IS_WIN } from "./utils/platform.js";
import { safeChildEnv } from "./utils/safeChildEnv.js";
import { verifyApprovalToken } from "./approval-auth.js";
import { computeMemoryDir } from "../mcp/memory-dir.js";
import { getWorkerIdleTimeoutSec } from "../agents/genie.js";
import { getWorkerAgent } from "../agent-registry.js";
import { extractAndLogCost } from "./cost-extractor.js";
import type { AgentConfig, AgentResult } from "../types.js";
import { getUserTitle } from "./user-title.js";
import { OVERLOAD_BACKOFFS_MS, isApiOverloadError, sleep } from "../claude-error-retry.js";

const workerPtys = new Map<string, AgentPty>();
const workerSessions = new Map<string, string>();  // agentId → claude 세션 ID (--resume용)
const workerViewers = new Map<string, Set<WebSocket>>();  // agentId → 라이브 터미널 뷰어

/** 워커 PTY 출력을 해당 워커의 라이브 터미널 뷰어들에게 브로드캐스트 */
function broadcastToWorkerViewers(agentId: string, data: string): void {
  const viewers = workerViewers.get(agentId);
  if (!viewers) return;
  for (const ws of viewers) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

/** 워커 PTY의 MCP config + cliArgs 생성 (runAgent의 인터랙티브판) */
async function buildWorkerSpawn(config: AgentConfig) {
  const agentId = config.role;
  const port = process.env.PORT ?? "3456";
  const mcpConfigPath = join(tmpdir(), `mycrew-mcp-worker-${agentId}-${process.pid}.json`);
  const memDir = computeMemoryDir(PROJECT_SELF_DIR);
  const hasBash = config.allowedTools.includes("Bash") || (config.bashCommands?.length ?? 0) > 0;
  const base = `http://127.0.0.1:${port}`;
  // 할당된 MCP 서버를 레지스트리에서 해석 (safefs는 아래에 항상 직접 포함)
  const { servers: extraMcp, allowNames, approvalNames } = resolveAgentMcpServers(config.mcpServers);

  writeFileSync(mcpConfigPath, JSON.stringify({
    mcpServers: {
      safefs: {
        command: TSX_BIN,
        args: [join(PROJECT_SELF_DIR, "src", "mcp", "safefs-server.ts")],
        env: {
          MCP_WRITE_PATHS: (() => {
            const wp = config.writePaths ?? [];
            if (wp.length === 0) return "";
            const s = new Set(wp);
            s.add("/history/external/partners.json");
            return Array.from(s).join(",");
          })(),
          MCP_READ_PATHS: config.readPaths?.join(",") ?? "",
          MCP_BASH_ENABLED: hasBash ? "1" : "",
          MCP_BASH_COMMANDS: config.bashCommands?.join(",") ?? "",
          MCP_BASH_PATHS: config.bashPaths?.join(",") ?? "",
          MCP_READ_SENSITIVE: config.readSensitivePaths?.join(",") ?? "",
          MCP_WRITE_SENSITIVE: config.writeSensitivePaths?.join(",") ?? "",
          MCP_BASH_SENSITIVE_PATTERNS: config.bashSensitivePatterns?.join(",") ?? "",
          MCP_APPROVAL_URL: `${base}/api/approvals`,
          MCP_DELEGATE_URL: `${base}/api/delegate`,
          MCP_SEND_PARTNER_URL: `${base}/api/genie/external-send`,
          MCP_REQUEST_PARTNERSHIP_URL: `${base}/api/genie/external-partner-request`,
          MCP_ROTATE_TOKEN_URL: `${base}/api/genie/external-rotate-token`,
          MCP_MY_PROFILE_URL: `${base}/api/genie/my-profile`,
          MCP_AGENT_ROLE: config.role,
          // 상주 PTY라 잡별 갱신 불가 — 고정값. 서버가 worker-* 를 현재 lease의 실제 jobId로 해석.
          MCP_JOB_ID: `worker-${agentId}`,
          MCP_CWD: PROJECT_SELF_DIR,
          MCP_SELF_DIR: PROJECT_SELF_DIR,
          MCP_MYCREW_HOME: MYCREW_HOME,
          MCP_PROJECTS_DIR: PROJECTS_DIR,
          MCP_EXTRA_BASES: existsSync(memDir) ? memDir : "",
          // 인터랙티브 워커는 submit_response로 결과 보고 (워커별 라우팅)
          MCP_SUBMIT_RESPONSE_URL: `${base}/api/agent-response/${agentId}`,
          // 막혔을 때 ask 툴로 질문 → escalation (#13)
          MCP_ASK_URL: `${base}/api/worker-questions`,
        },
      },
      ...extraMcp,   // 레지스트리에서 할당된 MCP 서버 (playwright 등)
    },
  }), "utf-8");

  // --strict-mcp-config: 프로젝트/유저 .mcp.json 누수 차단 (safefs + 할당 서버만 로드).
  const cliArgs = ["--no-chrome", "--strict-mcp-config", "--mcp-config", mcpConfigPath];
  if (config.model) cliArgs.push("--model", config.model);
  // approval 모드 서버 → PreToolUse 훅(서버별 매처)으로 승인카드 라우팅 (네이티브 권한창=freeze 방지).
  // allow 모드 서버 → allowedTools에 통째 추가(승인 없이 사용).
  const hookCmd = `node ${join(PROJECT_SELF_DIR, "scripts", "mcp-approval-hook.mjs")}`;
  const stopHookCmd = `node ${join(PROJECT_SELF_DIR, "scripts", "stop-response-hook.mjs")}`;
  const preToolUse = approvalNames.map((n) => ({
    matcher: `mcp__${n}__.*`,
    hooks: [{ type: "command", command: hookCmd, timeout: 70 }],
  }));
  // Stop 훅 안전망(마이크루와 동일) — 워커가 submit_response를 누락/미해소해도 턴 종료 시
  // last_assistant_message를 /api/agent-response로 전달해 busy 갇힘 방지 + 보고 회수. (Stop은 matcher 미지원)
  const hooks: Record<string, unknown> = {
    Stop: [{ hooks: [{ type: "command", command: stopHookCmd, timeout: 10 }] }],
  };
  if (preToolUse.length) hooks.PreToolUse = preToolUse;
  const extraAllowedTools = allowNames.map((n) => `mcp__${n}`);
  // 인터랙티브 — 내장 도구 차단 + submit_response 허용 (genie PTY와 동일 정책) + 승인 훅
  cliArgs.push(...buildPermissionArgs(config, { interactive: true, hooks, extraAllowedTools }));

  const sid = workerSessions.get(agentId);
  if (sid && claudeSessionExists(sid, PROJECT_SELF_DIR)) {
    cliArgs.push("--resume", sid);
  } else {
    if (sid) console.warn(`[Worker:${agentId}] 세션 ${sid} 대화 파일 없음 — 새 세션으로 시작`);
    const newId = randomUUID();
    cliArgs.push("--session-id", newId);
    workerSessions.set(agentId, newId);
  }
  // 인터랙티브 워커도 결과를 submit_response로 보고 (누락 시 잡이 busy에 갇힘)
  const askDirective = "작업 중 정말 막혀서 사람의 결정·정보가 꼭 필요하면 ask MCP 툴로 질문하세요 (사소한 판단은 스스로). 대화형 질문 메뉴는 쓸 수 없으니 ask 툴을 쓰세요.";
  const approvalDirective = `SafeWrite/SafeEdit/SafeDelete/SafeBash가 작업 범위 밖을 건드려 승인이 필요할 때는 reason 인자에 '왜 이 작업에 그게 필요한지'를 한 줄로 적으세요 (예: '회귀 테스트 결과를 보고서로 남기려고'). 도구 이름만 적지 마세요 — ${getUserTitle()}이 그 사유만 보고 승인/거부를 판단합니다.`;
  // 위임 작업은 '빈 응답' 금지 — 빈 submit_response는 마이크루가 '완료'로 오해해 무한 재위임을 부른다.
  // (위 SUBMIT_RESPONSE_DIRECTIVE의 '답 없으면 빈 content' 안내는 마이크루의 단순 확인 턴 한정 — 워커의 위임 작업에는 적용 안 됨)
  const reportDirective = "위임받은 작업은 끝나면 결과를 반드시 submit_response의 content에 담아 보고하세요 — 성공이면 한 일 요약, 실패·중단·불가면 '왜 못 했는지'와 '누가/어떻게 해야 하는지'를 적으세요. 특히 도구나 권한이 없어 못 하는 작업이면 그 사실을 명확히 보고하세요(예: 'MCP 설치는 제 권한 밖입니다 — 마이크루가 manage_mcp 도구로 직접 해야 합니다'). 위임 작업에 빈 응답(빈 content)은 금지입니다 — 빈 응답을 보내면 마이크루가 '완료됐다'고 오해해 같은 일을 무한 재위임합니다. 그리고 submit_response의 summary 인자에 핵심 결과를 한두 줄로 요약해 넣으세요 — 카드·보고에 이 요약이 표시됩니다(머리만 자르지 말고 진짜 요약, 실패면 사유 요약).";
  cliArgs.push("--append-system-prompt", `${config.systemPrompt}\n\n${SUBMIT_RESPONSE_DIRECTIVE}\n\n${askDirective}\n\n${approvalDirective}\n\n${reportDirective}`);

  return {
    cliArgs,
    cwd: PROJECT_SELF_DIR,
    env: safeChildEnv({
      PATH: `${process.env.PATH ?? ""}${IS_WIN ? ";" : ":"}${CLAUDE_BIN_DIR}`,
      // playwright 등 npx 기반 MCP 서버는 첫 실행 시 패키지를 콜드 다운로드한다.
      // Claude CLI 기본 MCP 시작 타임아웃(30s)을 초과하면 도구가 0개로 등록돼 우즈 E2E가 막힘.
      MCP_TIMEOUT: "180000",
      MCP_TOOL_TIMEOUT: "180000",
      // PreToolUse 훅(mcp-approval-hook.mjs)이 승인 라우팅에 사용
      MYCREW_APPROVAL_BASE: base,
      MYCREW_AGENT_ROLE: config.role,
      MYCREW_JOB_ID: `worker-${agentId}`,
      // Stop 훅이 턴 종료 시 워커 보고를 전달할 대상 (멱등 — awaiter 없으면 receiveWorkerResponse가 no-op)
      MYCREW_STOP_SUBMIT_URL: `${base}/api/agent-response/${agentId}`,
    }),
    cleanup: () => { try { unlinkSync(mcpConfigPath); } catch { /* */ } },
  };
}

function getWorkerPty(config: AgentConfig): AgentPty {
  const agentId = config.role;
  let p = workerPtys.get(agentId);
  if (!p) {
    p = new AgentPty({
      agentId,
      claudePath: CLAUDE_PATH,
      // idle-kill 타임아웃 — genie-config.json의 workerIdleTimeoutSec (PTY 생성 시 1회 반영)
      idleTimeoutMs: getWorkerIdleTimeoutSec() * 1000,
      buildSpawn: () => buildWorkerSpawn(config),
      onData: (d) => broadcastToWorkerViewers(agentId, d),  // 라이브 터미널 (#12)
    });
    workerPtys.set(agentId, p);
  }
  return p;
}

/**
 * 인터랙티브 워커 실행 — 어댑터 execute의 인터랙티브 분기.
 * runAgent(-p)와 동일하게 AgentResult 반환.
 */
export async function runInteractiveWorker(
  config: AgentConfig,
  taskId: string,
  prompt: string,
): Promise<AgentResult> {
  let pty = getWorkerPty(config);
  const maxOverloadRetries = OVERLOAD_BACKOFFS_MS.length;
  for (let overloadAttempt = 0; overloadAttempt <= maxOverloadRetries; overloadAttempt++) {
   try {
    await pty.ensureReady();
    // 상주 PTY는 childPid로 등록하지 않음 — 잡 lease 만료·cancel로 죽이면 안 됨.
    // 잡 종료는 abortWorker(ESC)가 처리하고 PTY는 유지/재사용.
    console.log(`[Worker:${config.role}] 인터랙티브 위임 — ${prompt.slice(0, 60)}`);
    const submitStart = Date.now();
    let output: string;
    try {
      output = await pty.submitPrompt(prompt);
    } catch (err) {
      // 좀비/소켓끊김 자동복구 — agent_pty_busy 인데 isHealthy=false면 PTY 사망 의심.
      // 1회 한정 reset+재시도 (무한루프 차단).
      const msg = err instanceof Error ? err.message : String(err);
      const isBusy = msg.includes("agent_pty_busy");
      if (isBusy && !pty.isHealthy()) {
        console.warn(`[Worker:${config.role}] busy+unhealthy 감지 — reset 후 1회 재시도`);
        resetWorker(config.role);
        pty = getWorkerPty(config);
        await pty.ensureReady();
        output = await pty.submitPrompt(prompt);
      } else {
        throw err;
      }
    }
    if (overloadAttempt < maxOverloadRetries && isApiOverloadError(output)) {
      const backoff = OVERLOAD_BACKOFFS_MS[overloadAttempt];
      console.warn(`[Worker:${config.role}] API 과부하(529/429) 감지 — ${backoff}ms 후 재시도 (${overloadAttempt + 1}/${maxOverloadRetries})`);
      await sleep(backoff);
      continue;
    }
    console.log(`[Worker:${config.role}] 완료`);
    // 비용 집계 — 인터랙티브 워커도 세션 jsonl에서 추출 (마이크루와 동일 방식).
    // jsonl flush 시간 약간 줌 (마이크루 path와 동일하게 200ms 지연 백그라운드).
    const sid = workerSessions.get(config.role);
    if (sid) {
      const dur = Date.now() - submitStart;
      setTimeout(() => extractAndLogCost(config.role, sid, dur), 200);
    }
    return { agentRole: config.role, taskId, success: true, output };
   } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (overloadAttempt < maxOverloadRetries && (isApiOverloadError(error) || isApiOverloadError(pty?.replayBuffer ?? ""))) {
      const backoff = OVERLOAD_BACKOFFS_MS[overloadAttempt];
      console.warn(`[Worker:${config.role}] API 과부하(529/429) 감지 — ${backoff}ms 후 재시도 (${overloadAttempt + 1}/${maxOverloadRetries})`);
      await sleep(backoff);
      continue;
    }
    console.error(`[Worker:${config.role}] 인터랙티브 위임 실패: ${error}`);
    return { agentRole: config.role, taskId, success: false, output: "", error };
   }
  }
  // 재시도 루프 소진 — 마지막 시도는 항상 return하므로 도달 불가. 타입 안정성용 fallback.
  return { agentRole: config.role, taskId, success: false, output: "", error: "API 과부하 재시도 소진" };
}

/** submit_response 수신 (워커별 — /api/agent-response/:agentId 라우트가 호출) */
export function receiveWorkerResponse(agentId: string, content: string): boolean {
  const pty = workerPtys.get(agentId);
  if (!pty) {
    console.warn(`[Worker:${agentId}] submit_response 수신 — PTY 없음`);
    return false;
  }
  return pty.receiveResponse(content);
}

/**
 * 인터랙티브 워커의 현재 작업 중단 (claude TUI에 ESC) — lease 만료·cancel 시 호출.
 * 상주 PTY는 죽이지 않고 작업만 끊어 다음 위임에 재사용. PTY 없으면 false.
 */
export function abortWorker(agentId: string): boolean {
  const pty = workerPtys.get(agentId);
  if (!pty) return false;
  return pty.abort().ok;
}

/** 워커 PTY가 현재 살아있는지 — 직원탭의 대기중/휴식중 구분용 */
export function isWorkerPtyAlive(agentId: string): boolean {
  return workerPtys.get(agentId)?.ready ?? false;
}

/**
 * 좀비/소켓끊김 워커 PTY 정리 — 워치독·부팅 hook이 호출.
 * isHealthy()=false인 워커 PTY를 force terminate(SIGKILL까지) + 맵에서 제거.
 * 다음 위임 시 새 PTY가 자동 spawn됨. 반환: 정리 개수.
 */
export function sweepZombieWorkerPtys(): number {
  let cleaned = 0;
  for (const [agentId, pty] of workerPtys.entries()) {
    if (pty.isHealthy()) continue;
    console.warn(`[Worker:${agentId}] 좀비 PTY 감지 — force terminate + 맵 제거`);
    try { pty.terminate({ force: true }); } catch (e) {
      console.error(`[Worker:${agentId}] terminate 실패:`, e instanceof Error ? e.message : e);
    }
    workerPtys.delete(agentId);
    cleaned++;
  }
  return cleaned;
}

/** 워커 PTY의 idle-kill 예정 시각(epoch ms) — 직원탭 "휴식까지" 카운트다운용. 0이면 미무장. */
export function getWorkerIdleDeadline(agentId: string): number {
  return workerPtys.get(agentId)?.idleDeadline ?? 0;
}

/**
 * 인터랙티브 워커가 이어갈 수 있는 살아있는 claude 세션을 가졌는지.
 * 위임 프롬프트의 fat(정체성·조직도·위키 전체)/body(작업만) 분기 판단용 —
 * buildWorkerSpawn의 --resume 조건과 동일하게 맞춤 (세션 jsonl 존재까지 확인).
 */
export function hasWorkerSession(agentId: string): boolean {
  const sid = workerSessions.get(agentId);
  return !!sid && claudeSessionExists(sid, PROJECT_SELF_DIR);
}

/**
 * 워커 세션·PTY 완전 리셋 (일일 리셋용).
 * PTY 종료 + workerPtys/workerSessions에서 제거 → 다음 위임 시 새 AgentPty가
 * 최신 config로 생성되고 새 claude 세션(--resume 아닌 --session-id)으로 시작.
 * (기존 clearPmSession은 -p 모드용이라 인터랙티브 워커 PTY를 안 건드렸음)
 */
export function resetWorker(agentId: string): void {
  const pty = workerPtys.get(agentId);
  if (pty) pty.terminate();
  workerPtys.delete(agentId);
  workerSessions.delete(agentId);
  console.log(`[Worker:${agentId}] 세션·PTY 리셋 — 다음 위임 시 새 세션·config로 재생성`);
}

// ── 워커 라이브 터미널 WebSocket (/ws/worker/:agentId, 읽기 전용) ──────────────
let workerWss: WebSocketServer | null = null;

export function attachWorkerTerminalWS(): void {
  workerWss = new WebSocketServer({ noServer: true });
  workerWss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const pathname = new URL(req.url || "", "http://localhost").pathname;
    const agentId = pathname.replace(/^\/ws\/worker\//, "");
    if (!agentId || !getWorkerAgent(agentId)) {
      try { ws.close(); } catch { /* */ }
      return;
    }
    let viewers = workerViewers.get(agentId);
    if (!viewers) { viewers = new Set(); workerViewers.set(agentId, viewers); }
    viewers.add(ws);
    // 현재까지의 PTY 출력 replay (워커가 작업 중이면 진행 상황 즉시 표시)
    const pty = workerPtys.get(agentId);
    if (pty?.replayBuffer) ws.send(pty.replayBuffer);

    ws.on("message", (raw) => {
      // 읽기 전용 — resize만 PTY에 반영, 그 외 입력은 무시
      try {
        const msg = typeof raw === "string" ? raw : raw.toString("utf-8");
        const parsed = JSON.parse(msg);
        if (parsed.type === "resize" && parsed.cols && parsed.rows) {
          workerPtys.get(agentId)?.resize(parsed.cols, parsed.rows);
        }
      } catch { /* */ }
    });
    ws.on("close", () => {
      workerViewers.get(agentId)?.delete(ws);
    });
  });
  console.log("[Worker] 라이브 터미널 WebSocket 서버 준비 (/ws/worker/:agentId)");
}

export function handleWorkerTerminalUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): void {
  // 대시보드 토큰 인정 — 마스터 strict 비교는 클라이언트(대시보드 토큰 사용)를 401로 차단한다.
  if (process.env.APPROVAL_RESOLVE_TOKEN) {
    const url = new URL(req.url || "", "http://localhost");
    const token = url.searchParams.get("token") || "";
    if (!verifyApprovalToken({ "x-approval-token": token })) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
  }
  if (!workerWss) { socket.destroy(); return; }
  workerWss.handleUpgrade(req, socket, head, (ws) => {
    workerWss!.emit("connection", ws, req);
  });
}
