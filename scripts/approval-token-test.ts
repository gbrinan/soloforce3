// /api/approvals/:id/resolve 게이트 토큰 검증 단위 테스트
import { verifyApprovalToken } from "../src/server/approval-auth.js";

interface Case {
  name: string;
  envToken: string | null;
  headers: Record<string, string | undefined>;
  expected: boolean;
}

const cases: Case[] = [
  { name: "토큰 미설정 → 거부 (fail-secure)",       envToken: null,        headers: {},                                          expected: false },
  { name: "X-Approval-Token 일치 → 통과",         envToken: "secret123", headers: { "x-approval-token": "secret123" },         expected: true  },
  { name: "헤더 누락 → 401",                       envToken: "secret123", headers: {},                                          expected: false },
  { name: "다른 토큰 → 401",                       envToken: "secret123", headers: { "x-approval-token": "wrong" },             expected: false },
  { name: "Authorization Bearer 일치 → 통과",      envToken: "secret123", headers: { "authorization": "Bearer secret123" },     expected: true  },
  { name: "Authorization Bearer 다름 → 401",       envToken: "secret123", headers: { "authorization": "Bearer wrong" },         expected: false },
];

let pass = 0, fail = 0;
for (const c of cases) {
  if (c.envToken === null) delete process.env.APPROVAL_RESOLVE_TOKEN;
  else process.env.APPROVAL_RESOLVE_TOKEN = c.envToken;
  const result = verifyApprovalToken(c.headers);
  const ok = result === c.expected;
  if (ok) pass++; else fail++;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${c.name} | got=${result} expected=${c.expected}`);
}
console.log(`\n=== ${pass}/${pass + fail} PASS, ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);
