/**
 * 터미널 모드: WebSocket ↔ 마이크루 PTY 브릿지
 * - /ws/terminal 경로로 WebSocket 연결, Claude CLI interactive 세션을 xterm.js에 전달
 * - 응답 캡처: submit_response MCP 툴 → /api/terminal/response → receiveTerminalResponse()
 *
 * 마이크루 PTY의 수명·spawn·submit_response 대기·abort·준비대기는 AgentPty가 관리.
 * 이 모듈은 AgentPty 위에서 WS 미러링·사용자 입력 추적·대화 저장만 담당
 * (AgentPty 설계상 caller 책임 영역).
 * - WebSocket이 끊겨도 PTY는 유지 (idleTimeoutMs=0 — 무기한)
 * - 재연결 시 AgentPty.replayBuffer로 화면 복원
 */
import { WebSocketServer, type WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { appendFileSync, mkdirSync, existsSync, writeFileSync, unlinkSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { CLAUDE_PATH, CLAUDE_BIN_DIR, HISTORY_DIR, PROJECT_SELF_DIR, MYCREW_HOME, PROJECTS_DIR, getTodayKST, TSX_BIN } from "../config.js";
import { safeChildEnv } from "./utils/safeChildEnv.js";
import { verifyApprovalToken } from "./approval-auth.js";
import { getGenieSessionInfo, buildSessionContext, setGenieSessionId, addGenieMessage, sendMessage, getGenieName } from "./chat.js";
import { getGenieAgent } from "../agents/genie.js";
import { buildPermissionArgs } from "../agent.js";
import { resolveAgentMcpServers } from "./mcp-registry.js";
import { listManifests } from "./app-registry.js";
import { AgentPty, claudeSessionExists, SUBMIT_RESPONSE_DIRECTIVE, type SpawnSpec } from "./agent-pty.js";
import { computeMemoryDir } from "../mcp/memory-dir.js";
import { archiveChatMessage } from "./audit.js";
import { emitGlobalEvent } from "./jobs.js";
import { getUserTitle } from "./user-title.js";

// ── 모듈 상태 ────────────────────────────────────────────────────────────────
let wss: WebSocketServer | null = null;
const viewers = new Set<WebSocket>();
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let inputBuffer = "";      // 사용자 타이핑 누적 (Enter 시 flush)
let inputEscaping = false; // ESC 시퀀스 스킵 상태
let inputCsi = false;      // \x1b[ CSI 시퀀스 여부

const CHAT_RESPONSE_TIMEOUT_MS = 30 * 60 * 1000;  // 30분 — 툴 사용 긴 응답 대비

// ── 마이크루 권한 레벨 (whitelist/workspace/full) — 영속 + spawn env로 SafeFS에 전달 ───────────
export type GeniePermLevel = "whitelist" | "workspace" | "full";
const PERM_LEVEL_FILE = join(HISTORY_DIR, "genie-perm-level");
let geniePermLevel: GeniePermLevel = (() => {
  try {
    const v = readFileSync(PERM_LEVEL_FILE, "utf-8").trim();
    if (v === "workspace" || v === "full") return v;
  } catch { /* 미설정 → 기본 whitelist */ }
  return "whitelist";
})();
export function getGeniePermLevel(): GeniePermLevel { return geniePermLevel; }
export function setGeniePermLevel(level: GeniePermLevel): void {
  geniePermLevel = level;
  try {
    if (!existsSync(HISTORY_DIR)) mkdirSync(HISTORY_DIR, { recursive: true });
    writeFileSync(PERM_LEVEL_FILE, level, "utf-8");
  } catch (e) { console.error("[Terminal] 권한 레벨 저장 실패:", e); }
  console.log(`[Terminal] 마이크루 권한 레벨 → ${level} (세션 재spawn으로 적용)`);
  emitGlobalEvent("perm-level", { level });   // 모든 클라이언트 버튼 동기화 (로컬↔네트워크)
  // 새 env(MCP_PERM_LEVEL)로 재spawn → 준비완료 후 새 세션이 변경을 사장님께 안내(=확실).
  const desc: Record<GeniePermLevel, string> = {
    whitelist: "제한 모드 (허용 경로만, 범위 밖·민감 작업은 승인 필요)",
    workspace: "작업공간 무제한 모드 (워크스페이스 안은 승인 없이 자유, 밖은 차단)",
    full: "완전 무제한 모드 (모든 경로·명령 허용, 승인 없음)",
  };
  void ptyRespawnForReset().then(() => {
    void sendMessage(
      `[시스템] ${getUserTitle()}이 너의 권한을 '${desc[level]}'로 변경해서 세션이 재시작됐어. ${getUserTitle()}께 [NOTIFY]로 '권한 모드 변경됨 — ${desc[level]}'을 한 줄로 확인해줘.`,
      undefined, undefined, { internal: true, source: "perm-level:change" },
    ).catch(() => {});
  }).catch((e) => console.error("[Terminal] 권한 변경 재spawn 실패:", e));
}

type WsWithAlive = WebSocket & { isAlive?: boolean };
const HEARTBEAT_MS = 30_000;

// ── 마이크루 PTY (AgentPty) ───────────────────────────────────────────────────────
/** 마이크루 PTY의 MCP config + cliArgs 생성 — AgentPty가 (재)spawn마다 호출 */
async function buildGenieSpawn(): Promise<SpawnSpec> {
  const genieConfig = getGenieAgent();
  const mcpConfigPath = join(tmpdir(), `mycrew-mcp-pty-${process.pid}.json`);
  const port = process.env.PORT ?? "3456";
  const memDir = computeMemoryDir(PROJECT_SELF_DIR);
  // 마이크루에 할당된 MCP 서버를 레지스트리에서 해석 (safefs는 아래에 항상 직접 포함)
  const { servers: extraMcp, allowNames, approvalNames } = resolveAgentMcpServers(genieConfig.mcpServers);
  writeFileSync(mcpConfigPath, JSON.stringify({
    mcpServers: {
      ...extraMcp,
      safefs: {
        command: TSX_BIN,
        args: [join(PROJECT_SELF_DIR, "src", "mcp", "safefs-server.ts")],
        env: {
          MCP_WRITE_PATHS: (() => {
            const base = genieConfig.writePaths ?? [];
            const s = new Set(base);
            s.add("/history/external/partners.json");
            return Array.from(s).join(",");
          })(),
          MCP_READ_PATHS: genieConfig.readPaths?.join(",") ?? "",
          // 권한 레벨 — SafeFS가 경로·승인·bash 체크를 레벨별로 분기 (whitelist/workspace/full)
          MCP_PERM_LEVEL: geniePermLevel,
          // workspace/full에선 bash도 풀어야 하므로 SafeBash 툴 등록 강제(=BASH_ENABLED)
          MCP_BASH_ENABLED: (geniePermLevel !== "whitelist" || (genieConfig.bashCommands?.length ?? 0) > 0) ? "1" : "",
          MCP_BASH_COMMANDS: genieConfig.bashCommands?.join(",") ?? "",
          MCP_BASH_PATHS: genieConfig.bashPaths?.join(",") ?? "",
          MCP_READ_SENSITIVE: genieConfig.readSensitivePaths?.join(",") ?? "",
          MCP_WRITE_SENSITIVE: genieConfig.writeSensitivePaths?.join(",") ?? "",
          MCP_BASH_SENSITIVE_PATTERNS: genieConfig.bashSensitivePatterns?.join(",") ?? "",
          MCP_APPROVAL_URL: `http://127.0.0.1:${port}/api/approvals`,
          MCP_DELEGATE_URL: `http://127.0.0.1:${port}/api/delegate`,
          MCP_SEND_PARTNER_URL: `http://127.0.0.1:${port}/api/genie/external-send`,
          MCP_REQUEST_PARTNERSHIP_URL: `http://127.0.0.1:${port}/api/genie/external-partner-request`,
          MCP_ROTATE_TOKEN_URL: `http://127.0.0.1:${port}/api/genie/external-rotate-token`,
          MCP_MY_PROFILE_URL: `http://127.0.0.1:${port}/api/genie/my-profile`,
          MCP_AGENT_ROLE: genieConfig.role,
          MCP_JOB_ID: "terminal",
          MCP_CWD: PROJECT_SELF_DIR,
          MCP_SELF_DIR: PROJECT_SELF_DIR,
          MCP_MYCREW_HOME: MYCREW_HOME,
          MCP_PROJECTS_DIR: PROJECTS_DIR,
          MCP_EXTRA_BASES: existsSync(memDir) ? memDir : "",
          MCP_SUBMIT_RESPONSE_URL: `http://127.0.0.1:${port}/api/terminal/response`,
          MCP_POST_MESSAGE_URL: `http://127.0.0.1:${port}/api/terminal/message`,
          MCP_GENIE_ACTION_BASE: `http://127.0.0.1:${port}`,
        },
      },
      // 지니 전용 앱 데이터 통합 질의(ledger/bookshelf/booking) — 읽기 전용 GET, 앱 프록시 경유.
      appdata: {
        command: TSX_BIN,
        args: [join(PROJECT_SELF_DIR, "src", "mcp", "appdata-server.ts")],
        env: {
          MCP_APPDATA_BASE_URL: `http://127.0.0.1:${port}`,
          MCP_APPDATA_APPS: listManifests().map((m) => m.id).join(","),
        },
      },
    },
  }));

  const { sessionId } = getGenieSessionInfo();
  const baseDirective = `${SUBMIT_RESPONSE_DIRECTIVE}\n\n작업 도중 사용자에게 진행 상황을 알리려면 post_message MCP 툴로 중간 메시지를 보내세요 — post_message는 턴을 끝내지 않습니다. 최종 답변과 턴 종료는 반드시 submit_response를 쓰세요.`;
  let appendSystemPrompt = baseDirective;
  // --strict-mcp-config: 프로젝트/유저 .mcp.json(예: playwright)이 머지돼 새어들면
  // 허용목록에 없는 MCP 도구 호출 시 TUI 권한창이 떠 PTY가 갇힌다. safefs만 로드되게 강제.
  const cliArgs = ["--no-chrome", "--strict-mcp-config", "--mcp-config", mcpConfigPath];
  if (genieConfig.model) {
    cliArgs.push("--model", genieConfig.model);
    console.log(`[Terminal] model: ${genieConfig.model}`);
  }
  // 도구 권한 — 내장 Read/Write/Edit/Bash 차단, SafeFS MCP 강제.
  // interactive: bypass 경고 프롬프트를 피하려 default 모드 사용
  // 할당된 MCP 서버: approval 모드 → PreToolUse 훅(승인카드) / allow 모드 → allowedTools
  const hookCmd = `node ${join(PROJECT_SELF_DIR, "scripts", "mcp-approval-hook.mjs")}`;
  const agentEventCmd = `node ${join(PROJECT_SELF_DIR, "scripts", "agent-event-hook.mjs")}`;
  const stopHookCmd = `node ${join(PROJECT_SELF_DIR, "scripts", "stop-response-hook.mjs")}`;
  const preToolUse: Array<Record<string, unknown>> = approvalNames.map((n) => ({
    matcher: `mcp__${n}__.*`,
    hooks: [{ type: "command", command: hookCmd, timeout: 70 }],
  }));
  // 알바(Agent) 스폰 감지 → UI "알바 작업 중" 표시 (fire-and-forget)
  preToolUse.push({ matcher: "Agent", hooks: [{ type: "command", command: agentEventCmd, timeout: 5 }] });
  const hooks = {
    PreToolUse: preToolUse,
    SubagentStop: [{ matcher: "*", hooks: [{ type: "command", command: agentEventCmd, timeout: 5 }] }],
    // Stop 훅 안전망 — 턴 종료 시 submit_response가 awaiter를 못 풀었으면(누락/미해소)
    // last_assistant_message를 독립 채널로 전달해 busy 갇힘 방지 + 답 회수. (Stop은 matcher 미지원)
    Stop: [{ hooks: [{ type: "command", command: stopHookCmd, timeout: 10 }] }],
  };
  // appdata는 읽기 전용 GET만이라 승인 없이 허용 (playwright allow 모드와 동일 근거).
  const extraAllowedTools = [...allowNames.map((n) => `mcp__${n}`), "mcp__appdata"];
  cliArgs.push(...buildPermissionArgs(genieConfig, { interactive: true, hooks, extraAllowedTools }));
  if (sessionId && claudeSessionExists(sessionId, process.cwd())) {
    cliArgs.push("--resume", sessionId);
    console.log(`[Terminal] 세션 이어받기: ${sessionId}`);
  } else {
    if (sessionId) {
      console.warn(`[Terminal] 세션 ${sessionId} 대화 파일 없음 — 새 세션으로 시작 (크래시 루프 방지)`);
    }
    // 새 세션: UUID 발급 + 세션 컨텍스트 주입
    const newId = randomUUID();
    cliArgs.push("--session-id", newId);
    try {
      const context = await buildSessionContext();
      if (context) appendSystemPrompt = `${context}\n\n${baseDirective}`;
    } catch (e) {
      console.error("[Terminal] buildSessionContext 실패:", e instanceof Error ? e.message : e);
    }
    setGenieSessionId(newId, { resetTokens: true });
    console.log(`[Terminal] 새 세션 생성: ${newId}`);
  }
  cliArgs.push("--append-system-prompt", appendSystemPrompt);

  return {
    cliArgs,
    cwd: process.cwd(),
    env: safeChildEnv({
      PATH: `${process.env.PATH ?? ""}:${CLAUDE_BIN_DIR}`,
      // PreToolUse 훅(mcp-approval-hook.mjs)이 승인 라우팅에 사용 (approval 모드 MCP 서버용)
      MYCREW_APPROVAL_BASE: `http://127.0.0.1:${port}`,
      MYCREW_AGENT_ROLE: "orchestrator",
      MYCREW_JOB_ID: "terminal",
      // Stop 훅(stop-response-hook.mjs)이 턴 종료 시 답을 전달할 대상
      MYCREW_STOP_SUBMIT_URL: `http://127.0.0.1:${port}/api/terminal/stop-finalize`,
    }),
    cleanup: () => { try { unlinkSync(mcpConfigPath); } catch { /* */ } },
  };
}

// 마이크루 PTY 비정상 종료 시 자동 재spawn(자가 치유) 상태.
// 재시작 직후 첫 인터랙티브 --resume가 code=1로 즉시 죽는 일이 잦다 — 강제 종료된
// 직전 마이크루 claude가 남긴 세션 락이 잠깐 남아 있다가 풀리는 것으로 보인다(첫 시도 실패,
// 잠시 뒤 재시도는 성공). 워치독은 "ready인데 unhealthy" 좀비만 처리하므로 proc=null
// (크래시) 상태는 다음 WS 연결까지 방치된다 — 이 갭을 자동 재시도로 메운다.
const GENIE_MAX_RESPAWN = 5;                  // 연속 비정상 종료 자동 재시도 상한
const GENIE_RESPAWN_BACKOFF_MS = 2500;        // 세션 락이 풀리도록 잠시 대기 후 재spawn
const GENIE_STABLE_RESET_MS = 30_000;         // 재spawn 후 이만큼 생존하면 안정 → 카운터 리셋
let genieRespawnAttempts = 0;
let genieRespawnTimer: ReturnType<typeof setTimeout> | null = null;

const geniePty = new AgentPty({
  agentId: "genie",
  claudePath: CLAUDE_PATH,
  cols: 120,
  rows: 30,
  idleTimeoutMs: 0,                            // 무기한 유지 (WS 끊겨도 PTY 보존)
  responseTimeoutMs: CHAT_RESPONSE_TIMEOUT_MS,
  buildSpawn: buildGenieSpawn,
  onData: (data) => {
    for (const ws of viewers) {
      if (ws.readyState === ws.OPEN) ws.send(data);
    }
    scanAgentLifecycle(data);
  },
  onExit: (exitCode) => {
    // 예기치 않은 종료 → 뷰어 닫아 클라이언트 재연결 유도 (재연결 시 재spawn).
    // 명시적 terminate(리셋)는 AgentPty가 onExit를 건너뛰므로 여기 안 옴.
    for (const ws of viewers) { try { ws.close(); } catch { /* */ } }
    if (exitCode !== 0) scheduleGenieRespawn(exitCode);
  },
});

// 비정상 종료 자가 치유 — 상한+백오프로 무한 루프 차단.
// 핵심: ensureReady는 빈 버퍼 타임아웃으로도 resolve돼 '성공' 보고가 신뢰 불가하므로,
// resolve 후 실제 생존(ready && isHealthy)을 확인하고 죽었으면 false-success로 보고 재시도.
function scheduleGenieRespawn(exitCode: number): void {
  if (geniePty.ready) { genieRespawnAttempts = 0; return; }   // 이미 살아있으면 불필요
  if (genieRespawnAttempts >= GENIE_MAX_RESPAWN) {
    console.error(`[Terminal] 마이크루 PTY ${genieRespawnAttempts}회 재spawn 실패 — 자동 재시도 중단(다음 WS 연결 대기)`);
    return;
  }
  genieRespawnAttempts++;
  if (genieRespawnTimer) clearTimeout(genieRespawnTimer);
  genieRespawnTimer = setTimeout(() => {
    genieRespawnTimer = null;
    console.log(`[Terminal] 마이크루 PTY 자동 재spawn 시도 #${genieRespawnAttempts} (code=${exitCode})`);
    geniePty.ensureReady()
      .then(() => {
        if (geniePty.ready && geniePty.isHealthy()) {
          console.log("[Terminal] 마이크루 PTY 자동 재spawn 성공");
          // 일정 시간 생존 확인 후에만 카운터 리셋 — 성공 직후 재크래시 루프 차단.
          setTimeout(() => { if (geniePty.ready && geniePty.isHealthy()) genieRespawnAttempts = 0; }, GENIE_STABLE_RESET_MS);
        } else {
          console.warn("[Terminal] 마이크루 PTY 재spawn 직후 미생존(false-success) — 재시도");
          scheduleGenieRespawn(exitCode);
        }
      })
      .catch((e) => {
        console.error("[Terminal] 마이크루 PTY 자동 재spawn 실패:", e instanceof Error ? e.message : e);
        scheduleGenieRespawn(exitCode);
      });
  }, GENIE_RESPAWN_BACKOFF_MS);
}

// ── Agent(서브에이전트) 도구 호출 감지 — 채팅에 자동 알림 ─────────────────────
// claude TUI 출력 스트림에서 "Agent" 도구 lifecycle을 감지해 채팅으로 알린다.
// 마스터가 챗 모드에서도 서브에이전트 작업이 도는 줄 알 수 있게.
// 출력은 ANSI 포함 raw — 누적 버퍼에서 줄단위로 패턴 매칭. 중복 발화는 set으로 차단.
const AGENT_SCAN_BUF_MAX = 8192;
let agentScanBuf = "";
// 시작 패턴 — claude TUI가 sub-agent를 띄울 때 보이는 라인.
//   "Backgrounded agent"  (run_in_background)
//   "Spawning agent"      (foreground)
// 완료 패턴 — 'Agent "<설명>" completed · <초>s'
const AGENT_START_RE = /(?:Backgrounded|Spawning|Launching) agent/g;
const AGENT_DONE_RE = /Agent\s+"([^"]+)"\s+completed(?:\s+·\s+(\d+)s)?/g;
// 중복 발화 차단 — 같은 라인이 여러 번 찍힐 수 있음 (TUI redraw)
const announcedDone = new Set<string>();
let lastStartAnnouncedAt = 0;

function stripAnsi(s: string): string {
  // ANSI escape 시퀀스 + control chars 대충 제거 (정밀할 필요 없음, 매칭만 통과시키면 됨)
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\r/g, "");
}

function scanAgentLifecycle(data: string): void {
  agentScanBuf += stripAnsi(data);
  if (agentScanBuf.length > AGENT_SCAN_BUF_MAX) {
    agentScanBuf = agentScanBuf.slice(-AGENT_SCAN_BUF_MAX);
  }
  // 시작: 1초 내 중복 차단 (같은 라인이 redraw로 여러 번 흘러도 1회만)
  if (AGENT_START_RE.test(agentScanBuf)) {
    AGENT_START_RE.lastIndex = 0;
    const now = Date.now();
    if (now - lastStartAnnouncedAt > 1000) {
      lastStartAnnouncedAt = now;
      addGenieMessage("🔧 서브에이전트 작업 시작", { internal: true });
    }
    // 버퍼에서 시작 표시 토큰 제거 — 다음 스캔이 같은 시작 라인을 재매칭하지 않도록
    agentScanBuf = agentScanBuf.replace(/(?:Backgrounded|Spawning|Launching) agent/g, "");
  }
  // 완료: 도구 설명 + 소요시간 추출, 같은 (설명+시간) 조합은 1회만
  for (const m of agentScanBuf.matchAll(AGENT_DONE_RE)) {
    const desc = m[1];
    const sec = m[2];
    const key = `${desc}|${sec ?? ""}`;
    if (announcedDone.has(key)) continue;
    announcedDone.add(key);
    // 메모리 절약 — 200개 넘으면 오래된 절반 제거
    if (announcedDone.size > 200) {
      const arr = [...announcedDone];
      announcedDone.clear();
      arr.slice(-100).forEach((k) => announcedDone.add(k));
    }
    const tail = sec ? ` · ${sec}s` : "";
    addGenieMessage(`✅ 서브에이전트 완료: "${desc.slice(0, 80)}"${tail}`, { internal: true });
  }
}

// ── 대화 저장 ─────────────────────────────────────────────────────────────────
const CONV_DIR = join(HISTORY_DIR, "conversations");
function saveMessage(role: "user" | "genie", content: string): void {
  if (!existsSync(CONV_DIR)) mkdirSync(CONV_DIR, { recursive: true });
  const convPath = join(CONV_DIR, `${getTodayKST()}.md`);
  const time = new Date().toLocaleTimeString("ko-KR");
  const sender = role === "user" ? "사용자" : getGenieName();
  appendFileSync(convPath, `\n### [${time}] ${sender}\n\n${content}\n`);
  archiveChatMessage(role, content, { source: "terminal" });
  const id = Math.random().toString(36).slice(2, 10);
  emitGlobalEvent("chat", { id, role, content, timestamp: new Date().toISOString() });
}

export function receiveTerminalResponse(content: string, options?: string[]): void {
  inputBuffer = "";
  inputEscaping = false;
  inputCsi = false;
  const trimmed = content.trim();
  console.log(`[Terminal] submit_response 수신: "${trimmed.slice(0, 60)}"`);
  // 빈 응답 / 괄호-only 상태 메시지 → 턴만 끝내고(awaiter 해소) 채팅엔 표시 안 함
  // (awaiter를 해소하지 않으면 busy 갇힘 — 반드시 receiveResponse 호출)
  if (trimmed === "" || /^\([^)]+\)$/.test(trimmed)) {
    geniePty.receiveResponse("");
    return;
  }
  // 질문 선택지가 있으면 마커로 부착 — ChatBubble이 파싱해 질문 카드로 렌더
  const withMarker = options && options.length > 0
    ? `${content}\n\n<!--GENIE_Q:${JSON.stringify(options)}-->`
    : content;
  // chat 턴 대기 중이면 awaiter로 라우팅 (chat.ts가 후처리). 아니면 일반 응답 → 저장.
  if (!geniePty.receiveResponse(withMarker)) {
    // 단일 \n → \n\n 강제 변환 폐기 — claude가 단락은 이미 \n\n으로 보냄.
    // 그 변환이 마크다운 테이블·리스트·코드블록의 인접 행 사이에 빈 줄을 끼워
    // 파싱을 깨뜨리던 문제 해소.
    saveMessage("genie", withMarker);
  }
}

// Stop 훅 전용 — 턴 종료 시 awaiter가 아직 펜딩이면(submit_response 누락/미해소)
// last_assistant_message로 해소(답 회수). receiveTerminalResponse와 달리 awaiter가 없으면
// 그냥 no-op (saveMessage 안 함 → 정상 턴에서의 중복 저장 방지).
export function finalizeTerminalTurn(content: string): void {
  if (!geniePty.busy) return;
  console.log(`[Terminal] Stop 훅 finalize — awaiter 펜딩 → last_assistant_message로 해소 (${content.length}b)`);
  geniePty.receiveResponse(content);
}

// ── 챗 모드용 PTY 브릿지 ──────────────────────────────────────────────────────
export function isPtyReady(): boolean { return geniePty.ready; }

export async function ensurePtyReady(): Promise<void> {
  await geniePty.ensureReady();
}

export async function submitFromChat(text: string): Promise<string> {
  return geniePty.submitPrompt(text);
}

// 세션 리셋 — 현재 PTY 종료, 다음 입력 시 재spawn
// 세션 리셋: PTY 종료 후 즉시 재spawn하고 입력창 준비까지 대기.
// (onExit 핸들러의 proc !== this.proc 가드가 늦은 exit의 새 proc 덮어쓰기를 막음)
// → 호출부가 await하면 "리셋 완료" 메시지를 실제 준비 후에 emit할 수 있다.
// force terminate(SIGHUP→SIGTERM→SIGKILL)로 좀비 잔존 방지.
export async function ptyRespawnForReset(): Promise<void> {
  if (geniePty.ready) {
    console.log("[Terminal] 세션 리셋 — PTY force terminate 후 재spawn");
  }
  geniePty.terminate({ force: true });
  await geniePty.ensureReady();
}

/** 마이크루 PTY 헬스 — 워치독 sweepZombiePtys가 호출. */
export function isGeniePtyHealthy(): boolean {
  return geniePty.isHealthy();
}

export function abortCurrent(): { ok: boolean; reason?: string } {
  return geniePty.abort();
}

// ── WebSocket 서버 ────────────────────────────────────────────────────────────
export function attachTerminalWS(): void {
  wss = new WebSocketServer({ noServer: true });

  heartbeatInterval = setInterval(() => {
    if (!wss) return;
    wss.clients.forEach((client) => {
      const c = client as WsWithAlive;
      if (c.isAlive === false) {
        try { c.terminate(); } catch { /* */ }
        return;
      }
      c.isAlive = false;
      try { c.ping(); } catch { /* */ }
    });
  }, HEARTBEAT_MS);

  wss.on("connection", async (ws) => {
    viewers.add(ws);

    const wsAlive = ws as WsWithAlive;
    wsAlive.isAlive = true;
    ws.on("pong", () => { wsAlive.isAlive = true; });

    if (geniePty.ready) {
      console.log("[Terminal] 기존 PTY 재연결 — 버퍼 replay");
      if (geniePty.replayBuffer) ws.send(geniePty.replayBuffer);
    } else {
      console.log("[Terminal] WebSocket 연결 — 새 PTY spawn");
      try { await ensurePtyReady(); } catch (e) {
        console.error("[Terminal] PTY spawn 실패:", e instanceof Error ? e.message : e);
      }
      if (geniePty.ready && geniePty.replayBuffer) ws.send(geniePty.replayBuffer);
    }

    ws.on("message", (raw) => {
      if (!geniePty.ready) return;
      const msg = typeof raw === "string" ? raw : raw.toString("utf-8");
      try {
        const parsed = JSON.parse(msg);
        if (parsed.type === "resize" && parsed.cols && parsed.rows) {
          geniePty.resize(parsed.cols, parsed.rows);
          return;
        }
        if (parsed.type === "ping") return;
      } catch { /* */ }
      for (const ch of msg) {
        if (inputEscaping) {
          if (ch === "\r" || ch === "\n") {
            inputBuffer += "\n";
            inputEscaping = false;
            inputCsi = false;
            continue;
          }
          if (!inputCsi && ch === "[") { inputCsi = true; continue; }
          if (inputCsi && ch >= "@" && ch <= "~") { inputEscaping = false; inputCsi = false; }
          else if (!inputCsi) { inputEscaping = false; }
          continue;
        }
        if (ch === "\x1b") { inputEscaping = true; inputCsi = false; continue; }
        if (ch === "\r") {
          const line = inputBuffer.trim();
          if (line) saveMessage("user", line.replace(/\n/g, "\n\n"));
          inputBuffer = "";
          inputEscaping = false;
          inputCsi = false;
        } else if (ch === "\n") {
          if (inputBuffer && !inputBuffer.endsWith("\n")) inputBuffer += "\n";
        } else if (ch === "\x7f" || ch === "\b") {
          inputBuffer = inputBuffer.slice(0, -1);
        } else if (ch >= " ") {
          inputBuffer += ch;
        }
      }
      geniePty.write(msg);
    });

    ws.on("close", () => {
      viewers.delete(ws);
      console.log(`[Terminal] WebSocket 닫힘 (남은 ${viewers.size}개) — PTY 유지`);
    });
  });

  console.log("[Terminal] WebSocket 서버 준비 (/ws/terminal)");
}

export function handleTerminalUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): void {
  // 마스터 strict 비교 금지 — 클라이언트는 /api/approval-token의 대시보드 토큰을 쓰므로
  // verifyApprovalToken(대시보드+마스터 인정, timing-safe)으로 검증해야 한다.
  if (process.env.APPROVAL_RESOLVE_TOKEN) {
    const url = new URL(req.url || "", "http://localhost");
    const token = url.searchParams.get("token") || "";
    if (!verifyApprovalToken({ "x-approval-token": token })) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
  }
  wss!.handleUpgrade(req, socket, head, (ws) => {
    wss!.emit("connection", ws, req);
  });
}

export function closeTerminalWS(): void {
  if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
  geniePty.terminate({ force: true });
  if (wss) { wss.close(); wss = null; }
}
