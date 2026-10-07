// 인제스트 잡 레지스트리.
// 1차 캐시는 In-memory Map. 2차 영구화는 workspaces/{jobId}/project.json (P1-2).
// 서버 재시작 후에도 디스크에서 자동 복원되어 멀티세션 / 리오픈 / 후속 렌더 가능.

import { randomUUID } from "node:crypto";

import {
  loadProject,
  saveProject,
  listProjects,
  type ProjectJob,
} from "../core/project-store";

export type JobStage = "queued" | "downloading" | "transcoding" | "done" | "error";

export interface IngestJob {
  id: string;
  source: { kind: "youtube"; url: string } | { kind: "upload"; filename: string };
  stage: JobStage;
  progress: number; // 0..100
  message?: string;
  outputPath?: string;
  proxyPath?: string;
  createdAt: number;
  updatedAt: number;
}

const jobs = new Map<string, IngestJob>();

function persist(job: IngestJob): void {
  try {
    saveProject(job.id, { job: job as ProjectJob });
  } catch {
    // 디스크 쓰기 실패는 잡 처리를 막지 않는다 (in-memory는 살아 있음).
    // ENOSPC 등 환경 문제는 로그가 별도로 잡는다.
  }
}

function hydrate(id: string): IngestJob | null {
  const proj = loadProject(id);
  if (!proj) return null;
  const j = proj.job as Partial<IngestJob> | undefined;
  if (!j || !j.id || !j.source || !j.stage) return null;
  const restored: IngestJob = {
    id: j.id,
    source: j.source as IngestJob["source"],
    stage: j.stage as JobStage,
    progress: typeof j.progress === "number" ? j.progress : 0,
    message: j.message,
    outputPath: j.outputPath,
    proxyPath: j.proxyPath,
    createdAt: typeof j.createdAt === "number" ? j.createdAt : Date.now(),
    updatedAt: typeof j.updatedAt === "number" ? j.updatedAt : Date.now(),
  };
  jobs.set(restored.id, restored);
  return restored;
}

export function createJob(source: IngestJob["source"]): IngestJob {
  const now = Date.now();
  const job: IngestJob = {
    id: randomUUID(),
    source,
    stage: "queued",
    progress: 0,
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(job.id, job);
  persist(job);
  return job;
}

export function updateJob(
  id: string,
  patch: Partial<Omit<IngestJob, "id" | "createdAt">>
): IngestJob | null {
  const cur = jobs.get(id) ?? hydrate(id);
  if (!cur) return null;
  const next: IngestJob = { ...cur, ...patch, updatedAt: Date.now() };
  jobs.set(id, next);
  persist(next);
  return next;
}

export function getJob(id: string): IngestJob | null {
  return jobs.get(id) ?? hydrate(id);
}

export function listJobs(): IngestJob[] {
  // 디스크의 모든 프로젝트를 캐시에 끌어올린 뒤 메모리 기준으로 정렬.
  for (const summary of listProjects()) {
    if (!jobs.has(summary.jobId)) hydrate(summary.jobId);
  }
  return Array.from(jobs.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}
