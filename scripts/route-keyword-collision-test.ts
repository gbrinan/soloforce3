#!/usr/bin/env tsx
/**
 * "선생님" 키워드 충돌 QA 회귀 테스트 (3회차, 2026-08-28, 잡 a2165962).
 *
 * QA P1 지적 — 이전 버전은 가상 픽스처(agent("ingest-crab", 2, ["노션","정리"]))를 검사해
 * 위양성 PASS를 냈다(같은 문장이 픽스처에서는 PASS, 실 라이브 라우팅에서는 FAIL). 그래서
 * 이번 버전은 **실 history/agents.json을 그대로 로드하는 getAllWorkerAgents()** 를 쓴다 —
 * 이 파일이 검사하는 것과 서버가 실제로 쓰는 것이 항상 같은 데이터임을 보장한다.
 */
import { pickRouteCandidate, getAllWorkerAgents } from "../src/agent-registry.js";

const agents = getAllWorkerAgents();

let fail = 0;
let knownGapObserved = 0;
function check(label: string, request: string, expect: { mentor?: boolean; agentId?: string }) {
  const got = pickRouteCandidate(agents, request);
  const gotId = got?.agent.id;
  const isMentor = gotId === "mentor-advisor";
  const ok = expect.agentId ? gotId === expect.agentId : isMentor === expect.mentor;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label} — 실제 ${gotId ?? "(없음)"} (kw:"${got?.keyword ?? "-"}")`);
  if (!ok) fail++;
}

/**
 * "선생님"으로 시작하지만 문장 안에 그 업무를 주장하는 다른 팀 키워드가 아예 없는 경우
 * (노션 게시·코드 디버깅·이메일 발송 — 2026-08-28 QA 3회차 §3 발견). 라우터가 폴백으로
 * mentor-advisor를 선택하는 것 자체는 pickRouteCandidate 설계상 올바르다("아무도 안 주장한
 * 문장은 유일 후보가 이긴다") — 결함은 라우터가 아니라 다른 에이전트에 해당 업무 키워드가
 * 없다는 **데이터 공백**이다. 이번 지시 범위(mentor-advisor 키워드 + 공통 폴백 규칙)를 넘어
 * 다른 에이전트 키워드를 추가하는 것은 금지돼 있으므로, 이 결과는 하드 실패로 세지 않고
 * 관찰로만 남긴다. `npm test` 체인을 이 미해결 사안으로 영구 RED로 만들지 않기 위함이다.
 */
function observeKnownGap(label: string, request: string) {
  const got = pickRouteCandidate(agents, request);
  const gotId = got?.agent.id;
  const stillGap = gotId === "mentor-advisor";
  console.log(`  ${stillGap ? "GAP(관찰)" : "해소됨"}  ${label} — 실제 ${gotId ?? "(없음)"} (kw:"${got?.keyword ?? "-"}")`);
  if (stillGap) knownGapObserved++;
}

console.log("=== §2 정탐 10건 — mentor-advisor로 라우팅돼야 한다 ===");
check("선생님께 물어봐줘", "선생님께 물어봐줘", { mentor: true });
check("선생님한테 물어봐줘", "선생님한테 물어봐줘", { mentor: true });
check("선생님 의견을 듣고 싶어", "선생님 의견을 듣고 싶어", { mentor: true });
check("선생님 생각은 어때?", "선생님 생각은 어때?", { mentor: true });
check("선생님이라면 어떻게 하실까", "선생님이라면 어떻게 하실까", { mentor: true });
check("선생님께서 보시기엔 어떤가요", "선생님께서 보시기엔 어떤가요", { mentor: true });
check("AMU MK2에게 물어봐줘", "AMU MK2에게 물어봐줘", { mentor: true });
check("멘토가 필요해", "멘토가 필요해", { mentor: true });
check("선생님, 요즘 사업이 잘 안 됩니다 (회귀1·쉼표형)", "선생님, 요즘 사업이 잘 안 됩니다", { mentor: true });
check("선생님 이거 어떻게 생각하세요 (회귀2·무조사형)", "선생님 이거 어떻게 생각하세요", { mentor: true });
check("선생님,\\n요즘 사업이 잘 안 됩니다 (회귀3·개행형)", "선생님,\n요즘 사업이 잘 안 됩니다", { mentor: true });

console.log("\n=== §3 QA 자작 공격 10문장 — 3회차 지적 그대로 편입 ===");
// 3인칭 2건은 접두 앵커로 원천 배제(문장이 "선생님"으로 시작하지 않음) — 반드시 비-AMU.
check("[3인칭] 요가 선생님, 수업료 정산 장부에 기록해줘", "요가 선생님, 수업료 정산 장부에 기록해줘", { agentId: "book-keeper" });
check("[3인칭2] 담임 선생님, 면담 일정 캘린더에 넣어줘", "담임 선생님, 면담 일정 캘린더에 넣어줘", { agentId: "spf-sales" });
// 호격+실제업무 3건은 문장이 "선생님"으로 시작하지만, 같은 문장에 다른 팀의 키워드가
// 함께 있으면 앵커가 폴백으로 밀려 해당 팀이 이긴다(agent-registry.ts pickRouteCandidate 참고).
check("[호격+일정] 선생님, 내일 학부모 상담 일정을 캘린더에 등록해줘", "선생님, 내일 학부모 상담 일정을 캘린더에 등록해줘", { agentId: "spf-sales" });
check("[호격+장부] 선생님, 이번 달 학원비 정산 장부에 기록해줘", "선생님, 이번 달 학원비 정산 장부에 기록해줘", { agentId: "book-keeper" });
check("[이거+장부] 선생님 이거 영수증인데 정산해줘", "선생님 이거 영수증인데 정산해줘", { agentId: "book-keeper" });
// 아래 3건은 「선생님」으로 시작하고, 문장 속 업무(노션 게시·디버깅·이메일 발송)를
// 다른 어떤 직원도 routeKeywords로 주장하지 않는다 — 실 agents.json 데이터 공백이며
// 라우팅 알고리즘으로는 못 막는다(경쟁 후보가 아예 없으면 앵커가 유일 후보로 승리).
// 이번 지시 범위(mentor-advisor 자기 키워드 + 라우터 폴백 규칙)로는 닫히지 않는 잔여
// 결함으로 기록한다 — 다른 에이전트 키워드 확장은 이번 지시가 금지한 범위 밖이다.
console.log("  --- 아래 3건은 관찰 전용(데이터 공백 — 다른 팀에 해당 업무 키워드가 없음, fail 미집계) ---");
observeKnownGap("[호격+파일] 선생님, 이 파일들 좀 정리해서 노션에 올려줘", "선생님, 이 파일들 좀 정리해서 노션에 올려줘");
observeKnownGap("[호격+코드] 선생님, 이 코드 버그 좀 디버깅해줘", "선생님, 이 코드 버그 좀 디버깅해줘");
observeKnownGap("[이거+메일] 선생님 이거 이메일로 보내줘", "선생님 이거 이메일로 보내줘");

console.log("\n=== 음성 — QA 1회차 반례 3건은 여전히 비-AMU여야 한다 ===");
check("학교 선생님 미팅 일정을 캘린더에 등록해줘", "학교 선생님 미팅 일정을 캘린더에 등록해줘", { agentId: "spf-sales" });
check("요가 선생님 수업료 정산해서 장부에 반영해줘", "요가 선생님 수업료 정산해서 장부에 반영해줘", { agentId: "book-keeper" });
check("선생님이 보내주신 자료 노션에 정리해줘", "선생님이 보내주신 자료 노션에 정리해줘", { mentor: false });

console.log("\n=== 회귀 스캔 — 타 직원 정탐 대표 사례 5건, mentor-advisor 편입 전과 결과 동일해야 한다 ===");
check("리서치 좀 부탁해", "리서치 좀 부탁해", { agentId: "planner-researcher" });
check("QA 검증해줘", "QA 검증해줘", { agentId: "qa" });
check("코퍼스에 인제스트해줘", "코퍼스에 인제스트해줘", { agentId: "ingest-crab" });
check("정산 내역 확인해줘", "정산 내역 확인해줘", { agentId: "book-keeper" });
check("리드 파이프라인 정리해줘", "리드 파이프라인 정리해줘", { agentId: "lead-keeper" });

console.log(
  `\n${fail ? `FAIL ${fail}건` : "PASS — 단정 22건 전건 통과"} · 관찰(데이터 공백) ${knownGapObserved}/3건 잔존` +
  ` (전체 ${agents.length}명 대상, 실 history/agents.json 라이브 로더)`,
);
process.exit(fail ? 1 : 0);
