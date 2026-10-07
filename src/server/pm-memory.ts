import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  renameSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

// index.md 동시 쓰기 보호
const indexLocks = new Map<string, Promise<void>>();
function withIndexLock(key: string, fn: () => void): void {
  const prev = indexLocks.get(key) ?? Promise.resolve();
  const next = prev.then(fn).catch(() => {});
  indexLocks.set(key, next);
}
function atomicWrite(filepath: string, content: string): void {
  const tmp = filepath + ".tmp";
  writeFileSync(tmp, content);
  renameSync(tmp, filepath);
}
import { HISTORY_DIR, getTodayKST } from "../config.js";
import { archiveWikiPage } from "./audit.js";

const AGENTS_DIR = join(HISTORY_DIR, "agents");

// self-profile 크기 경고 임계값
const PROFILE_WARN_BYTES = 3000;

// self-profile 크기 체크 — tagReminder에서 호출
export function isProfileOversized(pmId: string): boolean {
  const spPath = join(AGENTS_DIR, pmId, "wiki", "self-profile.md");
  try {
    if (!existsSync(spPath)) return false;
    return statSync(spPath).size > PROFILE_WARN_BYTES;
  } catch { return false; }
}

// 보호 대상 상수 — 사서/일별요약/태그안내에서 공통 사용
export const PROTECTED_PAGE_NAMES = new Set(["index", "role-directive", "self-profile", "schedule"]);
export const PROTECTED_PAGE_PREFIXES = ["feedback_", "project_", "procedure_", "teamLGS-", "genie-", "!"];

// 페이지명 → 파일명 정규화.
// 끝에 .md가 있으면 먼저 떼고 sanitize 후 .md를 한 번만 붙여
// foo.md → foo-md.md 같은 중복 접미사 버그를 방지.
export function normalizePageName(page: string): string {
  const stripped = page.replace(/\.md$/i, "");
  const sanitized = stripped.replace(/[^a-zA-Z0-9가-힣\-_]/g, "-");
  return `${sanitized}.md`;
}

function agentDir(pmId: string): string {
  return join(AGENTS_DIR, pmId);
}

function wikiDir(pmId: string): string {
  return join(agentDir(pmId), "wiki");
}

function sessionFile(pmId: string): string {
  return join(agentDir(pmId), "session.json");
}

function ensureDirs(pmId: string): void {
  const wiki = wikiDir(pmId);
  if (!existsSync(wiki)) mkdirSync(wiki, { recursive: true });
  const daily = join(wiki, "daily");
  if (!existsSync(daily)) mkdirSync(daily, { recursive: true });
  const outputs = join(HISTORY_DIR, "outputs", pmId);
  if (!existsSync(outputs)) mkdirSync(outputs, { recursive: true });
  // index.md 자동 생성 (새 직원 첫 호출 시)
  const indexPath = join(wiki, "index.md");
  if (!existsSync(indexPath)) {
    writeFileSync(indexPath, `# ${pmId}의 기억\n\n## 기억\n- [role-directive](role-directive.md)\n\n## 주요 산출물 (최대 5건)\n(전체: history/outputs/${pmId}/ — Glob/Read로 접근)\n`);
    console.log(`[${pmId}] index.md 자동 생성`);
  }
}

// --- 세션 ---

export function loadPmSession(pmId: string): string | undefined {
  const path = sessionFile(pmId);
  if (!existsSync(path)) return undefined;
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    const id = data.sessionId as string | undefined;
    if (id) console.log(`[${pmId}] 세션 복원: ${id}`);
    return id;
  } catch {
    return undefined;
  }
}

export function savePmSession(pmId: string, sessionId: string): void {
  ensureDirs(pmId);
  const path = sessionFile(pmId);
  // 기존 데이터 보존 (startedAt, baseTokens, lastTokens)
  let existing: Record<string, unknown> = {};
  try { if (existsSync(path)) existing = JSON.parse(readFileSync(path, "utf-8")); } catch { /* */ }
  existing.sessionId = sessionId;
  writeFileSync(path, JSON.stringify(existing));
}

// 새 세션 시작 시점 기록 (startedAt + 토큰 초기화)
export function markSessionStart(pmId: string): void {
  ensureDirs(pmId);
  const path = sessionFile(pmId);
  let existing: Record<string, unknown> = {};
  try { if (existsSync(path)) existing = JSON.parse(readFileSync(path, "utf-8")); } catch { /* */ }
  existing.startedAt = new Date().toISOString();
  delete existing.baseTokens;
  delete existing.lastTokens;
  writeFileSync(path, JSON.stringify(existing));
}

export function savePmSessionTokens(pmId: string, cacheReadTokens: number): void {
  const path = sessionFile(pmId);
  try {
    if (!existsSync(path)) return;
    const data = JSON.parse(readFileSync(path, "utf-8"));
    if (!data.baseTokens) data.baseTokens = cacheReadTokens; // 첫 호출의 토큰만 기록
    data.lastTokens = cacheReadTokens;
    writeFileSync(path, JSON.stringify(data));
  } catch { /* */ }
}

export function loadPmSessionInfo(pmId: string): { sessionId?: string; startedAt?: string; baseTokens?: number; lastTokens?: number } {
  const path = sessionFile(pmId);
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, "utf-8")); } catch { return {}; }
}

export function clearPmSession(pmId: string): void {
  const path = sessionFile(pmId);
  if (existsSync(path)) writeFileSync(path, "{}");
}

export function clearAllPmSessions(): void {
  if (!existsSync(AGENTS_DIR)) return;
  const dirs = readdirSync(AGENTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  for (const id of dirs) {
    clearPmSession(id);
  }
  console.log(`[PM] 전체 세션 리셋 완료 (${dirs.length}개)`);
}

// --- 위키 ---

export function loadPmWiki(pmId: string): string {
  ensureDirs(pmId);
  const dir = wikiDir(pmId);
  // 온디맨드 로딩: index.md만 로드. 개별 페이지는 에이전트가 Read 도구로 읽음.
  const indexPath = join(dir, "index.md");
  if (!existsSync(indexPath)) return "";
  const index = readFileSync(indexPath, "utf-8");
  return `${index}\n\n(개별 페이지는 Read 도구로 ${dir}/<파일명> 읽기)`;
}

export const JUNK_PAGES = new Set(["페이지명", "page_name", "페이지", "pagename"]);
export const JUNK_CONTENTS = new Set(["내용", "content", "정리된 내용"]);

export function savePmWikiPage(
  pmId: string,
  page: string,
  content: string,
): void {
  if (JUNK_PAGES.has(page) || JUNK_CONTENTS.has(content.trim())) {
    console.warn(`[${pmId}] placeholder 저장 거부: page="${page}"`);
    return;
  }
  const contentBytes = Buffer.byteLength(content, "utf-8");
  const MAX_WIKI_BYTES = 5000;
  if (contentBytes > MAX_WIKI_BYTES) {
    console.warn(`[${pmId}] wiki 크기 초과 거부: page="${page}" (${contentBytes}B > ${MAX_WIKI_BYTES}B). 산출물은 history/outputs/${pmId}/ 에 직접 저장하세요.`);
    return;
  }
  ensureDirs(pmId);
  const dir = wikiDir(pmId);
  const filename = normalizePageName(page);
  const filepath = join(dir, filename);
  writeFileSync(filepath, content);
  try { archiveWikiPage(page, content, `pm-${pmId}`); } catch (e) {
    console.error(`[${pmId}] archive 실패 (원본은 저장됨):`, e instanceof Error ? e.message : e);
  }

  // index.md 업데이트 (동시 쓰기 보호)
  const indexPath = join(dir, "index.md");
  withIndexLock(indexPath, () => {
    let index = existsSync(indexPath)
      ? readFileSync(indexPath, "utf-8")
      : `# ${pmId}의 기억\n`;

    const todayKST = getTodayKST();
    const entry = `- [${page}](${filename}) — (업데이트: ${todayKST})`;

    if (!index.includes(filename)) {
      index += `\n${entry}`;
    } else {
      const lineRe = new RegExp(`- \\[[^\\]]+\\]\\(${filename.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\)[^\\n]*`, "g");
      index = index.replace(lineRe, entry);
    }
    atomicWrite(indexPath, index);
  });

  console.log(`[${pmId}] 위키 업데이트: ${filename}`);

  // 역할/성격 변경 시 세션 리셋 (새 세션에서 최신 내용 로드)
  const IDENTITY_FILES = ["role-directive.md", "self-profile.md"];
  if (IDENTITY_FILES.includes(filename)) {
    clearPmSession(pmId);
    console.log(`[${pmId}] 정체성 파일 변경 → 세션 리셋`);
  }

  // 위키 페이지 수 체크 → 워커 Librarian 직접 트리거
  const MAX_WORKER_WIKI_PAGES = 20;
  const pageCount = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "index.md").length;
  if (pageCount > MAX_WORKER_WIKI_PAGES) {
    import("./chat.js").then(({ runWorkerLibrarian }) => {
      runWorkerLibrarian(pmId).catch((err: unknown) => console.error(`[${pmId}] Librarian 트리거 실패:`, err));
    }).catch((err: unknown) => console.error(`[${pmId}] Librarian import 실패:`, err));
  }
}
