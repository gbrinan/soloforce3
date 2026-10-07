// 토큰 단가 보정 테스트 — 기대값은 우리 코드가 계산한 값이 아니라 «CLI가 보고한 실제 비용»이다.
//   fixture = 라이브 cost-log.jsonl 의 costMethod="cli"(비재개 세션) 실측 행.
//   비재개 세션의 CLI total_cost_usd 는 이번 호출분과 같으므로 외부 정답으로 쓸 수 있다.
//   (설계자가 정한 기대값으로 설계자 코드를 검증하면 mandela #4·#5 누수다.)
// 2026-10-07 실측: 공시 단가 + 캐시 생성 1시간 TTL(입력 단가 2배) 가정에서 3개 계열 모두
//   추정/CLI 중앙값 1.000. 5분 TTL(1.25배) 가정이면 0.66~0.68로 어긋난다.
import { priceTokens, priceForModel } from "../src/server/invocation-cost.js";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`[PASS] ${name}`); pass++; }
  else { console.log(`[FAIL] ${name}${detail ? " — " + detail : ""}`); fail++; }
}

interface Fixture {
  label: string;
  model: string;
  cliCostUsd: number;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreateTokens: number };
}

// 라이브 원장 실측 행 (2026-10-03, costMethod=cli)
const FIXTURES: Fixture[] = [
  { label: "book-keeper sonnet-5", model: "claude-sonnet-5", cliCostUsd: 0.3247954,
    usage: { inputTokens: 6, outputTokens: 262, cacheReadTokens: 145_797, cacheCreateTokens: 73_251 } },
  // 출력 비중이 큰 행: 입력·캐시 단가 오차가 서로 상쇄되는 위 행만으로는 출력 단가를 가려내지 못한다.
  { label: "doc-writer sonnet-5 (출력 위주)", model: "claude-sonnet-5", cliCostUsd: 0.6041578,
    usage: { inputTokens: 8, outputTokens: 19_447, cacheReadTokens: 222_839, cacheCreateTokens: 91_276 } },
  { label: "genie haiku-4-5", model: "claude-haiku-4-5", cliCostUsd: 0.1223214,
    usage: { inputTokens: 10, outputTokens: 1_163, cacheReadTokens: 8_024, cacheCreateTokens: 57_847 } },
  { label: "ax-consultant opus-5", model: "claude-opus-5", cliCostUsd: 1.8104755,
    usage: { inputTokens: 28, outputTokens: 13_648, cacheReadTokens: 1_056_251, cacheCreateTokens: 94_101 } },
];

for (const f of FIXTURES) {
  const est = priceTokens(f.usage, f.model);
  const ratio = est / f.cliCostUsd;
  check(`${f.label}: 토큰 추정이 CLI 보고값과 1% 이내`, Math.abs(ratio - 1) < 0.01,
    `추정 $${est.toFixed(4)} / CLI $${f.cliCostUsd.toFixed(4)} = ${ratio.toFixed(3)}`);
}

// 계열 판정: 모델 ID가 바뀌어도 계열로 단가를 고른다(2026-07-17 표 누락 사고 재발 방지).
check("opus 계열은 opus 단가", priceForModel("claude-opus-5").input === priceForModel("claude-opus-4-8").input);
check("모르는 claude 모델은 과소계상하지 않는다(opus 이상 단가)",
  priceForModel("claude-unknown-9").input >= priceForModel("claude-opus-5").input);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
