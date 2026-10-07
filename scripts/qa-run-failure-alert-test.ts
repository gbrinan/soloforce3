// QA 잡 실행 실패가 조용히 묻히지 않는지 검증(2026-09-27).
// 재현 근거: 2026-09-19~26 QA 23건이 codex 인증 실패로 끝났는데 알림 0건이었다.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  classifyQaRunFailure, shouldAlertQaRunFailure, recordQaRunOutcome, __resetQaRunFailureState,
} from "../src/server/qa-run-failure.js";

// 실제 실패 로그(축약)
const authLogs = [
  "[mrgerm] (codex) 작업 시작: [역할 지시서]",
  "[ERROR] [mrgerm] (codex) 작업 실패: codex exited 1: 2026-09-19T00:01:17Z ERROR codex_login::auth::manager: Failed to refresh token: 401 Unauthorized: { \"error\": { \"message\": \"Your refresh token has already been used to generate a new access token. Please try signing in again.\" } }",
];
const silentLogs = [
  "[mrgerm] (codex) 작업 시작: [역할 지시서]",
  "[진행] 새 턴 시작",
  "[ERROR] [mrgerm] (codex) 작업 실패: codex exited 1: (no stderr) (cwd: /home/anan/.local/share/soloforce2/releases/x)",
];
const formatLogs = ["[mrgerm] (codex) 작업 완료", "[분류] outputs_missing — exit 0 but 보고 형식 누락", "[결과] QA_READY"];

const a = classifyQaRunFailure(authLogs);
assert.equal(a.cause, "auth");
assert.equal(a.adapter, "codex");
assert.match(a.todo, /^조치/);
assert.match(a.where, /^환경/);

const s = classifyQaRunFailure(silentLogs);
assert.equal(s.cause, "silent-exit");
assert.match(s.todo, /^확인/);
assert.ok(s.evidence.includes("no stderr"));

const f = classifyQaRunFailure(formatLogs);
assert.equal(f.cause, "report-format");
assert.equal(f.countsTowardStreak, false, "보고 형식 누락은 실행 불가 연속 집계에서 빠져야 한다");

// 알림 주기: 2회째 첫 알림, 이후 7·12·17…
assert.deepEqual([1, 2, 3, 6, 7, 12].map(shouldAlertQaRunFailure), [false, true, false, false, true, true]);

// 23연속 실패 시나리오 → 알림은 2·7·12·17·22회째 5번, 그 뒤 성공하면 초기화
__resetQaRunFailureState();
let alerts = 0; let firstAlert = "";
for (let i = 1; i <= 23; i++) {
  const r = recordQaRunOutcome("failed", i < 4 ? authLogs : silentLogs, `작업 ${i}`);
  if (r?.alert) { alerts++; firstAlert ||= r.alert; }
}
assert.equal(alerts, 5);
assert.match(firstAlert, /연속 2회/);
assert.match(firstAlert, /아난이 할 일: 조치/);
assert.match(firstAlert, /문제 위치: 환경/);
assert.match(firstAlert, /작업 2/);
assert.equal(recordQaRunOutcome("completed", [], "ok"), null);
assert.equal(recordQaRunOutcome("failed", silentLogs, "재발 1")?.alert ?? null, null, "성공 후엔 1회째부터 다시 센다");

// 배선: handleQaJobComplete가 completed가 아닌 QA를 조용히 버리지 않고 recordQaRunOutcome에 넘기는지 소스 대조
const judge = readFileSync("src/server/qa-auto-judge.ts", "utf-8");
const fn = judge.slice(judge.indexOf("export function handleQaJobComplete"));
const hook = fn.indexOf("recordQaRunOutcome(");
const guard = fn.indexOf('if (job.status !== "completed") return;');
assert.ok(hook > 0, "handleQaJobComplete에 recordQaRunOutcome 호출이 없다");
assert.ok(guard < 0 || hook < guard, "failed QA를 무시하는 return이 기록보다 먼저 있다");

console.log("qa run failure alert: PASS");
