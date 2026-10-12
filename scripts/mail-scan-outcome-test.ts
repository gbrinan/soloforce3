// 메일 스캔 결과 봉투 통합 테스트 (G20) — 실제 runMailScan을 가짜 claude 호출·가짜 알림으로 돌린다.
//   npx tsx scripts/mail-scan-outcome-test.ts
// 확인 대상: 실패는 사장님에게 «확인 못 함»으로 알려지고, 결과 없음은 조용하며, 일부 누락은 partial로 밝힌다.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MYCREW_HOME = mkdtempSync(join(tmpdir(), "sf-mailscan-"));
const { runMailScan } = await import("../src/server/mail-scan.js");

type Reply = { ok: boolean; text?: string; error?: string };
function fakeClaude(replies: Reply[], delayMs = 0) {
  let i = 0;
  return (async () => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return replies[Math.min(i++, replies.length - 1)];
  }) as never;
}
function recorder() {
  const sent: string[] = [];
  return { sent, announce: async (t: string) => { sent.push(t); return { telegram: true, discord: false }; } };
}
const thread = (id: string) => ({ threadId: id, sender: "김담당 <kim@client-co.kr>", subject: "교육 문의드립니다", snippet: "다음 달 교육 가능하실까요", date: "2026-10-13", labelIds: ["INBOX"] });

let n = 0;
const test = async (name: string, fn: () => Promise<void>): Promise<void> => { await fn(); n++; console.log(`PASS ${name}`); };

await test("수집 실패 → failed, 사장님에게 «확인 못 함» 알림", async () => {
  const r = recorder();
  const out = await runMailScan({ runClaude: fakeClaude([{ ok: false, error: "OAuth 만료" }]), announce: r.announce });
  assert.equal(out.status, "failed");
  assert.match(out.error ?? "", /수집: OAuth 만료/);
  assert.equal(r.sent.length, 1);
  assert.match(r.sent[0], /확인하지 못했습니다\. 메일이 없다는 뜻이 아닙니다/);
});

await test("수집 결과가 깨졌으면 failed", async () => {
  const r = recorder();
  const out = await runMailScan({ runClaude: fakeClaude([{ ok: true, text: "죄송합니다, 메일을 찾을 수 없습니다" }]), announce: r.announce });
  assert.equal(out.status, "failed");
  assert.equal(r.sent.length, 1);
});

await test("메일 0건 → empty, 알림 없음(조용한 게 정상)", async () => {
  const r = recorder();
  const out = await runMailScan({ runClaude: fakeClaude([{ ok: true, text: "[]" }]), announce: r.announce });
  assert.equal(out.status, "empty");
  assert.equal(out.data?.scanned, 0);
  assert.equal(r.sent.length, 0);
});

await test("분류 실패 → failed, 알림", async () => {
  const r = recorder();
  const out = await runMailScan({
    runClaude: fakeClaude([{ ok: true, text: JSON.stringify([thread("t1")]) }, { ok: false, error: "timeout" }]),
    announce: r.announce,
  });
  assert.equal(out.status, "failed");
  assert.match(out.error ?? "", /분류: timeout/);
  assert.match(r.sent[0], /분류 단계/);
});

await test("일부 분류 누락 → partial, 다이제스트에 누락 건수", async () => {
  const r = recorder();
  const out = await runMailScan({
    runClaude: fakeClaude([
      { ok: true, text: JSON.stringify([thread("p1"), thread("p2")]) },
      { ok: true, text: JSON.stringify([{ threadId: "p1", category: "교육의뢰", org: "고객사", summary: "11월 교육", urgency: "normal" }]) },
    ]),
    announce: r.announce,
  });
  assert.equal(out.status, "partial");
  assert.equal(out.data?.classified, 1);
  assert.equal(r.sent.length, 1);
  assert.match(r.sent[0], /분류 못 한 메일 1건/);
  assert.deepEqual(out.data?.relayed, { telegram: true, discord: false }, "전달 여부는 알림이 돌려준 실제 값");
});

await test("전부 분류 → ok", async () => {
  const r = recorder();
  const out = await runMailScan({
    runClaude: fakeClaude([
      { ok: true, text: JSON.stringify([thread("q1")]) },
      { ok: true, text: JSON.stringify([{ threadId: "q1", category: "교육의뢰", org: "고객사", summary: "교육", urgency: "high" }]) },
    ]),
    announce: r.announce,
  });
  assert.equal(out.status, "ok");
  assert.ok(!r.sent[0].includes("분류 못 한"));
});

await test("이미 실행 중이면 skipped(실패와 구분)", async () => {
  const slow = runMailScan({ runClaude: fakeClaude([{ ok: true, text: "[]" }], 300), announce: recorder().announce });
  const second = await runMailScan({ runClaude: fakeClaude([{ ok: true, text: "[]" }]), announce: recorder().announce });
  assert.equal(second.status, "skipped");
  assert.equal((await slow).status, "empty");
});

console.log(`mail-scan-outcome: ${n} passed, 0 failed`);
process.exit(0);
