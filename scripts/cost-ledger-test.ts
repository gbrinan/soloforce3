// 비용 원장 신뢰 등급 테스트 — fixture 는 라이브 cost-log.jsonl 실측 행이다.
//   원장은 고치지 않는다(append-only, 과거 행 소급 수정은 날조). 읽을 때 등급을 붙여
//   집계가 부풀려진 과거 행을 측정값과 섞지 않게 한다.
import { classifyCostRow, summarizeCosts, COST_METHOD_CUTOFF } from "../src/server/cost-ledger.js";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`[PASS] ${name}`); pass++; }
  else { console.log(`[FAIL] ${name}${detail ? " — " + detail : ""}`); fail++; }
}
const near = (a: number, b: number, eps = 1e-4) => Math.abs(a - b) < eps;

// 패치 80 이전: CLI 세션 누적값이 그대로 기록돼 haiku 1회가 $8.07로 찍힌 행
const legacyInflated = {
  timestamp: "2026-10-02T04:16:24.819Z", agentId: "genie", costUsd: 8.07, inputTokens: 10, outputTokens: 1154,
  cacheReadTokens: 48770, cacheCreateTokens: 11308, model: "claude-haiku-4-5", source: "scheduler:state-change",
};
// 패치 80 이후: 비재개 세션 CLI 보고값
const measured = {
  timestamp: "2026-10-03T00:00:40.935Z", agentId: "book-keeper", costUsd: 0.3247954, costMethod: "cli",
  inputTokens: 6, outputTokens: 262, cacheReadTokens: 145797, cacheCreateTokens: 73251, model: "claude-sonnet-5",
};
const estimated = {
  timestamp: "2026-10-04T01:00:00.000Z", agentId: "dev-pm", costUsd: 1.2, costMethod: "tokens",
  inputTokens: 100, outputTokens: 1000, cacheReadTokens: 10000, cacheCreateTokens: 1000, model: "claude-opus-5",
};
// codex(구독제) — 토큰은 있으나 달러는 모른다. $0을 "무료"로 집계하면 과소계상이다.
const codexQa = {
  timestamp: "2026-10-05T02:00:00.000Z", agentId: "qa", costUsd: 0, inputTokens: 52000, outputTokens: 3100,
  cacheReadTokens: 40000, cacheCreateTokens: 0, model: "gpt-5.6-sol",
};
// 앱 경로: 산정 방식 기록 없음
const appRow = { timestamp: "2026-10-05T03:00:00.000Z", agentId: "app:diary", costUsd: 0.02, inputTokens: 500, outputTokens: 200, cacheReadTokens: 0, cacheCreateTokens: 0 };

check("컷오프는 패치 80 첫 기록 시각", COST_METHOD_CUTOFF === "2026-10-02T04:47:17.484Z");
check("cli → measured", classifyCostRow(measured) === "measured");
check("session-delta → measured", classifyCostRow({ ...measured, costMethod: "session-delta" }) === "measured");
check("tokens → estimated", classifyCostRow(estimated) === "estimated");
check("컷오프 이전·방식 없음 → legacy", classifyCostRow(legacyInflated) === "legacy");
check("비 claude 모델 $0 → unpriced", classifyCostRow(codexQa) === "unpriced");
check("명시적 unpriced 유지", classifyCostRow({ ...codexQa, costMethod: "unpriced" }) === "unpriced");
check("컷오프 이후·방식 없음 → unrecorded", classifyCostRow(appRow) === "unrecorded");

const s = summarizeCosts([legacyInflated, measured, estimated, codexQa, appRow]);
check("신뢰 합계 = measured + estimated (legacy 로그값 제외)", near(s.trustedUsd, 0.3247954 + 1.2), String(s.trustedUsd));
check("legacy 로그값은 따로 보존", near(s.byTrust.legacy.loggedUsd, 8.07));
// 토큰 재산정: 10×1 + 1154×5 + 48770×0.1 + 11308×2 = 33,273 → $0.0333 (로그값 $8.07의 약 1/240)
check("legacy 토큰 재산정 추정치", near(s.byTrust.legacy.tokenEstimateUsd, 0.033273), String(s.byTrust.legacy.tokenEstimateUsd));
check("unpriced 행 수와 토큰 보존", s.byTrust.unpriced.rows === 1 && s.byTrust.unpriced.tokens === 52000 + 3100 + 40000);
check("에이전트별 신뢰 합계", near(s.byAgent["book-keeper"].trustedUsd, 0.3247954) && s.byAgent["genie"].trustedUsd === 0);

const windowed = summarizeCosts([legacyInflated, measured], { since: "2026-10-03T00:00:00.000Z" });
check("기간 필터", windowed.byTrust.legacy.rows === 0 && windowed.byTrust.measured.rows === 1);

const empty = summarizeCosts([]);
check("빈 원장 → 0, 예외 없음", empty.trustedUsd === 0 && empty.rows === 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
