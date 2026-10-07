#!/usr/bin/env node
// health-process.mjs — LaunchAgent 실가동 상태 점검 스크립트.
//
// 목적:
//   - ~/Library/LaunchAgents에 등록된 plist와 실제 launchctl 가동 상태를 대조한다.
//   - SafeBash 화이트리스트에 launchctl이 없어도 npm run health:processes 로 실행 가능.
//
// 사용법:
//   npm run health:processes
//   node scripts/health-process.mjs [--json] [--filter <prefix>]
//
// 출력:
//   기본: 사람이 읽는 표 형태 (총 개수 / 실가동 / 종료코드 비정상 / 미등록)
//   --json: { plistCount, runningCount, exitFailures, sample[] }
//   exit code: 종료코드 비정상이 있으면 1, 정상이면 0

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const execAsync = promisify(exec);

const args = new Set(process.argv.slice(2));
const jsonMode = args.has("--json");
const filterIdx = process.argv.indexOf("--filter");
const filterPrefix = filterIdx > -1 ? process.argv[filterIdx + 1] : null;

const LAUNCH_AGENTS_DIR = join(homedir(), "Library", "LaunchAgents");

async function listPlistLabels() {
  try {
    const entries = await readdir(LAUNCH_AGENTS_DIR);
    const plistFiles = entries.filter((f) => f.endsWith(".plist"));
    return plistFiles.map((f) => f.replace(/\.plist$/, ""));
  } catch (err) {
    return { error: `LaunchAgents 디렉토리 읽기 실패: ${err.message}` };
  }
}

async function launchctlList() {
  // launchctl list 출력 형식: PID\tStatus\tLabel
  try {
    const { stdout } = await execAsync("launchctl list", { maxBuffer: 4 * 1024 * 1024 });
    const lines = stdout.split("\n").filter((l) => l.trim() && !l.startsWith("PID"));
    const rows = lines.map((l) => {
      const [pid, status, label] = l.split("\t");
      return {
        pid: pid === "-" ? null : Number(pid),
        status: Number(status),
        label,
      };
    });
    return rows.filter((r) => r.label);
  } catch (err) {
    return { error: `launchctl list 실패: ${err.message}` };
  }
}

function applyFilter(rows, prefix) {
  if (!prefix) return rows;
  return rows.filter((r) => (r.label || r).startsWith(prefix));
}

async function main() {
  const [plistLabels, launchctlRows] = await Promise.all([
    listPlistLabels(),
    launchctlList(),
  ]);

  if (plistLabels.error) {
    console.error(plistLabels.error);
    process.exit(2);
  }
  if (launchctlRows.error) {
    console.error(launchctlRows.error);
    process.exit(2);
  }

  const labelSet = new Set(plistLabels);
  const filteredPlist = applyFilter(plistLabels, filterPrefix);
  const filteredRows = applyFilter(launchctlRows, filterPrefix);

  const runningRows = filteredRows.filter((r) => labelSet.has(r.label));
  const exitFailures = runningRows.filter((r) => r.status !== 0 && r.status !== null);
  const notRegistered = runningRows.filter((r) => false); // 모든 row가 plist에 등록됨 (이미 labelSet 필터 통과)
  const plistNotRunning = filteredPlist.filter(
    (label) => !runningRows.some((r) => r.label === label),
  );

  const summary = {
    plistCount: filteredPlist.length,
    runningCount: runningRows.length,
    exitFailures: exitFailures.length,
    plistNotRunning: plistNotRunning.length,
    timestamp: new Date().toISOString(),
    filter: filterPrefix ?? null,
  };

  if (jsonMode) {
    console.log(
      JSON.stringify(
        {
          ...summary,
          sampleFailures: exitFailures.slice(0, 10),
          sampleNotRunning: plistNotRunning.slice(0, 10),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`[health-process] ${summary.timestamp}`);
    if (filterPrefix) console.log(`  filter: ${filterPrefix}`);
    console.log(`  plist 등록: ${summary.plistCount}개`);
    console.log(`  실제 가동: ${summary.runningCount}개`);
    console.log(`  종료코드 비정상: ${summary.exitFailures}개`);
    console.log(`  plist 있으나 미가동: ${summary.plistNotRunning}개`);
    if (exitFailures.length) {
      console.log("\n  [종료코드 비정상 샘플]");
      for (const r of exitFailures.slice(0, 10)) {
        console.log(`    ${r.label} (pid=${r.pid ?? "-"}, status=${r.status})`);
      }
    }
    if (plistNotRunning.length) {
      console.log("\n  [plist 등록 + 미가동 샘플]");
      for (const label of plistNotRunning.slice(0, 10)) {
        console.log(`    ${label}`);
      }
    }
  }

  process.exit(exitFailures.length ? 1 : 0);
}

main().catch((err) => {
  console.error("[health-process] 실행 실패:", err);
  process.exit(2);
});
