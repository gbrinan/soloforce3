// 점검용 핑 요청에는 자동 QA를 붙이지 않는다(2026-09-27 아난 결정).
// 재현 근거: 9/15 하네스 핑(DONGGUK_READY·QA_READY) 3건에 QA가 붙어 "보고 형식 누락"으로 기록됐다.
import { strict as assert } from "node:assert";
import { decideQa, isHealthPing } from "../src/server/qa-trigger-policy.js";

const now = "2026-09-27T12:00:00.000Z";
const ping = "하네스 반영 검증용 핑입니다. 외부 조회·파일 읽기/쓰기·도구 호출을 일절 하지 말고, 응답으로 DONGGUK_READY 한 단어만 반환하세요.";

// 핑 → 코드 변경 판정이 불가(null)여도 QA 생략
const d = decideQa({ jobScopedCodeChanges: null, agentId: "planner-researcher", request: ping, nowIso: now });
assert.equal(d.run, false, `핑에 QA가 붙는다: ${d.reason}`);
assert.match(d.reason, /health-ping/);

// 명시 요청(forceQa)은 핑이어도 우선
assert.equal(decideQa({ jobScopedCodeChanges: 0, agentId: "planner-researcher", request: ping, nowIso: now, forceQa: true }).run, true);

// 오탐 방지: 실제 작업은 핑으로 보지 않는다
assert.equal(isHealthPing("QA_READY"), true);
assert.equal(isHealthPing("재시작 게이트 최종 검증입니다. 외부 조회, 파일 읽기/쓰기/변경, 도구 호출을 하지 마세요. 응답으로 RESTART_READY 한 단어만 반환하세요."), true);
assert.equal(isHealthPing("Opus 전환 검증용 작업입니다. 외부 조회, 파일 읽기/쓰기/변경, 도구 호출을 하지 마세요. 응답으로 OPUS_READY 한 단어만 반환하세요."), true);
assert.equal(isHealthPing("QA 재검증 #1이 다시 FAIL(QA_READY)로 판정됐습니다. 직전 핫픽스가 실제 반영됐는지 git status와 변경 내역을 확인하고 보고하라."), false, "핫픽스 확인 작업이 핑으로 분류됐다");
assert.equal(isHealthPing("월마감 장부를 점검하고 결과를 보고하세요."), false);
assert.equal(isHealthPing("핑 퐁 게임 기획서를 작성해줘. " + "요구사항 ".repeat(120)), false, "긴 실제 요청이 핑으로 분류됐다");
assert.equal(isHealthPing("배포 후 서비스가 READY 상태인지 확인하고 이상 시 원인을 분석해 보고하라"), false);
// 실제 작업은 기존대로 코드 변경 시 QA
assert.equal(decideQa({ jobScopedCodeChanges: 2, agentId: "backend-dev", request: "로그인 API 수정", nowIso: now }).run, true);

console.log("qa skip health ping: PASS");
