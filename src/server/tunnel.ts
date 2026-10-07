// SSH 터널 자동 관리 — .env에 TUNNEL_HOST가 있을 때만 활성화
// 서버 시작 시 터널 연결 + 주기적 health check + 끊기면 자동 재연결
//
// 잭키 감사 반영 (2026-04-27, history/outputs/qa/외주-EC2터널-자동재연결-감사-2026-04-27_qa.md):
// - C-1: exit/error 핸들러 자기 proc 체크로 race 차단 (다른 proc 핸들이 tunnelProc=null로 덮는 사고)
// - C-2: exponential backoff(1s→30s cap) + MAX_RETRIES=10 + 영구 실패 알림
// - C-3: StrictHostKeyChecking=accept-new (TOFU — 첫 연결 자동 수락 + 이후 변경 감지)
// - H-1: reconnecting flag로 exit setTimeout과 healthCheck 동시 fire 차단
// - H-2: exec → execFile (shell injection 표면 차단)
// - H-4: startTunnel 진입 가드 (running 체크)
// - M-1: 연속 3회 실패에서만 재연결 (false positive cooldown)
// - M-3: error 핸들러도 재연결 트리거 (exit이 항상 fire되지 않을 가능성 대비)
// - M-4: getTunnelStatus export (routes.ts → GET /api/tunnel/status)

import { spawn, execFile } from "node:child_process";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import type { ChildProcess } from "node:child_process";
import { addGenieMessage } from "./chat.js";

const TUNNEL_HOST = process.env.TUNNEL_HOST || "";
const TUNNEL_KEY = (process.env.TUNNEL_KEY || "").replace(/^~/, homedir());
const TUNNEL_REMOTE_PORT = parseInt(process.env.TUNNEL_REMOTE_PORT || "8080", 10);
const TUNNEL_URL = process.env.TUNNEL_URL || "";
const LOCAL_PORT = parseInt(process.env.PORT || "3456", 10);

const CHECK_INTERVAL = 30_000;        // 30초마다 health check
const BASE_DELAY = 1_000;             // 재연결 첫 대기 1초
const MAX_DELAY = 30_000;             // 재연결 대기 cap 30초
const MAX_RETRIES = 10;               // 영구 실패 임계
const FAILURE_THRESHOLD = 3;          // 연속 health check 실패 임계 (cooldown)

let tunnelProc: ChildProcess | null = null;
let checkTimer: ReturnType<typeof setInterval> | null = null;
let running = false;
let reconnecting = false;
let permanentlyFailed = false;
let retryCount = 0;
let consecutiveFailures = 0;
let lastSuccessAt: number | undefined;

export interface TunnelStatus {
  enabled: boolean;
  running: boolean;
  connected: boolean;
  retryCount: number;
  consecutiveFailures: number;
  permanentlyFailed: boolean;
  lastSuccessAt?: number;
}

function isEnabled(): boolean {
  return !!(TUNNEL_HOST && TUNNEL_KEY && existsSync(TUNNEL_KEY));
}

function killTunnel(): void {
  if (tunnelProc) {
    try { tunnelProc.kill(); } catch { /* */ }
    tunnelProc = null;
  }
}

// EC2에서 좀비 SSH 프로세스 kill (포트 점유 해제)
function killRemoteZombie(): Promise<void> {
  return new Promise((resolve) => {
    execFile("ssh", [
      "-i", TUNNEL_KEY,
      "-o", "ConnectTimeout=5",
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", "BatchMode=yes",
      `ubuntu@${TUNNEL_HOST}`,
      `sudo lsof -i :${TUNNEL_REMOTE_PORT} -t 2>/dev/null | xargs kill 2>/dev/null; echo OK`,
    ], { timeout: 10_000 }, (err, stdout) => {
      if (stdout?.includes("OK")) console.log("[Tunnel] EC2 좀비 프로세스 정리 완료");
      else console.warn("[Tunnel] EC2 좀비 정리 실패:", err?.message ?? "unknown");
      resolve();
    });
  });
}

function scheduleReconnect(): void {
  if (!running || reconnecting || permanentlyFailed) return;
  if (retryCount >= MAX_RETRIES) {
    permanentlyFailed = true;
    if (checkTimer) { clearInterval(checkTimer); checkTimer = null; }
    console.error(`[Tunnel] 영구 실패 — ${MAX_RETRIES}회 재연결 모두 실패. 수동 점검 필요 (TUNNEL_HOST/TUNNEL_KEY/EC2 상태 확인).`);
    try {
      addGenieMessage(
        `⚠️ SSH 터널 연결이 ${MAX_RETRIES}회 실패해 중단됐습니다. 외부 접속이 필요하면 "터널 다시 연결해줘"라고 말씀해주세요.`,
      );
    } catch (err) {
      console.error("[Tunnel] 영구 실패 알림 전송 실패:", (err as Error)?.message ?? err);
    }
    return;
  }
  reconnecting = true;
  const delay = Math.min(BASE_DELAY * 2 ** retryCount, MAX_DELAY);
  retryCount++;
  console.log(`[Tunnel] ${retryCount}/${MAX_RETRIES} 재연결 ${delay / 1000}초 후...`);

  // 3회째부터 EC2 좀비 정리 시도 (포트 점유 해제)
  const doReconnect = async () => {
    if (retryCount >= 3) await killRemoteZombie();
    reconnecting = false;
    startTunnel();
  };
  setTimeout(doReconnect, delay);
}

function startTunnel(): void {
  if (!running) return;        // H-4: shutdown 직후 setTimeout fire로 좀비 spawn 차단
  killTunnel();
  console.log(`[Tunnel] SSH 터널 시작: localhost:${LOCAL_PORT} → ${TUNNEL_HOST}:${TUNNEL_REMOTE_PORT}`);
  const proc = spawn("ssh", [
    "-i", TUNNEL_KEY,
    "-N",
    "-R", `${TUNNEL_REMOTE_PORT}:localhost:${LOCAL_PORT}`,
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=3",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "StrictHostKeyChecking=accept-new",   // C-3: TOFU
    `ubuntu@${TUNNEL_HOST}`,
  ], { stdio: "ignore", detached: false });
  tunnelProc = proc;

  proc.on("exit", (code) => {
    if (proc !== tunnelProc) return;            // C-1: 다른 proc의 핸들러가 현재 proc 핸들을 덮지 않도록
    console.log(`[Tunnel] SSH 프로세스 종료 (code=${code})`);
    tunnelProc = null;
    if (running) scheduleReconnect();
  });

  proc.on("error", (err) => {
    if (proc !== tunnelProc) return;
    console.error(`[Tunnel] SSH 에러:`, err.message);
    tunnelProc = null;
    if (running) scheduleReconnect();           // M-3: error도 재연결 트리거 (exit 보장 X 대비)
  });
}

async function healthCheck(): Promise<boolean> {
  if (!TUNNEL_URL) return tunnelProc !== null;
  return new Promise((resolve) => {
    execFile("curl",                            // H-2: shell 우회 차단
      ["-sf", "-o", "/dev/null", "-w", "%{http_code}", `${TUNNEL_URL}/`],
      { timeout: 10_000 },
      (_err, stdout) => resolve(stdout?.trim() === "200"),
    );
  });
}

async function checkAndReconnect(): Promise<void> {
  const ok = await healthCheck();
  if (ok) {
    consecutiveFailures = 0;
    retryCount = 0;
    permanentlyFailed = false;
    lastSuccessAt = Date.now();
    return;
  }
  consecutiveFailures++;
  if (consecutiveFailures >= FAILURE_THRESHOLD) {  // M-1: 연속 N회 누적 시에만 재연결
    console.log(`[Tunnel] health check ${consecutiveFailures}회 연속 실패 — 재연결`);
    consecutiveFailures = 0;
    scheduleReconnect();
  } else {
    console.log(`[Tunnel] health check 실패 ${consecutiveFailures}/${FAILURE_THRESHOLD}`);
  }
}

export function startTunnelManager(): void {
  if (!isEnabled()) {
    console.log("[Tunnel] 비활성 (TUNNEL_HOST/TUNNEL_KEY 미설정)");
    return;
  }
  running = true;
  console.log(`[Tunnel] 활성화: ${TUNNEL_URL || TUNNEL_HOST}`);
  startTunnel();
  checkTimer = setInterval(checkAndReconnect, CHECK_INTERVAL);
}

export function stopTunnelManager(): void {
  running = false;
  if (checkTimer) { clearInterval(checkTimer); checkTimer = null; }
  killTunnel();
  console.log("[Tunnel] 중지");
}

export function getTunnelStatus(): TunnelStatus {
  return {
    enabled: isEnabled(),
    running,
    connected: tunnelProc !== null,
    retryCount,
    consecutiveFailures,
    permanentlyFailed,
    lastSuccessAt,
  };
}

// 영구 실패 후 사용자 명령으로 호출. 상태 리셋 + 재연결 시작.
// 영구 실패 분기에서 checkTimer가 clear되므로 healthCheck 타이머도 재가동.
export function resetTunnel(): TunnelStatus {
  if (!isEnabled()) {
    console.warn("[Tunnel] reset 호출됐지만 비활성 상태 (TUNNEL_HOST/TUNNEL_KEY 미설정)");
    return getTunnelStatus();
  }
  permanentlyFailed = false;
  retryCount = 0;
  consecutiveFailures = 0;
  reconnecting = false;
  if (!running) {
    startTunnelManager();
  } else {
    if (!checkTimer) checkTimer = setInterval(checkAndReconnect, CHECK_INTERVAL);
    startTunnel();
  }
  console.log("[Tunnel] 수동 reset — 재연결 시작");
  return getTunnelStatus();
}
