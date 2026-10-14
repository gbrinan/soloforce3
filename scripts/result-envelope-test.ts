// 결과 봉투 단위 테스트 (G19) — src/shared/result-envelope.ts, 루프 스텝 봉투(runner.ts).
//   npx tsx scripts/result-envelope-test.ts
import assert from "node:assert/strict";
import { combineStatus, envelope, unavailableFooter } from "../src/shared/result-envelope.js";
import { loopStepEnvelopes } from "../src/server/loops/runner.js";

let n = 0;
const test = (name: string, fn: () => void): void => { fn(); n++; console.log(`PASS ${name}`); };

test("봉투는 상태·출처·시각을 갖고, 빈 값은 싣지 않는다", () => {
  const e = envelope("empty", "gmail", { asOf: new Date("2026-10-13T00:00:00Z") });
  assert.deepEqual(e, { status: "empty", source: "gmail", asOf: "2026-10-13T00:00:00.000Z" });
  assert.equal(envelope("failed", "gmail", { error: "timeout" }).error, "timeout");
});

test("상태 합치기 — 하나라도 실패가 섞이면 partial", () => {
  assert.equal(combineStatus(["ok", "failed"]), "partial");
  assert.equal(combineStatus(["empty", "partial"]), "partial");
  assert.equal(combineStatus(["failed", "failed"]), "failed");
  assert.equal(combineStatus(["ok", "empty"]), "ok");
  assert.equal(combineStatus(["empty", "empty"]), "empty");
  assert.equal(combineStatus(["skipped", "ok"]), "ok", "건너뛴 출처는 판정에서 뺀다");
  assert.equal(combineStatus(["skipped"]), "skipped");
});

test("실패한 출처는 «0건»이 아니라 «확인 못 함»으로 꼬리말에 남는다", () => {
  const f = unavailableFooter([
    { status: "ok", source: "notion" },
    { status: "failed", source: "gmail", error: "수집: timeout" },
    { status: "partial", source: "calendar" },
  ]);
  assert.ok(f);
  assert.match(f!, /gmail\(확인 못 함: 수집: timeout\)/);
  assert.match(f!, /calendar\(일부만\)/);
  assert.match(f!, /없다는 뜻이 아닙니다/);
  assert.ok(!f!.includes("notion"));
});
test("모두 정상이면 꼬리말 없음", () => {
  assert.equal(unavailableFooter([{ status: "ok", source: "a" }, { status: "empty", source: "b" }]), null);
});

test("루프 스텝 — 잡 상태로 ok·partial·failed를 가른다", () => {
  const envs = loopStepEnvelopes([
    { stepId: "fetch", jobStatuses: ["completed"] },
    { stepId: "retry", jobStatuses: ["failed", "completed"] },
    { stepId: "send", jobStatuses: ["outputs_missing"] },
    { stepId: "skip", jobStatuses: [] },
  ]);
  assert.deepEqual(envs.map((e) => [e.source, e.status]), [
    ["스텝 fetch", "ok"], ["스텝 retry", "partial"], ["스텝 send", "failed"],
  ]);
  assert.match(unavailableFooter(envs)!, /스텝 send\(확인 못 함: outputs_missing\)/);
});

console.log(`result-envelope: ${n} passed, 0 failed`);
process.exit(0);
