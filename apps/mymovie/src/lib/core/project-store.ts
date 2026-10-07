// File-backed project store (P1-2 영구화).
// 잡 메타데이터 + Action[] + ClipMeta[] 를 workspaces/{jobId}/project.json 으로 보존.
// OSS-only: 외부 DB 미사용, 파일시스템만 사용.

import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { resolve as resolvePath } from "node:path";

import type { Action } from "./action-types";
import type { ClipMeta } from "./clip-meta";
import { DATA_DIR } from "../paths";

export const WORKSPACES_DIR: string =
  process.env.MYMOVIE_WORKSPACES_DIR || resolvePath(DATA_DIR, "workspaces");

export interface ProjectJob {
  id: string;
  source: unknown;
  stage: string;
  progress: number;
  message?: string;
  outputPath?: string;
  proxyPath?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectFile {
  job: ProjectJob;
  actions: Action[];
  clips: ClipMeta[];
  updatedAt: number;
}

function ensureWorkspaceDir(jobId: string): string {
  const dir = resolvePath(WORKSPACES_DIR, jobId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function projectPath(jobId: string): string {
  return resolvePath(WORKSPACES_DIR, jobId, "project.json");
}

function atomicWrite(path: string, content: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, path);
}

export function loadProject(jobId: string): ProjectFile | null {
  const path = projectPath(jobId);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<ProjectFile>;
    if (!parsed.job) return null;
    return {
      job: parsed.job as ProjectJob,
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      clips: Array.isArray(parsed.clips) ? parsed.clips : [],
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

export function saveProject(
  jobId: string,
  patch: { job?: ProjectJob; actions?: Action[]; clips?: ClipMeta[] }
): ProjectFile {
  ensureWorkspaceDir(jobId);
  const existing = loadProject(jobId);
  const next: ProjectFile = {
    job: patch.job ?? existing?.job ?? ({ id: jobId } as ProjectJob),
    actions: patch.actions ?? existing?.actions ?? [],
    clips: patch.clips ?? existing?.clips ?? [],
    updatedAt: Date.now(),
  };
  atomicWrite(projectPath(jobId), JSON.stringify(next, null, 2));
  return next;
}

export interface ProjectSummary {
  jobId: string;
  updatedAt: number;
  stage: string;
  clips: number;
  actions: number;
}

export function listProjects(): ProjectSummary[] {
  if (!existsSync(WORKSPACES_DIR)) return [];
  const out: ProjectSummary[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(WORKSPACES_DIR);
  } catch {
    return [];
  }
  for (const name of entries) {
    const dir = resolvePath(WORKSPACES_DIR, name);
    try {
      const st = statSync(dir);
      if (!st.isDirectory()) continue;
    } catch {
      continue;
    }
    const proj = loadProject(name);
    if (!proj) continue;
    out.push({
      jobId: name,
      updatedAt: proj.updatedAt || proj.job.updatedAt || 0,
      stage: proj.job.stage,
      clips: proj.clips.length,
      actions: proj.actions.length,
    });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}
