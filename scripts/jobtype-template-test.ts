// 채용/해고 JSON 통합 — 회귀 테스트
// 검증 항목: 가상 채용 자동 디렉토리, jobType 템플릿 로드, 플레이스홀더 8개 치환,
//            jobType 폴백, 인라인 systemPrompt 우선, 로컬 오버라이드 우선,
//            isCore 누락 경고, 가상 해고 후 디렉토리 잔존.
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, statSync, utimesSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const AGENTS_FILE = join(ROOT, "history", "agents.json");
const TEMPLATES = join(ROOT, "config", "system-prompt-templates");
const HIST_AGENTS = join(ROOT, "history", "agents");
const HIST_OUTPUTS = join(ROOT, "history", "outputs");

const VIRT_ID = "virt-test-marketer";
const VIRT_JOBTYPE_KNOWN_ID = "virt-test-dev";
const VIRT_LOCAL_ID = "virt-test-local";
const VIRT_INLINE_ID = "virt-test-inline";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`[PASS] ${name}`); pass++; }
  else { console.log(`[FAIL] ${name}${detail ? " — " + detail : ""}`); fail++; }
}

// 이 테스트는 프로비저닝된 설치본을 전제로 한다 — history/agents.json의 명단과 config/agents/의
// meta.json이 서로 맞물려 있어야 인원 수 검증이 성립한다. history/는 gitignore라 신규 클론에는
// 없으므로, 빈 명단을 지어내 거짓 신호를 내는 대신 건너뛴다(온보딩 후 다시 돌리면 실행된다).
if (!existsSync(AGENTS_FILE)) {
  console.log(`[SKIP] jobtype-template-test — ${AGENTS_FILE} 없음 (미프로비저닝 설치본)`);
  console.log("       온보딩으로 직원 명단이 생성된 뒤 실행하면 검증됩니다.");
  process.exit(0);
}

// 백업 후 임시 채용 → 검증 → 원복
const original = readFileSync(AGENTS_FILE, "utf-8");
const data = JSON.parse(original) as { agents: Array<Record<string, unknown>> };

// 기준선은 반드시 레지스트리에서 "채용 전"에 잡는다 — agents.json의 배열 길이가 아니다.
// getAllWorkerAgents()는 agents.json 등재분 + config/agents/*/meta.json 자동등재분(15-D)을
// 합친 결과다. agents.json 길이를 기준선으로 쓰면 비교 양변의 출처가 달라져,
// 자동등재 직원이 한 명이라도 있는 순간 이 단언은 영구 red가 된다.
// (2026-08-10 실측: agents.json 20 + 자동등재 10 = 30 → "expected 24, got 34"로 상시 실패)
const { getAllWorkerAgents, ensureAllAgentDirs, consumeUnknownJobTypes } = await import("../src/agent-registry.js");
const beforeIds = new Set(getAllWorkerAgents().map((a) => a.id));

// 가상 채용: jobType 미존재(marketer) + 인라인 systemPrompt 미설정
data.agents.push({
  id: VIRT_ID,
  name: "마크",
  team: "마케팅팀",
  role: "마케팅 리드",
  jobType: "marketer",
  isCore: false,
  allowedTools: ["WebSearch"],
  maxTurns: 30,
  bashTagSupport: false,
  routeKeywords: [],
  adapter: "claude-code",
  readPaths: ["/history/**"],
  writePaths: [`/history/outputs/${VIRT_ID}/**`],
});
// 가상 채용: jobType 존재(developer)
data.agents.push({
  id: VIRT_JOBTYPE_KNOWN_ID,
  name: "데니",
  team: "개발팀",
  role: "주니어 개발자",
  jobType: "developer",
  isCore: false,
  manager: "dev-pm",
  allowedTools: [],
  maxTurns: 30,
  bashTagSupport: true,
  routeKeywords: [],
  adapter: "claude-code",
  readPaths: ["/**"],
  writePaths: [`/history/outputs/${VIRT_JOBTYPE_KNOWN_ID}/**`],
});
// 가상 채용: 로컬 오버라이드 우선 검증용
data.agents.push({
  id: VIRT_LOCAL_ID,
  name: "로키",
  team: "테스트팀",
  role: "테스터",
  jobType: "qa",
  isCore: false,
  allowedTools: [],
  maxTurns: 30,
  bashTagSupport: false,
  routeKeywords: [],
  adapter: "claude-code",
  readPaths: ["/**"],
  writePaths: [`/history/outputs/${VIRT_LOCAL_ID}/**`],
});
// 가상 채용: 인라인 systemPrompt 최우선 검증용
data.agents.push({
  id: VIRT_INLINE_ID,
  name: "인라이",
  team: "임시팀",
  role: "임시 직원",
  jobType: "developer",
  isCore: false,
  systemPrompt: "INLINE_PROMPT_MARKER_42",
  allowedTools: [],
  maxTurns: 30,
  bashTagSupport: false,
  routeKeywords: [],
  adapter: "claude-code",
  readPaths: ["/**"],
  writePaths: [`/history/outputs/${VIRT_INLINE_ID}/**`],
});

const preMtime = statSync(AGENTS_FILE).mtimeMs;
writeFileSync(AGENTS_FILE, JSON.stringify(data, null, 2));
// loadAgents()는 mtime으로 캐시를 무효화한다(agent-registry.ts). 위에서 기준선을 잡느라
// 이미 캐시가 채워졌으므로, 쓰기가 같은 ms에 떨어지면 재로드가 일어나지 않아 가상 4명이
// 조회되지 않는다(flaky). mtime이 안 변했으면 명시적으로 밀어준다.
if (statSync(AGENTS_FILE).mtimeMs === preMtime) {
  const t = new Date(preMtime + 10);
  utimesSync(AGENTS_FILE, t, t);
}

// 로컬 오버라이드 파일 미리 작성
const localDir = join(HIST_AGENTS, VIRT_LOCAL_ID);
mkdirSync(localDir, { recursive: true });
writeFileSync(join(localDir, "system-prompt.md"), "LOCAL_OVERRIDE_MARKER_99 — {{NAME}} / {{ID}}");

try {
  // mtime 가드 우회: agents.json 변경됨 → loadAgents가 재로드
  ensureAllAgentDirs();
  const all = getAllWorkerAgents();

  // ① 신규 직원 4명이 등록됐는지 — 검증 대상은 총원 절대값이 아니라 "증분 4"다.
  // ID 집합으로 비교하므로 조직 인원·자동등재 수가 어떻게 변해도 영향을 받지 않는다.
  const afterIds = new Set(all.map((a) => a.id));
  const VIRT_IDS = [VIRT_ID, VIRT_JOBTYPE_KNOWN_ID, VIRT_LOCAL_ID, VIRT_INLINE_ID];
  const missingVirt = VIRT_IDS.filter((id) => !afterIds.has(id));
  check(
    "① 가상 채용 등록 (4명 추가)",
    missingVirt.length === 0 && afterIds.size === beforeIds.size + 4,
    `before=${beforeIds.size}, after=${afterIds.size}, 누락=[${missingVirt.join(", ")}]`,
  );

  // ② 자동 디렉토리/파일 생성
  for (const id of [VIRT_ID, VIRT_JOBTYPE_KNOWN_ID, VIRT_LOCAL_ID, VIRT_INLINE_ID]) {
    check(`② [${id}] wiki/index.md 자동 생성`, existsSync(join(HIST_AGENTS, id, "wiki", "index.md")));
    check(`② [${id}] wiki/role-directive.md 자동 생성`, existsSync(join(HIST_AGENTS, id, "wiki", "role-directive.md")));
    check(`② [${id}] wiki/daily/ 자동 생성`, existsSync(join(HIST_AGENTS, id, "wiki", "daily")));
    check(`② [${id}] outputs/ 자동 생성`, existsSync(join(HIST_OUTPUTS, id)));
  }

  // ③ jobType 폴백 (marketer → general.md)
  const general = readFileSync(join(TEMPLATES, "general.md"), "utf-8");
  const marketer = all.find((a) => a.id === VIRT_ID);
  // general 템플릿의 첫 50자가 마크 시스템 프롬프트에 들어가는지
  const generalHead = general.slice(0, 30);
  // 플레이스홀더가 있으므로 첫 30자 이내 변수 부재 가정 → "당신의 역할과 업무 범위는 위키"
  check(
    "③ jobType 미존재 (marketer) → general.md 폴백",
    typeof marketer?.systemPrompt === "string" && marketer.systemPrompt.includes(generalHead.split("{{")[0]!.slice(0, 20)),
    `marketer.systemPrompt head=${marketer?.systemPrompt?.slice(0, 60)}`,
  );

  // ④ jobType 폴백 시 toast 대상 등록
  const unknown = consumeUnknownJobTypes();
  check("④ marketer jobType이 unknown 셋에 등록됨", unknown.includes("marketer"));

  // ⑤ 플레이스홀더 8개 치환
  const dennis = all.find((a) => a.id === VIRT_JOBTYPE_KNOWN_ID);
  const sp = dennis?.systemPrompt ?? "";
  check("⑤-1 {{NAME}} 치환 (데니 포함)", sp.includes("데니"));
  check("⑤-2 {{ID}} 치환", sp.includes(VIRT_JOBTYPE_KNOWN_ID));
  check("⑤-3 {{ROLE}} 치환 (주니어 개발자 포함)", sp.includes("주니어 개발자"));
  check("⑤-4 {{TEAM}} 치환 (개발팀 포함)", sp.includes("개발팀"));
  check("⑤-5 {{COWORKERS}} 치환 (다른 직원 이름 1명 이상 포함)", /데이브|리사|잭키|로키|마크|인라이/.test(sp));
  check("⑤-6 {{OUTPUT_DIR}} 치환", sp.includes(`history/outputs/${VIRT_JOBTYPE_KNOWN_ID}`));
  check("⑤-7 {{WIKI_DIR}} 치환", sp.includes(`history/agents/${VIRT_JOBTYPE_KNOWN_ID}/wiki`));
  check("⑤-8 미치환 잔존 없음 ({{ 패턴 0건)", !sp.includes("{{"));

  // ⑥ 직군 템플릿 적용 (developer.md의 셀프 수정 안전 원칙 텍스트가 데니 sp에 포함)
  check("⑥ developer.md 적용 (셀프 수정 안전 원칙 포함)", sp.includes("셀프 수정 안전 원칙"));

  // ⑦ qa.md 템플릿에는 카테고리 C 항목(## 핵심 마인드셋·## 보고 형식)이 없어야 함
  const qaTmpl = readFileSync(join(TEMPLATES, "qa.md"), "utf-8");
  check("⑦-1 qa.md 템플릿에서 ## 핵심 마인드셋 제거됨", !qaTmpl.includes("## 핵심 마인드셋"));
  check("⑦-2 qa.md 템플릿에서 ## 보고 형식 제거됨", !qaTmpl.includes("## 보고 형식"));
  check("⑦-3 qa.md 템플릿에 ## 코드 QA 방법 잔존", qaTmpl.includes("## 코드 QA 방법"));

  // ⑧ 인라인 systemPrompt 최우선 (0단계)
  const inline = all.find((a) => a.id === VIRT_INLINE_ID);
  check("⑧ 인라인 systemPrompt 0단계 우선 (INLINE_PROMPT_MARKER_42)",
    inline?.systemPrompt === "INLINE_PROMPT_MARKER_42");

  // ⑨ 로컬 오버라이드 1단계 우선 (qa.md 템플릿 무시)
  const loki = all.find((a) => a.id === VIRT_LOCAL_ID);
  check("⑨-1 로컬 오버라이드 1단계 우선 (LOCAL_OVERRIDE_MARKER_99)",
    typeof loki?.systemPrompt === "string" && loki.systemPrompt.includes("LOCAL_OVERRIDE_MARKER_99"));
  check("⑨-2 로컬 오버라이드 내 플레이스홀더도 치환됨 ({{NAME}} → 로키)",
    typeof loki?.systemPrompt === "string" && loki.systemPrompt.includes("로키"));

  // ⑩ 코어 직원 systemPrompt 정상
  const dave = all.find((a) => a.id === "dev-pm");
  check("⑩-1 dev-pm systemPrompt 비어있지 않음 (developer.md 적용)",
    typeof dave?.systemPrompt === "string" && dave.systemPrompt.length > 100);
  const devPmCfg = data.agents.find((a) => a.id === "dev-pm");
  const devPmName = typeof devPmCfg?.name === "string" ? devPmCfg.name : "";
  check(`⑩-2 dev-pm systemPrompt에 {{NAME}}이 '${devPmName}'로 치환됨`,
    devPmName.length > 0 && typeof dave?.systemPrompt === "string" && dave.systemPrompt.includes(devPmName));

  // ⑪ 가상 해고 — agents.json에서 제거 후 디렉토리 잔존 확인
  data.agents = data.agents.filter((a) =>
    a.id !== VIRT_ID && a.id !== VIRT_JOBTYPE_KNOWN_ID && a.id !== VIRT_LOCAL_ID && a.id !== VIRT_INLINE_ID
  );
  writeFileSync(AGENTS_FILE, JSON.stringify(data, null, 2));

  for (const id of [VIRT_ID, VIRT_JOBTYPE_KNOWN_ID, VIRT_LOCAL_ID, VIRT_INLINE_ID]) {
    check(`⑪ 가상 해고 후 [${id}] 디렉토리 잔존`,
      existsSync(join(HIST_AGENTS, id, "wiki")) && existsSync(join(HIST_OUTPUTS, id)));
  }
} finally {
  // 복구: agents.json 원본 + 가상 디렉토리 청소
  writeFileSync(AGENTS_FILE, original);
  for (const id of [VIRT_ID, VIRT_JOBTYPE_KNOWN_ID, VIRT_LOCAL_ID, VIRT_INLINE_ID]) {
    const ad = join(HIST_AGENTS, id);
    const od = join(HIST_OUTPUTS, id);
    if (existsSync(ad)) rmSync(ad, { recursive: true, force: true });
    if (existsSync(od)) rmSync(od, { recursive: true, force: true });
  }
  // mtime 변경 이상 감지 (워치독)
  try {
    const m = statSync(AGENTS_FILE).mtimeMs;
    if (!Number.isFinite(m)) console.log("[WARN] agents.json mtime 비정상");
  } catch { /* */ }
}

console.log(`\n=== ${pass}/${pass + fail} PASS, ${fail} FAIL ===`);
process.exit(fail === 0 ? 0 : 1);
