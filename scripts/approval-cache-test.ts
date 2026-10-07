// [2026-07-18] 비민감 읽기 auto_rule_read 즉시승인 정책 도입으로, 캐시(repeat/deny/revoke/격리)
// 기전 검증은 자동승인 대상이 아닌 SafeWrite로 수행한다 (기존 SafeRead 전면 치환).
// auto_rule_repeat 캐시 정책 회귀 테스트
// 점검: agentRole + tool + path 매칭, deny/revoke/orchestrator 우회, 윈도우 만료
import {
  createApproval,
  resolveApproval,
  revokeRecentApprovals,
  autoDecide,
  isOwnerAway,
  type ApprovalRequest,
} from "../src/server/approvals.js";

let pass = 0, fail = 0;
function check(name: string, ok: boolean, info?: string): void {
  if (ok) pass++; else fail++;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${info ? " | " + info : ""}`);
}

// (a) Read 승인 → 동일 path Read 재요청 → 즉시 allow (auto_rule_repeat)
{
  const path = "/tmp/cache-test/a.txt".replace("/tmp/", "/notrepo/"); // tmp 규칙 우회용 가짜 절대경로
  const first = createApproval({ agentRole: "dev-pm", tool: "SafeWrite", path });
  resolveApproval(first.id, true, "user");
  const second = createApproval({ agentRole: "dev-pm", tool: "SafeWrite", path });
  check(
    "(a) Read 승인 후 동일 Read 재요청 → 즉시 allow",
    second.status === "allowed" && second.decisionSource === "auto_rule_repeat",
    `status=${second.status} source=${second.decisionSource}`,
  );
}

// (b) Read 승인 → 동일 path Write 재요청 → 즉시 allow되지 않음 (도구명 매칭)
{
  const path = "/notrepo/cache-test/b.txt";
  // 도구명 격리 검증 — 서로 다른 두 쓰기 도구(SafeEdit 승인 → SafeWrite 재요청)로 확인
  const first = createApproval({ agentRole: "dev-pm", tool: "SafeEdit", path });
  resolveApproval(first.id, true, "user");
  const second = createApproval({ agentRole: "dev-pm", tool: "SafeWrite", path });
  check(
    "(b) Read 승인 후 Write 재요청 → 즉시 allow 안 됨 (도구명 매칭)",
    second.status === "pending_chat",
    `status=${second.status} source=${second.decisionSource}`,
  );
  // autoDecide도 SafeWrite를 deny로 처리해야 함 (auto_rule_write)
  const decision = autoDecide(second);
  check(
    "(b) autoDecide(SafeWrite) → deny (auto_rule_write)",
    decision.decision === "deny" && decision.rule === "auto_rule_write",
    `decision=${JSON.stringify(decision)}`,
  );
}

// (c) deny된 path 재요청 → 자동 allow되지 않음
{
  const path = "/notrepo/cache-test/c.txt";
  const first = createApproval({ agentRole: "dev-pm", tool: "SafeWrite", path });
  resolveApproval(first.id, false, "user"); // deny
  const second = createApproval({ agentRole: "dev-pm", tool: "SafeWrite", path });
  check(
    "(c) deny된 동일 요청 재시도 → 자동 allow 안 됨",
    second.status === "pending_chat",
    `status=${second.status} source=${second.decisionSource}`,
  );
}

// (d) revoke 이후 재요청 → 자동 allow되지 않음
{
  const path = "/notrepo/cache-test/d.txt";
  const first = createApproval({ agentRole: "dev-pm", tool: "SafeWrite", path });
  resolveApproval(first.id, true, "user");
  const revoked = revokeRecentApprovals({ agentRole: "dev-pm", path });
  const second = createApproval({ agentRole: "dev-pm", tool: "SafeWrite", path });
  check(
    "(d) revoke 후 동일 요청 → 자동 allow 안 됨",
    revoked.length === 1 && second.status === "pending_chat",
    `revoked=${revoked.length} status=${second.status}`,
  );
}

// (e) orchestrator(마이크루) 본인 요청은 우회 차단 — 이전 allow가 있어도 즉시 allow되지 않음.
// 단 이 가드는 "재석" 전제다. 부재중 모드에서는 설계상 해제된다 —
// approvals.ts:328 `(req.agentRole !== "orchestrator" || ownerAway) && hasApprovedRecord(...)`.
// 부재중 여부는 런타임 상태(history/.owner-away)이고 setOwnerAway()는 그 파일을 실제로 덮어쓴다.
// 테스트가 상태를 바꾸면 그 사이 들어오는 진짜 승인 요청의 판정까지 흔들리므로, 상태는
// 건드리지 않고 "현재 모드에 대한 명세"를 검증한다.
// (2026-08-10: 부재중 모드가 켜져 있던 동안 이 케이스가 상시 red였다 — 코드 결함이 아니라
//  테스트가 전제 조건을 고정하지 않은 탓이다.)
{
  const path = "/notrepo/cache-test/e.txt";
  const away = isOwnerAway();
  const first = createApproval({ agentRole: "orchestrator", tool: "SafeWrite", path });
  resolveApproval(first.id, true, "user");
  const second = createApproval({ agentRole: "orchestrator", tool: "SafeWrite", path });
  check(
    `(e) orchestrator 본인 요청 → ${away ? "부재중이라 가드 해제 (즉시 allow)" : "재석이라 캐시 우회 차단"}`,
    away
      ? second.status === "allowed" && second.decisionSource === "auto_rule_repeat"
      : second.status === "pending_chat",
    `ownerAway=${away} status=${second.status} source=${second.decisionSource}`,
  );
}

// (f) 다른 agentRole 간 격리 — dev-pm allow가 qa로 새지 않음
{
  const path = "/notrepo/cache-test/f.txt";
  const first = createApproval({ agentRole: "dev-pm", tool: "SafeWrite", path });
  resolveApproval(first.id, true, "user");
  const second = createApproval({ agentRole: "qa", tool: "SafeWrite", path });
  check(
    "(f) 에이전트 간 격리 — dev-pm allow가 qa로 안 샘",
    second.status === "pending_chat",
    `status=${second.status} source=${second.decisionSource}`,
  );
}

// (g) resolvedAt 필드 세팅 검증
{
  const path = "/notrepo/cache-test/g.txt";
  const before = Date.now();
  const first = createApproval({ agentRole: "dev-pm", tool: "SafeWrite", path });
  resolveApproval(first.id, true, "user");
  const after = Date.now();
  check(
    "(g) user resolve 후 resolvedAt 세팅",
    typeof first.resolvedAt === "number" && first.resolvedAt >= before && first.resolvedAt <= after,
    `resolvedAt=${first.resolvedAt}`,
  );
  // 즉시 allow 분기에서도 resolvedAt 세팅
  const second = createApproval({ agentRole: "dev-pm", tool: "SafeWrite", path });
  check(
    "(g) auto_rule_repeat 즉시 allow에도 resolvedAt 세팅",
    second.status === "allowed" && typeof second.resolvedAt === "number",
    `resolvedAt=${second.resolvedAt}`,
  );
}

console.log(`\n=== ${pass}/${pass + fail} PASS, ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);
