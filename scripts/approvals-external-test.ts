// 승인 저장소의 external 규칙 통합 테스트 (G16) — 실제 approvals.ts·external-actions.ts를 임시 MYCREW_HOME에서 돌린다.
//   npx tsx scripts/approvals-external-test.ts
// 텔레그램·디스코드 토큰을 지워 외부 알림이 나가지 않게 한다.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MYCREW_HOME = mkdtempSync(join(tmpdir(), "sf-approvals-"));
for (const k of Object.keys(process.env)) if (/^(TELEGRAM|DISCORD)_/.test(k)) delete process.env[k];

const ap = await import("../src/server/approvals.js");
const { requestExternalAction } = await import("../src/server/external-actions.js");

let n = 0;
const test = (name: string, fn: () => void): void => { fn(); n++; console.log(`PASS ${name}`); };
const ext = (path: string) => ap.createApproval({ agentRole: "genie", tool: "External:partner-send", path, external: true, previewHash: `h:${path}` });

test("external 요청은 /tmp 경로여도 자동 허용되지 않는다", () => {
  assert.equal(ext("/tmp/x").status, "pending_chat");
  assert.equal(ap.createApproval({ agentRole: "genie", tool: "SafeRead", path: "/tmp/y" }).status, "allowed", "일반 요청의 기존 규칙은 그대로");
});

test("지니 의견은 부재중이어도 external 허용으로 적용되지 않는다", () => {
  ap.setOwnerAway(true, { manual: true });
  const r = ext("partner-send:a");
  ap.resolveApproval(r.id, true, "genie", "괜찮아 보임");
  assert.equal(ap.getApprovalStatus(r.id)?.status, "pending_chat");
  ap.setOwnerAway(false, { manual: true });
});

test("자동 규칙 확정도 external 허용에는 적용되지 않는다", () => {
  const r = ext("partner-send:b");
  ap.autoResolveApproval(r.id, true, "auto_rule_free_notify", "무비용 알림");
  assert.equal(ap.getApprovalStatus(r.id)?.status, "pending_chat");
});

test("거부는 지니도 할 수 있다(안전한 방향)", () => {
  const r = ext("partner-send:c");
  ap.resolveApproval(r.id, false, "genie");
  // 재석 중 지니 거부 의견은 바로 적용되지 않고 기록된다 — 기존 동작과 같다. 부재중이면 적용된다.
  ap.setOwnerAway(true, { manual: true });
  const r2 = ext("partner-send:c2");
  ap.resolveApproval(r2.id, false, "genie");
  assert.equal(ap.getApprovalStatus(r2.id)?.status, "denied");
  ap.setOwnerAway(false, { manual: true });
});

test("사람 승인은 적용되고, 승인은 한 번만 쓸 수 있다", () => {
  const r = ext("partner-send:d");
  ap.resolveApproval(r.id, true, "user");
  assert.equal(ap.getApprovalStatus(r.id)?.status, "allowed");
  assert.equal(ap.getApprovalStatus(r.id)?.decisionSource, "user");
  assert.equal(ap.consumeExternalApproval(r.id), true);
  assert.equal(ap.consumeExternalApproval(r.id), false);
});

test("반복 이력은 동의가 아니다 — 같은 경로를 승인받은 뒤에도 새 요청은 대기", () => {
  const r = ext("partner-send:e");
  ap.resolveApproval(r.id, true, "user");
  assert.equal(ext("partner-send:e").status, "pending_chat");
});

test("같은 내용의 대기 중 요청은 같은 승인 카드에 합류", () => {
  const action = { kind: "partner-send" as const, target: "p1", body: "안녕하세요", attachments: [], meta: { messageType: "request" } };
  const a = requestExternalAction(action, { agentRole: "genie" });
  const b = requestExternalAction(action, { agentRole: "genie" });
  assert.equal(a.status, "pending_approval");
  assert.equal(a.approvalId, b.approvalId);
  const c = requestExternalAction({ ...action, body: "안녕하세요!" }, { agentRole: "genie" });
  assert.notEqual(c.approvalId, a.approvalId, "내용이 다르면 다른 카드");
});

console.log(`approvals-external: ${n} passed, 0 failed`);
process.exit(0);
