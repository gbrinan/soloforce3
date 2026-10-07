// 비용 리포트 CLI — LLM이 원장을 읽고 합산하던 일을 결정적 코드로 옮긴다.
//   npx tsx scripts/cost-report.ts [--days 7] [--file <cost-log.jsonl>] [--json]
// 종료 코드: 0 정상, 2 원장 파일 없음(MISS — 빈 리포트로 «0원»을 꾸며내지 않는다).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HISTORY_DIR } from "../src/config.js";
import { summarizeCosts, COST_TRUSTS, type CostRow } from "../src/server/cost-ledger.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const file = arg("--file") ?? join(HISTORY_DIR, "cost-log.jsonl");
const days = Number(arg("--days") ?? 7);
const asJson = process.argv.includes("--json");

if (!existsSync(file)) {
  console.error(`MISS: 원장 파일이 없습니다 — ${file}`);
  process.exit(2);
}

const rows: CostRow[] = [];
let badLines = 0;
for (const line of readFileSync(file, "utf-8").split("\n")) {
  if (!line.trim()) continue;
  try { rows.push(JSON.parse(line) as CostRow); } catch { badLines++; }
}

const since = new Date(Date.now() - days * 86_400_000).toISOString();
const s = summarizeCosts(rows, { since });

if (asJson) {
  console.log(JSON.stringify({ file, since, days, badLines, ...s }, null, 2));
  process.exit(0);
}

const usd = (n: number) => `$${n.toFixed(2)}`;
console.log(`# 비용 리포트 (최근 ${days}일, ${since.slice(0, 10)} 이후)\n`);
console.log(`- 의사결정용 합계(measured + estimated): **${usd(s.trustedUsd)}**`);
console.log(`- 행 ${s.rows}개${badLines ? `, 파싱 실패 ${badLines}줄` : ""}\n`);
console.log("| 등급 | 행 | 로그값 | 토큰 재산정 | 토큰 |");
console.log("| --- | ---: | ---: | ---: | ---: |");
for (const t of COST_TRUSTS) {
  const b = s.byTrust[t];
  if (b.rows === 0) continue;
  console.log(`| ${t} | ${b.rows} | ${usd(b.loggedUsd)} | ${usd(b.tokenEstimateUsd)} | ${b.tokens.toLocaleString("en-US")} |`);
}
console.log("\n| 에이전트 | 행 | 신뢰 합계 | legacy 재산정 | unpriced 행 |");
console.log("| --- | ---: | ---: | ---: | ---: |");
for (const [id, a] of Object.entries(s.byAgent).sort((x, y) => y[1].trustedUsd - x[1].trustedUsd)) {
  console.log(`| ${id} | ${a.rows} | ${usd(a.trustedUsd)} | ${usd(a.legacyEstimateUsd)} | ${a.unpricedRows} |`);
}
console.log("\n- legacy: 2026-10-02 패치 80 이전 행. 로그값은 세션 누적이 섞여 부풀어 있어 합계에서 뺀다.");
console.log("- unpriced: 구독제(codex·gemini) 실행. 달러를 모르므로 0원으로 세지 않는다.");
