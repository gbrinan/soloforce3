// 내부 발화 모델 라우팅 회귀 테스트.
// 배경(2026-09-24 실측): 3일간 genie 비용 $25.41 중 $18.44(73%)가 라우팅 표에 없는
// 내부 source 3종(chat:auto-continuation · owner-away:returned · todo-monitor:backlog)에서
// 기본 모델(opus)로 새고 있었다. 사장님 직접 대화(source=user)는 $0.83뿐이었다.
import { strict as assert } from "node:assert";
import { modelForInternalSource } from "../src/server/internal-source-tier.js";
import { resolveTier } from "../src/server/model-tiers.js";

const standard = resolveTier("standard");

// 새로 등재한 자율 발화 3종은 standard 티어로 가야 한다.
for (const source of ["chat:auto-continuation", "owner-away:returned", "todo-monitor:backlog"]) {
  assert.equal(
    modelForInternalSource(true, source),
    standard,
    `${source} 가 기본 모델(프론티어)로 새고 있다`,
  );
}

// 사장님 직접 대화는 건드리지 않는다 — 기본 모델 유지(undefined).
assert.equal(modelForInternalSource(false, "user"), undefined, "사용자 대화의 모델이 바뀌었다");
assert.equal(modelForInternalSource(false, undefined), undefined, "사용자 대화의 모델이 바뀌었다");

// 기존 저비용 라우팅은 그대로 유지돼야 한다.
assert.equal(modelForInternalSource(true, "job:notify:ok"), "claude-haiku-4-5", "기존 cheap 라우팅이 깨졌다");
assert.equal(modelForInternalSource(true, "job:notify:fail"), standard, "기존 standard 라우팅이 깨졌다");

// 기본 모델 유지는 명시한 source(job:report — 사용자가 그대로 읽는 문장)만.
assert.equal(modelForInternalSource(true, "job:report"), undefined, "job:report 가 기본 모델에서 내려갔다");

// 2026-10-13: 표에 없는 내부 source 는 기본 모델(opus)로 새지 않고 standard 로 간다(경고 1회).
assert.equal(modelForInternalSource(true, "new-feature:unregistered"), standard, "미등재 내부 source 가 기본 모델로 샌다");
assert.equal(modelForInternalSource(true, undefined), standard, "source 없는 내부 호출이 기본 모델로 샌다");
assert.equal(modelForInternalSource(true, ""), standard, "빈 source 내부 호출이 기본 모델로 샌다");

console.log("internal source model routing: PASS");
process.exit(0);
