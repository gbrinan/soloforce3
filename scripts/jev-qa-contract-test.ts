// Jev QA 경로의 운영 계약 회귀 테스트(0단계 보정, 2026-09-26).
// 계약: 전송 전 마스킹·축소 / 버전 고정·불일치 가드 / 비용 원장 기록 (jev-decisions/docs/data-handling.md·operations.md)
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { maskSensitive, redactHeadTail } from "../src/server/jev/redact.js";
import {
  selectQaReview, resolveJevModel, PINNED_JEV_MODEL, JEV_INPUT_USD_PER_TOKEN,
  JEV_REQUEST_MAX_CHARS, JEV_REPORT_MAX_CHARS,
} from "../src/server/qa-review-plan.js";
import type { JevQaClient, JevQaContext } from "../src/server/qa-jev.js";

// 1. 마스킹
const sample = [
  "연락처 010-1234-5678, 메일 hong.gildong@example.co.kr",
  "주민번호 900101-1234567, 카드 4111 1111 1111 1111, 계좌 110-123-456789",
  "키 sk-abcdefghijklmnopqrstuvwxyz0123, 링크 https://drive.example.com/file/d/abc?token=secret123",
  "주문번호 1234 5678 9012 3456 은 카드가 아님",
].join("\n");
const m = maskSensitive(sample);
for (const leaked of ["010-1234-5678", "hong.gildong@", "900101-1234567", "4111 1111 1111 1111", "110-123-456789", "sk-abcdefghij", "token=secret123"]) {
  assert.ok(!m.text.includes(leaked), `가려지지 않음: ${leaked}`);
}
assert.ok(m.text.includes("1234 5678 9012 3456"), "Luhn 불통과 번호까지 카드로 가렸다(과잉 마스킹)");
assert.equal(m.counts.phone, 1); assert.equal(m.counts.email, 1); assert.equal(m.counts.rrn, 1);
assert.equal(m.counts.card, 1); assert.equal(m.counts.account, 1); assert.equal(m.counts.secret, 1); assert.equal(m.counts.url, 1);

// 2. 앞뒤 축소
const ht = redactHeadTail("가".repeat(10000) + "결론:통과", 2000);
assert.ok(ht.text.length <= 2000, "보고서 축소 상한 초과");
assert.ok(ht.text.endsWith("결론:통과"), "보고서 끝(결론)이 잘렸다");

// 3. 버전 고정
assert.equal(resolveJevModel("jev-latest"), PINNED_JEV_MODEL);
assert.equal(resolveJevModel("jev-preview"), PINNED_JEV_MODEL);
assert.equal(resolveJevModel(undefined), PINNED_JEV_MODEL);
assert.equal(resolveJevModel("jev-1.14.0"), "jev-1.14.0");

const config = { enabled: true, apiKey: "test-key", model: PINNED_JEV_MODEL, timeoutMs: 3000, minConfidence: 0.85 };
let sent: JevQaContext | undefined;
const client = (model: string): JevQaClient => async (ctx) => {
  sent = ctx;
  return { profile: "document", confidence: 0.95, model, inputTokens: 1500, outputTokens: 3 };
};

// 4. 큰 입력도 폴백하지 않고, 가리고 줄여서 보낸다
const bigRequest = "보고서 작성. 담당자 010-9999-8888 로 연락. " + "나".repeat(5000);
const bigReport = "메일 a.b@corp.com 확인. " + "다".repeat(20000);
const r = await selectQaReview({ request: bigRequest, report: bigReport, codeChanges: 0 }, config, client(PINNED_JEV_MODEL));
assert.equal(r.reason, "jev-selected", `큰 입력이 폴백됐다: ${r.reason}`);
assert.ok(sent && sent.request.length <= JEV_REQUEST_MAX_CHARS && sent.report.length <= JEV_REPORT_MAX_CHARS, "전송 상한 초과");
assert.ok(sent && !sent.request.includes("010-9999-8888") && !sent.report.includes("a.b@corp.com"), "원문 개인정보가 전송됐다");
assert.ok(Math.abs((r.costUsd ?? 0) - 1500 * JEV_INPUT_USD_PER_TOKEN) < 1e-12, "비용 계산 오류");
assert.equal(r.redactions?.phone, 1); assert.equal(r.redactions?.email, 1);

// 5. 응답 모델 불일치 → 답을 쓰지 않되 비용은 남김
const mm = await selectQaReview({ request: "x", report: "y", codeChanges: 0 }, config, client("jev-1.99.0"));
assert.equal(mm.reason, "model-mismatch"); assert.equal(mm.profile, "code"); assert.ok((mm.costUsd ?? 0) > 0);

// 6. 호출부가 비용을 원장에 쓰는지(소스 대조)
const jobs = readFileSync("src/server/jobs.ts", "utf-8");
assert.ok(jobs.includes('"jev:qa-profile"'), "jobs.ts가 Jev 비용을 cost-log에 쓰지 않는다");

console.log("jev qa contract: PASS");
process.exit(0);
