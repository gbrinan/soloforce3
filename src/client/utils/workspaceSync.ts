// 워크스페이스 서버 동기화 — 자료실/노트의 폴더·배정·노트 콘텐츠를 로그인 유저(서버 세션) 기준으로 저장·조회.
// 동기화 소스는 서버(/api/workspace). localStorage는 오프라인/초기렌더 캐시로만 사용.
// 저장은 600ms 디바운스 PUT(부분 패치 누적 머지). 페이지 이탈 시 keepalive로 보류분 flush.

export interface SharedFolderData { id: string; name: string; parentId: string | null; color?: string }
export interface NoteData { id: string; title: string; content: string; createdAt: number; updatedAt: number }

export interface WorkspaceData {
  sharedFolders?: SharedFolderData[];
  libraryFolders?: { staff: SharedFolderData[]; external: SharedFolderData[] };
  fileFolders?: Record<string, string>;
  fileBookmarks?: string[];
  notes?: NoteData[];
  noteFolderMap?: Record<string, string>;
  updatedAt?: number;
}

// 서버에서 현재 유저의 워크스페이스 조회. 실패(오프라인/네트워크)는 null → 호출측이 localStorage 캐시 유지.
export async function fetchWorkspace(): Promise<WorkspaceData | null> {
  try {
    const res = await fetch('/api/workspace');
    if (!res.ok) return null;
    return (await res.json()) as WorkspaceData;
  } catch {
    return null;
  }
}

let pending: Partial<WorkspaceData> = {};
let timer: ReturnType<typeof setTimeout> | null = null;

function flush(): Promise<void> {
  const body = pending;
  pending = {};
  if (timer) { clearTimeout(timer); timer = null; }
  if (Object.keys(body).length === 0) return Promise.resolve();
  try {
    return fetch('/api/workspace', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(() => { /* success */ }).catch(() => { /* 오프라인 — localStorage 캐시 유지, 다음 변경 시 재시도 */ });
  } catch {
    return Promise.resolve();
  }
}

// 변경분을 서버에 비동기 반영(디바운스). 동일 키는 최신값으로 덮어써 누적.
export function pushWorkspace(patch: Partial<WorkspaceData>): void {
  pending = { ...pending, ...patch };
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { void flush(); }, 600);
}

// 디바운스 대기 없이 즉시 보류 패치를 서버에 전송. 폴더 삭제 같은 중요 작업에서 호출.
// Promise 반환으로 호출측에서 await 가능(완료 보장).
export function flushWorkspace(): Promise<void> {
  return flush();
}

// 페이지 이탈 시 보류 패치를 keepalive로 즉시 전송(디바운스 내 새로고침 소실 방지).
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (Object.keys(pending).length === 0) return;
    const body = JSON.stringify(pending);
    pending = {};
    if (timer) { clearTimeout(timer); timer = null; }
    try {
      void fetch('/api/workspace', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => { /* best-effort */ });
    } catch { /* */ }
  });
}
