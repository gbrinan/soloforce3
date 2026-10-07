// QA 모델 티어: 위험한 검증은 gpt-5.6-sol, 가벼운 검증은 gpt-5.6-terra (codex QA일 때만) — 2026-09-28 아난 결정
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { pickQaModel, QA_MODEL_HEAVY, QA_MODEL_LIGHT } from "../src/server/qa-trigger-policy.js";

assert.equal(QA_MODEL_HEAVY, "gpt-5.6-sol");
assert.equal(QA_MODEL_LIGHT, "gpt-5.6-terra");
const codex = "codex-cli";
// 무거운 쪽
assert.equal(pickQaModel({ adapter: codex, reason: "code-change(3개 파일)", profile: "general" }), QA_MODEL_HEAVY);
assert.equal(pickQaModel({ adapter: codex, reason: "code-change-undetermined(안전측 수행)", profile: "document" }), QA_MODEL_HEAVY);
assert.equal(pickQaModel({ adapter: codex, reason: "external-send-suspected(되돌릴 수 없음)", profile: "general" }), QA_MODEL_HEAVY);
assert.equal(pickQaModel({ adapter: codex, reason: "forceQa(호출자 명시)", profile: "general" }), QA_MODEL_HEAVY);
assert.equal(pickQaModel({ adapter: codex, reason: "sample(첫 표본 · 주기 7일)", profile: "code" }), QA_MODEL_HEAVY);
assert.equal(pickQaModel({ adapter: codex, reason: "sample(첫 표본 · 주기 7일)", profile: "data" }), QA_MODEL_HEAVY);
// 가벼운 쪽
assert.equal(pickQaModel({ adapter: codex, reason: "sample(마지막 표본 8.0일 전 · 주기 7일)", profile: "general" }), QA_MODEL_LIGHT);
assert.equal(pickQaModel({ adapter: codex, reason: "sample(첫 표본 · 주기 7일)", profile: "document" }), QA_MODEL_LIGHT);
// codex가 아니면 덮어쓰지 않음(모델 이름 체계가 다름)
assert.equal(pickQaModel({ adapter: "claude-code", reason: "code-change(1개 파일)", profile: "code" }), undefined);
assert.equal(pickQaModel({ adapter: undefined, reason: "sample", profile: "general" }), undefined);
// 배선: QA 잡 생성 직후 model을 지정하는지 소스 대조
const jobs = readFileSync("src/server/jobs.ts", "utf-8");
const at = jobs.indexOf("qaJob.qaTriggered = true;");
assert.ok(at > 0 && /pickQaModel\(/.test(jobs.slice(at - 200, at + 600)), "QA 잡 생성 직후 pickQaModel 배선이 없다");
console.log("qa model tier: PASS");
