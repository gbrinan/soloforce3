// 노트(NotesPanel)와 자료실(FilesPanel 'staff' 탭)이 공유하는 폴더 "정의" 저장소.
// 공유 대상: 폴더의 정의(id/이름/부모/색). 한쪽에서 폴더를 만들거나 이름·색을 바꾸면 양쪽에 반영된다.
// 비공유: 노트→폴더 / 파일→폴더 "배정"은 각자 유지(jarvis:noteFolderMap, jarvis:fileFolders) —
//   콘텐츠 종류(localStorage 노트 vs 서버 파일)가 달라 배정까지 합치지 않는다.
// 자료실 'external'(외부 보고) 탭 폴더는 공유 대상이 아니다(기존대로 jarvis:libraryFolders.external 유지).
//
// 기존 분리 저장(jarvis:noteFolders, jarvis:libraryFolders.staff)을 최초 1회 병합해 무손실 이전한다.
// 폴더 id가 보존되므로 기존 배정 맵(noteFolderMap/fileFolders)이 그대로 해석된다.

import { pushWorkspace } from './workspaceSync';

export interface SharedFolder { id: string; name: string; parentId: string | null; color?: string }

const KEY = 'jarvis:sharedFolders';
export const SHARED_FOLDERS_CHANGED_EVENT = 'shared-folders-changed';

function normalize(arr: unknown): SharedFolder[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((x): x is SharedFolder => !!x && typeof (x as SharedFolder).id === 'string' && typeof (x as SharedFolder).name === 'string')
    .map((x) => ({
      id: x.id,
      name: x.name,
      parentId: typeof x.parentId === 'string' ? x.parentId : null,
      ...(typeof x.color === 'string' ? { color: x.color } : {}),
    }));
}

// id 기준 중복 제거(먼저 등장한 항목 우선). 노트/스태프 폴더 id는 uuid라 실제 충돌은 거의 없다.
function mergeById(arr: SharedFolder[]): SharedFolder[] {
  const seen = new Set<string>();
  const out: SharedFolder[] = [];
  for (const f of arr) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    out.push(f);
  }
  return out;
}

function readLegacy(key: string, pick?: (o: any) => unknown): SharedFolder[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return normalize(pick ? pick(parsed) : parsed);
  } catch {
    return [];
  }
}

export function loadSharedFolders(): SharedFolder[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return normalize(parsed);
    }
  } catch {
    // fallthrough → 레거시 병합
  }
  // 최초 1회: 레거시 노트 폴더 + 자료실 staff 폴더를 병합해 공유 저장소로 이전.
  const merged = mergeById([
    ...readLegacy('jarvis:noteFolders'),
    ...readLegacy('jarvis:libraryFolders', (o) => o?.staff),
  ]);
  try { localStorage.setItem(KEY, JSON.stringify(merged)); } catch { /* ignore */ }
  return merged;
}

export function saveSharedFolders(v: SharedFolder[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* ignore */ }
  pushWorkspace({ sharedFolders: v });   // 서버 동기화(기기 간) — localStorage는 캐시.
  try { window.dispatchEvent(new Event(SHARED_FOLDERS_CHANGED_EVENT)); } catch { /* SSR/비브라우저 */ }
}

// 서버에서 받은 공유 폴더를 localStorage 캐시에 미러(서버를 단일 진실 소스로). 이벤트만 발화, 서버 재push 안 함.
export function hydrateSharedFoldersCache(v: SharedFolder[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(normalize(v))); } catch { /* ignore */ }
  try { window.dispatchEvent(new Event(SHARED_FOLDERS_CHANGED_EVENT)); } catch { /* */ }
}
