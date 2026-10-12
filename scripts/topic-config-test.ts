// 주제 설정 형식 테스트 (T1-G1) — src/shared/topic-config.ts, 예시 파일, 검사기 종료 코드.
//   npx tsx scripts/topic-config-test.ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { parseTopicConfig } from "../src/shared/topic-config.js";

let n = 0;
const test = (name: string, fn: () => void): void => { fn(); n++; console.log(`PASS ${name}`); };
const example = readFileSync("config/topics/example.topic.yaml", "utf-8");
const base = parse(example) as Record<string, any>;
const variant = (patch: (o: Record<string, any>) => void): string => { const o = structuredClone(base); patch(o); return stringify(o); };
const errorsOf = (text: string): string[] => { const r = parseTopicConfig(text); return r.ok ? [] : r.errors; };

test("예시 파일은 형식을 통과한다", () => {
  const r = parseTopicConfig(example);
  assert.ok(r.ok, JSON.stringify(r));
});
test("필수 값이 없으면 거부", () => {
  assert.match(errorsOf(variant((o) => { delete o.knowledgeFile; })).join(), /knowledgeFile/);
  assert.match(errorsOf(variant((o) => { delete o.sinks; })).join(), /sinks/);
});
test("Notion 저장 위치는 data_source UUID", () => {
  assert.match(errorsOf(variant((o) => { o.sinks.news.dataSource = "not-a-uuid"; })).join(), /sinks\.news\.dataSource/);
});
test("저장 위치 종류는 notion·leads-app뿐", () => {
  assert.match(errorsOf(variant((o) => { o.sinks.leads = { kind: "sheet", label: "x" }; })).join(), /sinks\.leads/);
});
test("파일 경로는 history/ 아래 상대 경로만(절대 경로·상위 이동 거부)", () => {
  assert.match(errorsOf(variant((o) => { o.knowledgeFile = "/etc/passwd"; })).join(), /knowledgeFile/);
  assert.match(errorsOf(variant((o) => { o.knowledgeFile = "../secrets.md"; })).join(), /knowledgeFile/);
  assert.match(errorsOf(variant((o) => { o.inputs.kakao.inboxDir = "topics/../../x"; })).join(), /inputs\.kakao\.inboxDir/);
});
test("켠 루프에 필요한 값이 없으면 거부", () => {
  assert.match(errorsOf(variant((o) => { o.loops["logi-watch"] = { enabled: true }; })).join(), /loops\.logi-watch: sinks\.shipments와 logistics/);
  assert.match(errorsOf(variant((o) => { delete o.inputs.mail; })).join(), /loops\.mail-scan: inputs\.mail/);
  assert.match(errorsOf(variant((o) => { o.loops["weekly-news"].enabled = true; delete o.sinks.news; })).join(), /loops\.weekly-news/);
});
test("꺼진 루프는 필요한 값이 없어도 통과", () => {
  assert.deepEqual(errorsOf(variant((o) => { o.loops["logi-watch"] = { enabled: false }; })), []);
});
test("cron은 5필드", () => {
  assert.match(errorsOf(variant((o) => { o.loops["daily-brief"].cron = "every morning"; })).join(), /loops\.daily-brief\.cron/);
});
test("뉴스 긴급도는 CRITICAL·HIGH·WATCH", () => {
  assert.match(errorsOf(variant((o) => { o.news.categories[0].urgency = "URGENT"; })).join(), /news\.categories\.0\.urgency/);
});
test("모르는 필드는 거부(오타가 조용히 무시되지 않게)", () => {
  assert.match(errorsOf(variant((o) => { o.sink = {}; })).join(), /sink|Unrecognized/i);
});
test("오류 메시지에 값은 싣지 않는다", () => {
  const errs = errorsOf(variant((o) => { o.sinks.news.dataSource = "비밀-거래처-식별값"; }));
  assert.ok(errs.length > 0);
  assert.ok(!errs.join().includes("비밀-거래처-식별값"));
});
test("검사기 종료 코드 — 통과 0 · 형식 오류 1 · 대상 없음 2", () => {
  const dir = mkdtempSync(join(tmpdir(), "sf-topic-"));
  const good = join(dir, "good.yaml");
  const bad = join(dir, "bad.yaml");
  writeFileSync(good, example);
  writeFileSync(bad, variant((o) => { o.sinks.news.dataSource = "숨길값"; }));
  const run = (args: string[], env: Record<string, string> = {}) =>
    spawnSync(process.execPath, ["--import", "tsx", "scripts/topic-check.ts", ...args], { encoding: "utf-8", env: { ...process.env, ...env } });
  assert.equal(run(["--file", good]).status, 0);
  const r = run(["--file", bad]);
  assert.equal(r.status, 1);
  assert.ok(!r.stdout.includes("숨길값"));
  assert.equal(run([], { MYCREW_HOME: dir }).status, 2, "history/topics 없음 → MISS");
});

console.log(`topic-config: ${n} passed, 0 failed`);
process.exit(0);
