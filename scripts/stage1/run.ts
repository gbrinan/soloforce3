// Stage 1 재실행 — 표본 요청을 «단일 에이전트 + 역할 스킬»로 다시 처리한다(B안).
//   npx tsx scripts/stage1/run.ts --out <stage1 폴더> [--limit 10]
// 실행 환경: 라이브와 같은 WSL claude CLI. 부작용 차단(G11):
//   허용 도구 Skill·WebSearch·WebFetch만, 쓰기·셸·하위 에이전트 금지, MCP 서버 0개, 사용자 스킬 숨김, 세션 저장 안 함.
// 결과·원문은 --out(리포 밖)에만 쓴다. 이미 결과가 있는 건은 건너뛴다(재과금 없음).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LANE_AGENTS, type Candidate } from "./sample.js";

const MODEL = "claude-sonnet-5"; // 흡수 후보 워커의 기존 모델과 같게 둬 구조 효과만 비교한다
const TIMEOUT_SEC = 900;
const ALLOWED = "Skill,WebSearch,WebFetch";
const DISALLOWED = "Write,Edit,Bash,NotebookEdit,Agent,Task";

const SYSTEM_PROMPT = `당신은 아난의 단일 AI 비서다. 받은 요청을 직접 끝까지 처리한다.
특정 역할의 전문 지침이 필요하면 사용 가능한 스킬 중 맞는 것을 불러 그 지침을 따른다. 맞는 스킬이 없으면 스킬 없이 처리한다.
파일을 쓰거나 외부로 보내지 말고, 결과물 전체를 응답 본문으로 낸다.`;

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

/** Windows 경로 → WSL 경로 (D:/x → /mnt/d/x). */
const toWsl = (p: string): string =>
  path.resolve(p).replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, d: string) => `/mnt/${d.toLowerCase()}`);

/** 레인이 아닌 모든 에이전트의 역할 지시서를 스킬로 만든다. 표본에 없는 에이전트도 넣어 스킬 선택까지 시험한다. */
function buildSandbox(sandbox: string, repoRoot: string): string[] {
  const agentsDir = path.join(repoRoot, "config", "agents");
  const made: string[] = [];
  for (const id of readdirSync(agentsDir).sort()) {
    if (LANE_AGENTS.has(id)) continue;
    const directive = path.join(agentsDir, id, "role-directive.md");
    const metaFile = path.join(agentsDir, id, "meta.json");
    if (!existsSync(directive) || !existsSync(metaFile)) continue;
    const meta = JSON.parse(readFileSync(metaFile, "utf-8")) as { jobTitle?: string; description?: string };
    const desc = [meta.jobTitle, meta.description].filter(Boolean).join(" — ").replace(/"/g, "'").replace(/\s+/g, " ");
    const dir = path.join(sandbox, ".claude", "skills", id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${id}\ndescription: "${desc.slice(0, 700)}"\n---\n\n${readFileSync(directive, "utf-8")}`);
    made.push(id);
  }
  return made;
}

interface RunResult {
  id: string; agent: string; ok: boolean; result: string; costUsd: number; numTurns: number;
  durationMs: number; skillsUsed: string[]; toolsUsed: string[]; error?: string;
}

function parseStream(jsonl: string): Omit<RunResult, "id" | "agent"> {
  const skills = new Set<string>();
  const tools = new Set<string>();
  let final: Record<string, unknown> | null = null;
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let ev: Record<string, unknown>;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === "assistant") {
      const content = ((ev.message as Record<string, unknown>)?.content ?? []) as Array<Record<string, unknown>>;
      for (const c of content) {
        if (c.type !== "tool_use") continue;
        tools.add(String(c.name));
        if (c.name === "Skill") skills.add(String((c.input as Record<string, unknown>)?.skill ?? "?"));
      }
    }
    if (ev.type === "result") final = ev;
  }
  if (!final) return { ok: false, result: "", costUsd: 0, numTurns: 0, durationMs: 0, skillsUsed: [...skills], toolsUsed: [...tools], error: "result 이벤트 없음" };
  return {
    ok: final.is_error !== true,
    result: String(final.result ?? ""),
    costUsd: Number(final.total_cost_usd ?? 0),
    numTurns: Number(final.num_turns ?? 0),
    durationMs: Number(final.duration_ms ?? 0),
    skillsUsed: [...skills],
    toolsUsed: [...tools],
    error: final.is_error === true ? String(final.result ?? "is_error") : undefined,
  };
}

const outDir = arg("--out");
const limit = Number(arg("--limit", "10"));
if (!outDir || !existsSync(path.join(outDir, "sample.json"))) {
  console.error(`MISS: ${outDir ?? "--out"}/sample.json 이 없습니다 — sample.ts 를 먼저 실행하세요`);
  process.exit(2);
}
const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const { cases } = JSON.parse(readFileSync(path.join(outDir, "sample.json"), "utf-8")) as { cases: Candidate[] };
const sandbox = path.join(outDir, "sandbox");
const skills = buildSandbox(sandbox, repoRoot);
writeFileSync(path.join(outDir, "system.md"), SYSTEM_PROMPT);
for (const d of ["prompts", "runs", "results"]) mkdirSync(path.join(outDir, d), { recursive: true });

// 사용자 스킬(WSL ~/.claude/skills)을 전부 숨긴다 — B안이 보는 스킬을 역할 스킬로 한정
execFileSync("wsl", ["-e", "bash", "-lc",
  `python3 -c 'import os,json; n=[d for d in os.listdir(os.path.expanduser("~/.claude/skills")) if not d.startswith(".")]; json.dump({"skillOverrides":{x:"off" for x in n}}, open("${toWsl(sandbox)}/settings.json","w"))'`]);
console.log(`스킬 ${skills.length}개: ${skills.join(", ")}`);

for (const c of cases.slice(0, limit)) {
  const resultFile = path.join(outDir, "results", `${c.id}.json`);
  if (existsSync(resultFile)) { console.log(`SKIP ${c.id} (이미 있음)`); continue; }
  writeFileSync(path.join(outDir, "prompts", `${c.id}.txt`), c.request);
  const cmd = `cd '${toWsl(sandbox)}' && ` + [
    `timeout ${TIMEOUT_SEC} claude -p --output-format stream-json --verbose`,
    `--settings settings.json --setting-sources project --strict-mcp-config --mcp-config '{"mcpServers":{}}'`,
    `--allowedTools '${ALLOWED}' --disallowedTools '${DISALLOWED}'`,
    `--model ${MODEL} --no-session-persistence --append-system-prompt-file '${toWsl(path.join(outDir, "system.md"))}'`,
    `< '${toWsl(path.join(outDir, "prompts", `${c.id}.txt`))}' > '${toWsl(path.join(outDir, "runs", `${c.id}.jsonl`))}' 2>&1`,
  ].join(" ");
  const started = Date.now();
  try { execFileSync("wsl", ["-e", "bash", "-lc", cmd], { stdio: "ignore", timeout: (TIMEOUT_SEC + 60) * 1000 }); } catch { /* 결과 파싱에서 판정 */ }
  const jsonl = existsSync(path.join(outDir, "runs", `${c.id}.jsonl`)) ? readFileSync(path.join(outDir, "runs", `${c.id}.jsonl`), "utf-8") : "";
  const r: RunResult = { id: c.id, agent: c.agent, ...parseStream(jsonl) };
  if (!r.durationMs) r.durationMs = Date.now() - started;
  writeFileSync(resultFile, JSON.stringify(r, null, 2));
  console.log(`${r.ok ? "OK  " : "FAIL"} ${c.id} ${c.agent} $${r.costUsd.toFixed(3)} ${r.numTurns}턴 ${Math.round(r.durationMs / 1000)}s 스킬=[${r.skillsUsed.join(",")}] 도구=[${r.toolsUsed.join(",")}]${r.error ? " " + r.error.slice(0, 80) : ""}`);
}
