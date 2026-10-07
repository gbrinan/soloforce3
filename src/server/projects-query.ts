// Projects 앱 M1 읽기 전용 백엔드 — 파일시스템이 SSOT, 여기서는 읽기만 한다.
// 쓰기·버전·RAG·도메인분류는 이후 단계(설계 v2.3-final 참조). M1은 열람만.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, extname, sep } from "node:path";
import { PROJECTS_DIR } from "../config.js";
import { CATEGORY_DIRS } from "./anandara-projects.js";
import { nfc, resolveExistingArtifact } from "./utils/path-normalize.js";

const READABLE_EXTS = new Set([".md", ".txt", ".json"]);
const FOLDER_KEYS = ["00-sessions", "10-curriculum", "20-feedback", "30-proposals", "outputs"] as const;

export interface ProjectSessions { total: number; live: number; cancelled: number; firstDate: string | null; lastDate: string | null; }
export interface ProjectSummary {
  category: string; slug: string; name: string; client: string | null; status: string | null;
  sessions: ProjectSessions | null; domain: string[]; generatedBy: string | null;
}
export interface ProjectFileMeta { name: string; size: number; mtime: string; }
export interface ProjectDetail extends ProjectSummary {
  folders: { key: string; files: ProjectFileMeta[] }[];
  projectJson: Record<string, unknown>;
}

function readProjectJson(dir: string): Record<string, unknown> | null {
  const p = join(dir, "project.json");
  if (!existsSync(p)) return null;
  try { const raw = JSON.parse(readFileSync(p, "utf-8")) as unknown; return raw && typeof raw === "object" ? raw as Record<string, unknown> : null; }
  catch { return null; }
}

function toSummary(category: string, slug: string, pj: Record<string, unknown> | null): ProjectSummary {
  const rawSessions = pj?.anandaraSessions;
  const sessions = rawSessions && typeof rawSessions === "object" ? rawSessions as unknown as ProjectSessions : null;
  const domRaw = pj?.domain;
  let domain: string[] = [];
  if (Array.isArray(domRaw)) domain = domRaw.map((d) => String(d));
  else if (domRaw && typeof domRaw === "object" && Array.isArray((domRaw as { labels?: unknown }).labels)) {
    domain = (domRaw as { labels: Array<{ name?: unknown }> }).labels.map((l) => String(l?.name ?? "")).filter(Boolean);
  }
  return {
    category, slug,
    name: typeof pj?.name === "string" ? pj.name : slug,
    client: typeof pj?.anandaraClient === "string" ? pj.anandaraClient as string : (typeof pj?.client === "string" ? pj.client as string : null),
    status: typeof pj?.status === "string" ? pj.status as string : null,
    sessions,
    domain,
    generatedBy: typeof pj?.generatedBy === "string" ? pj.generatedBy as string : null,
  };
}

export function listProjects(opts: { category?: string; search?: string } = {}): ProjectSummary[] {
  if (!existsSync(PROJECTS_DIR)) return [];
  const cats = opts.category ? [opts.category] : [...CATEGORY_DIRS];
  const q = opts.search ? nfc(opts.search).toLowerCase() : "";
  const out: ProjectSummary[] = [];
  for (const category of cats) {
    let entries: import("node:fs").Dirent[];
    try { entries = readdirSync(join(PROJECTS_DIR, category), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue;
      const slug = nfc(e.name);
      const s = toSummary(category, slug, readProjectJson(join(PROJECTS_DIR, category, e.name)));
      if (q && !`${s.name} ${s.client ?? ""}`.toLowerCase().includes(q)) continue;
      out.push(s);
    }
  }
  return out;
}

function resolveProjectDir(category: string, slug: string): string | null {
  const catDir = join(PROJECTS_DIR, category);
  const direct = join(catDir, slug);
  if (existsSync(direct)) return direct;
  const want = nfc(slug);
  try {
    for (const e of readdirSync(catDir, { withFileTypes: true })) {
      if (e.isDirectory() && nfc(e.name) === want) return join(catDir, e.name);
    }
  } catch { /* 카테고리 폴더 부재 */ }
  return null;
}

export function getProject(category: string, slug: string): ProjectDetail | null {
  const dir = resolveProjectDir(category, slug);
  if (!dir) return null;
  const pj = readProjectJson(dir);
  const base = toSummary(category, nfc(slug), pj);
  const folders = FOLDER_KEYS.map((key) => {
    let files: ProjectFileMeta[] = [];
    try {
      files = readdirSync(join(dir, key), { withFileTypes: true })
        .filter((d) => d.isFile() && !d.name.startsWith("."))
        .map((d) => { const st = statSync(join(dir, key, d.name)); return { name: nfc(d.name), size: st.size, mtime: st.mtime.toISOString() }; });
    } catch { /* 폴더 부재 */ }
    return { key: key as string, files };
  });
  return { ...base, folders, projectJson: pj ?? {} };
}

export function readProjectFile(category: string, slug: string, relPath: string): { path: string; content: string; mtime: string } | null {
  const dir = resolveProjectDir(category, slug);
  if (!dir) return null;
  const cleanRel = nfc(relPath).replace(/\\/g, "/");
  if (!cleanRel || cleanRel.includes("..") || cleanRel.startsWith("/")) return null;   // 경로탈출 차단
  if (!READABLE_EXTS.has(extname(cleanRel).toLowerCase())) return null;                 // 확장자 화이트리스트
  const root = resolve(dir);
  const target = resolve(dir, cleanRel);
  if (target !== root && !target.startsWith(root + sep)) return null;                    // 루트 이탈 차단
  const actual = resolveExistingArtifact(target, cleanRel, dir);                         // NFD 관용
  if (!actual) return null;
  const st = statSync(actual);
  if (!st.isFile()) return null;
  return { path: cleanRel, content: readFileSync(actual, "utf-8"), mtime: st.mtime.toISOString() };
}
