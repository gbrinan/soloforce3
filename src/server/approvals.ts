// 승인 요청 관리 — MCP 서버(safefs)가 readPaths 밖 접근 시 생성
// Step 10: 대화창 경유 + 60s 마이크루 자동 판단 + 기존 대시보드 백업 UI 유지
//
// 캐시 정책:
// - allowed 이력만 자동 패스(`auto_rule_repeat`) 매칭에 사용. denied/timeout는 매칭에서 제외.
// - 매칭 키: agentRole + tool + path (도구명 무관 매칭은 권한 상승이라 차단).
// - 윈도우: resolvedAt 기준 REPEAT_WINDOW_MS (1시간). resolvedAt 없으면 createdAt 폴백.
// - revokedAt 설정된 이력은 즉시 매칭 제외.

import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { atomicWriteFileSync, quarantineCorruptFile } from "./utils/atomic-write.js";
import { join } from "node:path";
import { HISTORY_DIR } from "../config.js";
import { emitGlobalEvent } from "./jobs.js";
import { getMyProfile } from "./partners.js";

// 사장님 부재중 모드 — 부재중이면 orchestrator 가드 해제 (마이크루가 전권 판단)
// 서버 재시작 시 조용히 재석으로 리셋되면 부재중인 사장님 몰래 승인이 쌓이므로
// genie-perm-level과 동일하게 파일로 영속화한다.
//
// 재석/부재는 선언이 아니라 관찰 가능한 사실 — 활동(대시보드 조작·채팅·승인 응답)이
// 없으면 자동 부재중, 활동이 감지되면 자동 재석 복귀한다.
// 수동(/away·버튼) 부재중은 잠금이라 활동해도 유지("회의 중" 케이스), /back·버튼으로만 해제.
// 파일 값: "present" | "away"(자동) | "away-manual"(수동 잠금)
const OWNER_AWAY_FILE = join(HISTORY_DIR, "owner-away");
let ownerAwayManual = false; // 수동 부재중 잠금 — 활동 감지로 자동 복귀하지 않음
let ownerAway = (() => {
  try {
    const v = readFileSync(OWNER_AWAY_FILE, "utf-8").trim();
    if (v === "away-manual") { ownerAwayManual = true; return true; }
    return v === "away";
  } catch {
    return false; // 미설정 → 기본 재석
  }
})();
export function setOwnerAway(away: boolean, opts?: { manual?: boolean }): void {
  // 대시보드 버튼·텔레그램 명령 등 기존 호출부는 opts 없이 호출 → 의도적 조작이므로 수동 취급
  const manual = opts?.manual ?? true;
  const wasPreviouslyAway = ownerAway;
  ownerAway = away;
  ownerAwayManual = away && manual;
  try {
    if (!existsSync(HISTORY_DIR)) mkdirSync(HISTORY_DIR, { recursive: true });
    writeFileSync(OWNER_AWAY_FILE, away ? (ownerAwayManual ? "away-manual" : "away") : "present", "utf-8");
  } catch (e) {
    console.error("[Approval] 부재중 상태 저장 실패:", e);
  }
  const ownerName = getMyProfile()?.contactName ?? '사용자';
  console.log(`[Approval] ${ownerName} ${away ? "부재중" : "재석"} 모드${away ? (ownerAwayManual ? " (수동 잠금)" : " (자동)") : ""}`);
  emitGlobalEvent("owner-away", { away });
  // 부재중 → 자동 모드 ON (재석 복귀 시에는 자동 모드 유지)
  if (away) {
    import("./chat.js").then((chat) => {
      if (!chat.isAutoContinuationMode()) {
        chat.setAutoContinuationMode(true);
        console.log("[Approval] 부재중 → 자동 모드 ON");
      }
    }).catch(() => {});
  }
  // 부재중 → 재석 전환 시 마이크루에게 알림 (부재중 동안 쌓인 외부 메시지 확인)
  if (wasPreviouslyAway && !away) {
    import("./chat.js").then((chat) => {
      const returnName = getMyProfile()?.contactName ?? '사용자';
      chat.sendMessage(
        `[시스템 알림] ${returnName}이(가) 재석으로 전환했습니다. 부재중 동안 처리한 외부 메시지나 미처리 건이 있으면 [REPORT]로 보고하세요.`,
        undefined, undefined,
        { internal: true, source: "owner-away:returned" },
      ).catch(() => {});
    }).catch(() => {});
  }
}
export function isOwnerAway(): boolean { return ownerAway; }

// ── 활동 기반 자동 재석/부재 전환 ─────────────────────────────
// 활동 신호: 대시보드 하트비트(POST /api/owner-activity)·채팅 전송·승인 응답.
// 텔레그램 활동은 재석으로 보지 않는다 — 폰으로 지시하는 상황이 전형적 부재중이고,
// 이때 재석 복귀되면 승인이 폰으로 쏟아져 오히려 불편하다.
const IDLE_AWAY_MINUTES = Number(process.env.OWNER_IDLE_AWAY_MINUTES ?? "15"); // 0=자동 전환 비활성
let lastOwnerActivity = Date.now(); // 부팅 시점 = 활동으로 간주 (부팅 직후 즉시 부재중 방지)

/** 사장님 활동 감지 — 유휴 타이머 리셋 + 자동 부재중이면 재석 복귀 (수동 잠금은 유지). */
export function noteOwnerActivity(): void {
  lastOwnerActivity = Date.now();
  if (ownerAway && !ownerAwayManual) {
    console.log("[Approval] 활동 감지 → 재석 자동 복귀");
    setOwnerAway(false, { manual: false });
  }
}

if (IDLE_AWAY_MINUTES > 0) {
  setInterval(() => {
    if (ownerAway) return;
    if (Date.now() - lastOwnerActivity < IDLE_AWAY_MINUTES * 60_000) return;
    console.log(`[Approval] ${IDLE_AWAY_MINUTES}분 무활동 → 부재중 자동 전환`);
    setOwnerAway(true, { manual: false });
    import("./telegram.js").then((t) => {
      void t.sendTelegramNotice(
        `🔴 ${IDLE_AWAY_MINUTES}분간 활동이 없어 부재중으로 자동 전환했습니다.\n` +
        `지니의 읽기·쓰기 승인은 자동 허용됩니다 (bash는 거부).\n` +
        `대시보드를 다시 조작하면 자동으로 재석 복귀합니다. 폰에서는 /back 을 보내주세요.`,
      );
    }).catch(() => {});
  }, 60_000);
}

// 재시작으로 부재중이 복원된 경우, setOwnerAway를 거치지 않으므로
// 부재중의 전제인 자동 모드 ON을 여기서 재적용한다.
if (ownerAway) {
  console.log(`[Approval] 재시작 → 부재중 상태 복원${ownerAwayManual ? " (수동 잠금)" : ""}`);
  import("./chat.js").then((chat) => {
    if (!chat.isAutoContinuationMode()) {
      chat.setAutoContinuationMode(true);
      console.log("[Approval] 부재중 복원 → 자동 모드 ON");
    }
  }).catch(() => {});
}

export interface ApprovalRequest {
  id: string;
  agentRole: string;
  tool: string;
  path: string;
  // 위임 작업 추적용 (P1.3, 2026-04-30) — 워커 spawn 시 MCP_JOB_ID로 전달.
  // 누락은 정상 (마이크루 self-call 등 jobId 없는 경로). job 종료 시 revokeRecentApprovals({jobId}) 자동 회수에 사용.
  jobId?: string;
  // 워커가 제시한 사유 ("왜 이 작업에 이게 필요한지") — 마이크루 자동판단 맥락에 사용.
  reason?: string;
  createdAt: number;
  resolvedAt?: number;
  status: "pending_chat" | "allowed" | "denied" | "timeout";
  autoDecideAttempts?: number;
  revokedAt?: number;
  // 마이크루 의견 (사장님 응답 전이면 보류, 55초 후 적용)
  genieOpinion?: { allow: boolean; reason?: string };
  decisionSource?:
    | "user"                   // 사장님 (대시보드/chat 버튼)
    | "genie"                  // 마이크루 의견이 55초 후 적용됨
    | "chat"                   // legacy
    | "dashboard"              // legacy
    | "auto_rule_system"
    | "auto_rule_dotfile"
    | "auto_rule_env"
    | "auto_rule_users"
    | "auto_rule_write"
    | "auto_rule_tmp"
    | "auto_rule_read"
    | "auto_rule_local_curl"
    | "auto_rule_free_notify"
    | "auto_rule_repeat"
    | "auto_rule_cert_key"
    | "auto_rule_retry_exhausted"
    | "auto_rule_job_failed";
}

const TTL_MS = 20 * 60 * 1000;         // 20분: 최종 안전망 (autoDecide 전 사장님 수동 long-wait)
const CLEANUP_INTERVAL = 10_000;        // 10초마다 만료 체크
// [F4 픽스] 자동판단 총 시한을 클라이언트 폴링 창(60s) 안으로: 45 + 5 + 5 = 55s.
// 기존 55+30+30=115s는 워커가 60s에 이미 '거부'로 실패한 뒤 서버가 뒤늦게 '허용'을
// 확정하는 헛실패(+재시도로 F2 중복행)를 양산했다.
const AUTO_DECIDE_DELAY_MS = 45_000;    // 사장님 대화창 응답 대기
const AUTO_DECIDE_RETRY_MS = 5_000;     // 판단 불가 시 재평가 간격 (총 55s < 클라 60s)
const AUTO_DECIDE_MAX_ATTEMPTS = 3;
const REPEAT_WINDOW_MS = 60 * 60 * 1000; // 1시간: auto_rule_repeat 캐시 윈도우
const RESOLVED_RETENTION_MS = REPEAT_WINDOW_MS; // resolved 메모리/디스크 retention (repeat 윈도우와 동일)
const APPROVALS_FILE = join(HISTORY_DIR, "approvals.json");

const approvals = new Map<string, ApprovalRequest>();

// resolved 이력 디스크 영속화 (pending_chat은 저장 X — 재시작 후 워커 재호출이 새 pending 자연 생성)
// 재시작 후 loadApprovals로 캐시 복원 → auto_rule_repeat 매칭으로 동일 요청 자동 통과
function saveApprovals(): void {
  try {
    if (!existsSync(HISTORY_DIR)) mkdirSync(HISTORY_DIR, { recursive: true });
    // 메모리에서 resolved된 항목
    const memResolved = Array.from(approvals.values()).filter((r) => r.status !== "pending_chat");
    const memIds = new Set(memResolved.map((r) => r.id));
    // 파일의 기존 항목 병합 (메모리에서 삭제된 오래된 것 보존)
    let fileExisting: ApprovalRequest[] = [];
    try {
      if (existsSync(APPROVALS_FILE)) {
        const arr = JSON.parse(readFileSync(APPROVALS_FILE, "utf-8"));
        if (Array.isArray(arr)) fileExisting = arr.filter((r: ApprovalRequest) => !memIds.has(r.id));
      }
    } catch { /* */ }
    atomicWriteFileSync(APPROVALS_FILE, JSON.stringify([...memResolved, ...fileExisting], null, 2));
  } catch (err) {
    console.error("[Approvals] 저장 실패:", err instanceof Error ? err.message : err);
  }
}

export function loadApprovals(): void {
  if (!existsSync(APPROVALS_FILE)) return;
  try {
    const arr = JSON.parse(readFileSync(APPROVALS_FILE, "utf-8")) as ApprovalRequest[];
    if (!Array.isArray(arr)) return;
    const now = Date.now();
    let loaded = 0, expired = 0;
    for (const r of arr) {
      if (now - (r.resolvedAt ?? r.createdAt) > RESOLVED_RETENTION_MS) {
        expired++;
        continue;
      }
      approvals.set(r.id, r);
      loaded++;
    }
    console.log(`[Approvals] 복원 ${loaded}건${expired > 0 ? ` (만료 ${expired}건 제외)` : ""}`);
  } catch (err) {
    console.error("[Approvals] 로드 실패:", err instanceof Error ? err.message : err);
    const q = quarantineCorruptFile(APPROVALS_FILE);
    if (q) console.error(`[Approvals] 손상 파일 격리: ${q}`);
  }
}

// Phase B에서 chat.ts가 바인딩 (circular import 회피 — 의존성 주입)
let notifier: ((req: ApprovalRequest) => void) | null = null;
export function setApprovalNotifier(fn: ((req: ApprovalRequest) => void) | null): void {
  notifier = fn;
}

// v1.13 Phase4: 승인 확정(allowed/denied/timeout) 후속 처리 훅 — store-install 등 도구별 리스너가 등록.
// notifier와 동일한 의존성 주입 패턴(circular import 회피). 여러 리스너 등록 가능.
type ResolutionHook = (req: ApprovalRequest) => void | Promise<void>;
const resolutionHooks: ResolutionHook[] = [];
export function onApprovalResolved(fn: ResolutionHook): void {
  resolutionHooks.push(fn);
}
function emitResolved(req: ApprovalRequest): void {
  emitGlobalEvent("approval-resolved", req);
  for (const hook of resolutionHooks) {
    try {
      const result = hook(req);
      if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch((err) =>
          console.error("[Approval] resolution hook 실패:", err instanceof Error ? err.message : err),
        );
      }
    } catch (err) {
      console.error("[Approval] resolution hook 실패:", err instanceof Error ? err.message : err);
    }
  }
}

// [F1 픽스] 승인 키 경로 정규화 — 같은 파일이 C:\...\a / C:/.../a / .\a 로 오면
// repeat 캐시·pending 중복 판정이 전부 미스나서 행 폭증 + 알림 폭주가 된다.
// 저장은 구분자만 정규화("/"), 비교는 Windows 대소문자 무시를 위해 lowercase 사용.
function normApprovalPath(p: string): string {
  return String(p ?? "").replace(/\\/g, "/");
}
function approvalKeyEq(a: string, b: string): boolean {
  return normApprovalPath(a).toLowerCase() === normApprovalPath(b).toLowerCase();
}

// 자동승인 대상 읽기 전용 도구 — 부작용 없음. 민감(sensitive=true) 요청은 제외.
const AUTO_ALLOW_READ_TOOLS = new Set(["SafeRead", "SafeReadImage", "SafeGlob", "SafeGrep"]);
// 루프백 curl 자동승인 — 서브앱 API 호출은 설계된 정상 업무(장부지기 등).
// 조건: curl로 시작, 셸 체이닝/파이프/리다이렉트/치환 없음, URL은 오직 127.0.0.1/localhost만.
function isLocalCurlCommand(cmd: string): boolean {
  if (!/^curl\s/.test(cmd)) return false;
  // 셸 체이닝/파이프/리다이렉트/치환 + 개행(개행도 셸에선 ';'와 동일한 명령 구분자) 차단
  if (/[|;&><`\r\n]|\$\(/.test(cmd)) return false;
  // curl 자체의 파일 쓰기/업로드/설정 플래그 차단 — 셸 리다이렉트 없이도
  // -o 등으로 임의 파일을 덮어써 SafeWrite 게이트를 우회할 수 있다.
  // 짧은 플래그는 붙여쓰기(-so)까지 잡도록 단일 대시 뒤 문자군 전체를 검사한다.
  const shortFlagBlock = /(^|\s)-[A-Za-z]*[oODcKT]/;   // -o -O -D -c -K -T (및 -so 등 결합형)
  const longFlagBlock = /--(output|remote-name|remote-header-name|dump-header|cookie-jar|config|upload-file|trace|trace-ascii|create-dirs|output-dir|etag-save|libcurl)\b/;
  if (shortFlagBlock.test(cmd) || longFlagBlock.test(cmd)) return false;
  // @파일 참조(-d @file, -F name=@file, --data-binary @file) — 로컬 파일을 읽어 전송하는 우회 차단
  if (/[=\s]@/.test(cmd)) return false;
  const urls = cmd.match(/https?:\/\/[^\s"']+/gi) ?? [];
  if (urls.length === 0) return false;
  return urls.every((u) => /^https?:\/\/(127\.0\.0\.1|localhost)([:/]|$)/i.test(u));
}

export function createApproval(input: { agentRole: string; tool: string; path: string; jobId?: string; reason?: string; sensitive?: boolean }): ApprovalRequest {
  const req: ApprovalRequest = {
    id: randomUUID(),
    agentRole: input.agentRole,
    tool: input.tool,
    path: normApprovalPath(input.path),
    jobId: input.jobId,
    reason: input.reason,
    createdAt: Date.now(),
    status: "pending_chat",
  };

  // 즉시 체크: /tmp/** 경로 — approval-policy(2026-07-16)에 따라 항상 자동 허용
  // POSIX(/tmp/...) 및 Windows(\tmp\...) 모두 매칭. 끝이 '/tmp' 또는 '\tmp'인 경우도 포함.
  if (/(^|[/\\])tmp([/\\]|$)/.test(req.path)) {
    req.status = "allowed";
    req.resolvedAt = Date.now();
    req.decisionSource = "auto_rule_tmp";
    approvals.set(req.id, req);
    emitResolved(req);
    saveApprovals();
    console.log(`[Approval] /tmp/** 즉시 승인: ${req.id.slice(0, 8)} (${req.path})`);
    return req;
  }

  // 즉시 체크: 비민감 읽기 전용 도구 — 부작용이 없고 이력상 92%가 결국 허용되던 순수 마찰.
  // 민감(.env/.ssh/키 등) 읽기는 sensitive=true로 와서 이 규칙을 타지 않는다.
  if (!input.sensitive && AUTO_ALLOW_READ_TOOLS.has(req.tool)) {
    req.status = "allowed";
    req.resolvedAt = Date.now();
    req.decisionSource = "auto_rule_read";
    approvals.set(req.id, req);
    emitResolved(req);
    saveApprovals();
    console.log(`[Approval] 읽기 즉시 승인: ${req.id.slice(0, 8)} (${req.agentRole}:${req.tool})`);
    return req;
  }

  // 즉시 체크: 루프백 curl — 서브앱(장부/리드/아난다라) API 호출은 설계된 정상 워크플로우
  if (req.tool === "SafeBash" && isLocalCurlCommand(req.path)) {
    req.status = "allowed";
    req.resolvedAt = Date.now();
    req.decisionSource = "auto_rule_local_curl";
    approvals.set(req.id, req);
    emitResolved(req);
    saveApprovals();
    console.log(`[Approval] 루프백 curl 즉시 승인: ${req.id.slice(0, 8)} (${req.agentRole})`);
    return req;
  }

  // 즉시 체크: 1시간 내 동일 요청 승인 이력 → 대기 없이 바로 allow
  // A안 안전장치: orchestrator(마이크루) 본인 요청은 repeat 우회 금지 — 매번 사장님 직접 결정 (부재중이면 해제)
  if ((req.agentRole !== "orchestrator" || ownerAway) && hasApprovedRecord(req.agentRole, req.tool, req.path)) {
    req.status = "allowed";
    req.resolvedAt = Date.now();
    req.decisionSource = "auto_rule_repeat";
    approvals.set(req.id, req);
    emitResolved(req);
    saveApprovals();
    console.log(`[Approval] repeat 즉시 승인: ${req.id.slice(0, 8)} (${req.agentRole}:${req.tool}:${req.path})`);
    return req;
  }

  // [F2 픽스] 동일 요청이 아직 pending이면 새 행을 만들지 말고 기존 요청에 합류.
  // (클라이언트 60s 폴 타임아웃 후 재시도가 매번 새 행+새 텔레그램/디스코드 알림을 만들던 폭증 경로 차단)
  for (const r of approvals.values()) {
    if (
      r.status === "pending_chat" &&
      r.agentRole === req.agentRole &&
      r.tool === req.tool &&
      approvalKeyEq(r.path, req.path)
    ) {
      console.log(`[Approval] pending 합류: ${r.id.slice(0, 8)} (${req.agentRole}:${req.tool}) — 중복 행 생성 안 함`);
      return r;
    }
  }

  approvals.set(req.id, req);
  emitGlobalEvent("approval-request", req);
  try { notifier?.(req); } catch (err) {
    console.error("[Approval] notifier 실패:", err instanceof Error ? err.message : err);
  }
  // [로컬 패치] 텔레그램·디스코드 승인 버튼 발송 (부재중 운영 — 2026-07-11 구현 재이식)
  const reasonOrPath = req.reason ? req.reason : req.path;
  const approvalNoticeText = `🔐 승인 요청: ${req.agentRole}가 ${req.tool} — ${reasonOrPath}.
아래 버튼으로 바로 승인/거부하거나 대시보드에서 처리해 주세요.`;
  import("./telegram.js")
    .then((m) => m.sendApprovalRequestWithButtons(req.id, approvalNoticeText))
    .catch((err) => console.error("[Approval] 텔레그램 버튼 알림 실패:", err instanceof Error ? err.message : err));
  import("./discord.js")
    .then((m) => m.sendDiscordApprovalRequestWithButtons(req.id, approvalNoticeText))
    .catch((err) => console.error("[Approval] 디스코드 버튼 알림 실패:", err instanceof Error ? err.message : err));
  setTimeout(() => autoDecideAttempt(req.id), AUTO_DECIDE_DELAY_MS);
  return req;
}

export function resolveApproval(
  id: string,
  allow: boolean,
  source: "user" | "genie" = "user",
  reason?: string,
): ApprovalRequest | null {
  const req = approvals.get(id);
  if (!req) return null;
  if (req.status !== "pending_chat") return req;

  // 사장님 응답 → 즉시 최종 결정
  if (source === "user") {
    req.status = allow ? "allowed" : "denied";
    req.resolvedAt = Date.now();
    req.decisionSource = "user";
    emitResolved(req);
    saveApprovals();
    return req;
  }

  // 마이크루 응답 → 의견으로 보류 (55초 후 적용)
  req.genieOpinion = { allow, reason };
  console.log(`[Approval] 마이크루 의견 접수: ${id.slice(0, 8)} → ${allow ? "allow" : "deny"} (${reason ?? "-"})`);
  // 의견을 대화창에 표시 (결정이 아닌 의견임을 명시)
  emitGlobalEvent("approval-opinion", { id: req.id, allow, reason, source: "genie" });

  // 부재중이면 마이크루 의견 즉시 적용 (55초 대기 불필요)
  if (ownerAway && req.status === "pending_chat") {
    req.status = allow ? "allowed" : "denied";
    req.resolvedAt = Date.now();
    req.decisionSource = "genie";
    console.log(`[Approval] 부재중 마이크루 의견 즉시 적용: ${id.slice(0, 8)} → ${req.status}`);
    emitResolved(req);
    saveApprovals();
  }
  return req;
}

// 자동 규칙(무비용 알림 등) 기반 즉시 확정 — 55초 대기 없이 pending_chat → allowed/denied.
// approval-genie가 사전 판단으로 확정할 때 사용. 사장님이 이미 결정했으면 no-op.
export function autoResolveApproval(
  id: string,
  allow: boolean,
  source: NonNullable<ApprovalRequest["decisionSource"]>,
  reason?: string,
): ApprovalRequest | null {
  const req = approvals.get(id);
  if (!req) return null;
  if (req.status !== "pending_chat") return req;
  req.status = allow ? "allowed" : "denied";
  req.resolvedAt = Date.now();
  req.decisionSource = source;
  if (reason) req.genieOpinion = { allow, reason };
  console.log(`[Approval] 자동 확정(${source}): ${id.slice(0, 8)} → ${req.status} (${reason ?? "-"})`);
  emitResolved(req);
  saveApprovals();
  return req;
}

export function getApprovalStatus(id: string): ApprovalRequest | null {
  const memHit = approvals.get(id);
  if (memHit) return memHit;
  // 메모리 miss — 1시간 지난 resolved는 cleanup interval에서 메모리 삭제됨, 파일 폴백
  try {
    if (existsSync(APPROVALS_FILE)) {
      const arr = JSON.parse(readFileSync(APPROVALS_FILE, "utf-8")) as ApprovalRequest[];
      if (Array.isArray(arr)) {
        const found = arr.find((r) => r.id === id);
        if (found) return found;
      }
    }
  } catch { /* */ }
  return null;
}

export function getPendingApprovals(): ApprovalRequest[] {
  return [...approvals.values()].filter((r) => r.status === "pending_chat");
}

// 최근 resolved 이력 (pending_chat 제외) — 대시보드 이력 패널용
export function getResolvedApprovals(limit = 10): ApprovalRequest[] {
  // 메모리 + 파일에서 합쳐서 반환 (메모리에서 삭제된 오래된 것도 포함)
  const memResolved = [...approvals.values()].filter((r) => r.status !== "pending_chat");
  const memIds = new Set(memResolved.map((r) => r.id));
  let fileResolved: ApprovalRequest[] = [];
  try {
    if (existsSync(APPROVALS_FILE)) {
      const arr = JSON.parse(readFileSync(APPROVALS_FILE, "utf-8")) as ApprovalRequest[];
      if (Array.isArray(arr)) {
        fileResolved = arr.filter((r) => r.status !== "pending_chat" && !memIds.has(r.id));
      }
    }
  } catch { /* */ }
  return [...memResolved, ...fileResolved]
    .sort((a, b) => (b.resolvedAt ?? b.createdAt) - (a.resolvedAt ?? a.createdAt))
    .slice(0, limit);
}

// --- autoDecide: 마이크루 규칙 기반 자동 판단 ---

type AutoDecision = { decision: "allow" | "deny" | null; rule?: string };

export function autoDecide(req: ApprovalRequest): AutoDecision {
  // A안 안전장치: orchestrator(마이크루) 요청은 자동 규칙 적용 안 함 — 사장님 직접 결정만 인정 (부재중이면 해제)
  if (req.agentRole === "orchestrator" && !ownerAway) return { decision: null };
  const p = req.path;
  // 1. 시스템 경로
  if (/^\/(etc|usr|var|System|private\/etc|private\/usr|private\/var)(\/|$)/.test(p)) return { decision: "deny", rule: "auto_rule_system" };
  // 2. 민감 dotfile 폴더 + SSH 키 파일명
  if (/\/\.(ssh|aws|gnupg|config|netrc|gitconfig|kube|docker|netlify|vercel|gcp|npmrc)|\/id_rsa|\/id_ed25519|\/id_ecdsa/.test(p)) return { decision: "deny", rule: "auto_rule_dotfile" };
  // 3. .env 파일/폴더 (.env, .env.prod, .env.local, .env/ 등)
  if (/\.env(\.|$|\/)/.test(p)) return { decision: "deny", rule: "auto_rule_env" };
  // 3.5. 인증서/키 파일 확장자
  if (/\.(pem|key|crt|p12|pfx|jks|keychain-db)$/.test(p)) return { decision: "deny", rule: "auto_rule_cert_key" };
  // 4. 타 사용자 홈 (macOS: /Users/xxx, Linux: /home/xxx)
  const home = homedir();
  if (p.startsWith("/Users/") && !p.startsWith(home + "/") && p !== home) return { decision: "deny", rule: "auto_rule_users" };
  if (p.startsWith("/home/") && !p.startsWith(home + "/") && p !== home) return { decision: "deny", rule: "auto_rule_users" };
  // 5. Write 계열 (방어적 — 정상 경로에서는 오지 않아야 함)
  if (req.tool === "SafeWrite" || req.tool === "SafeEdit") return { decision: "deny", rule: "auto_rule_write" };
  // 6. tmp 경로
  if (p.includes("/tmp/") || p.endsWith("/tmp")) return { decision: "allow", rule: "auto_rule_tmp" };
  // 7. 반복 요청 (메모리 내 동일 agentRole+tool+path 승인 이력, 1시간 윈도우)
  if (hasApprovedRecord(req.agentRole, req.tool, p)) return { decision: "allow", rule: "auto_rule_repeat" };
  return { decision: null };
}

function hasApprovedRecord(agentRole: string, tool: string, path: string): boolean {
  const now = Date.now();
  for (const r of approvals.values()) {
    if (
      r.agentRole === agentRole &&
      r.tool === tool &&
      approvalKeyEq(r.path, path) &&
      r.status === "allowed" &&
      !r.revokedAt &&
      now - (r.resolvedAt ?? r.createdAt) <= REPEAT_WINDOW_MS
    ) return true;
  }
  return false;
}

// revoke-recent: 지정 조건에 맞는 미종결 approvals(allowed | pending_chat) 회수.
// hasApprovedRecord에서 revokedAt 체크로 자동 제외됨.
// jobId 필터(P1.4): processCallback 실패 분기에서 잔여 approval 자동 회수에 사용.
//   jobId 미보유 approval(legacy/마이크루 self-call)은 jobId 필터에서 자동 제외 (no-op).
// P1.8: pending_chat도 회수 — 사장님 결정 전 워커 실패/lease 만료 시
//   stuck 모달 정리 + decisionSource="auto_rule_job_failed"로 source 구분.
//   pending_chat → denied 전환하여 approval-resolved emit 시 UI 모달 닫힘 트리거.
export function revokeRecentApprovals(filters: { agentRole?: string; path?: string; jobId?: string; window?: number }): string[] {
  const window = filters.window ?? 60 * 60 * 1000;
  const now = Date.now();
  const revoked: string[] = [];
  for (const r of approvals.values()) {
    // 종결(denied/timeout) 또는 이미 revoke된 항목 skip.
    if (r.status === "denied" || r.status === "timeout" || r.revokedAt) continue;
    if (now - r.createdAt > window) continue;
    if (filters.agentRole && r.agentRole !== filters.agentRole) continue;
    if (filters.path && r.path !== filters.path) continue;
    if (filters.jobId && r.jobId !== filters.jobId) continue;
    // pending_chat → denied 전환(job 실패로 인한 자동 철회).
    if (r.status === "pending_chat") {
      r.status = "denied";
      r.resolvedAt = now;
      r.decisionSource = "auto_rule_job_failed";
    }
    r.revokedAt = now;
    revoked.push(r.id);
    emitResolved(r);
  }
  if (revoked.length > 0) saveApprovals();
  return revoked;
}

// job-notify 게이팅(jobs.ts)에서 사용 — 이 job이 승인 체인(approval-gated)에 걸린 적이 있는지 확인.
// 승인이 발급된 job은 항상 지니에게 알려야 하므로(사장님 결정 흐름과 연결) cheap pre-filter의 always-notify 조건으로 사용.
export function hasApprovalHistory(jobId: string): boolean {
  for (const r of approvals.values()) {
    if (r.jobId === jobId) return true;
  }
  return false;
}

function autoDecideAttempt(id: string): void {
  const req = approvals.get(id);
  if (!req || req.status !== "pending_chat") return;
  const attempts = (req.autoDecideAttempts ?? 0) + 1;
  req.autoDecideAttempts = attempts;

  // 1순위: 마이크루 의견이 있으면 적용 (사장님 55초 무응답 후)
  // orchestrator 본인 요청도 부재중이면 마이크루 의견 적용 (재석 시에는 사장님만 결정)
  if (req.genieOpinion && (req.agentRole !== "orchestrator" || ownerAway)) {
    req.status = req.genieOpinion.allow ? "allowed" : "denied";
    req.resolvedAt = Date.now();
    req.decisionSource = "genie";
    console.log(`[Approval] 마이크루 의견 적용: ${id.slice(0, 8)} → ${req.status}`);
    emitResolved(req);
    saveApprovals();
    return;
  }

  // 2순위: 시스템 autoDecide 규칙
  const result = autoDecide(req);
  if (result.decision === "allow" || result.decision === "deny") {
    req.status = result.decision === "allow" ? "allowed" : "denied";
    req.resolvedAt = Date.now();
    req.decisionSource = result.rule as ApprovalRequest["decisionSource"];
    emitResolved(req);
    saveApprovals();
    return;
  }

  // orchestrator 전용 판단 (도구별 분기)
  if (req.agentRole === "orchestrator") {
    const isRead = req.tool === "SafeRead" || req.tool === "SafeGlob" || req.tool === "SafeGrep";
    const isBash = req.tool === "SafeBash";
    let decision: "allowed" | "denied";
    if (ownerAway) {
      // 부재중: 읽기/쓰기 allow, bash deny
      decision = isBash ? "denied" : "allowed";
    } else {
      // 재석 + 시간초과: 읽기 allow, 쓰기/bash deny
      decision = isRead ? "allowed" : "denied";
    }
    req.status = decision;
    req.resolvedAt = Date.now();
    req.decisionSource = "auto_rule_retry_exhausted";
    console.log(`[Approval] orchestrator ${ownerAway ? "부재" : "재석"} → ${decision}: ${id.slice(0, 8)} (${req.tool})`);
    emitResolved(req);
    saveApprovals();
    return;
  }

  // 판단 불가 — 마이크루 의견 대기 (재시도)
  if (attempts < AUTO_DECIDE_MAX_ATTEMPTS) {
    setTimeout(() => autoDecideAttempt(id), AUTO_DECIDE_RETRY_MS);
    return;
  }
  // 최종: 마이크루도 시스템도 판단 못함 → 보수적 DENY
  req.status = "denied";
  req.resolvedAt = Date.now();
  req.decisionSource = "auto_rule_retry_exhausted";
  emitResolved(req);
  saveApprovals();
}

// 주기적 정리: pending TTL timeout + resolved 1시간 후 메모리 삭제
// retention은 resolvedAt 기준 (의도: 승인 시점부터 캐시 1시간 보존). resolvedAt 없으면 createdAt 폴백.
setInterval(() => {
  const now = Date.now();
  let dirty = false;
  for (const [id, req] of approvals) {
    if (req.status === "pending_chat" && now - req.createdAt > TTL_MS) {
      req.status = "timeout";
      req.resolvedAt = now;
      req.decisionSource = "auto_rule_retry_exhausted";
      emitResolved(req);
      dirty = true;
    }
    if (req.status !== "pending_chat" && now - (req.resolvedAt ?? req.createdAt) > RESOLVED_RETENTION_MS) {
      approvals.delete(id);
      // 파일에서는 삭제하지 않음 — 대시보드 히스토리용 영구 보관
      // dirty를 안 세팅해서 saveApprovals 호출 안 함
    }
  }
  if (dirty) saveApprovals();
}, CLEANUP_INTERVAL);
