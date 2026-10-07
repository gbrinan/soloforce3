// 아난다라 교육 → MyCrew 교육 프로젝트 폴더 동기화 (mycrew-works/education/<고객사>/)
//
// anandara-sync.ts가 교육을 "일정"으로 옮긴다면, 이 모듈은 교육을 "프로젝트"로 세운다.
// 일정은 시각을 알려주고, 프로젝트는 교안·피드백·제안이 쌓이는 집이 된다.
//
// 설계:
// - 교육 사실의 소스 오브 트루스는 아난다라(Supabase). 여기서는 읽기만 하고, 사본이 아니라
//   교육 id를 명시한 파생 뷰를 남긴다. 아난다라 쪽 데이터는 절대 수정하지 않는다.
// - 프로젝트 정체성 = client_name(고객사). company_id는 정산 벤더라 프로젝트 키가 아니다.
//   같은 고객사의 다른 날짜 교육은 새 프로젝트가 아니라 같은 프로젝트의 '회차'다.
// - 이름 표기가 흔들려도(공백·전각) 폴더가 갈라지지 않도록 .registry.json이
//   정규화한 고객사명 → 폴더 slug 매핑을 들고 있다. 매핑은 한 번 정해지면 바뀌지 않는다.
// - 자동 생성 표면은 project.json의 sync 소유 키와 00-sessions/sessions.md 둘뿐.
//   10-curriculum(교안)·20-feedback·30-proposals·outputs는 사람과 에이전트의 것이고
//   동기화가 절대 덮어쓰지 않는다. 씨앗 파일은 없을 때 한 번만 만든다.
// - sessions.md는 매 회 통째로 다시 쓴다 — 변경 이력이 아니라 지금 무엇이 참인가를 담는다.
// - 멱등: 쓰려는 내용이 디스크와 같으면 쓰지 않는다. 새 교육이 없는 날엔 한 바이트도 안 바뀐다.
// - 폴더는 어떤 경우에도 삭제하지 않는다. 아난다라에서 교육이 사라져도 사람이 쓴 교안과
//   제안은 남아 있고, 취소된 회차는 지우는 대신 취소로 표시한다.
// - 실패는 조용히 로그만 — 아난다라가 꺼져 있어도 MyCrew 본체에 영향 없음. 다음 주기에 재시도.
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { PROJECTS_DIR, HISTORY_DIR } from "../config.js";
import { createSSOToken } from "./sso-token.js";

const ANANDARA_BASE = process.env.ANANDARA_BASE_URL || "http://127.0.0.1:13210";
const OWNER_EMAIL = process.env.MYCREW_OWNER_EMAIL || "gbrielkim@gmail.com";
const SYNC_INTERVAL_MS = 24 * 60 * 60_000; // 하루 1회 (수동은 POST /api/anandara-projects-sync)

// 조회 창 — 일정 동기화(앞 3개월)보다 넓다. 프로젝트는 지난 회차까지 한 장에 모아야 하기 때문.
const MONTHS_BACK = 12;
const MONTHS_FORWARD = 3;

// 카테고리 폴더 이름. mycrew-works/<카테고리>/<프로젝트> 2단 구조의 윗단.
export const EDUCATION_CATEGORY = "education";

interface AnandaraEducation {
  id: string;
  edu_date: string;    // YYYY-MM-DD
  start_time: string;  // HH:MM(:SS)
  end_time: string;
  client_name: string;
  topic?: string | null;
  curriculum?: string | null;
  location?: string | null;
  is_seoul?: boolean;
  hours?: number;
  rate_set?: boolean;  // 사람이 시급을 채웠는가 = 진짜 교육으로 확정했는가
  status?: string;     // scheduled | completed | cancelled
  is_tentative?: boolean; // 가예약(미정) — 확정된 회차가 아니다
}

interface Registry { clients: Record<string, string> } // 정규화 고객사명 → 폴더 slug

let timer: NodeJS.Timeout | null = null;

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// 교육으로 볼 것인가 — 아난다라 educations 테이블은 구글 캘린더에서 가져온 개인 일정까지
// 함께 담는다(gcal-actions.ts가 모든 이벤트를 hourly_rate=0으로 넣는다). 그래서 프로젝트를
// 세울 자격은 앱 자신의 신호로 판정한다: 사람이 시급을 채워 '정보 입력 필요'를 해소한 건.
// 길이 0(종일·미정) 일정은 시급과 무관하게 제외한다 — 교육 회차가 아니다.
// 판정을 못 하면(구버전 아난다라라 rate_set이 없으면) 통과시키지 않는다 — 아래 syncAnandaraProjects가
// 그 상황을 아예 중단으로 처리하므로, 여기서 조용히 개인 일정을 프로젝트로 만들 일은 없다.
function isRealEducation(e: AnandaraEducation): boolean {
  if (e.start_time === e.end_time) return false; // 종일·미정
  return e.rate_set === true;
}

// 프로젝트 식별에서 걷어낼 표기 — 가져오기 상태 표시와 회차 꼬리표는 정체성이 아니다.
// 벤더 접두어([스파르타] 등)는 남긴다: 같은 벤더를 통한 같은 고객이 한 프로젝트다.
const IMPORT_MARKERS = /^(?:⚠\s*충돌\s*|\[미정\]\s*)+/;
const SESSION_SUFFIX = /\s*(?:\d+\s*일차|\d+\s*차|\d+\s*h)\s*$/i;

// 프로젝트 표시 이름 — "경주 본교육 1일차/2일차/3일차"가 세 프로젝트로 갈라지지 않게
// 회차 꼬리표와 가져오기 표시를 뗀다. 원래 이름은 회차 표에 그대로 남는다.
function projectName(clientName: string): string {
  let n = clientName.replace(IMPORT_MARKERS, "").trim();
  for (let i = 0; i < 3 && SESSION_SUFFIX.test(n); i++) n = n.replace(SESSION_SUFFIX, "").trim();
  return n || clientName.trim();
}

// 고객사명 정규화 — 표기 흔들림(앞뒤 공백·연속 공백·전각 공백·대소문자)을 흡수해
// 같은 고객사가 두 폴더로 갈라지는 것을 막는다. 폴더 이름이 아니라 매핑 키로만 쓴다.
function normalizeClient(name: string): string {
  return projectName(name).replace(/[\s　]+/g, " ").trim().toLowerCase();
}

// 폴더 이름 — 한글은 살리고 파일시스템이 거부하는 문자만 바꾼다.
function slugify(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, "-")                 // 윈도우 금지 문자
    .replace(/[\x00-\x1f\x7f]/g, "")            // 제어 문자
    .replace(/[\s　]+/g, " ")
    .replace(/-{2,}/g, "-")
    .trim()
    .replace(/^[.\s-]+|[.\s-]+$/g, "");            // 선후행 점·공백·하이픈 (윈도우가 싫어함)
  return (cleaned || "미상").slice(0, 60);
}

function educationDir(): string {
  return join(PROJECTS_DIR, EDUCATION_CATEGORY);
}

function registryPath(): string {
  return join(educationDir(), ".registry.json");
}

function loadRegistry(): Registry {
  try {
    const raw = JSON.parse(readFileSync(registryPath(), "utf-8"));
    if (raw && typeof raw === "object" && raw.clients && typeof raw.clients === "object") return raw as Registry;
  } catch { /* 없거나 깨졌으면 새로 시작 — 아래 slug 결정이 기존 폴더를 다시 집는다 */ }
  return { clients: {} };
}

// 고객사 → 폴더 slug. 한 번 정해진 매핑은 유지하고, 충돌하면 결정론적으로 -2, -3을 붙인다.
// base 폴더가 이미 있는데 레지스트리에 없다면(수기 생성) 그 폴더를 그대로 채택한다.
function resolveSlug(reg: Registry, clientName: string): string {
  const key = normalizeClient(clientName);
  const known = reg.clients[key];
  if (known) return known;

  const base = slugify(clientName);
  const taken = new Set(Object.values(reg.clients));
  let slug = base;
  for (let n = 2; taken.has(slug); n++) {
    slug = `${base}-${n}`;
    if (n > 99) break; // 방어 — 현실에서 닿지 않는다
  }
  reg.clients[key] = slug;
  return slug;
}

// 내용이 같으면 쓰지 않는다 — 바뀐 게 없는 날은 mtime도 건드리지 않는다.
function writeIfChanged(path: string, content: string): boolean {
  try {
    if (existsSync(path) && readFileSync(path, "utf-8") === content) return false;
  } catch { /* 읽기 실패 시 아래에서 덮어쓴다 */ }
  writeFileSync(path, content, "utf-8");
  return true;
}

// 없을 때 한 번만 만든다 — 사람이 쓴 내용을 절대 덮지 않는다.
function seedOnce(path: string, content: string): boolean {
  if (existsSync(path)) return false;
  writeFileSync(path, content, "utf-8");
  return true;
}

async function fetchMonth(month: string): Promise<AnandaraEducation[] | null> {
  try {
    const token = createSSOToken(OWNER_EMAIL);
    const res = await fetch(
      `${ANANDARA_BASE}/api/apps/anandara/proxy/api/mycrew/educations?month=${month}&ssoToken=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) return null;
    const data = await res.json() as { ok?: boolean; educations?: AnandaraEducation[] };
    if (!data.ok || !Array.isArray(data.educations)) return null;
    return data.educations;
  } catch {
    return null; // 앱 미기동 등 — 다음 주기에 재시도
  }
}

function hhmm(t: string): string {
  return t.slice(0, 5);
}

const STATUS_LABEL: Record<string, string> = {
  scheduled: "예정",
  completed: "완료",
  cancelled: "취소",
};

// 회차 표 — 아난다라에서 파생된 읽기 전용 뷰. 매번 통째로 다시 쓴다.
function renderSessions(clientName: string, rows: AnandaraEducation[]): string {
  const sorted = [...rows].sort((a, b) =>
    a.edu_date === b.edu_date ? a.start_time.localeCompare(b.start_time) : a.edu_date.localeCompare(b.edu_date));
  const live = sorted.filter((e) => e.status !== "cancelled");

  const lines: string[] = [];
  lines.push(`# ${clientName} 교육 회차`);
  lines.push("");
  lines.push("아난다라에서 파생된 읽기 전용 뷰입니다. 손으로 고치면 다음 동기화에 덮어써집니다.");
  lines.push("일정·시간·교안 원문을 바꾸려면 아난다라에서 바꾸세요.");
  lines.push("");
  lines.push(`유효 회차 ${live.length}건 / 전체 ${sorted.length}건 (취소 ${sorted.length - live.length}건)`);
  lines.push("");
  lines.push("| 날짜 | 시간 | 상태 | 주제 | 장소 | 시수 | 교육 id |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const e of sorted) {
    const cells = [
      e.edu_date,
      `${hhmm(e.start_time)}–${hhmm(e.end_time)}`,
      STATUS_LABEL[e.status ?? "scheduled"] ?? (e.status ?? "-"),
      e.topic || "-",
      e.location || "-",
      e.hours != null ? `${e.hours}h` : "-",
      `\`${e.id}\``,
    ].map((c) => String(c).replace(/\|/g, "\\|"));
    lines.push(`| ${cells.join(" | ")} |`);
  }

  const withCurriculum = sorted.filter((e) => (e.curriculum ?? "").trim());
  if (withCurriculum.length) {
    lines.push("");
    lines.push("## 아난다라에 등록된 교안 메모");
    lines.push("");
    lines.push("아난다라 `curriculum` 필드 원문입니다. 본격적인 교안은 `10-curriculum/`에 씁니다.");
    for (const e of withCurriculum) {
      lines.push("");
      lines.push(`### ${e.edu_date}${e.topic ? ` — ${e.topic}` : ""}`);
      lines.push("");
      lines.push((e.curriculum ?? "").trim());
    }
  }
  lines.push("");
  return lines.join("\n");
}

// project.json에서 이 모듈이 소유하는 필드. 나머지(status·ciColors·decisions·memo 등)는
// 사람 소유이며 병합 시 그대로 보존한다.
function buildSyncFields(clientName: string, rows: AnandaraEducation[]): Record<string, unknown> {
  const live = rows.filter((e) => e.status !== "cancelled");
  const dates = live.map((e) => e.edu_date).sort();
  return {
    hierarchy: ["교육", clientName],
    name: `${clientName} 교육`,
    type: "education",
    source: "아난다라(Supabase) educations — client_name 기준. 일정·시수·교안 원문의 소스 오브 트루스.",
    anandaraClient: clientName,
    anandaraSessions: {
      total: rows.length,
      live: live.length,
      cancelled: rows.length - live.length,
      firstDate: dates[0] ?? null,
      lastDate: dates[dates.length - 1] ?? null,
      educationIds: rows.map((e) => e.id).sort(),
    },
    folders: {
      "00-sessions": "아난다라 파생 회차 표 (자동 생성 — 손대지 말 것)",
      "10-curriculum": "교안 — 차시별 설계, 슬라이드 원고, 실습 자료",
      "20-feedback": "현장 피드백 — 수강생 반응, 운영 이슈, 회고",
      "30-proposals": "제안사항 — 후속 과정, AX 전환 제안, 견적 근거",
      outputs: "발행본 — 고객사에 실제로 나간 산출물",
    },
    generatedBy: "anandara-projects.ts",
  };
}

// project.json 병합 — sync 소유 키만 갱신하고 사람이 쓴 키는 그대로 둔다.
function mergeProjectJson(path: string, clientName: string, rows: AnandaraEducation[], today: string): boolean {
  let cur: Record<string, unknown> = {};
  let existed = false;
  try {
    if (existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, "utf-8"));
      if (raw && typeof raw === "object") { cur = raw as Record<string, unknown>; existed = true; }
    }
  } catch { /* 깨진 파일은 아래에서 sync 키 + 씨앗 값으로 재구성 */ }

  const next: Record<string, unknown> = { ...cur, ...buildSyncFields(clientName, rows) };

  // 씨앗 값 — 최초 생성 때만 넣고, 이후에는 사람 편집을 존중해 손대지 않는다.
  if (!existed) {
    next.createdAt = today;
    next.status = "교육 진행 중";
    next.ciColors = {
      primary: null, secondary: null, accent: null, source: null,
      note: "프로젝트(고객사)마다 필수 등록. 공식 브랜드 자료에서만 추출(임의 추정 금지). null이면 슬라이드는 중립 팔레트+CI 미등록 경고로 생성.",
    };
    next.decisions = [];
  }

  // 키 순서를 안정화해 병합만으로 diff가 생기지 않게 한다.
  const ordered: Record<string, unknown> = {};
  const head = ["hierarchy", "name", "type", "status", "createdAt", "source", "anandaraClient", "anandaraSessions", "folders"];
  for (const k of head) if (k in next) ordered[k] = next[k];
  for (const k of Object.keys(next).sort()) if (!(k in ordered)) ordered[k] = next[k];

  return writeIfChanged(path, JSON.stringify(ordered, null, 2) + "\n");
}

const SEEDS: { dir: string; file: string; body: (c: string) => string }[] = [
  {
    dir: "10-curriculum", file: "README.md",
    body: (c) => `# ${c} 교안\n\n차시별 설계, 슬라이드 원고, 실습 자료를 여기에 둡니다.\n아난다라 \`curriculum\` 필드의 짧은 메모는 \`00-sessions/sessions.md\` 아래쪽에 그대로 실려 있으니, 그것을 출발점으로 삼아 실제 교안을 씁니다.\n동기화는 이 폴더를 건드리지 않습니다.\n`,
  },
  {
    dir: "20-feedback", file: "README.md",
    body: (c) => `# ${c} 현장 피드백\n\n수강생 반응, 운영 이슈, 강의 후 회고를 회차별로 남깁니다.\n다음 제안(\`30-proposals/\`)의 근거가 되므로, 인상이 아니라 관찰한 사실과 그 출처를 씁니다.\n동기화는 이 폴더를 건드리지 않습니다.\n`,
  },
  {
    dir: "30-proposals", file: "README.md",
    body: (c) => `# ${c} 제안사항\n\n후속 과정, AX 전환 제안, 견적 근거를 씁니다.\n각 제안은 \`20-feedback/\`의 관찰이나 \`00-sessions/sessions.md\`의 회차 사실을 근거로 걸고, 근거 없는 제안은 두지 않습니다.\n고객사에 실제로 나간 판본은 \`outputs/\`로 옮깁니다.\n동기화는 이 폴더를 건드리지 않습니다.\n`,
  },
];

export interface ProjectSyncResult { created: number; updated: number; clients: number; skipped: number }

export async function syncAnandaraProjects(): Promise<ProjectSyncResult | null> {
  // 1) 조회 창의 교육 수집
  const now = new Date();
  const months: string[] = [];
  for (let i = -MONTHS_BACK; i <= MONTHS_FORWARD; i++) {
    months.push(monthKey(new Date(now.getFullYear(), now.getMonth() + i, 1)));
  }
  const edus = new Map<string, AnandaraEducation>();
  let anyOk = false;
  for (const m of months) {
    const rows = await fetchMonth(m);
    if (rows === null) continue;
    anyOk = true;
    for (const e of rows) {
      if (e?.id && e.edu_date && e.start_time && e.end_time && e.client_name) edus.set(e.id, e);
    }
  }
  if (!anyOk) return null; // 한 달도 못 읽었으면 아무것도 만들지 않는다

  // 2) 판정 근거 확인 — rate_set이 응답에 없는 구버전 아난다라라면 교육과 개인 일정을 가를 수 없다.
  //    그 상태로 진행하면 캘린더의 개인 일정까지 프로젝트가 되므로, 아무것도 만들지 않고 멈춘다.
  const hasRateSignal = [...edus.values()].some((e) => typeof e.rate_set === "boolean");
  if (edus.size > 0 && !hasRateSignal) {
    console.warn("[AnandaraProjects] 중단: 아난다라 응답에 rate_set이 없습니다 — 교육과 개인 일정을 구분할 수 없어 아무것도 만들지 않았습니다. 아난다라를 재빌드·재기동하세요.");
    return null;
  }

  // 3) 교육만 남기고 고객사별로 묶기 — 같은 고객사의 다른 날짜는 회차이지 새 프로젝트가 아니다
  const byClient = new Map<string, { name: string; rows: AnandaraEducation[] }>();
  let skipped = 0;
  for (const e of edus.values()) {
    if (!isRealEducation(e)) { skipped++; continue; }
    const key = normalizeClient(e.client_name);
    if (!key) { skipped++; continue; }
    const cur = byClient.get(key);
    if (cur) cur.rows.push(e);
    else byClient.set(key, { name: projectName(e.client_name), rows: [e] });
  }

  // 4) 프로젝트 폴더 upsert — 삭제는 없다
  const dir = educationDir();
  mkdirSync(dir, { recursive: true });
  const reg = loadRegistry();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  let created = 0, updated = 0;

  for (const { name, rows } of byClient.values()) {
    const slug = resolveSlug(reg, name);
    const projDir = join(dir, slug);
    const isNew = !existsSync(projDir);

    mkdirSync(join(projDir, "00-sessions"), { recursive: true });
    for (const s of SEEDS) mkdirSync(join(projDir, s.dir), { recursive: true });
    mkdirSync(join(projDir, "outputs"), { recursive: true });

    let touched = false;
    touched = mergeProjectJson(join(projDir, "project.json"), name, rows, today) || touched;
    touched = writeIfChanged(join(projDir, "00-sessions", "sessions.md"), renderSessions(name, rows)) || touched;
    for (const s of SEEDS) touched = seedOnce(join(projDir, s.dir, s.file), s.body(name)) || touched;

    if (isNew) created++;
    else if (touched) updated++;
  }

  writeIfChanged(registryPath(), JSON.stringify(reg, null, 2) + "\n");

  if (created || updated) {
    console.log(`[AnandaraProjects] 교육→프로젝트 동기화: +${created} ~${updated} (고객사 ${byClient.size}곳, 교육 아님으로 제외 ${skipped}건, ${months[0]}~${months[months.length - 1]})`);
  }

  // 5) D-3 교육자료 제작 훅 — 방금 읽어온 educations를 그대로 넘긴다(추가 조회 없음).
  //    훅이 실패해도 폴더 동기화 결과는 유효하므로 삼키고 로그만 남긴다.
  try {
    await scanEduMaterialHooks(edus);
  } catch (err) {
    console.warn("[AnandaraProjects] D-3 교육자료 훅 실패:", err instanceof Error ? err.message : err);
  }

  // 6) 지난 교육 자동 완료 훅 — 같은 educations를 그대로 쓴다(추가 조회·새 스케줄러 없음).
  //    D-3 훅과 마찬가지로 실패를 삼킨다 — 폴더 동기화 결과는 이미 유효하다.
  try {
    await completePastEducations(edus);
  } catch (err) {
    console.warn("[AnandaraProjects] 지난 교육 자동 완료 훅 실패:", err instanceof Error ? err.message : err);
  }

  return { created, updated, clients: byClient.size, skipped };
}

// ── D-3 교육자료 제작 훅 ────────────────────────────────────────────
//
// 교육이 사흘 앞으로 오면 "이 교육의 교육자료를 만들어야 한다"는 요청이 스스로 생긴다.
// 아난이 교육자료를 만드는 손은 보통 GPT Image 2.0(지피티/gpt-runner)이라, 알림은 그 손을
// 가리킨다. 판단과 착수는 무아의 몫이고 여기서는 사실과 자리만 정확히 넘긴다.
//
// 설계:
// - 새 폴링 루프를 만들지 않는다. 위 일 1회 프로젝트 동기화가 이미 읽어온 educations를 그대로 쓴다.
// - 같은 교육으로 두 번 조르지 않는다 — 발화한 eduId를 상태 파일에 남기고, 재시작·수동 재실행에도
//   그 기록이 먼저다(멱등). 알림은 취소할 수 없으니 중복은 결함이다.
// - 날짜는 KST 달력 문자열로만 비교한다. 두 시각의 밀리초 차로 재면 자정 근처에서 D-3가
//   D-2나 D-4로 밀린다.
const EDU_MATERIAL_LEAD_DAYS = 3;
// 발화 기록 보존 창 — 이보다 오래된 교육은 다시 D-3가 될 수 없으므로 지워도 재발화하지 않는다.
const HOOK_RETENTION_DAYS = 365;

interface EduHookState {
  fired: Record<string, { firedAt: string; eduDate: string; client: string }>;
}

function hooksPath(): string {
  return join(HISTORY_DIR, "anandara", "edu-material-hooks.json");
}

function loadHookState(): EduHookState {
  try {
    const raw = JSON.parse(readFileSync(hooksPath(), "utf-8"));
    if (raw && typeof raw === "object" && raw.fired && typeof raw.fired === "object") return raw as EduHookState;
  } catch { /* 없거나 깨졌으면 빈 상태로 시작 */ }
  return { fired: {} };
}

function saveHookState(state: EduHookState): void {
  mkdirSync(dirname(hooksPath()), { recursive: true });
  writeFileSync(hooksPath(), JSON.stringify(state, null, 2) + "\n", "utf-8");
}

/** KST(UTC+9, 서머타임 없음) 기준 오늘 YYYY-MM-DD. */
function kstToday(): string {
  return new Date(Date.now() + 9 * 60 * 60_000).toISOString().slice(0, 10);
}

/** KST 달력 날짜에 일수를 더한다 — 시각이 아니라 날짜 계산이라 경계에서 밀리지 않는다. */
function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** 이 교육이 속한 프로젝트 폴더 — 레지스트리는 읽기만 한다(새 매핑을 만들지 않는다). */
function projectDirFor(clientName: string, reg: Registry): string {
  const name = projectName(clientName);
  return join(educationDir(), reg.clients[normalizeClient(name)] ?? slugify(name));
}

/** 무아에게 넘길 요청 본문 — 교육 사실 + 자료가 쌓일 자리 + 권장 도구. */
function renderMaterialRequest(e: AnandaraEducation, projDir: string): string {
  const client = projectName(e.client_name);
  return [
    `[아난다라 D-${EDU_MATERIAL_LEAD_DAYS}] 교육자료 제작 필요 — ${client}`,
    "",
    `- 교육일자: ${e.edu_date} ${hhmm(e.start_time)}–${hhmm(e.end_time)} (KST)`,
    `- 고객사: ${client}`,
    `- 과정명: ${e.topic || "(미지정)"}`,
    `- 장소: ${e.location || "(미지정)"}`,
    `- 프로젝트 폴더: ${projDir}`,
    `  · 교안은 10-curriculum/, 발행본은 outputs/ 에 둡니다.`,
    "",
    "교육자료 제작 필요 — GPT Image 2.0(지피티/gpt-runner) 사용 권장.",
    `교육 id: ${e.id}`,
  ].join("\n");
}

export interface EduMaterialScanResult {
  scanned: number;      // 조회 창에서 본 교육 수
  matched: number;      // D-3에 해당한 교육 수
  fired: number;        // 이번에 새로 발화한 요청 수 (이미 발화분은 제외)
  targetDate: string;   // D-3 대상 날짜 (KST)
}

/**
 * D-3 교육을 골라 교육자료 제작 요청을 발생시킨다.
 * @param preloaded 프로젝트 동기화가 이미 읽어온 educations (있으면 재조회하지 않는다)
 * @returns 아난다라를 한 달도 못 읽었으면 null (수동 호출 시에만 발생)
 */
export async function scanEduMaterialHooks(
  preloaded?: Map<string, AnandaraEducation>,
): Promise<EduMaterialScanResult | null> {
  let edus = preloaded;
  if (!edus) {
    // 수동 호출 — 일정 동기화와 같은 3개월 창(이번 달 포함)만 본다. D-3는 언제나 이 안에 든다.
    const now = new Date();
    const map = new Map<string, AnandaraEducation>();
    let anyOk = false;
    for (let i = 0; i <= MONTHS_FORWARD; i++) {
      const rows = await fetchMonth(monthKey(new Date(now.getFullYear(), now.getMonth() + i, 1)));
      if (rows === null) continue;
      anyOk = true;
      for (const e of rows) {
        if (e?.id && e.edu_date && e.start_time && e.end_time && e.client_name) map.set(e.id, e);
      }
    }
    if (!anyOk) return null;
    edus = map;
  }

  const today = kstToday();
  const targetDate = addDays(today, EDU_MATERIAL_LEAD_DAYS);
  const state = loadHookState();
  const reg = loadRegistry();

  // 취소된 회차와 개인 일정(rate_set 미확정)은 자료를 만들 대상이 아니다.
  const matched = [...edus.values()].filter(
    (e) => e.edu_date === targetDate && e.status !== "cancelled" && isRealEducation(e),
  );

  let fired = 0;
  const { addGenieMessage } = await import("./chat.js"); // 순환 참조 방지
  for (const e of matched) {
    if (state.fired[e.id]) continue; // 이미 발화 — 재시작·수동 재실행에도 다시 조르지 않는다
    addGenieMessage(renderMaterialRequest(e, projectDirFor(e.client_name, reg)), { internal: true });
    state.fired[e.id] = {
      firedAt: new Date().toISOString(),
      eduDate: e.edu_date,
      client: projectName(e.client_name),
    };
    fired++;
  }

  // 오래된 기록 정리 — 다시 D-3가 될 수 없는 과거 교육만 지운다(재발화 위험 없음).
  const cutoff = addDays(today, -HOOK_RETENTION_DAYS);
  let pruned = 0;
  for (const [id, rec] of Object.entries(state.fired)) {
    if (rec.eduDate < cutoff) { delete state.fired[id]; pruned++; }
  }

  if (fired || pruned) {
    saveHookState(state);
    if (fired) console.log(`[AnandaraProjects] D-${EDU_MATERIAL_LEAD_DAYS} 교육자료 요청 ${fired}건 발화 (대상일 ${targetDate})`);
  }
  return { scanned: edus.size, matched: matched.length, fired, targetDate };
}

// ── 지난 교육 자동 완료 훅 ──────────────────────────────────────────
//
// 교육이 끝났는데 완료 표시를 잊으면 미완료가 계속 쌓인다. 교육일이 지나면 자동으로 완료로
// 돌리고 무엇을 바꿨는지 알린다.
//
// [중대한 전제 — 이 훅이 DB를 직접 고치지 않는 이유]
// 아난다라에서 '완료'는 상태 한 칸이 아니다. completeEducation()(app/(auth)/calendar/actions.ts)이
// status='completed'와 **정산 행 자동 생성**을 한 몸으로 처리한다: company_id가 있으면
// 회사 정산 조건(수수료·세율·정산 밴드)으로 gross/net을 계산해 settlements에 넣고, 직계약이면
// 생성을 생략하며, 이미 정산이 있으면 중복 생성하지 않는다.
// 그래서 본체가 Supabase에 status만 써버리면 '완료됐는데 정산이 없는 교육'이 생긴다 — 돈을 못 받는
// 사고다. 반대로 그 금액 계산을 본체에 베껴오면 두 벌이 되어 반드시 어긋난다.
// 따라서 이 훅은 **판정만 본체에서 하고, 쓰기는 아난다라의 완료 API에 맡긴다.**
// 그 API가 아직 없으면 아무것도 바꾸지 않고 대상 목록만 보고한다(조용한 실패 금지).
//
// 판정 규칙:
// - 날짜는 KST 달력 문자열로만 비교한다(D-3 훅과 동일). 밀리초 뺄셈은 자정에서 밀린다.
// - 어제까지만 대상. 오늘 교육은 아직 진행 중일 수 있으므로 건드리지 않는다.
// - 소급 상한 90일. 그보다 오래된 미완료는 건수만 세어 알림에 남긴다(첫 실행 대량 처리 방지).
// - 취소·가예약(is_tentative)·개인 일정(rate_set 미확정)은 제외. "취소"를 "완료"로 만들지 않는다.
// - 상태가 scheduled가 아닌 것(이미 완료·알 수 없는 값)은 손대지 않는다 → 반복 실행에 멱등.
const AUTO_COMPLETE_MAX_AGE_DAYS = 90;

// 아난다라가 제공해야 할 완료 API. 없으면(404) 이 훅은 읽기만 하고 끝난다.
const COMPLETE_PATH = "/api/apps/anandara/proxy/api/mycrew/educations/complete";

export interface PastCompleteResult {
  scanned: number;           // 조회 창에서 본 교육 수
  targets: number;           // 자동 완료 대상으로 확정한 수
  completed: number;         // 실제로 완료 처리된 수
  failed: number;            // API가 있었지만 실패한 수
  blocked: number;           // 완료 API 부재로 처리하지 못한 수
  skippedOld: number;        // 90일 이전이라 제외한 미완료 수
  skippedAmbiguous: number;  // 가예약·상태 불명 등 애매해서 손대지 않은 수
  skippedFuture: number;     // 오늘·미래 또는 아직 종료 전이라 제외한 수 (미래 완료 사고 방지선)
  targetDate: string;        // 처리 상한 날짜(어제, KST)
  oldestAllowed: string;     // 소급 하한 날짜(KST)
  dryRun: boolean;
  notified: boolean;
}

/** 알림 한 줄 — 날짜 · 고객사 · 과정명. */
function completeLine(e: AnandaraEducation): string {
  return `- ${e.edu_date} · ${projectName(e.client_name)} · ${e.topic || "(과정명 미지정)"}`;
}

/** KST 기준 현재 "HH:MM". kstToday()와 같은 UTC+9 오프셋 방식(서머타임 없음). */
function kstNowHm(): string {
  return new Date(Date.now() + 9 * 60 * 60_000).toISOString().slice(11, 16);
}

/**
 * 종료일시 가드 — 교육이 `nowStamp`("YYYY-MM-DD HH:MM", KST) 시점에 이미 끝났는가.
 * 사전순 문자열 비교라 시간순 비교와 일치하고, 자정 경계에서 밀리지 않는다.
 * 별도 함수로 뺀 이유: 날짜 가드(어제까지)가 더 엄격해 통합 경로에서는 이 가드가 도달 불가라
 * 단위로 직접 검증해야 '작동함'을 증명할 수 있다.
 */
export function hasEndedBefore(e: Pick<AnandaraEducation, "edu_date" | "end_time">, nowStamp: string): boolean {
  return `${e.edu_date} ${hhmm(e.end_time)}` < nowStamp;
}

export interface AutoCompletePlan {
  targets: AnandaraEducation[];
  old: AnandaraEducation[];
  skippedAmbiguous: number;
  skippedFuture: number;
  targetDate: string;
  oldestAllowed: string;
}

/**
 * 자동 완료 대상 판정 — 순수 함수. I/O가 없어 픽스처로 검증할 수 있다.
 *
 * @param today  KST 오늘 YYYY-MM-DD
 * @param nowHm  KST 현재 HH:MM — 종료일시 가드에 쓴다
 *
 * 이중 가드를 두는 이유:
 *  (1) 날짜 가드 — 어제까지만. 오늘 교육은 진행 중일 수 있다.
 *  (2) 시각 가드 — `종료일시 < 현재시각`. 실질적으로는 (1)이 더 엄격해 (2)가 추가로 걸러낼 건은
 *      없지만, 훗날 누가 targetDate를 today로 완화하더라도 '아직 안 끝난 교육'이 완료로 바뀌는
 *      사고를 (2)가 막는다. 2026-08-08 QA에서 3일 뒤 교육이 completed가 된 사고의 재발 방지선이다.
 * 비교는 전부 KST 문자열 사전순으로 한다 — 밀리초 뺄셈은 자정 경계에서 밀린다(이 시스템 확립 규칙).
 */
export function planAutoComplete(
  edus: Iterable<AnandaraEducation>,
  today: string,
  nowHm: string,
): AutoCompletePlan {
  const targetDate = addDays(today, -1);              // 어제까지만
  const oldestAllowed = addDays(today, -AUTO_COMPLETE_MAX_AGE_DAYS);
  const nowStamp = `${today} ${nowHm}`;

  const targets: AnandaraEducation[] = [];
  const old: AnandaraEducation[] = [];
  let skippedAmbiguous = 0;
  let skippedFuture = 0;

  for (const e of edus) {
    if (!e.edu_date) continue;
    if (e.edu_date > targetDate) { skippedFuture++; continue; }         // 오늘·미래는 대상 아님
    // 종료일시 < 현재시각 강제 (가드 2)
    if (!hasEndedBefore(e, nowStamp)) { skippedFuture++; continue; }
    if (e.status === "completed" || e.status === "cancelled") continue; // 멱등 + 취소 보호
    if (e.status !== "scheduled") { skippedAmbiguous++; continue; }     // 상태 불명 → 손대지 않는다
    if (e.is_tentative === true) { skippedAmbiguous++; continue; }      // 가예약 → 확정 회차가 아니다
    if (!isRealEducation(e)) continue;                                  // 개인 일정·종일 — 교육이 아니다
    if (e.edu_date < oldestAllowed) { old.push(e); continue; }
    targets.push(e);
  }
  targets.sort((a, b) => a.edu_date.localeCompare(b.edu_date));

  return { targets, old, skippedAmbiguous, skippedFuture, targetDate, oldestAllowed };
}

/**
 * 교육일이 지난 미완료 교육을 아난다라에서 완료 처리한다.
 * @param preloaded 프로젝트 동기화가 이미 읽어온 educations (있으면 재조회하지 않는다)
 * @param opts.dryRun 판정만 하고 쓰기는 하지 않는다 (수동 라우트 ?dryRun=1)
 * @returns 아난다라를 한 달도 못 읽었으면 null
 */
export async function completePastEducations(
  preloaded?: Map<string, AnandaraEducation>,
  opts: { dryRun?: boolean } = {},
): Promise<PastCompleteResult | null> {
  const dryRun = opts.dryRun === true;
  let edus = preloaded;
  if (!edus) {
    // 수동 호출 — 90일 소급을 덮으려면 최근 4개월이면 충분하다.
    const now = new Date();
    const map = new Map<string, AnandaraEducation>();
    let anyOk = false;
    for (let i = -4; i <= 0; i++) {
      const rows = await fetchMonth(monthKey(new Date(now.getFullYear(), now.getMonth() + i, 1)));
      if (rows === null) continue;
      anyOk = true;
      for (const e of rows) {
        if (e?.id && e.edu_date && e.start_time && e.end_time && e.client_name) map.set(e.id, e);
      }
    }
    if (!anyOk) return null;
    edus = map;
  }

  const today = kstToday();
  const { targets, old, skippedAmbiguous, skippedFuture, targetDate, oldestAllowed } =
    planAutoComplete(edus.values(), today, kstNowHm());

  const result: PastCompleteResult = {
    scanned: edus.size, targets: targets.length, completed: 0, failed: 0, blocked: 0,
    skippedOld: old.length, skippedAmbiguous, skippedFuture, targetDate, oldestAllowed, dryRun, notified: false,
  };

  if (!targets.length) {
    if (old.length) console.log(`[AnandaraProjects] 지난 교육 자동 완료: 대상 0건 (90일 이전 미완료 ${old.length}건은 제외)`);
    return result;
  }

  // 처리 전에 대상을 먼저 확정해 남긴다 — 무엇이 바뀌었는지 추적 가능해야 한다.
  console.log(
    `[AnandaraProjects] 지난 교육 자동 완료 대상 ${targets.length}건 (~${targetDate}, 소급 하한 ${oldestAllowed})` +
    (dryRun ? " [dryRun]" : "") + "\n" +
    targets.map((e) => `  · ${e.edu_date} ${projectName(e.client_name)} ${e.topic || "-"} [${e.id}]`).join("\n"),
  );

  if (dryRun) return result;

  // 쓰기는 아난다라에 맡긴다 — 정산 자동 생성과 한 몸이라 본체가 흉내 내면 안 된다.
  const done: AnandaraEducation[] = [];
  for (const e of targets) {
    const outcome = await requestComplete(e.id);
    if (outcome === "ok") { done.push(e); result.completed++; }
    else if (outcome === "missing-api") {
      // 엔드포인트 자체가 없다 — 나머지도 같은 결과이므로 더 두드리지 않는다.
      result.blocked = targets.length - result.completed - result.failed;
      break;
    } else result.failed++;
  }

  const { addGenieMessage } = await import("./chat.js"); // 순환 참조 방지
  const oldNote = old.length
    ? `\n\n⚠️ 90일 이전 미완료 ${old.length}건은 대상에서 제외됨 — 아난다라에서 직접 확인하세요.`
    : "";

  // 알림은 한 건으로 묶되 **처리 성공 / 미처리 / 실패를 항상 분리 표기**한다.
  // 일부만 성공한 경우 "N건 완료 처리했습니다"만 보내면 나머지가 처리된 것처럼 오해된다.
  if (done.length || result.blocked || result.failed) {
    const parts: string[] = [];
    const head = done.length
      ? `✅ 지난 교육 자동 완료 — 처리 ${done.length}건 / 미처리 ${result.blocked}건 / 실패 ${result.failed}건`
      : `⚠️ 지난 교육 자동 완료 — 처리 0건 / 미처리 ${result.blocked}건 / 실패 ${result.failed}건`;
    parts.push(`${head} (${targetDate} 이전, KST)`);

    if (done.length) {
      parts.push("", `**처리 완료 ${done.length}건** — 아난다라에 반영됨`, ...done.map(completeLine));
    }
    if (result.blocked) {
      // 조용히 넘기면 '처리됐겠지'로 오해된다. 못 바꿨다는 사실은 반드시 알린다.
      const notDone = targets.filter((t) => !done.includes(t));
      parts.push(
        "",
        `**미처리 ${result.blocked}건 — 상태가 바뀌지 않았습니다**`,
        `아난다라에 완료 API(POST ${COMPLETE_PATH})가 없습니다.`,
        "완료 처리는 정산 행 자동 생성과 한 몸이라(회사 수수료·세율·정산 밴드 계산),",
        "본체가 DB의 status만 직접 고치면 정산이 누락됩니다. 그래서 아무것도 바꾸지 않았습니다.",
        ...notDone.map(completeLine),
      );
    }
    if (result.failed) {
      parts.push("", `**실패 ${result.failed}건** — 아난다라에서 직접 확인이 필요합니다.`);
    }
    addGenieMessage(parts.join("\n") + oldNote, { internal: true });
    result.notified = true;
  }

  console.log(
    `[AnandaraProjects] 지난 교육 자동 완료: 완료 ${result.completed} · 실패 ${result.failed} · ` +
    `미처리 ${result.blocked} · 90일초과 제외 ${result.skippedOld} · 애매 제외 ${result.skippedAmbiguous}`,
  );
  return result;
}

/**
 * 아난다라 완료 API 호출. 상태 변경과 정산 생성은 전적으로 앱의 몫이다.
 * @returns "ok" | "missing-api"(404 — 엔드포인트 부재) | "error"
 */
async function requestComplete(eduId: string): Promise<"ok" | "missing-api" | "error"> {
  try {
    const token = createSSOToken(OWNER_EMAIL);
    const res = await fetch(`${ANANDARA_BASE}${COMPLETE_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ssoToken: token, id: eduId }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404 || res.status === 405) return "missing-api";
    if (!res.ok) return "error";
    const data = await res.json().catch(() => null) as { ok?: boolean } | null;
    return data?.ok === true ? "ok" : "error";
  } catch {
    return "error"; // 앱 미기동·타임아웃 — 다음 주기에 재시도
  }
}

// 4개 상위 분류 — 비어 있어도 프로젝트 목록에 보여야 한다.
export const CATEGORY_DIRS = ["ax-consulting", "education", "ax-research", "spf"] as const;

export function ensureCategoryDirs(): void {
  for (const c of CATEGORY_DIRS) {
    try { mkdirSync(join(PROJECTS_DIR, c), { recursive: true }); } catch { /* 권한 등 — 다음 기회에 */ }
  }
}

// 카테고리별 프로젝트 목록 — 대시보드/에이전트가 현재 판을 한 번에 읽을 때 쓴다.
export function categorySummary(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const c of CATEGORY_DIRS) {
    try {
      out[c] = readdirSync(join(PROJECTS_DIR, c), { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith("."))
        .map((d) => d.name);
    } catch { out[c] = []; }
  }
  return out;
}

export function startAnandaraProjectSync(): void {
  if (timer) return;
  ensureCategoryDirs();
  // 부팅 직후엔 아난다라 앱이 아직 안 떠 있을 수 있어 120초 뒤 첫 실행 (일정 동기화 90초 다음)
  setTimeout(() => { void syncAnandaraProjects(); }, 120_000).unref?.();
  timer = setInterval(() => { void syncAnandaraProjects(); }, SYNC_INTERVAL_MS);
  timer.unref?.();
  console.log("[AnandaraProjects] 시작 (일 1회 주기, 수동: POST /api/anandara-projects-sync)");
}

export function stopAnandaraProjectSync(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
