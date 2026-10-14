// 위임 모델 티어·레인 정의 검사 테스트 (G21) — model-tiers.ts resolveDelegateModel, scripts/lane-check.ts.
//   npx tsx scripts/delegate-tier-test.ts
import assert from "node:assert/strict";
import { resolveDelegateModel, resolveTier } from "../src/server/model-tiers.js";
import { checkLanes } from "./lane-check.js";

let n = 0;
const test = (name: string, fn: () => void): void => { fn(); n++; console.log(`PASS ${name}`); };

test("호출자 티어가 모델을 정한다(모델 ID는 티어 표에서)", () => {
  assert.deepEqual(resolveDelegateModel("cheap"), { model: resolveTier("cheap") });
  assert.deepEqual(resolveDelegateModel("frontier", "claude-sonnet-5"), { model: resolveTier("frontier") }, "호출자 티어가 태스크 고정보다 우선");
});
test("티어가 없으면 루프 스텝이 태스크에 고정한 모델", () => {
  assert.deepEqual(resolveDelegateModel(undefined, "claude-haiku-4-5"), { model: "claude-haiku-4-5" });
  assert.deepEqual(resolveDelegateModel("", "claude-haiku-4-5"), { model: "claude-haiku-4-5" });
});
test("둘 다 없으면 지정하지 않는다(에이전트 정의 모델)", () => {
  assert.deepEqual(resolveDelegateModel(undefined, undefined), {});
  assert.deepEqual(resolveDelegateModel(null, null), {});
});
test("모르는 티어·모델 ID 직접 지정은 거부(기본 모델로 새지 않게)", () => {
  assert.match(resolveDelegateModel("opus").error ?? "", /unknown-tier: "opus"/);
  assert.match(resolveDelegateModel("claude-opus-4-8").error ?? "", /unknown-tier/);
});

test("레인 검사 — model 없는 정의는 FAIL", () => {
  const f = checkLanes([{ id: "x", model: null, source: "t" }, { id: "y", model: "  ", source: "t" }]);
  assert.deepEqual(f.filter((x) => x.level === "FAIL").map((x) => [x.rule, x.id]), [["L1", "x"], ["L1", "y"]]);
});
test("레인 검사 — 티어 이름은 경고 없음, 모델 ID는 WARN", () => {
  assert.deepEqual(checkLanes([{ id: "a", model: "standard", source: "t" }]), []);
  assert.deepEqual(checkLanes([{ id: "b", model: "claude-sonnet-5", source: "t" }]).map((x) => [x.level, x.rule]), [["WARN", "L2"]]);
  assert.deepEqual(checkLanes([{ id: "c", model: "auto", source: "t" }]), [], "auto는 비claude 런타임의 위임");
});
test("레인 검사 — 없는 MCP 서버 FAIL, bypass 에이전트의 approval 서버 WARN", () => {
  const reg = { notion: { mode: "allow" }, supabase: { mode: "approval" } };
  const f = checkLanes([
    { id: "w", model: "standard", permissionLevel: "workspace", mcpServers: ["notion", "supabase", "ghost"], source: "t" },
  ], reg);
  assert.deepEqual(f.map((x) => [x.level, x.rule]).sort(), [["FAIL", "L4"], ["WARN", "L3"], ["WARN", "L5"]].sort());
});
test("레인 검사 — 레지스트리를 안 주면 서버 존재는 판단하지 않는다", () => {
  assert.deepEqual(checkLanes([{ id: "n", model: "cheap", mcpServers: ["ghost"], source: "t" }]), []);
});

console.log(`delegate-tier: ${n} passed, 0 failed`);
process.exit(0);
