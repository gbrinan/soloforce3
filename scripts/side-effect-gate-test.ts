// 외부 발송 승인 계약 테스트 — src/server/side-effect-gate.ts (G14)
//   npx tsx scripts/side-effect-gate-test.ts
import assert from "node:assert/strict";
import {
  canApplyDecision, checkExternalApproval, EXTERNAL_APPROVAL_TTL_MS, formatPreview, previewHash,
  type ApprovalLike, type ExternalAction,
} from "../src/server/side-effect-gate.js";

const base: ExternalAction = {
  kind: "partner-send",
  target: "partner-a",
  body: "견적서 보내드립니다.",
  attachments: [{ filename: "quote.pdf", mimeType: "application/pdf", size: 3, data: "QUJD" }],
  meta: { messageType: "request" },
};
const h = previewHash(base);
const t0 = 1_000_000;
const approved: ApprovalLike = { status: "allowed", decisionSource: "user", createdAt: t0, external: true, previewHash: h };

let n = 0;
const test = (name: string, fn: () => void): void => { fn(); n++; console.log(`PASS ${name}`); };

test("해시는 meta 키 순서와 무관하다", () => {
  const a = { ...base, meta: { b: "2", a: "1" } };
  const b = { ...base, meta: { a: "1", b: "2" } };
  assert.equal(previewHash(a), previewHash(b));
});
test("본문이 바뀌면 해시가 바뀐다", () => assert.notEqual(previewHash({ ...base, body: base.body + " " }), h));
test("대상이 바뀌면 해시가 바뀐다", () => assert.notEqual(previewHash({ ...base, target: "partner-b" }), h));
test("첨부 내용이 바뀌면 해시가 바뀐다", () => {
  assert.notEqual(previewHash({ ...base, attachments: [{ ...base.attachments[0], data: "QUJE" }] }), h);
});
test("첨부가 늘면 해시가 바뀐다(목록 확장 거부)", () => {
  assert.notEqual(previewHash({ ...base, attachments: [...base.attachments, base.attachments[0]] }), h);
});

test("사람 승인 + 같은 해시 + 기한 안 → 통과", () => {
  assert.deepEqual(checkExternalApproval(approved, h, t0 + 1000), { ok: true });
});
test("승인 기록 없음 → no_approval", () => {
  assert.deepEqual(checkExternalApproval(null, h, t0), { ok: false, reason: "no_approval" });
});
test("external 표시 없는 일반 승인은 쓸 수 없다 → no_approval", () => {
  assert.deepEqual(checkExternalApproval({ ...approved, external: false }, h, t0), { ok: false, reason: "no_approval" });
});
test("대기·거부·시간초과 → not_allowed", () => {
  for (const status of ["pending_chat", "denied", "timeout"]) {
    assert.deepEqual(checkExternalApproval({ ...approved, status }, h, t0), { ok: false, reason: "not_allowed" });
  }
});
test("지니·자동 규칙 승인 → not_human", () => {
  for (const decisionSource of ["genie", "auto_rule_repeat", "auto_rule_retry_exhausted", undefined]) {
    assert.deepEqual(checkExternalApproval({ ...approved, decisionSource }, h, t0), { ok: false, reason: "not_human" });
  }
});
test("내용이 바뀐 동작 → hash_mismatch", () => {
  const other = previewHash({ ...base, body: "다른 내용" });
  assert.deepEqual(checkExternalApproval(approved, other, t0), { ok: false, reason: "hash_mismatch" });
});
test("이미 쓴 승인 → already_used", () => {
  assert.deepEqual(checkExternalApproval({ ...approved, consumedAt: t0 + 1 }, h, t0 + 2), { ok: false, reason: "already_used" });
});
test("기한 지난 승인 → expired", () => {
  assert.deepEqual(checkExternalApproval(approved, h, t0 + EXTERNAL_APPROVAL_TTL_MS + 1), { ok: false, reason: "expired" });
});

test("external 허용은 사람만 결정한다", () => {
  assert.equal(canApplyDecision(true, "user", true), true);
  assert.equal(canApplyDecision(true, "genie", true), false);
  assert.equal(canApplyDecision(true, "auto_rule_repeat", true), false);
});
test("external 거부는 누가 해도 적용된다(안전한 방향)", () => {
  assert.equal(canApplyDecision(true, "genie", false), true);
  assert.equal(canApplyDecision(true, "auto_rule_retry_exhausted", false), true);
});
test("일반 승인은 기존 규칙 그대로", () => {
  assert.equal(canApplyDecision(false, "genie", true), true);
  assert.equal(canApplyDecision(undefined, "auto_rule_repeat", true), true);
});

test("미리보기는 건수·대상·첨부·되돌릴 수 없음을 보인다", () => {
  const p = formatPreview(base);
  assert.match(p, /1건 → partner-a/);
  assert.match(p, /quote\.pdf\(3B\)/);
  assert.match(p, /되돌릴 수 없음/);
  assert.match(p, /견적서 보내드립니다/);
});

console.log(`side-effect-gate: ${n} passed, 0 failed`);
process.exit(0);
