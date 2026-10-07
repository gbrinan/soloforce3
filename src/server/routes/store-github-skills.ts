// 마이크루 스토어 — 깃허브 스킬 설치 (superpowers/GSD 스타일 스킬 리포 지원).
// 깃허브 리포 URL 등록 → 커밋 고정 tarball 다운로드 → SKILL.md 스캔 → ~/.claude/skills/<id> 설치.
// 설치 위치가 Claude Code CLI 전역 스킬 디렉토리이므로 마이크루가 스폰하는 모든 에이전트가
// cwd 무관하게 즉시 사용할 수 있다. 레지스트리: history/store/github-skills.json (로컬 SOT).
import { Hono } from "hono";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendFileSync, existsSync, lstatSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve as pathResolve, sep } from "node:path";
import { HISTORY_DIR } from "../../config.js";
import { storeCorsMiddleware } from "./store-cors.js";

const execFileAsync = promisify(execFile);

export const storeGithubSkillsRoutes = new Hono();

// store.dooitspace.com 브라우저가 직접 fetch하는 라우트 — CORS/PNA 헤더 필수.
storeGithubSkillsRoutes.use("*", storeCorsMiddleware());

const REGISTRY_FILE = join(HISTORY_DIR, "store", "github-skills.json");
const INSTALLED_FILE = join(HISTORY_DIR, "store", "installed.jsonl");
const SKILLS_ROOT = join(homedir(), ".claude", "skills");
const MAX_TARBALL_BYTES = 80 * 1024 * 1024; // 스킬 리포는 문서 위주 — 80MB 상한
const MAX_SCAN_DEPTH = 6;
const MARKER_FILE = ".mycrew-github-skill.json"; // 설치 디렉토리 관리 마커 (레지스트리 유실 대비)

interface SkillEntry {
  id: string; // 디렉토리명 = ~/.claude/skills/<id>
  name: string;
  description: string;
  relPath: string; // tarball 루트 기준 스킬 디렉토리 상대경로
  installedAt?: string;
  warnings?: string[]; // Agent Skills 규격 검증 경고
}

interface RepoRegistration {
  repoUrl: string; // 정규화된 https://github.com/<owner>/<repo>
  owner: string;
  repo: string;
  ref: string; // 등록 시점 브랜치명
  commit: string; // 설치 재현성을 위한 커밋 고정
  subpath: string; // /tree/<ref>/<subpath> 등록 시 스캔 범위 제한 ("" = 전체)
  registeredAt: string;
  skills: SkillEntry[];
}

// ── 레지스트리 IO ─────────────────────────────────────────────────────────────
function readRegistry(): RepoRegistration[] {
  if (!existsSync(REGISTRY_FILE)) return [];
  try {
    const parsed = JSON.parse(readFileSync(REGISTRY_FILE, "utf-8"));
    return Array.isArray(parsed) ? (parsed as RepoRegistration[]) : [];
  } catch (err) {
    console.error("[store/github-skills] 레지스트리 파싱 실패, 빈 배열 폴백:", err);
    return [];
  }
}

async function writeRegistry(repos: RepoRegistration[]): Promise<void> {
  await mkdir(dirname(REGISTRY_FILE), { recursive: true });
  await writeFile(REGISTRY_FILE, JSON.stringify(repos, null, 2));
}

// store-installed.ts installed.jsonl과 동일 포맷 — 스토어 설치 통계/목록에 반영.
function appendInstalledRecord(action: "install" | "uninstall", itemId: string): void {
  try {
    appendFileSync(
      INSTALLED_FILE,
      JSON.stringify({ userId: "local-owner", itemId, kind: "skill", action, at: new Date().toISOString() }) + "\n",
      "utf-8",
    );
  } catch (err) {
    console.error("[store/github-skills] installed.jsonl 기록 실패 (설치 자체는 유효):", err);
  }
}

// ── 깃허브 URL/API ────────────────────────────────────────────────────────────
interface ParsedRepoUrl {
  owner: string;
  repo: string;
  ref: string | null;
  subpath: string;
}

// 허용 형태: https://github.com/<owner>/<repo>[.git][/tree/<ref>[/<subpath>]]
// github.com 외 호스트는 전부 거부 (SSRF 방지 — 다운로드도 codeload.github.com 고정).
function parseGithubUrl(raw: string): ParsedRepoUrl | null {
  const m =
    /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\/tree\/([^/]+)((?:\/[^?#]+)?))?\/?$/.exec(
      raw.trim(),
    );
  if (!m) return null;
  return { owner: m[1], repo: m[2], ref: m[3] ?? null, subpath: (m[4] ?? "").replace(/^\/+|\/+$/g, "") };
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": "mycrew-store",
    Accept: "application/vnd.github+json",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

// ref(브랜치/태그, null이면 기본 브랜치)를 커밋 sha로 해석 — 설치 시점 재현성 확보.
async function resolveCommit(owner: string, repo: string, ref: string | null): Promise<{ ref: string; commit: string }> {
  let branch = ref;
  if (!branch) {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`github_repo_lookup_failed:${res.status}`);
    branch = ((await res.json()) as { default_branch?: string }).default_branch ?? "main";
  }
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`, {
    headers: githubHeaders(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`github_ref_resolve_failed:${res.status}`);
  const sha = ((await res.json()) as { sha?: string }).sha;
  if (!sha) throw new Error("github_ref_resolve_failed:no_sha");
  return { ref: branch, commit: sha };
}

// zip-slip 방어 — 추출 전 엔트리 이름을 나열해 대상 밖으로 탈출하는 경로가 있으면 거부.
// (store.ts v1.12-Tar-Hardening과 동일 원칙. 심링크는 거부 대신 추출 후 일괄 제거 —
//  superpowers 등 실제 스킬 리포가 in-repo 심링크(AGENTS.md→CLAUDE.md)를 포함하기 때문.)
async function assertNoEscapingEntries(archivePath: string, targetDir: string): Promise<void> {
  // Windows: GNU tar가 "C:..."의 콜론을 원격 host:path로 오인(Cannot connect to C:)하므로
  // cwd + 상대 파일명으로 호출해 드라이브 문자를 인자에서 제거한다(전 tar 구현 호환).
  const { stdout } = await execFileAsync("tar", ["-tzf", basename(archivePath)], { cwd: dirname(archivePath) });
  for (const name of stdout.split("\n").map((l) => l.trim()).filter(Boolean)) {
    if (!name || name.startsWith("/")) throw new Error(`tar_zip_slip_rejected:${name}`);
    const resolved = pathResolve(targetDir, name);
    if (resolved !== targetDir && !resolved.startsWith(targetDir + sep)) {
      throw new Error(`tar_zip_slip_rejected:${name}`);
    }
  }
}

// 추출 트리의 심링크를 전부 제거 — 스킬 복사(cp) 시 외부 파일 참조가 섞이지 않도록.
function purgeSymlinks(dir: string): number {
  let removed = 0;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) {
      unlinkSync(p);
      removed++;
    } else if (st.isDirectory()) {
      removed += purgeSymlinks(p);
    }
  }
  return removed;
}

// 커밋 고정 tarball 다운로드 → zip-slip 검증 → 임시 디렉토리 추출 → 심링크 제거.
// 반환: { tmpRoot(정리용), extractedRoot(리포 최상위 디렉토리) }
async function downloadAndExtract(owner: string, repo: string, commit: string): Promise<{ tmpRoot: string; extractedRoot: string }> {
  const url = `https://codeload.github.com/${owner}/${repo}/tar.gz/${commit}`;
  const res = await fetch(url, { headers: { "User-Agent": "mycrew-store" }, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`tarball_download_failed:${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_TARBALL_BYTES) throw new Error(`tarball_too_large:${buf.byteLength}`);

  const tmpRoot = await mkdtemp(join(tmpdir(), "mycrew-gh-skill-"));
  const tarFile = join(tmpRoot, "repo.tar.gz");
  await writeFile(tarFile, buf);
  const extractDir = join(tmpRoot, "x");
  await mkdir(extractDir, { recursive: true });
  await assertNoEscapingEntries(tarFile, extractDir);
  // 동일 사유(Windows 드라이브 문자 회피): cwd=tmpRoot, 상대경로로 추출.
  // Windows: bsdtar/GNU tar가 in-repo 심링크(예: superpowers의 AGENTS.md->CLAUDE.md) 생성 시 권한
  // 부족으로 non-zero 종료 -> 추출 전체가 실패 처리되던 문제. 심링크는 직후 purgeSymlinks가 제거하므로,
  // 추출 경고는 무시하고 아래 rootEntry 존재 검사로 실제 추출 여부를 판정한다.
  try {
    await execFileAsync("tar", ["-xzf", basename(tarFile), "-C", relative(dirname(tarFile), extractDir)], { cwd: dirname(tarFile) });
  } catch (err) {
    console.warn("[store/github-skills] tar 추출 경고(무시, rootEntry로 재검증): " + (err instanceof Error ? err.message.slice(0, 200) : String(err)));
  }
  const purged = purgeSymlinks(extractDir);
  if (purged > 0) console.log(`[store/github-skills] 심링크 ${purged}개 제거 (${owner}/${repo})`);

  const [rootEntry] = readdirSync(extractDir).filter((f) => statSync(join(extractDir, f)).isDirectory());
  if (!rootEntry) throw new Error("tarball_empty");
  return { tmpRoot, extractedRoot: join(extractDir, rootEntry) };
}

// ── SKILL.md 스캔/파싱 ────────────────────────────────────────────────────────
// Agent Skills 공식 규격 검증 훅 (platform.claude.com/docs/en/agents-and-tools/agent-skills/overview 기준).
// 설치 전 잠재 문제를 경고로 모아 반환한다 — 차단이 아니라 가시화(설치 UI가 표시).
export function validateSkillSpec(meta: { name?: string; description?: string }, dirName: string): string[] {
  const warns: string[] = [];
  const name = meta.name ?? dirName;
  if (name.length > 64) warns.push(`name ${name.length}자 — 규격 최대 64자 초과`);
  if (!/^[a-z0-9-]+$/.test(name)) warns.push("name에 소문자·숫자·하이픈 외 문자 포함 — 트리거 불가 가능");
  if (/anthropic|claude/i.test(name)) warns.push("name에 예약어(anthropic/claude) 포함");
  const desc = meta.description ?? "";
  if (!desc.trim()) warns.push("description 비어 있음 — 모델이 트리거할 수 없음(죽은 스킬)");
  if (desc.length > 1024) warns.push(`description ${desc.length}자 — 규격 최대 1024자 초과`);
  if (/<[a-zA-Z][^>]*>/.test(name + desc)) warns.push("name/description에 XML 태그 포함 — 규격 금지");
  return warns;
}

function parseFrontmatter(src: string): { name?: string; description?: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(src);
  if (!m) return {};
  const pick = (key: string): string | undefined => {
    const line = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(m[1]);
    return line?.[1]?.trim().replace(/^["']|["']$/g, "");
  };
  return { name: pick("name"), description: pick("description") };
}

// scanRoot 하위에서 SKILL.md를 포함한 디렉토리를 수집 (superpowers·gsd 등 skills/<name>/SKILL.md 규약).
function scanSkills(repoRoot: string, subpath: string): SkillEntry[] {
  const scanRoot = subpath ? join(repoRoot, subpath) : repoRoot;
  if (!existsSync(scanRoot)) return [];
  const found: SkillEntry[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_SCAN_DEPTH) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    if (entries.includes("SKILL.md")) {
      const src = readFileSync(join(dir, "SKILL.md"), "utf-8");
      const meta = parseFrontmatter(src);
      const id = basename(dir) === basename(repoRoot) ? basename(repoRoot).replace(/-[0-9a-f]{40}$/, "") : basename(dir);
      found.push({
        id,
        name: meta.name ?? id,
        description: meta.description ?? "",
        relPath: relative(repoRoot, dir),
        warnings: validateSkillSpec(meta, basename(dir)),
      });
      return; // 스킬 디렉토리 내부에 중첩 스킬은 없다고 간주
    }
    for (const e of entries) {
      if (e === "node_modules" || e === ".git" || e.startsWith(".")) continue;
      const p = join(dir, e);
      try {
        if (statSync(p).isDirectory()) walk(p, depth + 1);
      } catch {
        /* 접근 불가 항목 무시 */
      }
    }
  };
  walk(scanRoot, 0);
  // id 중복 시 뒤 항목에 상위 디렉토리명 접두 부여 (동일 이름 스킬이 다른 경로에 존재하는 경우)
  const seen = new Map<string, number>();
  for (const s of found) {
    const n = seen.get(s.id) ?? 0;
    seen.set(s.id, n + 1);
    if (n > 0) s.id = `${basename(dirname(join(repoRoot, s.relPath)))}-${s.id}`;
  }
  return found;
}

// ~/.claude/skills/<id> 경로 확정 — 디렉토리명 화이트리스트 + 루트 탈출 방지.
function installTargetFor(skillId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(skillId)) throw new Error(`invalid_skill_id:${skillId}`);
  const target = pathResolve(SKILLS_ROOT, skillId);
  if (target !== SKILLS_ROOT && !target.startsWith(SKILLS_ROOT + sep)) throw new Error(`invalid_skill_id:${skillId}`);
  return target;
}

function isManagedInstall(target: string): boolean {
  return existsSync(join(target, MARKER_FILE));
}

const repoKeyOf = (r: { owner: string; repo: string }) => `${r.owner}/${r.repo}`.toLowerCase();
const installedItemId = (r: RepoRegistration, skillId: string) => `gh:${r.owner}/${r.repo}#${skillId}`;

// ── 라우트 ────────────────────────────────────────────────────────────────────
storeGithubSkillsRoutes.get("/", (c) => {
  return c.json({ repos: readRegistry() });
});

// GET /check-updates — 등록 리포의 브랜치 최신 커밋과 설치 커밋 비교 (P1: 업데이트 감지).
// 업데이트 적용은 /register(커밋 갱신) → /install 재실행으로 수행한다.
storeGithubSkillsRoutes.get("/check-updates", async (c) => {
  const registry = readRegistry();
  const results: { repoUrl: string; currentCommit: string; latestCommit: string | null; updatable: boolean }[] = [];
  for (const entry of registry) {
    try {
      const { commit } = await resolveCommit(entry.owner, entry.repo, entry.ref);
      results.push({
        repoUrl: entry.repoUrl,
        currentCommit: entry.commit,
        latestCommit: commit,
        updatable: commit !== entry.commit,
      });
    } catch {
      results.push({ repoUrl: entry.repoUrl, currentCommit: entry.commit, latestCommit: null, updatable: false });
    }
  }
  return c.json({ updates: results });
});

// POST /register { repoUrl } — 리포 스캔 후 레지스트리 등록(재등록 = 갱신, 설치 상태 보존)
storeGithubSkillsRoutes.post("/register", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { repoUrl?: string } | null;
  if (!body?.repoUrl) return c.json({ error: "repoUrl_required" }, 400);
  const parsed = parseGithubUrl(body.repoUrl);
  if (!parsed) return c.json({ error: "invalid_github_url", detail: "https://github.com/<owner>/<repo> 형식만 지원" }, 400);

  let tmpRoot: string | null = null;
  try {
    const { ref, commit } = await resolveCommit(parsed.owner, parsed.repo, parsed.ref);
    const dl = await downloadAndExtract(parsed.owner, parsed.repo, commit);
    tmpRoot = dl.tmpRoot;
    const skills = scanSkills(dl.extractedRoot, parsed.subpath);
    if (skills.length === 0) return c.json({ error: "no_skills_found", detail: "리포에서 SKILL.md를 찾지 못했습니다" }, 404);

    const registry = readRegistry();
    const prev = registry.find((r) => repoKeyOf(r) === repoKeyOf(parsed));
    // 재등록 시 기존 설치 시각 보존 (id 매칭)
    if (prev) {
      for (const s of skills) {
        const old = prev.skills.find((o) => o.id === s.id);
        if (old?.installedAt) s.installedAt = old.installedAt;
      }
    }
    const entry: RepoRegistration = {
      repoUrl: `https://github.com/${parsed.owner}/${parsed.repo}`,
      owner: parsed.owner,
      repo: parsed.repo,
      ref,
      commit,
      subpath: parsed.subpath,
      registeredAt: prev?.registeredAt ?? new Date().toISOString(),
      skills,
    };
    const next = registry.filter((r) => repoKeyOf(r) !== repoKeyOf(parsed));
    next.push(entry);
    await writeRegistry(next);
    return c.json({ ok: true, repo: entry });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[store/github-skills/register] 실패:", msg);
    if (msg.startsWith("github_repo_lookup_failed:404")) return c.json({ error: "repo_not_found" }, 404);
    if (msg.startsWith("github_")) return c.json({ error: "github_api_failed", detail: msg }, 502);
    if (msg.startsWith("tarball_too_large")) return c.json({ error: "tarball_too_large", detail: msg }, 413);
    if (msg.startsWith("tarball_")) return c.json({ error: "tarball_download_failed", detail: msg }, 502);
    if (msg.startsWith("tar_")) return c.json({ error: "unsafe_archive_rejected", detail: msg }, 400);
    return c.json({ error: "register_failed", detail: msg }, 500);
  } finally {
    if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
});

// POST /install { repoUrl, skillIds? } — 미지정 시 전체 설치. 커밋 고정 tarball 재다운로드.
storeGithubSkillsRoutes.post("/install", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { repoUrl?: string; skillIds?: string[] } | null;
  if (!body?.repoUrl) return c.json({ error: "repoUrl_required" }, 400);
  const parsed = parseGithubUrl(body.repoUrl);
  if (!parsed) return c.json({ error: "invalid_github_url" }, 400);

  const registry = readRegistry();
  const entry = registry.find((r) => repoKeyOf(r) === repoKeyOf(parsed));
  if (!entry) return c.json({ error: "repo_not_registered", detail: "먼저 /register로 등록하세요" }, 404);

  const wanted = body.skillIds?.length
    ? entry.skills.filter((s) => body.skillIds!.includes(s.id))
    : entry.skills;
  if (wanted.length === 0) return c.json({ error: "skill_not_found" }, 404);

  let tmpRoot: string | null = null;
  const installed: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  try {
    const dl = await downloadAndExtract(entry.owner, entry.repo, entry.commit);
    tmpRoot = dl.tmpRoot;
    await mkdir(SKILLS_ROOT, { recursive: true });
    for (const skill of wanted) {
      try {
        const target = installTargetFor(skill.id);
        const srcDir = join(dl.extractedRoot, skill.relPath);
        if (!existsSync(join(srcDir, "SKILL.md"))) {
          skipped.push({ id: skill.id, reason: "source_skill_missing" });
          continue;
        }
        // 우리가 설치한 게 아닌 기존 스킬 디렉토리는 덮어쓰지 않는다 (사용자 수동 설치 보호)
        if (existsSync(target) && !isManagedInstall(target)) {
          skipped.push({ id: skill.id, reason: "conflict_existing_unmanaged" });
          continue;
        }
        await rm(target, { recursive: true, force: true });
        await cp(srcDir, target, { recursive: true });
        await writeFile(
          join(target, MARKER_FILE),
          JSON.stringify({ repoUrl: entry.repoUrl, commit: entry.commit, installedAt: new Date().toISOString() }, null, 2),
        );
        skill.installedAt = new Date().toISOString();
        appendInstalledRecord("install", installedItemId(entry, skill.id));
        installed.push(skill.id);
      } catch (err) {
        skipped.push({ id: skill.id, reason: err instanceof Error ? err.message : String(err) });
      }
    }
    await writeRegistry(registry);
    return c.json({ ok: true, installed, skipped, installPath: SKILLS_ROOT });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[store/github-skills/install] 실패:", msg);
    if (msg.startsWith("tarball_") || msg.startsWith("tar_")) return c.json({ error: "artifact_failed", detail: msg }, 502);
    return c.json({ error: "install_failed", detail: msg }, 500);
  } finally {
    if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
});

// POST /uninstall { repoUrl, skillId } — 관리 마커가 있는 설치본만 삭제.
storeGithubSkillsRoutes.post("/uninstall", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { repoUrl?: string; skillId?: string } | null;
  if (!body?.repoUrl || !body.skillId) return c.json({ error: "repoUrl_and_skillId_required" }, 400);
  const parsed = parseGithubUrl(body.repoUrl);
  if (!parsed) return c.json({ error: "invalid_github_url" }, 400);

  const registry = readRegistry();
  const entry = registry.find((r) => repoKeyOf(r) === repoKeyOf(parsed));
  const skill = entry?.skills.find((s) => s.id === body.skillId);
  if (!entry || !skill) return c.json({ error: "skill_not_found" }, 404);

  try {
    const target = installTargetFor(skill.id);
    if (existsSync(target)) {
      if (!isManagedInstall(target)) return c.json({ error: "not_managed_install", detail: "마이크루가 설치한 스킬이 아닙니다" }, 403);
      await rm(target, { recursive: true, force: true });
    }
    delete skill.installedAt;
    appendInstalledRecord("uninstall", installedItemId(entry, skill.id));
    await writeRegistry(registry);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: "uninstall_failed", detail: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// POST /unregister { repoUrl } — 관리 설치본 전체 제거 후 레지스트리에서 삭제.
storeGithubSkillsRoutes.post("/unregister", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { repoUrl?: string } | null;
  if (!body?.repoUrl) return c.json({ error: "repoUrl_required" }, 400);
  const parsed = parseGithubUrl(body.repoUrl);
  if (!parsed) return c.json({ error: "invalid_github_url" }, 400);

  const registry = readRegistry();
  const entry = registry.find((r) => repoKeyOf(r) === repoKeyOf(parsed));
  if (!entry) return c.json({ error: "repo_not_registered" }, 404);

  try {
    for (const skill of entry.skills) {
      if (!skill.installedAt) continue;
      const target = installTargetFor(skill.id);
      if (existsSync(target) && isManagedInstall(target)) {
        await rm(target, { recursive: true, force: true });
        appendInstalledRecord("uninstall", installedItemId(entry, skill.id));
      }
    }
    await writeRegistry(registry.filter((r) => repoKeyOf(r) !== repoKeyOf(parsed)));
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: "unregister_failed", detail: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// ── 스토어 카탈로그 자동 동기화 (store.dooitspace.com/catalog/skill 기준) ─────────────
// 스토어 스킬 카탈로그의 각 항목은 GitHub 리포다. 카탈로그 페이지 HTML을 파싱해 리포 목록을
// 얻고, 로컬에 없으면 설치 / 있어도 최신 커밋과 다르면(=outdated) 재설치한다.
// 안전장치는 기존 register/install 경로와 동일(github.com 전용, zip-slip 방어, 심링크 제거,
// 80MB 상한, 관리 마커로 수동 설치 보호). update-check.ts의 6시간 폴링에서 호출된다.
const STORE_URL_DEFAULT = "https://store.dooitspace.com";

// 카탈로그 페이지에서 github.com/<owner>/<repo> 링크를 추출(정규화·중복 제거).
export async function fetchStoreCatalogSkillRepos(): Promise<string[]> {
  const storeUrl = (process.env.MYCREW_STORE_URL || STORE_URL_DEFAULT).replace(/\/+$/, "");
  const res = await fetch(`${storeUrl}/catalog/skill`, {
    headers: { "User-Agent": "mycrew-skill-autosync" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`catalog_fetch_failed:${res.status}`);
  const html = await res.text();
  const repos = new Set<string>();
  for (const m of html.matchAll(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/g)) {
    const owner = m[1];
    const repo = m[2].replace(/\.git$/, "");
    // 자산/브랜드 경로(github.com/owner/repo가 아닌 것)는 parseGithubUrl가 재검증한다.
    if (owner && repo && owner !== "sponsors") repos.add(`https://github.com/${owner}/${repo}`);
  }
  return [...repos];
}

export interface SkillSyncResult {
  repoUrl: string;
  action: "installed" | "updated" | "uptodate" | "failed";
  skills: string[];
  detail?: string;
}

// 리포 하나를 최신 커밋으로 동기화. 미설치/커밋상이 시 다운로드·설치, 동일하면 uptodate.
export async function autoSyncSkillRepo(repoUrl: string): Promise<SkillSyncResult> {
  const parsed = parseGithubUrl(repoUrl);
  if (!parsed) return { repoUrl, action: "failed", skills: [], detail: "invalid_github_url" };
  let tmpRoot: string | null = null;
  try {
    const { ref, commit } = await resolveCommit(parsed.owner, parsed.repo, parsed.ref);
    const registry = readRegistry();
    const prev = registry.find((r) => repoKeyOf(r) === repoKeyOf(parsed));
    const alreadyInstalled = !!prev && prev.skills.some((s) => s.installedAt);
    if (prev && prev.commit === commit && alreadyInstalled) {
      return { repoUrl, action: "uptodate", skills: [] };
    }
    const dl = await downloadAndExtract(parsed.owner, parsed.repo, commit);
    tmpRoot = dl.tmpRoot;
    const skills = scanSkills(dl.extractedRoot, parsed.subpath);
    if (skills.length === 0) return { repoUrl, action: "failed", skills: [], detail: "no_skills_found" };
    await mkdir(SKILLS_ROOT, { recursive: true });
    const installed: string[] = [];
    for (const skill of skills) {
      try {
        const target = installTargetFor(skill.id);
        const srcDir = join(dl.extractedRoot, skill.relPath);
        if (!existsSync(join(srcDir, "SKILL.md"))) continue;
        if (existsSync(target) && !isManagedInstall(target)) continue; // 수동 설치 보호
        await rm(target, { recursive: true, force: true });
        await cp(srcDir, target, { recursive: true });
        await writeFile(
          join(target, MARKER_FILE),
          JSON.stringify({ repoUrl: `https://github.com/${parsed.owner}/${parsed.repo}`, commit, installedAt: new Date().toISOString() }, null, 2),
        );
        skill.installedAt = new Date().toISOString();
        appendInstalledRecord("install", installedItemId({ owner: parsed.owner, repo: parsed.repo } as RepoRegistration, skill.id));
        installed.push(skill.id);
      } catch { /* 개별 스킬 실패는 건너뜀 */ }
    }
    const entry: RepoRegistration = {
      repoUrl: `https://github.com/${parsed.owner}/${parsed.repo}`,
      owner: parsed.owner,
      repo: parsed.repo,
      ref,
      commit,
      subpath: parsed.subpath,
      registeredAt: prev?.registeredAt ?? new Date().toISOString(),
      skills,
    };
    await writeRegistry([...registry.filter((r) => repoKeyOf(r) !== repoKeyOf(parsed)), entry]);
    return { repoUrl, action: prev ? "updated" : "installed", skills: installed };
  } catch (err) {
    return { repoUrl, action: "failed", skills: [], detail: err instanceof Error ? err.message : String(err) };
  } finally {
    if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}

// 전체 카탈로그 동기화 — 순차 처리(GitHub rate limit·디스크 부하 완화).
export async function syncStoreSkillCatalog(): Promise<SkillSyncResult[]> {
  const repos = await fetchStoreCatalogSkillRepos();
  const results: SkillSyncResult[] = [];
  for (const repoUrl of repos) {
    results.push(await autoSyncSkillRepo(repoUrl));
  }
  return results;
}
