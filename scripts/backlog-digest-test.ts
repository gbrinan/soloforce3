// 백로그 다이제스트 선별 로직 단위 테스트 — 네트워크/디스크 부작용 없음 (순수 함수만).
// 배경: 2026-07-05~11 아난다라 등 10건이 received+잡없음 형태로 todo-monitor의 의도적
// 예외(3분 잔소리 금지)에 걸려 영구 방치된 사고의 재발 방지 장치 검증.
import { selectBacklogTodos } from "../src/server/todo-monitor.js";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, info?: string): void {
  if (ok) pass++;
  else fail++;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${info ? " | " + info : ""}`);
}

const NOW = new Date("2026-07-12T09:00:00Z").getTime();
const H = 60 * 60 * 1000;
const ago = (hours: number) => new Date(NOW - hours * H).toISOString();

type T = Parameters<typeof selectBacklogTodos>[0][number];
const base = (over: Partial<T>): T => ({
  id: "t-" + Math.floor(NOW % 100000) + "-" + (pass + fail),
  instruction: "테스트 업무",
  status: "pending",
  state: "received",
  createdAt: ago(48),
  relatedJobIds: [],
  ...over,
});

// (A) 핵심 사고 재현: received + 잡없음 + 며칠 방치 → 반드시 잡힘
{
  const r = selectBacklogTodos([base({ instruction: "아난다라 아키텍처 설계 (아샬 위임)", createdAt: ago(7 * 24) })], NOW);
  check("(A1) 7일 방치 received 백로그가 잡힌다", r.length === 1);
  check("(A2) ageDays 계산 정확", r[0]?.ageDays === 7, `ageDays=${r[0]?.ageDays}`);
}

// (B) 24시간 미만은 대상 아님 (하루는 정상적인 대기)
{
  const r = selectBacklogTodos([base({ createdAt: ago(23) })], NOW);
  check("(B1) 23시간짜리는 제외", r.length === 0);
  const r2 = selectBacklogTodos([base({ createdAt: ago(25) })], NOW);
  check("(B2) 25시간짜리는 포함", r2.length === 1);
}

// (C) 잡이 연결된 투두는 제외 (lease/stuck 인프라가 담당)
{
  const r = selectBacklogTodos([base({ relatedJobIds: ["job-1"] })], NOW);
  check("(C1) relatedJobIds 있으면 제외", r.length === 0);
}

// (D) received 외 상태는 제외 (stuck/plan_review 등은 runStuckCheck 담당)
{
  const r = selectBacklogTodos([
    base({ state: "stuck" as never }),
    base({ state: "plan_review" as never }),
  ], NOW);
  check("(D1) stuck/plan_review는 다이제스트 대상 아님", r.length === 0);
}

// (E) state 필드 없는 구버전 투두도 잡힘
{
  const r = selectBacklogTodos([base({ state: undefined })], NOW);
  check("(E1) state=undefined(구버전)도 포함", r.length === 1);
}

// (F) 완료/취소는 제외
{
  const r = selectBacklogTodos([base({ status: "done" })], NOW);
  check("(F1) status=done 제외", r.length === 0);
}

// (G) 정렬: 오래된 것 먼저
{
  const r = selectBacklogTodos([
    base({ instruction: "이틀", createdAt: ago(48) }),
    base({ instruction: "일주일", createdAt: ago(7 * 24) }),
    base({ instruction: "사흘", createdAt: ago(72) }),
  ], NOW);
  check("(G1) 나이 내림차순 정렬", r.map((x) => x.instruction).join(",") === "일주일,사흘,이틀", r.map((x) => x.instruction).join(","));
}

console.log(`\n=== ${pass}/${pass + fail} PASS, ${fail} FAIL ===`);
if (fail > 0) process.exit(1);
