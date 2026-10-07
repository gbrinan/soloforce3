// P1.3: ApprovalRequest.jobId 필드 보존 회귀 테스트
import {
  createApproval,
  getApprovalStatus,
  getPendingApprovals,
} from "../src/server/approvals.js";

let pass = 0, fail = 0;
function check(name: string, ok: boolean, info?: string): void {
  if (ok) pass++; else fail++;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${info ? " | " + info : ""}`);
}

// 1. jobId 전달 시 createApproval 결과에 보존
{
  const jobId = "11111111-2222-3333-4444-555555555555";
  const req = createApproval({ agentRole: "dev-pm", tool: "SafeRead", path: "/notrepo/jobid-test/a.txt", jobId });
  check("1. createApproval 결과에 jobId 보존", req.jobId === jobId, `req.jobId=${req.jobId}`);
}

// 2. jobId 미전달 시 undefined
{
  const req = createApproval({ agentRole: "dev-pm", tool: "SafeRead", path: "/notrepo/jobid-test/b.txt" });
  check("2. jobId 미전달 시 undefined", req.jobId === undefined, `req.jobId=${String(req.jobId)}`);
}

// 3. getApprovalStatus 조회 시 jobId 보존
{
  const jobId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const req = createApproval({ agentRole: "qa", tool: "SafeWrite", path: "/notrepo/jobid-test/c.txt", jobId });
  const fetched = getApprovalStatus(req.id);
  check(
    "3. getApprovalStatus 조회 시 jobId 보존",
    fetched?.jobId === jobId,
    `fetched.jobId=${fetched?.jobId}`,
  );
}

// 4. getPendingApprovals에 jobId 포함
{
  const jobId = "ffffffff-1111-2222-3333-444444444444";
  createApproval({ agentRole: "planner-researcher", tool: "SafeBash", path: "/notrepo/jobid-test/d.txt", jobId });
  const pending = getPendingApprovals();
  const found = pending.find((p) => p.jobId === jobId);
  check("4. getPendingApprovals 결과에 jobId 포함", found !== undefined, `pending count=${pending.length}`);
}

console.log(`\n=== ${pass}/${pass + fail} PASS, ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);
