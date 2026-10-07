// SafeFS 화이트리스트 매처 회귀 테스트
// 끝 **, 중간 **, 중간 *, 단일 파일, base 외부 거부 + dev-pm 회귀
import { configurePathMatcher, matchesAllowList } from "../src/mcp/path-matcher.js";
import { realpathSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

const cwd = realpathSync(process.cwd());

// 존재하지 않는 가짜 base. Windows에서는 "/fake/..." 가 드라이브 없는 경로라
// path-matcher 안의 pathResolve가 "C:/fake/..." 로 만들고, 테스트가 넘기는 abs에는
// 드라이브가 없어 영원히 어긋난다(제품 버그가 아니라 픽스처가 POSIX 전용이었던 것).
// 양쪽을 같은 방식으로 해석해 플랫폼과 무관하게 만든다.
const FAKE_BASE = pathResolve("/fake/memory/dir").replace(/\\/g, "/");

interface Case {
  name: string;
  paths: string[];
  abs: string;
  expected: boolean;
  bases?: string[];  // override BASES — 미지정 시 [cwd]
}

const DEV_PM_WRITE_PATHS = [
  "/src/**", "/dist/**", "/config/**", "/prompts/**", "/projects/**",
  "/scripts/**", "/history/outputs/dev-pm/**", "/history/agents/dev-pm/**",
  "/history/agents.json", "/tsconfig.json", "/package.json",
  "/package-lock.json", "/.mcp.json", "/.gitignore", "/tmp/**",
];

// safefs-server.ts SENSITIVE_PATHS와 동기 — 변경 시 양쪽 같이 수정.
const SENSITIVE_PATHS_V2 = [
  "/history/genie-config.json",
  "/history/genie/wiki/role-directive.md",
  "/history/agents/**/wiki/role-directive.md",
  "/history/agents.json",
  "/.env",
];

const cases: Case[] = [
  { name: "끝 ** 매칭",                paths: ["/src/**"],                                       abs: `${cwd}/src/foo/bar.ts`,                                            expected: true },
  { name: "중간 ** 매칭 (B안 핵심)",   paths: ["/history/agents/**/wiki/**"],                    abs: `${cwd}/history/agents/planner-researcher/wiki/role-directive.md`, expected: true },
  { name: "중간 * 매칭",               paths: ["/history/agents/*/wiki/role-directive.md"],      abs: `${cwd}/history/agents/dev-pm/wiki/role-directive.md`,             expected: true },
  { name: "단일 파일 매칭",            paths: ["/history/agents.json"],                          abs: `${cwd}/history/agents.json`,                                       expected: true },
  { name: "단일 파일 비매칭",          paths: ["/history/agents.json"],                          abs: `${cwd}/history/agents/dev-pm/wiki/x.md`,                           expected: false },
  { name: "base 외부 거부",            paths: ["/src/**"],                                       abs: "/etc/passwd",                                                      expected: false },
  { name: "회귀: dev-pm allow",        paths: DEV_PM_WRITE_PATHS,                                abs: `${cwd}/src/foo.ts`,                                                expected: true },
  { name: "회귀: dev-pm deny",         paths: DEV_PM_WRITE_PATHS,                                abs: `${cwd}/history/agents/qa/foo.md`,                                  expected: false },
  { name: "단일 /** 특별 케이스",      paths: ["/**"],                                           abs: `${cwd}/anywhere.md`,                                               expected: true },
  { name: "디렉토리 self-match",       paths: ["/src/**"],                                       abs: `${cwd}/src`,                                                       expected: true },
  // SENSITIVE_PATHS 매칭 정확도 (safefs-server.ts isSensitivePath 가드용)
  { name: "SENSITIVE 정확 매칭",        paths: ["/history/genie-config.json"],                    abs: `${cwd}/history/genie-config.json`,                                 expected: true },
  { name: "SENSITIVE 비매칭 (history)", paths: ["/history/genie-config.json"],                    abs: `${cwd}/history/agents.json`,                                       expected: false },
  { name: "SENSITIVE 비매칭 (src)",     paths: ["/history/genie-config.json"],                    abs: `${cwd}/src/foo.ts`,                                                expected: false },
  { name: "SENSITIVE 비매칭 (genie/)",  paths: ["/history/genie-config.json"],                    abs: `${cwd}/history/genie/foo.md`,                                      expected: false },
  { name: "SENSITIVE 사칭 차단 (.bak)", paths: ["/history/genie-config.json"],                    abs: `${cwd}/history/genie-config.json.bak`,                             expected: false },
  // 확장된 SENSITIVE_PATHS (agents.json + role-directive 글롭)
  { name: "agents.json 매칭 (sensitive 추가됨, A안 Phase 1-C)",  paths: SENSITIVE_PATHS_V2,           abs: `${cwd}/history/agents.json`,                                       expected: true  },
  { name: "직원 role-directive 매칭 (dev-pm) — 2026-04-28 가드 추가",  paths: SENSITIVE_PATHS_V2,            abs: `${cwd}/history/agents/dev-pm/wiki/role-directive.md`,              expected: true  },
  { name: "직원 role-directive 매칭 (qa) — 2026-04-28 가드 추가",      paths: SENSITIVE_PATHS_V2,            abs: `${cwd}/history/agents/qa/wiki/role-directive.md`,                  expected: true  },
  { name: "마이크루 self role-directive 매칭",         paths: SENSITIVE_PATHS_V2,                          abs: `${cwd}/history/genie/wiki/role-directive.md`,                      expected: true  },
  { name: "SENSITIVE 비매칭 (다른 wiki 페이지)", paths: SENSITIVE_PATHS_V2,                          abs: `${cwd}/history/agents/dev-pm/wiki/index.md`,                       expected: false },
  // /.env 추가 (토큰 셋업 1단계)
  { name: "SENSITIVE .env 매칭",         paths: SENSITIVE_PATHS_V2,                                abs: `${cwd}/.env`,                                                      expected: true  },
  { name: "SENSITIVE 사칭 차단 (.env.example)", paths: SENSITIVE_PATHS_V2,                          abs: `${cwd}/.env.example`,                                              expected: false },
  { name: "SENSITIVE 비매칭 (sub/.env)", paths: SENSITIVE_PATHS_V2,                                abs: `${cwd}/sub/.env`,                                                  expected: false },
  // WRITE_BASES vs READ_BASES 격리 — EXTRA_BASE 안의 path가 writePaths 매칭 통과하지 않음
  { name: "WRITE_BASES 격리 (EXTRA_BASE만 있음, write 시뮬)", paths: ["/src/**"], abs: `${FAKE_BASE}/src/foo.ts`, expected: false, bases: [cwd] },
  { name: "READ_BASES 통합 (EXTRA_BASE 포함, read 시뮬)",     paths: ["/src/**"], abs: `${FAKE_BASE}/src/foo.ts`, expected: true,  bases: [cwd, FAKE_BASE] },
  // attachments 권한 (2026-04-28 C안 — 직원/마이크루 모두 history/attachments/** 쓰기 허용)
  { name: "attachments 매칭 (qa writePaths)",          paths: ["/history/outputs/qa/**", "/history/agents/qa/**", "/history/attachments/**"],                                       abs: `${cwd}/history/attachments/qa-test.png`,                  expected: true },
  { name: "attachments 매칭 (dev-pm 날짜폴더 prefix)", paths: ["/src/**", "/history/agents/dev-pm/**", "/history/attachments/**"],                                                  abs: `${cwd}/history/attachments/2026-04-28/dev-pm-cafe.png`,   expected: true },
  { name: "attachments 매칭 (planner-researcher)",     paths: ["/history/outputs/planner-researcher/**", "/history/agents/planner-researcher/**", "/history/attachments/**"],       abs: `${cwd}/history/attachments/foo.txt`,                       expected: true },
  { name: "attachments 매칭 (genie)",                  paths: ["/history/agents.json", "/history/genie/**", "/history/agents/**/wiki/**", "/history/genie-config.json", "/history/attachments/**"], abs: `${cwd}/history/attachments/bar.png`,             expected: true },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const baseList = c.bases ?? [cwd];
  configurePathMatcher({ bases: baseList, projectsDir: "" });
  const result = matchesAllowList(c.abs, c.paths);
  const ok = result === c.expected;
  if (ok) pass++; else fail++;
  const absShort = c.abs.replace(cwd, "<cwd>");
  console.log(`[${ok ? "PASS" : "FAIL"}] ${c.name} | abs=${absShort} | got=${result} expected=${c.expected}`);
}
console.log(`\n=== ${pass}/${pass + fail} PASS, ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);
