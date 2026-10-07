// 산출물 경로 분리 가드 회귀 테스트
// safefs-server.ts(isSelfPattern/isUniversalPattern, SELF_*/CWD_* 분류)를
// 동등 시뮬레이션으로 검증. 원본 함수가 export되지 않으므로 본체 카피.
// 원본 변경 시 이 파일도 동기 유지 필요.
//
// [2026-08-10] jobs.ts의 extractOutputPaths/checkOutputsMissing 원본은 호출부 0건
// 데드코드로 확인돼 삭제됐다(승인 후 처리). 아래 사본은 삭제 시점의 동결 스냅샷이며,
// 확장자 절단 결함(접두 확장자 절단 — .mdx→.md, .jsonl→.json)을 그대로 안고 있다.
// 이 사본을 근거로 원본을 복원하지 마라. 산출물 경로 추출의 정본은
// src/server/utils/artifact-ext.ts 의 extractOutputPathsFromText 다.

import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve as pathResolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SELF_DIR = pathResolve(__dirname, "..");

// === safefs-server.ts 패턴 분기 (라인 32-44 카피) ===
const SELF_PATH_PREFIXES = ["history/outputs/", "history/agents/"];
function isSelfPattern(p: string): boolean {
  const n = p.replace(/^\//, "");
  return SELF_PATH_PREFIXES.some((pre) => n.startsWith(pre));
}
function isUniversalPattern(p: string): boolean {
  const n = p.replace(/^\//, "");
  return n === "**" || n === "*";
}
const classifySelf = (paths: string[]) =>
  paths.filter((p) => isSelfPattern(p) || isUniversalPattern(p));
const classifyCwd = (paths: string[]) =>
  paths.filter((p) => !isSelfPattern(p));

// === jobs.ts 산출물 검증 (라인 1626-1659 카피, _job 의존성 제거) ===
function extractOutputPaths(text: string): string[] {
  const paths = new Set<string>();
  for (const m of text.matchAll(/(\/[\w./\-가-힣 ]+?\/history\/outputs\/[\w./\-가-힣 ]+?\.md)/g)) {
    paths.add(m[1]);
  }
  for (const m of text.matchAll(/(?:^|[\s`'"`(])(history\/outputs\/[\w./\-가-힣 ]+?\.md)/g)) {
    paths.add(m[1]);
  }
  return [...paths];
}
function checkOutputsMissing(text: string): string[] {
  const paths = extractOutputPaths(text);
  if (paths.length === 0) return [];
  const missing: string[] = [];
  for (const p of paths) {
    if (p.startsWith("/")) {
      if (!p.startsWith(SELF_DIR + "/")) { missing.push(p); continue; }
      if (!existsSync(p)) missing.push(p);
    } else {
      if (!existsSync(join(SELF_DIR, p))) missing.push(p);
    }
  }
  return missing;
}

// === 케이스 ===
interface Case { name: string; got: unknown; expected: unknown; }
const cases: Case[] = [];

// 1) isSelfPattern
cases.push({ name: "isSelfPattern: history/outputs/dev-pm/...",   got: isSelfPattern("history/outputs/dev-pm/foo.md"), expected: true });
cases.push({ name: "isSelfPattern: /history/agents/qa/...",       got: isSelfPattern("/history/agents/qa/wiki/x.md"),  expected: true });
cases.push({ name: "isSelfPattern: /src/**",                       got: isSelfPattern("/src/**"),                       expected: false });
cases.push({ name: "isSelfPattern: /tmp/**",                       got: isSelfPattern("/tmp/**"),                       expected: false });
cases.push({ name: "isSelfPattern: /**",                           got: isSelfPattern("/**"),                           expected: false });

// 2) isUniversalPattern
cases.push({ name: "isUniversalPattern: /**",                      got: isUniversalPattern("/**"),                      expected: true });
cases.push({ name: "isUniversalPattern: /*",                       got: isUniversalPattern("/*"),                       expected: true });
cases.push({ name: "isUniversalPattern: /src/**",                  got: isUniversalPattern("/src/**"),                  expected: false });

// 3) 분류 결과 — 데이브 (코드+산출물 혼재)
const DEV_PM = ["/src/**", "/tmp/**", "/history/outputs/dev-pm/**", "/history/agents/dev-pm/**", "/package.json"];
cases.push({
  name: "데이브 SELF_WRITE 분류",
  got: JSON.stringify(classifySelf(DEV_PM).sort()),
  expected: JSON.stringify(["/history/agents/dev-pm/**", "/history/outputs/dev-pm/**"].sort()),
});
cases.push({
  name: "데이브 CWD_WRITE 분류",
  got: JSON.stringify(classifyCwd(DEV_PM).sort()),
  expected: JSON.stringify(["/src/**", "/tmp/**", "/package.json"].sort()),
});

// 4) 분류 결과 — 리사 (산출물 전용)
const RESEARCHER = ["/history/outputs/planner-researcher/**", "/history/agents/planner-researcher/**"];
cases.push({
  name: "리사 SELF_WRITE 분류",
  got: JSON.stringify(classifySelf(RESEARCHER).sort()),
  expected: JSON.stringify(RESEARCHER.slice().sort()),
});
cases.push({
  name: "리사 CWD_WRITE = [] (산출물만이라 cwd 군 비어있음 = 외부 프로젝트 cwd에서는 쓰기 0건)",
  got: JSON.stringify(classifyCwd(RESEARCHER)),
  expected: "[]",
});

// 5) 분류 결과 — 잭키 readPaths=["/**"] universal 양쪽 포함 (회귀 보호)
const QA = ["/**"];
cases.push({ name: "잭키 SELF_READ 분류 (universal)",   got: JSON.stringify(classifySelf(QA)), expected: '["/**"]' });
cases.push({ name: "잭키 CWD_READ 분류 (universal)",    got: JSON.stringify(classifyCwd(QA)),  expected: '["/**"]' });

// 6) checkOutputsMissing
cases.push({
  name: "missing: 본문에 경로 없음 → 0건 (스킵)",
  got: checkOutputsMissing("결과: 작업 완료. 별도 산출물 없음.").length,
  expected: 0,
});
cases.push({
  name: "missing: 상대경로 가짜 .md → 1건",
  got: checkOutputsMissing("저장됨: history/outputs/planner-researcher/없는파일_planner-researcher.md").length,
  expected: 1,
});
cases.push({
  name: "missing: SELF_DIR 외부 절대경로 → 1건 (정책 위반)",
  got: checkOutputsMissing("저장: /Users/bluelgs/Documents/isens/agentTeam/foo/history/outputs/planner-researcher/x_planner-researcher.md").length,
  expected: 1,
});
// 자기 픽스처 생성/정리 — 데이터 디렉터리의 특정 파일 존재에 의존하지 않게 함(픽스처 부패 방지)
const FIXTURE_REL = "history/outputs/qa/__path-routing-test-fixture__.md";
const FIXTURE_ABS = join(SELF_DIR, FIXTURE_REL);
mkdirSync(dirname(FIXTURE_ABS), { recursive: true });
writeFileSync(FIXTURE_ABS, "fixture\n");
let existingFileMissingCount: number;
try {
  existingFileMissingCount = checkOutputsMissing(`결과 산출물: \`${FIXTURE_REL}\``).length;
} finally {
  rmSync(FIXTURE_ABS, { force: true });
}
cases.push({
  name: "missing: 실제 존재 파일 → 0건",
  got: existingFileMissingCount,
  expected: 0,
});

let pass = 0, fail = 0;
for (const c of cases) {
  const ok = c.got === c.expected;
  if (ok) pass++; else fail++;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${c.name} | got=${c.got} expected=${c.expected}`);
}
console.log(`\n=== ${pass}/${pass + fail} PASS, ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);
