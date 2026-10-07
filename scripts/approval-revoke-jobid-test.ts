// P1.4: revokeRecentApprovals jobId 필터 단위 테스트
// processCallback 실패 분기에서 호출되는 회수 동작 검증
import {
  createApproval,
  resolveApproval,
  revokeRecentApprovals,
  getApprovalStatus,
} from "../src/server/approvals.js";

let pass = 0, fail = 0;
function check(name: string, ok: boolean, info?: string): void {
  if (ok) pass++; else fail++;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${info ? " | " + info : ""}`);
}

// 1. jobId 매칭 회수 — 동일 jobId의 allowed approval만 revoke
{
  const jobA = "aaaaaaaa-1111-2222-3333-444444444444";
  const reqA = createApproval({ agentRole: "dev-pm", tool: "SafeRead", path: "/notrepo/revoke-test/a1.txt", jobId: jobA });
  resolveApproval(reqA.id, true, "user");
  const revoked = revokeRecentApprovals({ jobId: jobA });
  const after = getApprovalStatus(reqA.id);
  check("1. jobId 매칭 회수", revoked.includes(reqA.id) && after?.revokedAt !== undefined, `revoked=${revoked.length}`);
}

// 2. 미매칭 jobId — 다른 jobId의 approval은 회수되지 않음
{
  const jobB = "bbbbbbbb-1111-2222-3333-444444444444";
  const jobC = "cccccccc-1111-2222-3333-444444444444";
  const reqB = createApproval({ agentRole: "qa", tool: "SafeRead", path: "/notrepo/revoke-test/b1.txt", jobId: jobB });
  resolveApproval(reqB.id, true, "user");
  const revoked = revokeRecentApprovals({ jobId: jobC });
  const after = getApprovalStatus(reqB.id);
  check(
    "2. 미매칭 jobId 영향 없음",
    !revoked.includes(reqB.id) && after?.revokedAt === undefined,
    `revoked=${revoked.length}`,
  );
}

// 3. jobId 없는 legacy approval — jobId 필터 적용 시 자동 무시
{
  const reqLegacy = createApproval({ agentRole: "planner-researcher", tool: "SafeRead", path: "/notrepo/revoke-test/legacy.txt" });
  resolveApproval(reqLegacy.id, true, "user");
  const revoked = revokeRecentApprovals({ jobId: "dddddddd-1111-2222-3333-444444444444" });
  const after = getApprovalStatus(reqLegacy.id);
  check(
    "3. jobId 없는 legacy approval은 jobId 필터에서 무시",
    !revoked.includes(reqLegacy.id) && after?.revokedAt === undefined,
    `legacy.jobId=${after?.jobId}`,
  );
}

// 4. 동일 jobId의 다중 approval 일괄 회수
{
  const jobMulti = "eeeeeeee-1111-2222-3333-444444444444";
  const r1 = createApproval({ agentRole: "dev-pm", tool: "SafeRead", path: "/notrepo/revoke-test/m1.txt", jobId: jobMulti });
  const r2 = createApproval({ agentRole: "dev-pm", tool: "SafeRead", path: "/notrepo/revoke-test/m2.txt", jobId: jobMulti });
  resolveApproval(r1.id, true, "user");
  resolveApproval(r2.id, true, "user");
  const revoked = revokeRecentApprovals({ jobId: jobMulti });
  check(
    "4. 동일 jobId 다중 approval 일괄 회수",
    revoked.includes(r1.id) && revoked.includes(r2.id),
    `revoked=${revoked.length}`,
  );
}

// P1.8 신규 — pending_chat 회수 (사장님 결정 전 워커 실패/lease 만료)
// 아래 3건은 approval이 실제로 pending_chat에 머물러야 의미가 있다. 읽기 도구(SafeRead/SafeGlob/
// SafeGrep/SafeReadImage)는 AUTO_ALLOW_READ_TOOLS 규칙으로 생성 즉시 allowed가 되므로 쓰면 안 된다.
// 마찬가지로 /tmp/** 경로도 auto_rule_tmp로 즉시 승인되므로 피한다.
// 5. pending_chat + jobId 매칭 → status=denied 전환 + revokedAt + decisionSource=auto_rule_job_failed
{
  const jobP = "11111111-aaaa-bbbb-cccc-555555555555";
  const reqP = createApproval({ agentRole: "dev-pm", tool: "SafeWrite", path: "/notrepo/revoke-test/p1.txt", jobId: jobP });
  // 의도적으로 resolveApproval 미호출 — pending_chat 상태 유지
  const revoked = revokeRecentApprovals({ jobId: jobP });
  const after = getApprovalStatus(reqP.id);
  check(
    "5. pending_chat + jobId 매칭 회수 (status=denied 전환)",
    revoked.includes(reqP.id)
      && after?.status === "denied"
      && after?.revokedAt !== undefined
      && after?.resolvedAt !== undefined
      && after?.decisionSource === "auto_rule_job_failed",
    `status=${after?.status} source=${after?.decisionSource}`,
  );
}

// 6. denied 상태(이미 종결)는 회수 대상 아님
{
  const jobD = "22222222-aaaa-bbbb-cccc-555555555555";
  const reqD = createApproval({ agentRole: "dev-pm", tool: "SafeWrite", path: "/notrepo/revoke-test/d1.txt", jobId: jobD });
  resolveApproval(reqD.id, false, "user"); // 사장님이 거부
  const beforeRevokedAt = getApprovalStatus(reqD.id)?.revokedAt;
  const revoked = revokeRecentApprovals({ jobId: jobD });
  const after = getApprovalStatus(reqD.id);
  check(
    "6. denied 상태는 회수 대상 아님",
    !revoked.includes(reqD.id) && after?.revokedAt === beforeRevokedAt,
    `revoked=${revoked.length} status=${after?.status}`,
  );
}

// 7. allowed + pending_chat 혼재 — 둘 다 회수
{
  const jobMix = "33333333-aaaa-bbbb-cccc-555555555555";
  const rA = createApproval({ agentRole: "dev-pm", tool: "SafeWrite", path: "/notrepo/revoke-test/mix-a.txt", jobId: jobMix });
  const rP = createApproval({ agentRole: "dev-pm", tool: "SafeWrite", path: "/notrepo/revoke-test/mix-p.txt", jobId: jobMix });
  resolveApproval(rA.id, true, "user"); // allowed
  // rP는 pending_chat 유지
  const revoked = revokeRecentApprovals({ jobId: jobMix });
  const afterA = getApprovalStatus(rA.id);
  const afterP = getApprovalStatus(rP.id);
  check(
    "7. allowed + pending_chat 혼재 일괄 회수",
    revoked.includes(rA.id)
      && revoked.includes(rP.id)
      && afterA?.status === "allowed"
      && afterA?.revokedAt !== undefined
      && afterP?.status === "denied"
      && afterP?.decisionSource === "auto_rule_job_failed",
    `A.status=${afterA?.status} P.status=${afterP?.status}`,
  );
}

console.log(`\n=== ${pass}/${pass + fail} PASS, ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);
