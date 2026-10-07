// 마이크루 승인 의견 파싱·프롬프트 + SENSITIVE skip + memory-dir 단위 테스트
import { buildOpinionPrompt, parseOpinion } from "../src/server/approval-genie.js";
import { buildSensitiveMatcher } from "../src/mcp/sensitive-paths.js";
import { computeMemoryDir } from "../src/mcp/memory-dir.js";
import { homedir } from "node:os";
import { join, resolve as pathResolve } from "node:path";

interface ParseCase {
  name: string;
  output: string;
  expected: { allow: boolean; reason: string } | null;
}

const parseCases: ParseCase[] = [
  { name: "ALLOW 정상",            output: "ALLOW: dev-pm 셀프 권한 변경 합당",   expected: { allow: true,  reason: "dev-pm 셀프 권한 변경 합당" } },
  { name: "DENY 정상",             output: "DENY: 계정 정보 접근 위험",            expected: { allow: false, reason: "계정 정보 접근 위험" } },
  { name: "소문자 case-insensitive", output: "allow: ok",                         expected: { allow: true,  reason: "ok" } },
  { name: "공백 관용",              output: "  ALLOW :  reason  ",                expected: { allow: true,  reason: "reason" } },
  { name: "50자 초과 truncate",     output: "ALLOW: " + "a".repeat(100),          expected: { allow: true,  reason: "a".repeat(50) } },
  { name: "형식 불일치 → null",     output: "잘 모르겠습니다",                     expected: null },
  { name: "빈 응답 → null",         output: "",                                    expected: null },
  { name: "여러 줄 (첫 줄만)",      output: "ALLOW: 첫 이유\nDENY: 두번째",        expected: { allow: true,  reason: "첫 이유" } },
];

let pass = 0, fail = 0;
for (const c of parseCases) {
  const got = parseOpinion(c.output);
  const ok = JSON.stringify(got) === JSON.stringify(c.expected);
  if (ok) pass++; else fail++;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${c.name} | got=${JSON.stringify(got)} expected=${JSON.stringify(c.expected)}`);
}

// buildOpinionPrompt 키워드 포함 검증
const fakeReq = {
  id: "abc12345",
  agentRole: "dev-pm",
  tool: "SafeWrite",
  path: "/etc/foo",
  createdAt: Date.now(),
  status: "pending_chat" as const,
};
const prompt = buildOpinionPrompt(fakeReq);
const requiredKeywords = ["dev-pm", "SafeWrite", "/etc/foo", "ALLOW", "DENY"];
const missing = requiredKeywords.filter(kw => !prompt.includes(kw));
if (missing.length === 0) {
  pass++;
  console.log(`[PASS] buildOpinionPrompt 키워드 포함 (${requiredKeywords.join(", ")})`);
} else {
  fail++;
  console.log(`[FAIL] buildOpinionPrompt 누락 키워드: ${missing.join(", ")}`);
}

// SENSITIVE skip 검증 — req.path가 SENSITIVE_PATHS에 매칭되면 매처가 true 반환.
// approval-genie.spawnGenieOpinion이 isSensitive 결과 true 시 즉시 return.
const cwd = process.cwd();
const isSensitive = buildSensitiveMatcher(cwd);

interface SensCase { name: string; reqPath: string; expected: boolean; }
const sensCases: SensCase[] = [
  { name: "마이크루 self role-directive — 사장님 결정 영역", reqPath: "history/genie/wiki/role-directive.md",           expected: true  },
  { name: "agents.json — SENSITIVE (A안 Phase 1-C, 권한 SoT는 사장님 결정 강제)", reqPath: "history/agents.json", expected: true },
  { name: "직원 role-directive (qa) — SENSITIVE skip (2026-04-28 가드)",    reqPath: "history/agents/qa/wiki/role-directive.md",         expected: true  },
  { name: "직원 role-directive (dev-pm) — SENSITIVE skip (2026-04-28 가드)", reqPath: "history/agents/dev-pm/wiki/role-directive.md",     expected: true  },
  { name: "SENSITIVE skip — .env",                       reqPath: ".env",                                              expected: true  },
  { name: "일반 경로 — 마이크루 의견 진행",                    reqPath: "src/foo.ts",                                       expected: false },
];

for (const c of sensCases) {
  const abs = pathResolve(cwd, c.reqPath);
  const got = isSensitive(abs);
  const ok = got === c.expected;
  if (ok) pass++; else fail++;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${c.name} | got=${got} expected=${c.expected}`);
}

// computeMemoryDir 정확성 — cwd / 를 - 로 치환한 hash 사용
{
  const got = computeMemoryDir("/Users/foo/bar");
  const expected = join(homedir(), ".claude", "projects", "-Users-foo-bar");
  const ok = got === expected;
  if (ok) pass++; else fail++;
  console.log(`[${ok ? "PASS" : "FAIL"}] computeMemoryDir 정확성 | got=${got} expected=${expected}`);
}

console.log(`\n=== ${pass}/${pass + fail} PASS, ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);
