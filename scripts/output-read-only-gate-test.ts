// 읽기 전용 참조 경로가 «산출물»로 승격되지 않는다는 것을 고정한다.
//
// 재발 방지 대상 (2026-10-05, QA 0f41d034 → 핫픽스 938bbcb0):
//   jobs.ts의 extractOutputFiles는 라벨 없이 로그 본문에서 `history/…` 경로를 긁는다.
//   동시 실행 잡의 로그가 섞여 들어오면서 `[진행] 파일 읽는 중: history/outputs/repo-scout/
//   ai-release/2026-10-01.json` (순수 읽기)이 spf-comms 잡의 outputFiles 유일 항목이 됐고,
//   QA «판정 대상 고정»이 4일 전 종결호를 피검체로 지목해 FAIL을 냈다.
//   ⇒ 잡 시작 이후 수정된 파일만 산출물로 인정해야 한다.
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataRoot = mkdtempSync(join(tmpdir(), "mycrew-home-"));
process.env.MYCREW_HOME = dataRoot; // ★ import 전에 설정해야 config.ts가 읽는다

const outDir = join(dataRoot, "history", "outputs", "repo-scout", "ai-release");
mkdirSync(outDir, { recursive: true });

const startedAt = "2026-10-04T23:30:58.646Z"; // 실사고의 spf-comms 잡 startedAt
const startedMs = new Date(startedAt).getTime();

// 읽기만 한 구본 — mtime이 잡 시작보다 4일 빠르다 (실사고 값)
const stale = "history/outputs/repo-scout/ai-release/2026-10-01.json";
writeFileSync(join(dataRoot, stale), "{}\n");
const staleSec = new Date("2026-09-30T23:31:50.436Z").getTime() / 1000;
utimesSync(join(dataRoot, stale), staleSec, staleSec);

// 이 잡이 실제로 쓴 파일 — mtime이 잡 시작 이후
const fresh = "history/outputs/repo-scout/ai-release/2026-10-05.json";
writeFileSync(join(dataRoot, fresh), "{}\n");
const freshSec = (startedMs + 90_000) / 1000;
utimesSync(join(dataRoot, fresh), freshSec, freshSec);

const { isArtifactModifiedSince } = await import("../src/server/utils/path-normalize.js");

let failed = 0;
function check(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " — " + detail}`);
  if (!ok) failed++;
}

// T1 (실사고 재현): 잡 시작 전 mtime인 읽기 전용 구본은 산출물이 아니다
check(
  "T1 잡 시작 이전 mtime 경로는 산출물에서 제외",
  isArtifactModifiedSince(stale, dataRoot, startedAt) === false,
  "stale 파일이 통과했다",
);

// T2 (음성 대조): 잡이 실제로 쓴 파일은 그대로 유지된다 — 게이트가 전부 지워버리는 게 아님
check(
  "T2 잡 시작 이후 mtime 경로는 유지",
  isArtifactModifiedSince(fresh, dataRoot, startedAt) === true,
  "정상 산출물이 걸러졌다",
);

// T3 (관할 분리): 미존재 경로는 이 게이트가 판정하지 않는다(통과).
//   유령 차단은 formatArtifactListForHandoff 관할 — 관할이 겹치면 한쪽 수정이 다른 쪽을 무력화한다.
check(
  "T3 미존재 경로는 이 게이트의 관할이 아님(통과)",
  isArtifactModifiedSince("history/outputs/repo-scout/없는파일.json", dataRoot, startedAt) === true,
  "미존재 경로를 이 게이트가 삼켰다",
);

// T4 (기준 부재): startedAt이 없으면 비교 기준이 없으므로 기존 동작 보존(통과)
check(
  "T4 startedAt 부재 시 기존 동작 보존",
  isArtifactModifiedSince(stale, dataRoot, undefined) === true,
  "기준 없이 산출물을 지웠다",
);

// T5 (손상 입력): 깨진 타임스탬프로 산출물을 지우지 않는다
check(
  "T5 손상된 startedAt으로 산출물을 지우지 않음",
  isArtifactModifiedSince(fresh, dataRoot, "not-a-date") === true,
  "NaN 기준으로 산출물이 걸러졌다",
);

// T6 (축 격리): 게이트가 '경로 문자열'이 아니라 '실측 mtime'으로 판정하는지 확인.
//   같은 경로의 mtime만 잡 시작 이후로 올리면 판정이 뒤집혀야 한다.
utimesSync(join(dataRoot, stale), freshSec, freshSec);
check(
  "T6 같은 경로라도 mtime이 올라가면 산출물로 인정(실측 기반 판정)",
  isArtifactModifiedSince(stale, dataRoot, startedAt) === true,
  "mtime을 올렸는데도 제외됐다 — 경로 문자열로 판정하고 있다",
);

rmSync(dataRoot, { recursive: true, force: true });

if (failed > 0) {
  console.error(`${failed}건 실패`);
  process.exit(1);
}
console.log("output-read-only-gate-test: 6건 통과");
