// QA "보류" 판정: 환경 문제로 검증 불가면 합격·핫픽스 없이 아난에게 알림 (2026-09-28)
// 재현 근거: 9/28 spf-logistics QA — Notion MCP ENOENT로 재조회 불가인데 "조건부 합격"(=pass)으로 처리됨.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { detectQaHold } from "../src/server/qa-auto-judge.js";

const held = `아난이 할 일: 조치 — Notion MCP 연결 복구 후 재검증
문제 위치: 환경 — Notion 조회 도구 ENOENT
종합 판정 — **보류**`;
assert.deepEqual(detectQaHold(held), { hold: true, todo: "조치 — Notion MCP 연결 복구 후 재검증" });
// 앞쪽에 인용된 직전 판정이 보류여도 마지막 판정이 합격이면 보류 아님
assert.equal(detectQaHold("직전: 종합 판정 — **보류**\n...\n종합 판정 — **합격**").hold, false);
assert.equal(detectQaHold("종합 판정 — **조건부 합격**").hold, false);
assert.equal(detectQaHold("종합 판정 — **불합격**").hold, false);
assert.equal(detectQaHold("보류라는 단어만 본문에 있음").hold, false);

// 배선: handleQaJobComplete에서 detectQaVerdict보다 먼저 보류를 본다
const src = readFileSync("src/server/qa-auto-judge.ts", "utf-8");
const fn = src.slice(src.indexOf("export function handleQaJobComplete"));
assert.ok(fn.indexOf("detectQaHold(") > 0 && fn.indexOf("detectQaHold(") < fn.indexOf("detectQaVerdict("), "보류 판정이 합격 판정보다 먼저여야 한다(조건부 합격 우선 규칙 때문)");
// 지시서에 보류 규칙
const dir = readFileSync("config/agents/qa/role-directive.md", "utf-8");
assert.match(dir, /종합 판정 — \*\*보류\*\*/);
console.log("qa hold verdict: PASS");
// qa-auto-judge → chat.js 가져오기로 서버 타이머가 뜬다 — 명시적으로 끝내야 배포 게이트가 멈추지 않는다.
process.exit(0);
