// Stage 1 도구 회귀 테스트 — 결과를 뒤집을 수 있는 지점(좌우 복원·표본 규칙)을 고정한다.
import { isEligible, pickSample, rng, sampleHash, type Candidate } from "./sample.js";
import { toVerdict } from "./tally.js";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`[PASS] ${name}`); pass++; }
  else { console.log(`[FAIL] ${name}${detail ? " — " + detail : ""}`); fail++; }
}

// 좌우 복원: 화면의 «1/2»를 A/B로 되돌릴 때 뒤집히면 판정이 정반대가 된다
check("왼쪽 A·1이 낫다 → A", toVerdict("1이 낫다", "A") === "A");
check("왼쪽 B·1이 낫다 → B", toVerdict("1이 낫다", "B") === "B");
check("왼쪽 A·2가 낫다 → B", toVerdict("2가 낫다", "A") === "B");
check("왼쪽 B·2가 낫다 → A", toVerdict("2가 낫다", "B") === "A");
check("비슷하다 → tie", toVerdict("비슷하다", "B") === "tie");
check("둘 다 못 쓴다 → both-bad", toVerdict("둘 다 못 쓴다", "A") === "both-bad");

// 표본 규칙
const base = { id: "x", agent: "planner-researcher", status: "completed", fullResult: "결과".repeat(150) };
check("자기완결 흡수 후보는 통과", isEligible({ ...base, request: "경쟁사 3곳 비교해줘" }) !== null);
check("시스템 지시는 제외", isEligible({ ...base, request: "[정기] 보고" }) === null);
check("레인 에이전트는 제외", isEligible({ ...base, agent: "dev-pm", request: "리팩터링" }) === null);
check("실시간 상태 요청은 제외", isEligible({ ...base, request: "메일함 정리해줘" }) === null);
check("미완료 잡은 제외", isEligible({ ...base, status: "failed", request: "조사" }) === null);
check("짧은 결과는 제외", isEligible({ ...base, fullResult: "짧음", request: "조사" }) === null);

const cands: Candidate[] = Array.from({ length: 40 }, (_, i) => ({
  id: `id-${String(i).padStart(2, "0")}`, agent: i < 30 ? "planner-researcher" : `agent-${i}`, request: `r${i}`, result: "r", createdAt: "",
}));
const s1 = pickSample(cands, 30, 7);
const s2 = pickSample(cands, 30, 7);
check("같은 시드 → 같은 표본", sampleHash(s1) === sampleHash(s2));
check("다른 시드 → 다른 순서", sampleHash(pickSample(cands, 30, 8)) !== sampleHash(s1));
check("에이전트별 상한 40%", s1.filter((c) => c.agent === "planner-researcher").length <= 12);
// 상한이 n에 따라 달라지므로 pickSample(n=10)은 전체 표본의 앞 10건과 다를 수 있다.
// 그래서 파일럿은 따로 뽑지 않고 전체 표본(sample.json)의 앞 k건을 자른다(run.ts --limit).
check("n이 다르면 상한이 달라져 별도 추출은 앞부분과 어긋날 수 있다", sampleHash(pickSample(cands, 10, 7)) !== sampleHash(s1.slice(0, 10)));
check("파일럿 = 전체 표본 앞 10건(자르기)", s1.slice(0, 10).every((c, i) => c.id === s1[i].id) && s1.slice(0, 10).length === 10);
const r = rng(1);
check("난수는 [0,1)", Array.from({ length: 100 }, r).every((x) => x >= 0 && x < 1));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
