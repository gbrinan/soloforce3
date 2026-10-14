// 레인(에이전트) 정의 검사 — 모델이 비어 기본 모델로 새는 정의, 없는 MCP 서버 참조를 잡는다.
//   npx tsx scripts/lane-check.ts                                  # 리포 시드(config/agents/*/meta.json, config/agents-default.json)
//   npx tsx scripts/lane-check.ts --agents <agents.json> [--registry <mcp-registry.json>]   # 라이브 읽기 전용 점검
// 종료 코드: 0 통과(경고만 있어도 0) · 1 FAIL 있음 · 2 MISS(대상 파일 없음)
//
// 규칙
//   FAIL L1 model이 비어 있다 — CLI 기본 모델로 실행된다(비용 누수 사고 2026-09-24의 같은 꼴)
//   FAIL L4 mcpServers가 레지스트리에 없는 서버를 가리킨다(--registry를 줬을 때)
//   WARN L2 model이 티어 이름이 아니라 모델 ID다(CLAUDE.md «설정에는 티어 이름»)
//   WARN L3 permLevel admin·workspace — 헤드리스에서 bypassPermissions라 허용 목록 밖 도구도 실행된다
//   WARN L5 approval 모드 서버가 bypass 에이전트에 할당됐다 — 헤드리스에서 그 서버는 통째로 막힌다(mcp-registry.ts)
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { isModelTier } from "../src/server/model-tiers.js";

export interface LaneDef {
  id: string;
  model?: string | null;
  permissionLevel?: string;
  mcpServers?: string[];
  source: string;
}
export interface LaneFinding { level: "FAIL" | "WARN"; rule: string; id: string; detail: string }

const BYPASS = new Set(["admin", "workspace"]);

export function checkLanes(
  defs: LaneDef[],
  registry?: Record<string, { mode?: string }>,
): LaneFinding[] {
  const out: LaneFinding[] = [];
  for (const d of defs) {
    const model = typeof d.model === "string" ? d.model.trim() : "";
    if (!model) out.push({ level: "FAIL", rule: "L1", id: d.id, detail: `model 없음 → CLI 기본 모델로 실행 (${d.source})` });
    else if (!isModelTier(model) && model !== "auto") out.push({ level: "WARN", rule: "L2", id: d.id, detail: `모델 ID «${model}» — 티어 이름 권장` });
    const bypass = BYPASS.has(d.permissionLevel ?? "");
    if (bypass) out.push({ level: "WARN", rule: "L3", id: d.id, detail: `permLevel ${d.permissionLevel} → 헤드리스 bypassPermissions` });
    for (const srv of d.mcpServers ?? []) {
      if (!registry) continue;
      const def = registry[srv];
      if (!def) out.push({ level: "FAIL", rule: "L4", id: d.id, detail: `레지스트리에 없는 MCP 서버 «${srv}»` });
      else if (def.mode !== "allow" && bypass) out.push({ level: "WARN", rule: "L5", id: d.id, detail: `approval 모드 «${srv}» → 헤드리스에서 통째로 막힘` });
    }
  }
  return out;
}

/** 리포 시드 — meta.json(permLevel)과 agents-default.json을 런타임과 같은 이름으로 읽는다(agent-registry.ts 15-D). */
export function loadSeedLanes(root: string): LaneDef[] {
  const defs: LaneDef[] = [];
  const metaDir = path.join(root, "config", "agents");
  for (const id of existsSync(metaDir) ? readdirSync(metaDir).sort() : []) {
    const f = path.join(metaDir, id, "meta.json");
    if (!existsSync(f)) continue;
    const m = JSON.parse(readFileSync(f, "utf-8")) as { id?: string; model?: string | null; permLevel?: string; mcpServers?: string[] };
    defs.push({ id: m.id ?? id, model: m.model ?? null, permissionLevel: m.permLevel, mcpServers: m.mcpServers, source: path.relative(root, f) });
  }
  const dflt = path.join(root, "config", "agents-default.json");
  if (existsSync(dflt)) {
    const raw = JSON.parse(readFileSync(dflt, "utf-8")) as unknown;
    const arr = (Array.isArray(raw) ? raw : (raw as { agents?: unknown[] }).agents ?? Object.values(raw as object)) as Array<Record<string, unknown>>;
    for (const a of arr) defs.push({ id: String(a.id), model: (a.model as string | null) ?? null, permissionLevel: a.permissionLevel as string | undefined, mcpServers: a.mcpServers as string[] | undefined, source: "config/agents-default.json" });
  }
  return defs;
}

export function loadRuntimeLanes(file: string): LaneDef[] {
  const raw = JSON.parse(readFileSync(file, "utf-8")) as unknown;
  const arr = (Array.isArray(raw) ? raw : (raw as { agents?: unknown[] }).agents ?? Object.values(raw as object)) as Array<Record<string, unknown>>;
  return arr.map((a) => ({
    id: String(a.id),
    model: (a.model as string | null) ?? null,
    permissionLevel: (a.permissionLevel ?? a.permLevel) as string | undefined,
    mcpServers: a.mcpServers as string[] | undefined,
    source: path.basename(file),
  }));
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1]?.endsWith("lane-check.ts")) {
  const agentsFile = arg("--agents");
  const registryFile = arg("--registry");
  for (const f of [agentsFile, registryFile]) {
    if (f && !existsSync(f)) { console.error(`MISS: ${f} 없음`); process.exit(2); }
  }
  const defs = agentsFile ? loadRuntimeLanes(agentsFile) : loadSeedLanes(process.cwd());
  if (defs.length === 0) { console.error("MISS: 검사할 레인 정의가 없음"); process.exit(2); }
  const registry = registryFile ? JSON.parse(readFileSync(registryFile, "utf-8")) as Record<string, { mode?: string }> : undefined;
  const findings = checkLanes(defs, registry);
  for (const f of findings) console.log(`${f.level} ${f.rule} ${f.id}: ${f.detail}`);
  const fails = findings.filter((f) => f.level === "FAIL").length;
  const warns = findings.length - fails;
  console.log(`lane-check: ${defs.length}개 정의 · FAIL ${fails} · WARN ${warns}`);
  process.exit(fails > 0 ? 1 : 0);
}
