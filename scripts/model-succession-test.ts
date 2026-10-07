// 지원 종료 모델 자동 승계 테스트.
//
// 왜 코드로 검사하는가: 이 기전이 생긴 이유가 "알림을 사람이 처리하지 않아서"다.
// 코퍼스키퍼가 죽은 모델(sonnet-4-6)로 몇 세대를 돌았고, 그동안 알림은 계속 떠 있었다.
// 판단에 맡기면 또 놓친다.
//
// 실행: tsx scripts/model-succession-test.ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "mycrew-succession-"));
process.env.MYCREW_HOME = home;
mkdirSync(join(home, "history"), { recursive: true });

const CATALOG = join(home, "history", "model-catalog.json");
function writeCatalog(models: unknown[]): void {
  writeFileSync(CATALOG, JSON.stringify({ models }, null, 2));
}

writeCatalog([
  { id: "claude-sonnet-5", label: "Sonnet 5", status: "active" },
  { id: "claude-opus-4-8", label: "Opus 4.8", status: "active" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6", status: "deprecated", replacement: "claude-sonnet-5" },
  { id: "claude-opus-4-7", label: "Opus 4.7", status: "deprecated", replacement: "claude-opus-4-8" },
  // 승계 대상이 카탈로그에 active 로 없는 경우 — 연쇄/미아 승계를 막아야 한다
  { id: "claude-ghost-1", label: "Ghost", status: "deprecated", replacement: "claude-nowhere-9" },
  // replacement 자체가 지원 종료 — 이것도 실어서는 안 된다
  { id: "claude-old-2", label: "Old 2", status: "deprecated", replacement: "claude-sonnet-4-6" },
]);

const { resolveDeprecatedModel, invalidateCatalogCache, recordSuccession, getAppliedSuccessions } =
  await import("../src/server/model-catalog.js");

let ok = 0, fail = 0;
function check(name: string, cond: boolean, info = ""): void {
  if (cond) { ok++; console.log(`[PASS] ${name}${info ? ` | ${info}` : ""}`); }
  else { fail++; console.log(`[FAIL] ${name}${info ? ` | ${info}` : ""}`); }
}

check("sonnet-4-6 → sonnet-5",
  resolveDeprecatedModel("claude-sonnet-4-6") === "claude-sonnet-5");
check("opus-4-7 → opus-4-8 (티어 의도 유지)",
  resolveDeprecatedModel("claude-opus-4-7") === "claude-opus-4-8");
check("active 모델은 그대로",
  resolveDeprecatedModel("claude-sonnet-5") === null);
check("모르는 모델은 그대로",
  resolveDeprecatedModel("gemini-3.5-flash") === null && resolveDeprecatedModel("auto") === null);
check("null·빈값 안전",
  resolveDeprecatedModel(null) === null && resolveDeprecatedModel(undefined) === null);

// 날짜가 붙은 ID(claude-haiku-4-5-20251001 같은 것)도 prefix 로 잡아야 한다.
check("prefix 매칭 — 날짜 붙은 ID",
  resolveDeprecatedModel("claude-sonnet-4-6-20260101") === "claude-sonnet-5");

// 승계 대상이 active 가 아니면 싣지 않는다 — 죽은 모델에서 죽은 모델로 옮기면 무의미하다.
check("승계 대상이 카탈로그에 없으면 승계 안 함",
  resolveDeprecatedModel("claude-ghost-1") === null);
check("승계 대상이 지원 종료면 승계 안 함",
  resolveDeprecatedModel("claude-old-2") === null, "연쇄 승계 방지");

// 킬 스위치
process.env.MYCREW_NO_MODEL_AUTOMIGRATE = "1";
check("MYCREW_NO_MODEL_AUTOMIGRATE=1 이면 승계 중단",
  resolveDeprecatedModel("claude-sonnet-4-6") === null);
delete process.env.MYCREW_NO_MODEL_AUTOMIGRATE;

// 카탈로그가 없으면 아무 일도 일어나지 않아야 한다(오프라인 최초 기동).
rmSync(CATALOG);
invalidateCatalogCache();
check("카탈로그 없으면 승계 안 함(기존 동작 유지)",
  resolveDeprecatedModel("claude-sonnet-4-6") === null);

// 기록은 (직원, from) 당 한 번 — 레지스트리는 자주 재로드된다.
recordSuccession("corpus-keeper", "claude-sonnet-4-6", "claude-sonnet-5");
recordSuccession("corpus-keeper", "claude-sonnet-4-6", "claude-sonnet-5");
recordSuccession("ingest-crab", "claude-sonnet-4-6", "claude-sonnet-5");
check("승계 기록은 중복되지 않는다",
  getAppliedSuccessions().length === 2,
  `${getAppliedSuccessions().length}건`);

// ── 레지스트리가 실제로 승계를 적용하는가 (읽기 경로 전 구간) ────────────────
writeCatalog([
  { id: "claude-sonnet-5", label: "Sonnet 5", status: "active" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6", status: "deprecated", replacement: "claude-sonnet-5" },
]);
invalidateCatalogCache();
writeFileSync(join(home, "history", "agents.json"), JSON.stringify({
  agents: [{ id: "probe-agent", name: "탐침", team: "테스트팀", adapter: "claude-code", model: "claude-sonnet-4-6" }],
}));

const { getAllWorkerAgents } = await import("../src/agent-registry.js");
const probe = getAllWorkerAgents().find((a) => a.id === "probe-agent");
check("레지스트리가 agents.json 의 죽은 모델을 승계해서 돌려준다",
  probe?.model === "claude-sonnet-5", `model=${probe?.model}`);

// 저장된 값은 그대로여야 한다 — git 체크아웃과 사용자 데이터를 말없이 고치지 않는다.
const stored = JSON.parse(
  (await import("node:fs")).readFileSync(join(home, "history", "agents.json"), "utf-8"),
) as { agents: Array<{ model: string }> };
check("저장된 agents.json 은 건드리지 않는다",
  stored.agents[0].model === "claude-sonnet-4-6", `저장값=${stored.agents[0].model}`);

rmSync(home, { recursive: true, force: true });
console.log(`\n=== ${ok}/${ok + fail} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
