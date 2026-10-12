// 업무 맥락 형식 테스트 (G25) — src/shared/business-context.ts, 예시 파일, 검사기의 종료 코드.
//   npx tsx scripts/business-context-test.ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { parseBusinessContext } from "../src/shared/business-context.js";

let n = 0;
const test = (name: string, fn: () => void): void => { fn(); n++; console.log(`PASS ${name}`); };
const example = readFileSync("config/business-context.example.yaml", "utf-8");
const base = parse(example) as Record<string, unknown>;
const variant = (patch: (o: Record<string, unknown>) => void): string => {
  const o = structuredClone(base);
  patch(o);
  return stringify(o);
};
const errorsOf = (text: string): string[] => { const r = parseBusinessContext(text); return r.ok ? [] : r.errors; };

test("예시 파일은 형식을 통과한다", () => {
  const r = parseBusinessContext(example);
  assert.ok(r.ok, JSON.stringify(r));
});
test("통화·국가는 ISO 대문자 코드", () => {
  assert.match(errorsOf(variant((o) => { o.currency = "krw"; })).join(), /currency/);
  assert.match(errorsOf(variant((o) => { o.country = "KOR"; })).join(), /country/);
  assert.match(errorsOf(variant((o) => { (o.businessLines as Array<Record<string, unknown>>)[0].currencies = ["usd"]; })).join(), /businessLines\.0\.currencies\.0/);
});
test("회계연도 끝은 실제 있는 날짜(MM-DD)", () => {
  assert.match(errorsOf(variant((o) => { o.fiscalYearEnd = "02-30"; })).join(), /fiscalYearEnd/);
  assert.match(errorsOf(variant((o) => { o.fiscalYearEnd = "2026-12-31"; })).join(), /fiscalYearEnd/);
  assert.deepEqual(errorsOf(variant((o) => { o.fiscalYearEnd = "03-31"; })), []);
});
test("시간대는 IANA 이름", () => {
  assert.match(errorsOf(variant((o) => { o.timezone = "KST"; })).join(), /timezone/);
});
test("사업 단위는 하나 이상, id는 중복 없는 슬러그", () => {
  assert.match(errorsOf(variant((o) => { o.businessLines = []; })).join(), /businessLines/);
  assert.match(errorsOf(variant((o) => { (o.businessLines as Array<Record<string, unknown>>)[1].id = "export-trade"; })).join(), /중복/);
  assert.match(errorsOf(variant((o) => { (o.businessLines as Array<Record<string, unknown>>)[0].id = "Export Trade"; })).join(), /businessLines\.0\.id/);
});
test("모르는 필드·범주·출력 선호는 거부(오타가 조용히 무시되지 않게)", () => {
  assert.match(errorsOf(variant((o) => { o.currancy = "KRW"; })).join(), /currancy|Unrecognized/i);
  assert.match(errorsOf(variant((o) => { (o.connectedTools as Record<string, unknown>).chat = ["slack"]; })).join(), /connectedTools/);
  assert.match(errorsOf(variant((o) => { o.outputPreference = "email"; })).join(), /outputPreference/);
});
test("오류 메시지에 값은 싣지 않는다", () => {
  const errs = errorsOf(variant((o) => { o.currency = "비밀통화값"; }));
  assert.ok(!errs.join().includes("비밀통화값"));
});
test("깨진 YAML은 파싱 실패로", () => {
  assert.match(errorsOf("version: [1").join(), /YAML 파싱 실패/);
});

test("검사기 종료 코드 — 통과 0 · 형식 오류 1 · 파일 없음 2", () => {
  const dir = mkdtempSync(join(tmpdir(), "sf-bizctx-"));
  const good = join(dir, "good.yaml");
  const bad = join(dir, "bad.yaml");
  writeFileSync(good, example);
  writeFileSync(bad, variant((o) => { o.currency = "won"; }));
  const run = (args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "scripts/business-context-check.ts", ...args], { encoding: "utf-8" });
  assert.equal(run(["--file", good]).status, 0);
  const r = run(["--file", bad]);
  assert.equal(r.status, 1);
  assert.ok(!r.stdout.includes("won"), "값을 출력하지 않는다");
  assert.equal(run(["--file", join(dir, "none.yaml")]).status, 2);
});

console.log(`business-context: ${n} passed, 0 failed`);
process.exit(0);
