// approvals.json 디스크 영속화 회귀 테스트
// 점검: resolved 디스크 저장 / pending_chat 제외 / revokedAt 반영 / loadApprovals 동작
// 격리: HISTORY_DIR/approvals.json을 백업/복원하여 운영 데이터 보호
import {
  createApproval,
  resolveApproval,
  revokeRecentApprovals,
  loadApprovals,
  type ApprovalRequest,
} from "../src/server/approvals.js";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";

const HISTORY_DIR = join(process.cwd(), "history");
const APPROVALS_FILE = join(HISTORY_DIR, "approvals.json");
const BACKUP = APPROVALS_FILE + ".test-bak";

// 백업 (기존 데이터 보호)
const hadOriginal = existsSync(APPROVALS_FILE);
if (hadOriginal) copyFileSync(APPROVALS_FILE, BACKUP);
// 빈 상태에서 시작
if (existsSync(APPROVALS_FILE)) unlinkSync(APPROVALS_FILE);

let pass = 0, fail = 0;
function check(name: string, ok: boolean, info?: string): void {
  if (ok) pass++; else fail++;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${info ? " | " + info : ""}`);
}

function readFile(): ApprovalRequest[] {
  if (!existsSync(APPROVALS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(APPROVALS_FILE, "utf-8"));
  } catch { return []; }
}

try {
  // (a) createApproval + resolveApproval(allow, user) → 파일 존재
  {
    const path = "/notrepo/persist-test/a.txt";
    const req = createApproval({ agentRole: "dev-pm", tool: "SafeWrite", path });
    resolveApproval(req.id, true, "user");
    check("(a) 파일 존재 (resolved 후 디스크 저장)", existsSync(APPROVALS_FILE));
    const arr = readFile();
    const found = arr.find((r) => r.id === req.id);
    check(
      "(b) allowed 디스크 저장",
      found?.status === "allowed",
      `status=${found?.status}`,
    );
    check(
      "(c) resolvedAt 디스크 저장",
      typeof found?.resolvedAt === "number" && found.resolvedAt > 0,
      `resolvedAt=${found?.resolvedAt}`,
    );
  }

  // 주의: 이 파일의 approval은 실제 승인 경로(pending_chat → 결정)를 타야 한다. 읽기 도구
  // (SafeRead/SafeReadImage/SafeGlob/SafeGrep)는 AUTO_ALLOW_READ_TOOLS로 생성 즉시 allowed가 되고,
  // /tmp/** 경로도 auto_rule_tmp로 즉시 승인된다. 그래서 SafeWrite + /notrepo 경로를 쓴다.

  // (d) deny resolveApproval → status='denied' 저장
  {
    const path = "/notrepo/persist-test/d.txt";
    const req = createApproval({ agentRole: "dev-pm", tool: "SafeWrite", path });
    resolveApproval(req.id, false, "user");
    const arr = readFile();
    const found = arr.find((r) => r.id === req.id);
    check(
      "(d) denied 디스크 저장",
      found?.status === "denied",
      `status=${found?.status}`,
    );
  }

  // (e) pending_chat은 디스크 저장 X
  {
    const pendingPath = "/notrepo/persist-test/e-pending.txt";
    const pending = createApproval({ agentRole: "dev-pm", tool: "SafeWrite", path: pendingPath });
    // 다른 항목으로 saveApprovals 트리거 (그 시점의 pending_chat은 저장 안 됨)
    const trig = createApproval({ agentRole: "dev-pm", tool: "SafeWrite", path: "/notrepo/persist-test/e-trigger.txt" });
    resolveApproval(trig.id, true, "user");
    const arr = readFile();
    const pendingFound = arr.find((r) => r.id === pending.id);
    check(
      "(e) pending_chat 디스크 저장 안 됨",
      !pendingFound,
      `pendingFound=${!!pendingFound}`,
    );
  }

  // (f) revokeRecentApprovals → revokedAt 디스크 반영
  {
    const path = "/notrepo/persist-test/f.txt";
    const req = createApproval({ agentRole: "dev-pm", tool: "SafeWrite", path });
    resolveApproval(req.id, true, "user");
    const revoked = revokeRecentApprovals({ agentRole: "dev-pm", path });
    const arr = readFile();
    const found = arr.find((r) => r.id === req.id);
    check(
      "(f) revokedAt 디스크 저장",
      revoked.length === 1 && typeof found?.revokedAt === "number",
      `revoked=${revoked.length} revokedAt=${found?.revokedAt}`,
    );
  }

  // (g) loadApprovals export + idempotent 호출
  {
    check(
      "(g) loadApprovals 함수 export",
      typeof loadApprovals === "function",
    );
    // idempotent — 두 번 호출해도 throw 안 함
    let threw = false;
    try { loadApprovals(); loadApprovals(); } catch { threw = true; }
    check("(g) loadApprovals idempotent (2회 호출)", !threw);
  }

  // (h) save → 디스크 round-trip 동일성 — id/agentRole/tool/path/status/createdAt/resolvedAt/decisionSource 모두 보존
  {
    const path = "/notrepo/persist-test/h-roundtrip.txt";
    const req = createApproval({ agentRole: "dev-pm", tool: "SafeWrite", path });
    resolveApproval(req.id, true, "user");  // saveApprovals 트리거
    const arr = readFile();
    const found = arr.find((r) => r.id === req.id);
    const fieldsMatch =
      !!found &&
      found.id === req.id &&
      found.agentRole === "dev-pm" &&
      found.tool === "SafeWrite" &&
      found.path === path &&
      found.status === "allowed" &&
      found.createdAt === req.createdAt &&
      typeof found.resolvedAt === "number" &&
      found.decisionSource === "user";
    check(
      "(h) save → 디스크 round-trip 동일성 (모든 필드 보존)",
      fieldsMatch,
      `id=${found?.id?.slice(0, 8)} status=${found?.status} source=${found?.decisionSource}`,
    );
  }

  // (i) 재시작 시뮬: 가짜 디스크 사전 데이터 → loadApprovals → createApproval 동일 매개변수 → auto_rule_repeat 즉시 allow
  {
    const fakeAgent = "loaded-test-i";
    const fakeTool = "SafeWrite";
    const fakePath = "/notrepo/loaded-i/x.txt";
    const now = Date.now();
    // 기존 디스크 파일 + 가짜 사전 데이터 합쳐서 write (재시작 직전 상태 시뮬)
    const existing = readFile();
    const fake: ApprovalRequest = {
      id: "loaded-fake-i-" + now,
      agentRole: fakeAgent,
      tool: fakeTool,
      path: fakePath,
      createdAt: now - 60_000,
      resolvedAt: now - 60_000,
      status: "allowed",
      decisionSource: "user",
    };
    existing.push(fake);
    writeFileSync(APPROVALS_FILE, JSON.stringify(existing, null, 2));
    // 재시작 시뮬: loadApprovals 호출로 디스크 → 메모리 복원
    loadApprovals();
    // 동일 (agentRole, tool, path)로 createApproval → auto_rule_repeat 캐시 매칭
    const second = createApproval({ agentRole: fakeAgent, tool: fakeTool, path: fakePath });
    check(
      "(i) 재시작 시뮬 — 디스크→메모리→캐시 매칭으로 즉시 allow",
      second.status === "allowed" && second.decisionSource === "auto_rule_repeat",
      `status=${second.status} source=${second.decisionSource}`,
    );
  }

  // (j) revokedAt 보존 시연 — load 후 hasApprovedRecord 가드 적용 (revoke된 이력은 매칭 X)
  {
    const fakeAgent = "loaded-test-j";
    const fakeTool = "SafeWrite";
    const fakePath = "/notrepo/loaded-j/x.txt";
    const now = Date.now();
    const existing = readFile();
    const fakeRevoked: ApprovalRequest = {
      id: "loaded-fake-j-" + now,
      agentRole: fakeAgent,
      tool: fakeTool,
      path: fakePath,
      createdAt: now - 60_000,
      resolvedAt: now - 60_000,
      revokedAt: now - 30_000,    // ← revoked 이력
      status: "allowed",
      decisionSource: "user",
    };
    existing.push(fakeRevoked);
    writeFileSync(APPROVALS_FILE, JSON.stringify(existing, null, 2));
    loadApprovals();
    const second = createApproval({ agentRole: fakeAgent, tool: fakeTool, path: fakePath });
    check(
      "(j) revokedAt 보존 — load 후 hasApprovedRecord 가드 적용 (캐시 매칭 X)",
      second.status === "pending_chat",
      `status=${second.status} source=${second.decisionSource}`,
    );
  }

  console.log(`\n=== ${pass}/${pass + fail} PASS, ${fail} FAIL ===`);
} finally {
  // 복원
  if (hadOriginal) {
    copyFileSync(BACKUP, APPROVALS_FILE);
    unlinkSync(BACKUP);
  } else if (existsSync(APPROVALS_FILE)) {
    unlinkSync(APPROVALS_FILE);
  }
}

process.exit(fail > 0 ? 1 : 0);
