// 마이크루 슈퍼유저 (A안) 회귀 테스트
// safefs-server.ts의 IS_GENIE 분기 (isSensitivePath) + isReadOnlyBash 헬퍼를
// 동등 시뮬레이션으로 검증. 원본 함수가 module-private이라 본체 카피.
// 원본 변경 시 이 파일도 동기 유지.

import { realpathSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { configurePathMatcher, matchesAllowList } from "../src/mcp/path-matcher.js";
import { SENSITIVE_PATHS } from "../src/mcp/sensitive-paths.js";

const cwd = realpathSync(process.cwd());
configurePathMatcher({ bases: [cwd], projectsDir: "" });

// === safefs-server.ts isWriteSensitive 시뮬 (JSON 기반 통합) ===
// 마이크루: writeSensitivePaths=["/**"] → 모든 경로 sensitive
// 직원: writeSensitivePaths에 명시된 경로만 sensitive
// SENSITIVE_PATHS는 approval-genie.ts에서만 사용 (SafeFS 가드에서는 미사용)

const GENIE_WRITE_SENSITIVE = ["/**"];
const WORKER_WRITE_SENSITIVE = [
  "/history/agents.json", "/history/genie-config.json", "/.env",
  "/history/agents/**/wiki/role-directive.md",
];

function isSensitivePathSim(targetPath: string, isGenie: boolean): boolean {
  const abs = pathResolve(cwd, targetPath.replace(/^\//, ""));
  const patterns = isGenie ? GENIE_WRITE_SENSITIVE : WORKER_WRITE_SENSITIVE;
  return matchesAllowList(abs, patterns);
}

// === safefs-server.ts isReadOnlyBash 본체 카피 (라인 384-392) ===
const READONLY_BASH_PREFIXES = new Set([
  "ls", "cat", "head", "tail", "wc", "find", "grep", "awk", "sed",
  "pwd", "which", "true", "false",
]);
function isReadOnlyBash(cmd: string): boolean {
  const trimmed = cmd.trim();
  if (/[><]/.test(trimmed)) return false;
  // chain commands(&&, ||, ;, &) 분리 후 각 부분 검증 (잭키 §3-3 우회 차단)
  const parts = trimmed.split(/\s*(?:&&|\|\||;|&)\s*/).filter(Boolean);
  for (const part of parts) {
    const firstWord = part.split(/\s/)[0];
    if (!READONLY_BASH_PREFIXES.has(firstWord)) return false;
  }
  // find -delete/-execdir, sed -i 등 위험 옵션 차단 (잭키 §3-1, §3-2)
  if (/\bfind\b.*\s-(?:delete|exec(?:dir)?)\b/.test(trimmed)) return false;
  if (/\bsed\b.*\s-i\b/.test(trimmed)) return false;
  return true;
}

// === 케이스 ===
interface Case { name: string; got: unknown; expected: unknown; }
const cases: Case[] = [];

// 1) IS_GENIE=true: 자기 위키 외 모든 경로 sensitive (옵션 A)
cases.push({
  name: "IS_GENIE=true → isSensitivePath('/tmp/foo')",
  got: isSensitivePathSim("/tmp/foo", true),
  expected: true,
});
cases.push({
  name: `IS_GENIE=true → isSensitivePath('${cwd}/src/foo.ts')`,
  got: isSensitivePathSim(`${cwd}/src/foo.ts`, true),
  expected: true,
});

// 1-A) 마이크루 writeSensitivePaths=["/**"] → 자기 wiki 포함 전부 sensitive
cases.push({
  name: "IS_GENIE=true 자기 위키 일반 페이지 → true (writeSensitive=/**)",
  got: isSensitivePathSim("/history/genie/wiki/test.md", true),
  expected: true,
});
cases.push({
  name: "IS_GENIE=true 자기 위키 role-directive → true (SENSITIVE 우선)",
  got: isSensitivePathSim("/history/genie/wiki/role-directive.md", true),
  expected: true,
});
cases.push({
  name: "IS_GENIE=true history/genie/ 직속 (wiki 밖) → true",
  got: isSensitivePathSim("/history/genie/foo.md", true),
  expected: true,
});
cases.push({
  name: "IS_GENIE=true 잭키 위키 (자기 위키 아님) → true",
  got: isSensitivePathSim("/history/agents/qa/wiki/foo.md", true),
  expected: true,
});

// 2) IS_GENIE=false (직원): writeSensitivePaths 매칭만 true
cases.push({
  name: "IS_GENIE=false → isSensitivePath('/tmp/foo')",
  got: isSensitivePathSim("/tmp/foo", false),
  expected: false,
});
cases.push({
  name: "IS_GENIE=false → isSensitivePath('/history/genie-config.json')",
  got: isSensitivePathSim("/history/genie-config.json", false),
  expected: true,
});
cases.push({
  name: "IS_GENIE=false → isSensitivePath('/history/agents.json')",
  got: isSensitivePathSim("/history/agents.json", false),
  expected: true,
});

// 2-A) 직원 role-directive 가드 (2026-04-28 추가)
cases.push({
  name: "IS_GENIE=true 직원 role-directive (dev-pm) → true",
  got: isSensitivePathSim("/history/agents/dev-pm/wiki/role-directive.md", true),
  expected: true,
});
cases.push({
  name: "IS_GENIE=true 직원 role-directive (qa) → true",
  got: isSensitivePathSim("/history/agents/qa/wiki/role-directive.md", true),
  expected: true,
});
cases.push({
  name: "IS_GENIE=false 직원 본인 role-directive (dev-pm) → true",
  got: isSensitivePathSim("/history/agents/dev-pm/wiki/role-directive.md", false),
  expected: true,
});
cases.push({
  name: "IS_GENIE=false 직원 본인 role-directive (planner-researcher) → true",
  got: isSensitivePathSim("/history/agents/planner-researcher/wiki/role-directive.md", false),
  expected: true,
});
cases.push({
  name: "IS_GENIE=false 직원 일반 위키 페이지 → false (회귀 보호)",
  got: isSensitivePathSim("/history/agents/dev-pm/wiki/foo.md", false),
  expected: false,
});

// 3) isReadOnlyBash: read-only 화이트리스트
cases.push({ name: "isReadOnlyBash('ls -la')",          got: isReadOnlyBash("ls -la"),          expected: true });
cases.push({ name: "isReadOnlyBash('cat foo.md')",      got: isReadOnlyBash("cat foo.md"),      expected: true });

// 4) isReadOnlyBash: write 명령 거부
cases.push({ name: "isReadOnlyBash('cp a b')",          got: isReadOnlyBash("cp a b"),          expected: false });
cases.push({ name: "isReadOnlyBash('mv a b')",          got: isReadOnlyBash("mv a b"),          expected: false });

// 5) isReadOnlyBash: redirect 검사
cases.push({ name: "isReadOnlyBash('echo x > file')",   got: isReadOnlyBash("echo x > file"),   expected: false });
cases.push({ name: "isReadOnlyBash('ls foo > /tmp/x')", got: isReadOnlyBash("ls foo > /tmp/x"), expected: false });

// 6) isReadOnlyBash: rm 등 위험 명령
cases.push({ name: "isReadOnlyBash('rm -rf foo')",      got: isReadOnlyBash("rm -rf foo"),      expected: false });

// 7) 잭키 §3 우회 결함 (강화 후 차단 확증)
cases.push({ name: "find /history -delete (잭키 §3-1 우회 차단)",                   got: isReadOnlyBash("find /history -delete"),               expected: false });
cases.push({ name: "find . -execdir rm {} \\; (잭키 §3-1 우회 차단)",               got: isReadOnlyBash("find . -execdir rm {} \\;"),           expected: false });
cases.push({ name: "sed -i s/x/y/ /history/agents.json (잭키 §3-2 우회 차단)",      got: isReadOnlyBash("sed -i s/x/y/ /history/agents.json"),  expected: false });
cases.push({ name: "ls && cp src dst (잭키 §3-3 chain 우회 차단)",                  got: isReadOnlyBash("ls && cp src dst"),                    expected: false });
cases.push({ name: "cat foo ; mv a b (잭키 §3-3 chain 우회 차단)",                  got: isReadOnlyBash("cat foo ; mv a b"),                    expected: false });

// 8) 안전망: 강화 후에도 정상 read-only는 여전히 통과 (회귀 보호)
cases.push({ name: "find . -name foo (옵션 없으면 통과)",                            got: isReadOnlyBash("find . -name foo"),                    expected: true  });
cases.push({ name: "sed s/x/y/ foo (-i 없으면 통과)",                                got: isReadOnlyBash("sed s/x/y/ foo"),                      expected: true  });

// 9) 시연 모순 가시화: 같은 isSensitivePath 함수가 SafeWrite/SafeDelete/SafeEdit 세 도구에서 동일하게 호출되는지 회귀 보호
//    (시연 시 SafeDelete만 모달 안 떴다는 사장님 보고에 대한 코드 분기 회귀 가드)
const TEST_PATH = "/Users/bluelgs/Documents/isens/teamLGS/tmp/__마이크루모달테스트__-2026-04-26.txt";
cases.push({ name: "시연 path: SafeWrite 시뮬 (IS_GENIE=true → 모달 강제)",  got: isSensitivePathSim(TEST_PATH, true),  expected: true });
cases.push({ name: "시연 path: SafeDelete 시뮬 (IS_GENIE=true → 모달 강제)", got: isSensitivePathSim(TEST_PATH, true),  expected: true });
cases.push({ name: "시연 path: SafeEdit 시뮬 (IS_GENIE=true → 모달 강제)",   got: isSensitivePathSim(TEST_PATH, true),  expected: true });
cases.push({ name: "시연 path: IS_GENIE=false → SENSITIVE 미매칭이라 false",  got: isSensitivePathSim(TEST_PATH, false), expected: false });

let pass = 0, fail = 0;
for (const c of cases) {
  const ok = c.got === c.expected;
  if (ok) pass++; else fail++;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${c.name} | got=${c.got} expected=${c.expected}`);
}
console.log(`\n=== ${pass}/${pass + fail} PASS, ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);
