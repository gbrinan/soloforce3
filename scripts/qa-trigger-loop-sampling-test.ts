// 루프 정기 작업의 자동 QA 를 주 1회 표본으로 제한하는 회귀 테스트(2026-09-26).
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { decideQa, LOOP_POLICY_MARKER } from "../src/server/qa-trigger-policy.js";

const now = "2026-09-26T12:00:00.000Z";
const dayAgo = "2026-09-25T12:00:00.000Z";
const loopRequest = `**${LOOP_POLICY_MARKER} 결제·구매 금지. 외부 발신·전송은 명시된 대상에 한해서만.**\n물류 DB 조회 후 요약`;

// 루프 작업 · 코드 변경 0 · 최근 표본 있음 → QA 생략 (예전엔 external-send 로 매번 발동)
const skipped = decideQa({ jobScopedCodeChanges: 0, agentId: "spf-logistics", request: loopRequest, lastSampleAtIso: dayAgo, nowIso: now });
assert.equal(skipped.run, false, `루프 작업이 아직 매번 QA 된다: ${skipped.reason}`);

// 루프 작업 · 한 번도 표본 없음 → 표본 QA 1회
const sampled = decideQa({ jobScopedCodeChanges: 0, agentId: "spf-logistics", request: loopRequest, lastSampleAtIso: null, nowIso: now });
assert.equal(sampled.run, true);
assert.equal(sampled.isSample, true, "루프 작업의 첫 표본이 표본으로 기록되지 않는다");

// 루프 작업이라도 코드를 바꿨으면 전수 QA 유지
const coded = decideQa({ jobScopedCodeChanges: 2, agentId: "spf-logistics", request: loopRequest, lastSampleAtIso: dayAgo, nowIso: now });
assert.equal(coded.run, true);
assert.match(coded.reason, /code-change/);

// 루프가 아닌 발신 에이전트 작업은 기존 원칙대로 전수 QA
const adhoc = decideQa({ jobScopedCodeChanges: 0, agentId: "spf-sales", request: "고객사에 견적 메일 발송", lastSampleAtIso: dayAgo, nowIso: now });
assert.equal(adhoc.run, true);
assert.match(adhoc.reason, /external-send/);

// 러너 정책 문구와 표식이 어긋나면 이 면제가 조용히 꺼진다 — 소스를 직접 대조
const runner = readFileSync("src/server/loops/runner.ts", "utf-8");
assert.ok(runner.includes(LOOP_POLICY_MARKER), "runner.ts 정책 문구에서 LOOP_POLICY_MARKER 가 사라졌다");

console.log("qa trigger loop sampling: PASS");
process.exit(0);
