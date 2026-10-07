// 자동 회수 단위 시뮬 (옵션 4 baseline diff)
// 시나리오 4건:
//   1. baseline diff: 새 파일 mtime > startedAt → recovered=true
//   2. 위양성 차단: 모든 파일 mtime ≤ startedAt → recovered=false
//   3. baseline 부재 fallback: 부팅 전 작업 + 새 파일 mtime > startedAt → recovered=true
//   4. baseline 동일: 같은 파일 mtime 변동 없음 → recovered=false
import { mkdirSync, writeFileSync, rmSync, existsSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { snapshotOutputsDir, checkOutputsRecovered } from "../src/server/jobs.js";
import { HISTORY_DIR } from "../src/config.js";
import type { Job } from "../src/types.js";

const TEST_AGENT = "__test-recovery";
const TEST_DIR = join(HISTORY_DIR, "outputs", TEST_AGENT);

function setupClean(): void {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
}

function writeFileAt(name: string, mtimeMs: number): string {
  const p = join(TEST_DIR, name);
  writeFileSync(p, "test");
  const t = mtimeMs / 1000;
  utimesSync(p, t, t);
  return p;
}

function makeJob(startedAtMs: number, baseline?: Record<string, number>): Job {
  return {
    id: "test-job-" + Math.random().toString(36).slice(2, 10),
    request: "test",
    priority: "normal",
    status: "running",
    createdAt: new Date(startedAtMs - 1000).toISOString(),
    startedAt: new Date(startedAtMs).toISOString(),
    logs: [],
    outputsBaseline: baseline,
  };
}

let pass = 0;
let fail = 0;
function assert(name: string, got: unknown, expected: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (ok) { console.log(`[PASS] ${name} | got=${JSON.stringify(got)}`); pass++; }
  else { console.error(`[FAIL] ${name} | got=${JSON.stringify(got)} expected=${JSON.stringify(expected)}`); fail++; }
}

const NOW = Date.now();
const startedAt = NOW - 60_000; // 1분 전

// 시나리오 1: baseline diff — 새 파일 mtime > startedAt
setupClean();
writeFileAt("old.md", startedAt - 30_000);   // 작업 시작 전 파일 (baseline에 들어감)
const baseline1 = snapshotOutputsDir(TEST_AGENT);
writeFileAt("new-report.md", startedAt + 30_000); // 작업 중 새 파일
const job1 = makeJob(startedAt, baseline1);
const r1 = checkOutputsRecovered(job1, TEST_AGENT);
assert("S1 baseline diff 신규 파일", { recovered: r1.recovered, paths: r1.paths }, { recovered: true, paths: ["new-report.md"] });

// 시나리오 2: 위양성 차단 — mtime ≤ startedAt
setupClean();
writeFileAt("ancient.md", startedAt - 30_000);
writeFileAt("just-before.md", startedAt - 1000);
const baseline2 = snapshotOutputsDir(TEST_AGENT);
writeFileAt("touched-but-old.md", startedAt - 500); // 작업 시작 전 파일이 baseline 후 추가됨, 그러나 mtime ≤ startedAt
const job2 = makeJob(startedAt, baseline2);
const r2 = checkOutputsRecovered(job2, TEST_AGENT);
assert("S2 위양성 차단 (mtime <= startedAt)", { recovered: r2.recovered }, { recovered: false });

// 시나리오 3: baseline 부재 fallback — 부팅 전 작업
setupClean();
writeFileAt("recovered-after-boot.md", startedAt + 60_000);
const job3 = makeJob(startedAt, undefined); // baseline 없음
const r3 = checkOutputsRecovered(job3, TEST_AGENT);
assert("S3 baseline 부재 fallback", { recovered: r3.recovered, paths: r3.paths }, { recovered: true, paths: ["recovered-after-boot.md"] });

// 시나리오 4: baseline 동일 — 같은 파일 mtime 변동 없음
setupClean();
writeFileAt("stable.md", startedAt - 30_000);
const baseline4 = snapshotOutputsDir(TEST_AGENT);
// 파일 변동 없음 — mtime 그대로
const job4 = makeJob(startedAt, baseline4);
const r4 = checkOutputsRecovered(job4, TEST_AGENT);
assert("S4 baseline 동일 (변동 없음)", { recovered: r4.recovered }, { recovered: false });

// 시나리오 5: baseline 후 동일 파일 mtime 갱신 → recovered=true
setupClean();
writeFileAt("updated.md", startedAt - 30_000);
const baseline5 = snapshotOutputsDir(TEST_AGENT);
writeFileAt("updated.md", startedAt + 30_000); // 같은 파일, mtime 갱신
const job5 = makeJob(startedAt, baseline5);
const r5 = checkOutputsRecovered(job5, TEST_AGENT);
assert("S5 mtime 갱신", { recovered: r5.recovered, paths: r5.paths }, { recovered: true, paths: ["updated.md"] });

// 정리
rmSync(TEST_DIR, { recursive: true, force: true });

console.log(`\n=== ${pass}/${pass + fail} PASS, ${fail} FAIL ===`);
process.exit(fail === 0 ? 0 : 1);
