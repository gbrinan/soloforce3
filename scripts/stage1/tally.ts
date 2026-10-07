// Stage 1 집계 — 라벨(labels.json)을 좌우 배치(key.json)로 A/B에 되돌려 사전 등록 기준으로 판정한다(G13).
//   npx tsx scripts/stage1/tally.ts --out <stage1 폴더>
// 기준(findings.md «Stage 1 사전 등록»): «A가 낫다» 비율이 30% 이상이면 레인 유지, 미만이면 흡수.
// 에이전트별 판정은 5건 이상 모인 곳만. 파일럿(30건 미만)은 «판정 보류»로만 보고한다.
// 채팅 단위(재설계 사전 등록): 판정은 «실시간 데이터 필요» 표시가 없는 카드만 대상으로 한다.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export const A_BETTER_THRESHOLD = 0.3;
export const MIN_PER_AGENT = 5;
export const FULL_N = 30;

type Choice = "1이 낫다" | "비슷하다" | "2가 낫다" | "둘 다 못 쓴다";
export type Verdict = "A" | "B" | "tie" | "both-bad";

export function toVerdict(choice: Choice, left: "A" | "B"): Verdict {
  if (choice === "비슷하다") return "tie";
  if (choice === "둘 다 못 쓴다") return "both-bad";
  const leftWins = choice === "1이 낫다";
  return (leftWins ? left : left === "A" ? "B" : "A") as Verdict;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1]?.endsWith("tally.ts")) {
  const outDir = arg("--out");
  if (!outDir || !existsSync(path.join(outDir, "labels.json")) || !existsSync(path.join(outDir, "key.json"))) {
    console.error(`MISS: ${outDir ?? "--out"} 에 labels.json 과 key.json 이 모두 있어야 합니다`);
    process.exit(2);
  }
  const { labels } = JSON.parse(readFileSync(path.join(outDir, "labels.json"), "utf-8")) as { labels: Record<string, { choice: Choice | null; live: boolean }> };
  const { key } = JSON.parse(readFileSync(path.join(outDir, "key.json"), "utf-8")) as { key: Record<string, { left: "A" | "B" }> };
  const results = Object.fromEntries(readdirSync(path.join(outDir, "results")).map((f) => {
    const r = JSON.parse(readFileSync(path.join(outDir, "results", f), "utf-8")) as { id: string; agent: string; costUsd: number; ok: boolean };
    return [r.id, r];
  }));

  const total: Record<Verdict, number> = { A: 0, B: 0, tie: 0, "both-bad": 0 };
  const byAgent: Record<string, Record<Verdict, number>> = {};
  let live = 0;
  let labeled = 0;
  const judged: Record<Verdict, number> = { A: 0, B: 0, tie: 0, "both-bad": 0 };
  let judgedN = 0;
  for (const [id, l] of Object.entries(labels)) {
    if (!l.choice || !key[id]) continue;
    labeled++;
    const v = toVerdict(l.choice, key[id].left);
    total[v]++;
    const agent = results[id]?.agent ?? "?";
    (byAgent[agent] ??= { A: 0, B: 0, tie: 0, "both-bad": 0 })[v]++;
    if (l.live) live++;
    else { judged[v]++; judgedN++; }
  }
  const failed = Object.values(results).filter((r) => !r.ok).length;
  const cost = Object.values(results).reduce((s, r) => s + (r.costUsd || 0), 0);
  const aRate = judgedN ? judged.A / judgedN : 0;
  console.log(`라벨 ${labeled}건 · 실행 실패 ${failed}건 · B안 실행 비용 합계 $${cost.toFixed(2)}`);
  console.log(`A가 낫다 ${total.A} / B가 낫다 ${total.B} / 비슷 ${total.tie} / 둘 다 못 씀 ${total["both-bad"]} · 실시간 데이터 필요 표시 ${live}`);
  console.log(`판정 대상(실시간 표시 없음) ${judgedN}건: ${JSON.stringify(judged)}`);
  console.log(`«A가 낫다» 비율 ${(aRate * 100).toFixed(1)}% (기준 ${A_BETTER_THRESHOLD * 100}%)`);
  if (labeled < FULL_N) console.log(`판정 보류 — 파일럿(${labeled}건 < ${FULL_N}건). 사전 등록 기준은 전체 표본에서만 적용한다.`);
  else console.log(aRate >= A_BETTER_THRESHOLD ? "판정: 레인 유지" : "판정: 흡수 진행");
  for (const [agent, t] of Object.entries(byAgent)) {
    const n = t.A + t.B + t.tie + t["both-bad"];
    const note = n >= MIN_PER_AGENT ? `A ${(t.A / n * 100).toFixed(0)}%` : `${n}건 — 개별 판정 대상 아님`;
    console.log(`  ${agent}: ${JSON.stringify(t)} (${note})`);
  }
}
