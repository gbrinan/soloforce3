// 글로벌 안전망 — 어떤 경우에도 서버 다운 방지
process.on("uncaughtException", (err) => {
  // EADDRINUSE: 이미 건강한 인스턴스가 포트를 점유 → 이 프로세스는 잉여(에러 아님).
  // ★ exit(0)으로 정상 종료 (2026-06-26): exit(1)이면 launchd KeepAlive(SuccessfulExit:false 설정 시)가
  //   즉시 재spawn → 또 EADDRINUSE → 무한 재spawn 폭주(runs 수천회, cascade fail·SIGKILL로 워커작업 파괴)의
  //   근본원인이었음. 잉여 인스턴스가 죽는 건 "성공적 양보"이므로 0으로 종료해 재spawn 트리거를 끊음.
  if ((err as NodeJS.ErrnoException)?.code === "EADDRINUSE") {
    console.error("[INFO] EADDRINUSE — 건강한 인스턴스가 이미 :포트 점유 중, 잉여 인스턴스 정상 양보(exit 0):", err.message);
    process.exit(0);
  }
  console.error("[FATAL] uncaughtException — 서버 유지:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] unhandledRejection — 서버 유지:", reason);
});

import { serve } from "@hono/node-server";
import "./store-install-executor.js"; // v1.13 Phase4: 승인 확정 → 설치 반영 훅 등록 (side-effect import)
import { startAppRegistry, stopAppRegistry, preWarmApps } from "./app-registry.js";
import { handleAppBusUpgrade, closeAppBus, startAppBusClient } from "./app-bus.js";
import { startScheduler, stopScheduler } from "./scheduler.js";
import { startUpdateCheck } from "./update-check.js";
import { runHistoryMaintenance } from "./history-maintenance.js";
import { startTunnelManager, stopTunnelManager } from "./tunnel.js";
import { loadLoops } from "./loops/loader.js";
import { reconcileAllOrphanRuns } from "./loops/ledger.js";
import { startTelegramBridge, stopTelegramBridge } from "./telegram.js";
import { startDiscordBridge, stopDiscordBridge } from "./discord.js";
import { addGenieMessage, bindApprovalNotifier, registerQueueSizeGetter } from "./chat.js";
import { loadTodos, startTodoReconcile } from "./todos.js";
import { loadSchedules } from "./schedules.js";
import { startSchedulesNotifier, stopSchedulesNotifier } from "./schedules-notifier.js";
import { startAnandaraSync, stopAnandaraSync } from "./anandara-sync.js";
import { startAnandaraProjectSync, stopAnandaraProjectSync } from "./anandara-projects.js";
import { loadNotifications } from "./notifications.js";
import { loadHumanChat } from "./human-chat.js";
import { loadWorkflowApprovals } from "./workflow-approvals.js";
import {
  loadScheduleRequests,
  startScheduleRequestCron,
  setScheduleRequestExpireNotifier,
  setPartnerNameResolver,
} from "./schedule-requests.js";
import { loadJobs } from "./jobs.js";
import { loadApprovals } from "./approvals.js";
import { restoreQueueFromDisk, getQueueStats } from "./genie-queue.js";
import { ensureAllAgentDirs, consumeUnknownJobTypes } from "../agent-registry.js";
import { loadPartners } from "./partners.js";
import { loadMessages as loadExternalMessages } from "./external-messages.js";
import { startPartnerRequestSweep, stopPartnerRequestSweep } from "./external-partner-request.js";
import { ensureMeetingDirs } from "./meetings.js";
import { loadTasks } from "./tasks.js";
import { ensureSkillsSeeded } from "./skills.js";
import { attachTerminalWS, closeTerminalWS, handleTerminalUpgrade, ensurePtyReady } from "./terminal-ws.js";
import { attachWorkerTerminalWS, handleWorkerTerminalUpgrade } from "./worker-pty.js";
import { sweepZombiePtys } from "./watchdog.js";
import { isWsRequestAuthorized, loadAuthSessions } from "./auth-google.js";
import { ensureClaudeInteractiveReady } from "../claude-bootstrap.js";
import { createServerApp } from "./create-server-app.js";
import {
  ensureExternalDir,
  ensureGenieConfigExternalWritePath,
  ensureStorePreseeded,
  handleSelfRestart,
  rotateLog,
} from "./server-bootstrap-support.js";

export function startServer(port = 3456): void {
  const isDryRun = process.env.DRY_RUN === "1";
  bindApprovalNotifier();
  registerQueueSizeGetter(() => getQueueStats().size);
  const app = createServerApp();

  // 바인딩 호스트: 기본 loopback(로컬 전용). Tailscale/LAN 접속 시 HOST를 tailscale IP(권장) 또는 0.0.0.0으로.
  const BIND_HOST = process.env.HOST || "127.0.0.1";
  const server = serve({ fetch: app.fetch, port, hostname: BIND_HOST }, () => {
    if (BIND_HOST !== "127.0.0.1") console.log(`[Boot] 외부 바인딩 활성 — hostname=${BIND_HOST}:${port} (Tailscale/LAN 접속 가능)`);
    // bind-success 가시성 (감사 2026-06-26 P2): 이 콜백은 포트 bind 성공 시에만 발화.
    // EADDRINUSE로 exit(0) 양보한 잉여 인스턴스는 이 로그가 없으므로, "정상 양보"와 "은폐된 bind 실패"를
    // 로그로 구분 가능 — 향후 이중bind 버그가 exit0으로 조용히 묻히는 것을 방지.
    console.log(`[Server] LISTEN 성공 — http://127.0.0.1:${port} (이 인스턴스가 포트 보유)`);
    attachTerminalWS();
    attachWorkerTerminalWS();
    // 부팅 시 전날 좀비 PTY 정리 (워커 + 마이크루). 비동기·실패 무시 — 부팅 안정성 보장.
    sweepZombiePtys().catch((e) => console.error("[Boot] sweepZombiePtys 실패:", e));
    (server as import("node:http").Server).on("upgrade", (req, socket, head) => {
      const pathname = new URL(req.url || "", "http://localhost").pathname;
      // SSO: 외부 WS는 세션 쿠키 검증 (내부 loopback self-fetch는 면제). 미설정 시 통과.
      if (!isWsRequestAuthorized(req)) {
        socket.destroy();
        return;
      }
      if (pathname === "/ws/terminal") {
        handleTerminalUpgrade(req, socket as import("node:net").Socket, head);
      } else if (pathname.startsWith("/ws/worker/")) {
        handleWorkerTerminalUpgrade(req, socket as import("node:net").Socket, head);
      } else if (pathname === "/ws/app-bus") {
        handleAppBusUpgrade(req, socket as import("node:net").Socket, head);
      } else {
        socket.destroy();
      }
    });
    console.log(`\n🤖 MyCrew Agent Team${isDryRun ? " [DRY_RUN — 검증 모드]" : ""}`);
    console.log(`   http://localhost:${port}`);
    console.log(`   종료: Ctrl+C\n`);

    if (!isDryRun) {
      ensureExternalDir();
      ensureMeetingDirs();
      ensureGenieConfigExternalWritePath();
      runHistoryMaintenance(); // 무한 성장 파일 로테이션/컴팩션 (부팅 1회)
      loadJobs();
      loadTodos();
      loadTasks();
      // 도메인 노출 게이트 (P4, fail-closed) — 외부 URL이 설정됐는데 SSO가 꺼져 있으면 기동을 거부한다.
      // 과거 재발 계급 5(권한 바닥 fail-open)와 같은 클래스: "공개 노출 + 무인증"이 조용히 성립하는 조합을 막는다.
      // 로컬 개발(외부 URL 미설정)은 기존대로 로그인 없이 동작. 의도적 공개는 SOLOFORCE_ALLOW_PUBLIC_NOAUTH=1로만 가능.
      {
        const externalUrl = process.env.TUNNEL_URL || process.env.NGROK_URL || process.env.SOLOFORCE_DOMAIN || "";
        const ssoOn = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
        if (externalUrl && !ssoOn && process.env.SOLOFORCE_ALLOW_PUBLIC_NOAUTH !== "1") {
          console.error(`[domain-gate] 외부 도메인(${externalUrl})이 설정됐지만 Google SSO가 꺼져 있습니다.`);
          console.error("[domain-gate] GOOGLE_CLIENT_ID/SECRET을 설정하거나, 의도적 공개라면 SOLOFORCE_ALLOW_PUBLIC_NOAUTH=1을 명시하세요. 기동을 중단합니다.");
          process.exit(78); // EX_CONFIG
        }
      }
      loadAuthSessions();
      loadSchedules();
      loadScheduleRequests();
      loadApprovals();
      loadPartners();
      loadExternalMessages();
      restoreQueueFromDisk();
      startAppRegistry();
      // (a) 포털 부팅 시 서브앱 pre-warm: 헬스 핑 후 미응답+autostart=true 앱은 npm start 기동
      void preWarmApps();
      startAppBusClient();
      startTodoReconcile();
      startScheduler(60 * 1000);
      startUpdateCheck(); // 프로그램 새 버전 폴링 (6시간 주기, 새 버전 시 지니 알림 1회)
      loadNotifications();
      loadHumanChat();
      loadWorkflowApprovals();
      startSchedulesNotifier();
      startAnandaraSync(); // 아난다라 교육 → MyCrew 일정 단방향 동기화 (30분 주기)
      startAnandaraProjectSync(); // 아난다라 교육 → mycrew-works/education/<고객사> 프로젝트 폴더 (일 1회)
      void import("./mail-scan.js").then((m) => m.startMailScan()); // 메일 인박스 → 교육·업무 의뢰 다이제스트 (09:00/17:00 KST)
      startPartnerRequestSweep();
      startTunnelManager();
      // 루프 엔진 부팅 시 orphan(고아) 실행 복구 — 서버가 루프 실행 도중 재시작/크래시되면
      // runs.jsonl에 status:"running" 마커만 남고 종료 라인이 영영 추가되지 않는 문제를 해결.
      // v1 범위: 부팅 시 1회만 검사(재시작 없는 크래시는 다음 부팅까지 미검출) — 자동 재시도는 하지 않고 알림만.
      try {
        const { loops } = loadLoops();
        const reconciled = reconcileAllOrphanRuns(loops);
        if (reconciled.length > 0) {
          const lines = reconciled.map(
            ({ loopLabel, runs }) => `- "${loopLabel}": ${runs.length}건 (runId: ${runs.map((r) => r.runId.slice(0, 8)).join(", ")})`,
          );
          addGenieMessage(
            `⚠️ 서버 재시작 전 중단된 루프 실행이 있습니다 (자동 재시도는 하지 않았습니다 — 필요하면 수동으로 다시 실행해주세요):\n${lines.join("\n")}`,
          );
        }
      } catch (err) {
        console.error("[LoopEngine] 부팅 시 orphan 실행 복구 실패:", err);
      }
      // TELEGRAM_BOT_TOKEN 설정 시에만 활성화 (내부적으로 미설정 가드 포함)
      startTelegramBridge();
      // DISCORD_BOT_TOKEN 설정 시에만 활성화 (내부적으로 미설정 가드 포함)
      startDiscordBridge();
      // 일정 공유 요청 타임아웃 cron + 알림자 연결 (loadPartners 이후라 partner 조회 가능)
      void import("./partners.js").then(({ getPartner }) => {
        setPartnerNameResolver((pid) => {
          const p = getPartner(pid);
          return p ? `${p.companyName}${p.contactName ? ` ${p.contactName}` : ""}` : pid.slice(0, 8);
        });
      });
      setScheduleRequestExpireNotifier((msg) => {
        addGenieMessage(msg, { internal: false });
      });
      startScheduleRequestCron();
      // 부팅 1회: 직원 디렉토리/파일 자동 복구 + 미존재 jobType 안내
      try {
        ensureAllAgentDirs();
        ensureSkillsSeeded();
        ensureStorePreseeded();
        const unknown = consumeUnknownJobTypes();
        for (const jobType of unknown) {
          addGenieMessage(
            `⚠️ 신규 직군 '${jobType}' 템플릿(\`config/system-prompt-templates/${jobType}.md\`) 미존재. 일반 템플릿(general.md) 폴백 동작 중. 데이브에게 \`${jobType}.md\` 신규 템플릿 작성을 요청하면 다음 사이클에 자동 적용됩니다.`,
            { internal: true },
          );
        }
      } catch (err) {
        console.error("[Boot] ensureAllAgentDirs 실패:", err);
      }
      handleSelfRestart(port).catch((err) =>
        console.error("[Self] 재시작 처리 실패:", err),
      );
      // Claude bootstrap — 지니 PTY spawn 전 인터랙티브 관문 멱등 통과 (온보딩/trust/MCP 승인)
      ensureClaudeInteractiveReady();
      // 마이크루 PTY eager-spawn 제거(2026-07-13) — 부팅 pre-warm이 세션을 무기한 점유해
      // 채팅 --resume이 매번 "Session ID already in use"로 충돌하던 근본 원인. PTY는 이제
      // 터미널 뷰 진입(handleTerminalUpgrade) 시에만 spawn한다. 첫 채팅은 세션을 자유롭게 이어받음.
      void ensurePtyReady; // 참조 유지(다른 경로에서 on-demand 사용)
      rotateLog();
    }
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log("\n[Server] 종료 중...");
    closeTerminalWS();
    stopTunnelManager();
    stopScheduler();
    stopSchedulesNotifier();
    stopAnandaraSync();
    stopAnandaraProjectSync();
    stopPartnerRequestSweep();
    stopTelegramBridge();
    stopDiscordBridge();
    server.close(() => {
      console.log("[Server] 정상 종료");
      process.exit(0);
    });
    // 5초 후 강제 종료
    setTimeout(() => {
      console.log("[Server] 강제 종료");
      process.exit(1);
    }, 5000);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
