import { readFileSync, statSync, existsSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { HISTORY_DIR, PROJECT_SELF_DIR } from "./config.js";
import { syncRoleDirective } from "./role-directive.js";
import type { AgentConfig } from "./types.js";
import { getUserTitle } from "./server/user-title.js";
import { resolveDeprecatedModel, recordSuccession } from "./server/model-catalog.js";

export interface WorkerAgentDef {
  id: string;
  name: string;
  systemPrompt?: string;
  allowedTools: string[];
  maxTurns: number;
  bashTagSupport: boolean;
  planGate?: boolean;
  postValidation?: string[];
  team?: string;
  manager?: string;
  role?: string;
  jobType?: string;
  isCore?: boolean;
  routeKeywords: string[];
  isDefault?: boolean;
  adapter?: string;
  readPaths?: string[];
  writePaths?: string[];
  denyPaths?: string[];
  bashCommands?: string[];
  bashPaths?: string[];
  bashExtraBases?: string[];
  writeExtraBases?: string[];
  readSensitivePaths?: string[];
  writeSensitivePaths?: string[];
  bashSensitivePatterns?: string[];
  maxCacheTokens?: number;
  model?: string | null;
  /**
   * 계획 단계에서만 쓸 모델 override. 미지정이면 worker-stage-model.ts의 PLAN_STAGE_MODELS
   * 표 기본값(현재 dev-pm=claude-opus-5)을 그대로 쓴다 — 이 필드는 그 기본값을 agents.json에서
   * 갈아끼우는 용도다(예: claude-fable-5). history/agents.json 이 실소스, mtime 캐시로 재시작 불필요.
   */
  planModel?: string | null;
  /** v0.1.6 nested runtime schema. flat adapter/model 필드와 병행 — 신규 직원만 사용, 기존 직원은 flat 유지. */
  runtime?: { adapter?: string; model?: string | null; provider?: string; mode?: string };
  interactive?: boolean;
  /** claude -p(runAgent) 경로에서 playwright MCP 부착 여부 (agent.ts에서 참조) */
  enablePlaywright?: boolean;
  /** 할당된 추가 MCP 서버 이름들 (mcp-registry.json 참조) */
  mcpServers?: string[];
  permissionLevel?: string;
}

/** v0.1.6 runtime 해석기. nested runtime{adapter,model,provider} 우선, 없으면 flat adapter/model 폴백.
 *  현재 9명 + genie 직원은 모두 flat 필드만 가지므로 결과는 기존 동작과 동일하다 (하위호환).
 *  antigravity-cli 등 v0.1.0 고유 어댑터 ID도 그대로 보존 (normalizeAdapterId 미적용). */
export function resolveWorkerRuntime(
  agent: Pick<WorkerAgentDef, "adapter" | "model" | "runtime">,
): { adapter: string; model: string | null } {
  const adapter = agent.runtime?.adapter ?? agent.runtime?.provider ?? agent.adapter ?? "claude-code";
  const model = agent.runtime?.model !== undefined ? agent.runtime.model : (agent.model ?? null);
  return { adapter, model };
}

const AGENTS_FILE = join(HISTORY_DIR, "agents.json");
const TEMPLATES_DIR = join(PROJECT_SELF_DIR, "config", "system-prompt-templates");

// 15-D 자동등재 직원의 기본 권한 프로파일.
// 이게 없으면 allowedTools=[] + readPaths/writePaths 미설정 → agent.ts의 hasRead/hasWrite/hasBash가
// 전부 false → safefs MCP 서버가 아예 부착되지 않는다. 그런데 --disallowedTools(Read,Write,Bash…)는
// 무조건 전달되므로 "도구를 뺏고 대체재도 안 주는" 상태가 된다(가용 도구 0).
// 값은 agents.json 등재 직원들의 공통 관행을 그대로 따랐다 — 자기 소유 경로만 쓰기 가능.
const DEFAULT_AUTO_ALLOWED_TOOLS = [
  "Read", "Write", "Edit", "Grep", "Glob",
  "WebSearch", "WebFetch", "Skill",
  "TaskCreate", "TaskUpdate", "TaskList", "TaskGet",
];
// Bash는 기본 미부여(최소권한). 필요한 직원은 meta.json에 bashCommands를 명시하면 SafeBash가 붙는다.

const DEFAULT_AUTO_READ_SENSITIVE_PATHS = [
  "/.env", "/.env.*", "/.ssh/**", "/.aws/**", "/.gnupg/**",
  "/**/id_rsa*", "/**/id_ed25519*", "/**/id_ecdsa*",
  "/**/*.pem", "/**/*.key", "/**/*.crt", "/**/*.p12", "/**/*.pfx", "/**/*.jks", "/**/*.keychain-db",
];

const DEFAULT_AUTO_WRITE_SENSITIVE_PATHS = [
  "/.env",
  "/history/agents/**/wiki/role-directive.md",
];

function defaultAutoWritePaths(agentId: string): string[] {
  return [
    `/history/outputs/${agentId}/**`,
    `/history/agents/${agentId}/**`,
    "/history/attachments/**",
  ];
}

let cache: WorkerAgentDef[] | null = null;
let lastMtime = 0;
let lastConfigDirMtime = 0;
const unknownJobTypes = new Set<string>();
const reportedJobTypes = new Set<string>();

function buildCoworkers(self: WorkerAgentDef, all: WorkerAgentDef[]): string {
  return all
    .filter((a) => a.id !== self.id)
    .map((a) => `${a.name}(${a.team ?? a.role ?? a.id})`)
    .join(", ");
}

function applyPlaceholders(template: string, agent: WorkerAgentDef, all: WorkerAgentDef[]): string {
  // 핵심 직원 이름은 agents.json에서 동적 조회 — onboarding이 사용자 입력 이름으로 채움.
  // 못 찾으면 placeholder를 그대로 남김(사용자가 바로 알아채게).
  const nameOf = (id: string) => all.find(a => a.id === id)?.name;
  const cto = nameOf("dev-pm");
  const cqo = nameOf("qa");
  const cso = nameOf("planner-researcher");
  const replacements: Record<string, string> = {
    "{{ID}}": agent.id,
    "{{NAME}}": agent.name,
    "{{ROLE}}": agent.role ?? "팀장",
    "{{TEAM}}": agent.team ?? "",
    "{{MANAGER}}": agent.manager ?? "마이크루",
    "{{COWORKERS}}": buildCoworkers(agent, all),
    "{{OUTPUT_DIR}}": `history/outputs/${agent.id}`,
    "{{WIKI_DIR}}": `history/agents/${agent.id}/wiki`,
    "{{GENIE}}": "마이크루",
    "{{USER}}": getUserTitle(),
    ...(cto ? { "{{CTO}}": cto } : {}),
    ...(cqo ? { "{{CQO}}": cqo } : {}),
    ...(cso ? { "{{CSO}}": cso } : {}),
  };
  let out = template;
  for (const [key, val] of Object.entries(replacements)) {
    out = out.split(key).join(val);
  }
  return out;
}

function loadSystemPrompt(agent: WorkerAgentDef, all: WorkerAgentDef[]): string {
  // 0단계: config/agents/{id}/system-prompt.md (씨앗 레벨 오버라이드)
  const seedPromptPath = join(PROJECT_SELF_DIR, "config", "agents", agent.id, "system-prompt.md");
  if (existsSync(seedPromptPath)) {
    return applyPlaceholders(readFileSync(seedPromptPath, "utf-8"), agent, all);
  }
  // 1단계: history/agents/{id}/system-prompt.md (로컬 개인 오버라이드)
  const localPath = join(HISTORY_DIR, "agents", agent.id, "system-prompt.md");
  if (existsSync(localPath)) {
    return applyPlaceholders(readFileSync(localPath, "utf-8"), agent, all);
  }
  // 2단계: config/system-prompt-templates/{jobType}.md
  const jobType = agent.jobType ?? "general";
  const jobPath = join(TEMPLATES_DIR, `${jobType}.md`);
  if (existsSync(jobPath)) {
    return applyPlaceholders(readFileSync(jobPath, "utf-8"), agent, all);
  }
  // jobType 미존재 시 폴백 + toast 대상 등록 (BOOST-3)
  if (jobType !== "general") unknownJobTypes.add(jobType);
  // 3단계: general.md 폴백
  const generalPath = join(TEMPLATES_DIR, "general.md");
  if (existsSync(generalPath)) {
    return applyPlaceholders(readFileSync(generalPath, "utf-8"), agent, all);
  }
  return "";
}

export function ensureAgentDirs(agent: WorkerAgentDef, all?: WorkerAgentDef[]): void {
  const agentDir = join(HISTORY_DIR, "agents", agent.id);
  const wikiDir = join(agentDir, "wiki");
  const dailyDir = join(wikiDir, "daily");
  const outputsDir = join(HISTORY_DIR, "outputs", agent.id);

  if (!existsSync(dailyDir)) mkdirSync(dailyDir, { recursive: true });
  if (!existsSync(outputsDir)) mkdirSync(outputsDir, { recursive: true });

  const indexPath = join(wikiDir, "index.md");
  if (!existsSync(indexPath)) {
    writeFileSync(
      indexPath,
      `# ${agent.name}의 기억\n\n## 기억\n- [role-directive](role-directive.md)\n\n## 주요 산출물 (최대 5건)\n(전체: history/outputs/${agent.id}/ — Glob/Read로 접근)\n`,
    );
  }

  const rdPath = join(wikiDir, "role-directive.md");
  // 1순위: config/agents/{id}/role-directive.md (신규 구조)
  const newTmplPath = join(PROJECT_SELF_DIR, "config", "agents", agent.id, "role-directive.md");
  // 2순위: config/role-directives/{id}.md (기존 구조 폴백)
  const tmplPath = join(PROJECT_SELF_DIR, "config", "role-directives", `${agent.id}.md`);
  const seedPath = existsSync(newTmplPath) ? newTmplPath : existsSync(tmplPath) ? tmplPath : null;

  if (seedPath) {
    const existed = existsSync(rdPath);
    try {
      const state = syncRoleDirective(seedPath, rdPath, raw => applyPlaceholders(raw, agent, all ?? [agent]));
      if (state === 'updated') console.log(`[Registry] ${agent.id} role-directive 재동기화 (이전본 → role-directive.md.bak)`);
    } catch (error) {
      if (!existed) throw error;
      console.error(`[Registry] ${agent.id} role-directive 재동기화 실패:`, error);
    }
  } else if (!existsSync(rdPath)) {
    writeFileSync(rdPath,
      `# ${agent.name}(${agent.role ?? "팀장"}) 역할 지시서\n\n> 이 문서는 사용자/마이크루가 관리합니다. 본인이 수정하지 마세요.\n\n## 역할\n${agent.role ?? "팀장"}. 마이크루의 지시를 받아 ${agent.team ?? ""} 업무를 수행합니다.\n\n## 업무 원칙\n- 지시받은 작업을 반드시 완료합니다.\n- 결과를 간결하게 보고합니다.\n`);
  }
}

export function ensureAllAgentDirs(): void {
  const agents = loadAgents();
  for (const agent of agents) {
    ensureAgentDirs(agent, agents);
  }
}

export function consumeUnknownJobTypes(): string[] {
  const fresh = Array.from(unknownJobTypes).filter((t) => !reportedJobTypes.has(t));
  fresh.forEach((t) => reportedJobTypes.add(t));
  return fresh;
}

function loadAgents(): WorkerAgentDef[] {
  try {
    const { mtimeMs } = statSync(AGENTS_FILE);
    const configAgentsDir = join(PROJECT_SELF_DIR, "config", "agents");
    let configDirMtime = 0;
    try { configDirMtime = statSync(configAgentsDir).mtimeMs; } catch { /* */ }
    if (cache && mtimeMs === lastMtime && configDirMtime === lastConfigDirMtime) return cache;
    lastMtime = mtimeMs;
    lastConfigDirMtime = configDirMtime;
  } catch {
    return cache ?? [];
  }

  try {
    const raw = readFileSync(AGENTS_FILE, "utf-8");
    const data = JSON.parse(raw) as { agents: WorkerAgentDef[] };
    const agents = data.agents;

    // 15-D: config/agents/*/meta.json 스캔 → agents.json에 없는 직원 자동 등록
    const configAgentsScanDir = join(PROJECT_SELF_DIR, "config", "agents");
    if (existsSync(configAgentsScanDir)) {
      try {
        const subdirs = readdirSync(configAgentsScanDir, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => d.name);
        for (const agentId of subdirs) {
          if (agentId === 'genie') continue; // genie is the orchestrator, handled by genie.ts — not a worker agent
          if (agents.find(a => a.id === agentId)) continue;
          const metaPath = join(configAgentsScanDir, agentId, "meta.json");
          if (!existsSync(metaPath)) continue;
          try {
            const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as {
              id?: string; name?: string; jobTitle?: string; team?: string;
              adapter?: string; model?: string; isCore?: boolean; permLevel?: string;
              maxTurns?: number;
              // 권한 오버라이드 (선택) — 미지정 시 아래 기본 프로파일이 적용된다.
              allowedTools?: string[]; readPaths?: string[]; writePaths?: string[];
              bashCommands?: string[]; bashPaths?: string[]; routeKeywords?: string[];
              maxCacheTokens?: number;
            };
            const autoId = meta.id ?? agentId;
            agents.push({
              id: autoId,
              name: meta.name ?? agentId,
              team: meta.team,
              role: meta.jobTitle,
              adapter: meta.adapter ?? "claude-code",
              model: meta.model ?? null,
              isCore: meta.isCore ?? false,
              permissionLevel: meta.permLevel,
              // 기본 권한 프로파일 — 미부여 시 safefs 미부착으로 도구 0이 된다(위 상수 주석 참고).
              // ?? 가 아니라 length 검사인 이유: ?? 는 빈 배열을 통과시킨다. meta.json에
              // "allowedTools": [] 가 한 줄 들어오면 시드가 통째로 무력화돼 그 직원만 조용히
              // 도구 0이 된다 — 2026-08-08 자동등재 11명 사고의 재발 경로를 여기서 닫는다.
              allowedTools: meta.allowedTools?.length ? meta.allowedTools : DEFAULT_AUTO_ALLOWED_TOOLS,
              readPaths: meta.readPaths?.length ? meta.readPaths : ["/**"],
              writePaths: meta.writePaths?.length ? meta.writePaths : defaultAutoWritePaths(autoId),
              bashCommands: meta.bashCommands,
              bashPaths: meta.bashPaths,
              readSensitivePaths: DEFAULT_AUTO_READ_SENSITIVE_PATHS,
              writeSensitivePaths: DEFAULT_AUTO_WRITE_SENSITIVE_PATHS,
              maxCacheTokens: meta.maxCacheTokens ?? 3_000_000,
              // 다턴 누적(캐시읽기) 절감: meta.json에서 per-agent 상한 지정 가능, 미설정 시 20.
              maxTurns: (typeof meta.maxTurns === "number" && meta.maxTurns > 0) ? meta.maxTurns : 20,
              bashTagSupport: false,
              routeKeywords: meta.routeKeywords ?? [],
            });
          } catch (e) {
            console.error(`[Registry] meta.json 로드 실패 (${agentId}):`, e);
          }
        }
      } catch (e) {
        console.error("[Registry] config/agents 스캔 실패:", e);
      }
    }

    // 지원 종료 모델 자동 승계 — 카탈로그의 replacement 로 바꿔 읽는다.
    // 저장된 값(agents.json · 씨앗 meta.json)은 건드리지 않는다. 이유는 model-catalog.ts 참고.
    // 이 자리인 이유: agents.json 등재분과 meta.json 자동 등재분이 여기서 한 배열로 합쳐진다.
    for (const agent of agents) {
      const successor = resolveDeprecatedModel(agent.model);
      if (successor) {
        recordSuccession(agent.id, agent.model!, successor);
        agent.model = successor;
      }
    }

    // systemPrompt 4단 우선순위 (인라인 > 로컬 > jobType 템플릿 > general 폴백)
    for (const agent of agents) {
      if (!agent.systemPrompt) {
        agent.systemPrompt = loadSystemPrompt(agent, agents);
      }
    }

    // 자동 디렉토리/파일 생성 (agents.json 변경 시 신규 직원 즉시 반영)
    for (const agent of agents) {
      try { ensureAgentDirs(agent, agents); } catch (e) { console.error(`[Registry] ${agent.id} 디렉토리 생성 실패:`, e); }
    }

    // 핵심 직원(isCore=true) 보호: agents-default.json 기준 누락 시 경고
    try {
      const defaultPath = join(PROJECT_SELF_DIR, "config", "agents-default.json");
      if (existsSync(defaultPath)) {
        const defaultData = JSON.parse(readFileSync(defaultPath, "utf-8")) as { agents: WorkerAgentDef[] };
        for (const def of defaultData.agents) {
          if (def.isCore && !agents.find((a) => a.id === def.id)) {
            console.warn(`[Registry] 핵심 직원 ${def.id}가 agents.json에서 누락됨`);
          }
        }
      }
    } catch { /* */ }

    cache = agents;
    return cache;
  } catch (err) {
    console.error("[Registry] agents.json 로드 실패:", err);
    return cache ?? [];
  }
}

export function getAllWorkerAgents(): WorkerAgentDef[] {
  return loadAgents();
}

export function getWorkerAgent(id: string): WorkerAgentDef | undefined {
  return loadAgents().find((a) => a.id === id);
}

/** New assignments only. Existing job IDs and history keep their original worker. */
export function resolveNewWorkerId(id: string): string {
  return id === 'ingest-crab' && getWorkerAgent('ingestiger') ? 'ingestiger' : id;
}

export function getDefaultAgent(): WorkerAgentDef | undefined {
  const agent = loadAgents().find((a) => a.isDefault);
  return agent ? getWorkerAgent(resolveNewWorkerId(agent.id)) ?? agent : undefined;
}

export interface RouteCandidate {
  agent: WorkerAgentDef;
  keyword: string;
  agentIndex: number;
}

/**
 * "^" 로 시작하는 routeKeyword는 접두 앵커 — 요청문이 (좌측 공백 제거 후) 그 나머지 문자열로
 * *시작할 때만* 매칭된다(startsWith). 그 외 모든 키워드는 기존 그대로 부분일치(includes)다.
 *
 * 2026-08-28 QA 3회차 실증(잡 a2165962) — 접두 앵커만으로는 부족하다:
 * 앵커가 매칭된 문장이라도 뒤에 다른 팀 업무(캘린더 등록·정산·이메일 발송)가 이어지면,
 * 그 팀의 키워드도 같은 문장 안에서 매칭된다. 이때 기존 "최장 매칭 우선" 규칙을 그대로 쓰면
 * 앵커 키워드가 문자 수만 많아도 실제 업무 도메인 키워드를 누르고 이긴다("선생님, "(5자) >
 * "캘린더"(3자)). 그래서 앵커 후보는 **최후순위 폴백**으로 격하한다 — 앵커가 아닌(비앵커)
 * 후보가 하나라도 있으면 그쪽을 무조건 채택하고, 앵커 후보는 "다른 어떤 에이전트도 이 문장을
 * 주장하지 않을 때만" 승리한다. "요가 선생님, 정산…"·"담임 선생님, 캘린더…"처럼 애초에 앵커가
 * 안 걸리는 3인칭 호출도 여전히 배제되고(문장이 "선생님"으로 시작하지 않음), "선생님, 정산해줘"
 * 처럼 앵커는 걸리지만 실제 업무 키워드가 동시에 존재하는 문장도 그 업무 담당에게 넘어간다.
 * 이 규칙은 앵커를 쓰는 모든 에이전트에 공통 적용되는 일반 규칙이며 mentor-advisor 전용 특례가
 * 아니다 — routeKeywords 배열 순서·다른 에이전트의 includes() 동작은 그대로다.
 */
function matchKeyword(lower: string, kw: string): { matched: boolean; effectiveLen: number; anchored: boolean } {
  if (kw.startsWith("^")) {
    const needle = kw.slice(1).toLowerCase();
    return { matched: lower.trimStart().startsWith(needle), effectiveLen: needle.length, anchored: true };
  }
  const needle = kw.toLowerCase();
  return { matched: lower.includes(needle), effectiveLen: needle.length, anchored: false };
}

/**
 * 순수 라우팅 후보 선정 — agents 배열과 request 문자열만으로 결과가 정해진다.
 * loadAgents()의 파일 I/O에서 분리해 픽스처 기반 회귀 테스트를 가능하게 한다.
 * longest-match 우선: 각 에이전트에서 매칭된 키워드 중 가장 긴 것을 대표로 삼고,
 * 전 에이전트 대표 키워드를 길이 내림차순으로 정렬해 winner를 선택한다.
 * 동점 시 agents 배열 뒤(더 구체적으로 등록된) 에이전트를 우선한다.
 * 이 방식은 "리서치" < "딥리서치", "분석" < "심층 분석" 같은 substring 충돌을 방어한다.
 * 앵커(^) 후보는 비앵커 후보가 하나도 없을 때만 폴백으로 채택된다(위 matchKeyword 주석 참고).
 */
export function pickRouteCandidate(agents: WorkerAgentDef[], request: string): RouteCandidate | undefined {
  const lower = request.toLowerCase();

  const plain: (RouteCandidate & { matchLen: number })[] = [];
  const anchored: (RouteCandidate & { matchLen: number })[] = [];
  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    let bestKw: string | undefined;
    let bestLen = -1;
    let bestAnchored = false;
    for (const kw of agent.routeKeywords) {
      const { matched, effectiveLen, anchored: isAnchor } = matchKeyword(lower, kw);
      if (matched && effectiveLen > bestLen) {
        bestKw = kw;
        bestLen = effectiveLen;
        bestAnchored = isAnchor;
      }
    }
    if (bestKw) {
      const cand = { agent, keyword: bestKw, agentIndex: i, matchLen: bestLen };
      (bestAnchored ? anchored : plain).push(cand);
    }
  }

  const pool = plain.length > 0 ? plain : anchored;
  if (pool.length === 0) return undefined;

  pool.sort((a, b) => {
    const lenDiff = b.matchLen - a.matchLen;
    if (lenDiff !== 0) return lenDiff;
    return b.agentIndex - a.agentIndex; // 동점: 배열 뒤(더 구체적) 에이전트 우선
  });

  return pool[0];
}

export function routeToAgent(request: string, projectName?: string): WorkerAgentDef | undefined {
  const agents = loadAgents();
  if (agents.length === 0) return undefined;

  const winner = pickRouteCandidate(agents, request);
  if (!winner) {
    console.log(`[Route] "${request.slice(0, 60)}" → 매칭 실패 (적합한 직원 없음)`);
    return undefined;
  }

  const selected = getWorkerAgent(resolveNewWorkerId(winner.agent.id)) ?? winner.agent;
  console.log(`[Route] "${request.slice(0, 60)}" → ${selected.name} (keyword: "${winner.keyword}")`);
  return selected;
}

export function toAgentConfig(def: WorkerAgentDef): AgentConfig {
  const runtime = resolveWorkerRuntime(def);
  return {
    role: def.id as AgentConfig["role"],
    name: def.name,
    systemPrompt: def.systemPrompt ?? "",
    allowedTools: def.allowedTools,
    maxTurns: def.maxTurns,
    readPaths: def.readPaths,
    writePaths: def.writePaths,
    denyPaths: def.denyPaths,
    bashCommands: def.bashCommands,
    bashPaths: def.bashPaths,
    bashExtraBases: def.bashExtraBases,
    writeExtraBases: def.writeExtraBases,
    readSensitivePaths: def.readSensitivePaths,
    writeSensitivePaths: def.writeSensitivePaths,
    bashSensitivePatterns: def.bashSensitivePatterns,
    maxCacheTokens: def.maxCacheTokens,
    model: runtime.model,
    interactive: def.interactive,
    enablePlaywright: def.enablePlaywright,
    mcpServers: def.mcpServers,
    permissionLevel: def.permissionLevel,
  };
}
