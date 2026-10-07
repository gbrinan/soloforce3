// 사용자별 워크스페이스 저장소 — 자료실/노트의 폴더 정의·배정·노트 콘텐츠를 서버에 영속화.
// 기기 간 동기화 소스(클라이언트 localStorage는 오프라인/초기렌더 캐시).
// userKey = 로그인 이메일(SSO). SSO 비활성/미인증/내부 self-fetch는 단일 사용자("__local__").
// 저장: HISTORY_DIR/user-workspaces/{sha256(userKey).slice(0,16)}.json (last-write-wins, 부분 패치 머지).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { HISTORY_DIR } from "../config.js";

export interface SharedFolderData { id: string; name: string; parentId: string | null; color?: string }
export interface NoteData { id: string; title: string; content: string; createdAt: number; updatedAt: number }

export interface WorkspaceData {
  sharedFolders?: SharedFolderData[];                                   // 자료실(staff)↔노트 공유 폴더 정의
  libraryFolders?: { staff: SharedFolderData[]; external: SharedFolderData[] }; // 자료실 탭별 폴더(external 전용 + staff 레거시)
  fileFolders?: Record<string, string>;                                // 파일key → 폴더id 배정
  fileBookmarks?: string[];                                            // 북마크된 파일key 목록
  notes?: NoteData[];                                                  // 노트 콘텐츠(마크다운 포함)
  noteFolderMap?: Record<string, string>;                             // 노트id → 폴더id 배정
  updatedAt?: number;                                                  // 마지막 저장 시각(최초 여부 판별용)
}

// 부분 패치 가능한 데이터 필드(updatedAt 제외).
const PATCH_FIELDS = ["sharedFolders", "libraryFolders", "fileFolders", "fileBookmarks", "notes", "noteFolderMap"] as const;

const DIR = join(HISTORY_DIR, "user-workspaces");

function fileFor(userKey: string): string {
  const hash = createHash("sha256").update(userKey).digest("hex").slice(0, 16);
  return join(DIR, `${hash}.json`);
}

export function loadWorkspace(userKey: string): WorkspaceData {
  try {
    const fp = fileFor(userKey);
    if (!existsSync(fp)) return {};
    const raw = JSON.parse(readFileSync(fp, "utf-8"));
    return raw && typeof raw === "object" ? (raw as WorkspaceData) : {};
  } catch (err) {
    console.error("[Workspace] 로드 실패:", err);
    return {};
  }
}

// 부분 패치 머지 후 저장 — 명시된 필드만 덮어쓴다(undefined 필드는 기존 유지).
export function saveWorkspace(userKey: string, patch: Partial<WorkspaceData>): WorkspaceData {
  const cur = loadWorkspace(userKey);
  const next: WorkspaceData = { ...cur };
  for (const k of PATCH_FIELDS) {
    if (patch[k] !== undefined) (next as Record<string, unknown>)[k] = patch[k];
  }
  next.updatedAt = Date.now();
  try {
    if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
    writeFileSync(fileFor(userKey), JSON.stringify(next));
  } catch (err) {
    console.error("[Workspace] 저장 실패:", err);
  }
  return next;
}
