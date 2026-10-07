// 스캐너 공용 타입 + 실제 fs 재귀 스캔 유틸리티.
// macos.ts / windows.ts는 이 모듈의 함수를 플랫폼별 경로로 호출만 한다(중복 로직 제거).
import { readdirSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { isDenied, isExcludedDirName, isProtectedUserDir } from "../safety";

export interface ScanItem {
  path: string;
  size: number;
  isDir: boolean;
  mtimeMs: number;
  atimeMs: number;
}

export interface ScanCategory {
  id: string;
  label: string;
  totalSize: number;
  items: ScanItem[];
  available: boolean;
}

// AI parse-filter output schema — applied as a post-filter on the Large Files category only.
export interface ScanFilter {
  minSizeMB?: number;
  olderThanDays?: number;
  extensions?: string[];
  pathIncludes?: string[];
}

// Apply a ScanFilter to items ("not used" = max(mtime, atime) older than cutoff).
// minSizeMB is handled upstream as the scan threshold, so only the other keys filter here.
export function applyScanFilter(items: ScanItem[], filter: ScanFilter): ScanItem[] {
  const cutoff =
    filter.olderThanDays && filter.olderThanDays > 0
      ? Date.now() - filter.olderThanDays * 86_400_000
      : null;
  const exts = filter.extensions
    ?.map((e) => `.${e.replace(/^\./, "").toLowerCase()}`)
    .filter((e) => e.length > 1);
  const incs = filter.pathIncludes?.map((s) => s.toLowerCase()).filter((s) => s.length > 0);

  return items.filter((item) => {
    if (cutoff !== null && Math.max(item.mtimeMs, item.atimeMs) > cutoff) return false;
    if (exts?.length && !exts.some((e) => item.path.toLowerCase().endsWith(e))) return false;
    if (incs?.length && !incs.some((s) => item.path.toLowerCase().includes(s))) return false;
    return true;
  });
}

// 대용량 파일 기본 임계값 100MB — 500MB는 너무 높아 표시 건수가 적었다(상위 30 슬롯이 안 참).
// 100MB는 표준 "대용량 파일" 기준으로, 상위 30개 목록을 노이즈 없이 더 채운다.
export const LARGE_FILE_DEFAULT_THRESHOLD = 100 * 1024 * 1024;

function safeLstat(p: string) {
  try {
    return lstatSync(p);
  } catch {
    return null;
  }
}

interface WalkCounter {
  n: number;
}

// 디렉토리 전체 크기 합산 (심볼릭 링크 제외, 소스코드 폴더 제외, deny-list 제외).
function dirSize(dirPath: string, maxDepth: number, maxEntries: number, depth: number, counter: WalkCounter): number {
  if (depth > maxDepth || counter.n > maxEntries) return 0;
  let entries: string[];
  try {
    entries = readdirSync(dirPath);
  } catch {
    return 0;
  }
  let total = 0;
  for (const name of entries) {
    if (isExcludedDirName(name)) continue;
    counter.n++;
    if (counter.n > maxEntries) break;
    const full = join(dirPath, name);
    if (isDenied(full)) continue;
    const lst = safeLstat(full);
    if (!lst || lst.isSymbolicLink()) continue; // 심볼릭 링크는 순회하지 않음
    total += lst.isDirectory() ? dirSize(full, maxDepth, maxEntries, depth + 1, counter) : lst.size;
  }
  return total;
}

// 단일 경로 카테고리: 하위 항목(파일/폴더)을 1레벨로 집계해서 보여준다 (예: Caches의 com.docker.docker/ 등).
export function buildCategory(
  id: string,
  label: string,
  dirPath: string,
  opts: { maxDepth?: number; maxEntries?: number } = {},
): ScanCategory {
  const { maxDepth = 4, maxEntries = 20000 } = opts;
  const rootLst = safeLstat(dirPath);
  if (!rootLst || rootLst.isSymbolicLink()) return { id, label, totalSize: 0, items: [], available: false };
  let entries: string[];
  try {
    entries = readdirSync(dirPath);
  } catch {
    return { id, label, totalSize: 0, items: [], available: true };
  }
  const items: ScanItem[] = [];
  for (const name of entries) {
    if (isExcludedDirName(name)) continue;
    const full = join(dirPath, name);
    if (isDenied(full)) continue;
    const lst = safeLstat(full);
    if (!lst || lst.isSymbolicLink()) continue;
    if (lst.isDirectory()) {
      const size = dirSize(full, maxDepth, maxEntries, 0, { n: 0 });
      items.push({ path: full, size, isDir: true, mtimeMs: lst.mtimeMs, atimeMs: lst.atimeMs });
    } else {
      items.push({ path: full, size: lst.size, isDir: false, mtimeMs: lst.mtimeMs, atimeMs: lst.atimeMs });
    }
  }
  const totalSize = items.reduce((s, i) => s + i.size, 0);
  return { id, label, totalSize, items, available: true };
}

// 여러 경로(브라우저별 캐시 등)를 하나의 카테고리로 묶어서 집계.
export function buildMultiPathCategory(
  id: string,
  label: string,
  pathsByKey: Record<string, string>,
  opts: { maxDepth?: number; maxEntries?: number } = {},
): ScanCategory {
  const { maxDepth = 3, maxEntries = 20000 } = opts;
  const items: ScanItem[] = [];
  let available = false;
  for (const [key, dirPath] of Object.entries(pathsByKey)) {
    const lst = safeLstat(dirPath);
    if (!lst || lst.isSymbolicLink()) continue;
    available = true;
    const size = lst.isDirectory() ? dirSize(dirPath, maxDepth, maxEntries, 0, { n: 0 }) : lst.size;
    items.push({ path: `${key}: ${dirPath}`, size, isDir: lst.isDirectory(), mtimeMs: lst.mtimeMs, atimeMs: lst.atimeMs });
  }
  const totalSize = items.reduce((s, i) => s + i.size, 0);
  return { id, label, totalSize, items, available };
}

// 홈 디렉토리 재귀 스캔 → 임계값 이상 파일만 수집 (Large Files 카테고리).
// 보호 사용자 폴더(Documents/Desktop/...) + deny-list + 소스코드 폴더 + 심볼릭 링크는 순회하지 않는다.
export function scanLargeFilesUnder(
  homeDir: string,
  thresholdBytes: number,
  opts: { maxEntries?: number; maxDepth?: number } = {},
): ScanCategory {
  const { maxEntries = 50000, maxDepth = 8 } = opts;
  const items: ScanItem[] = [];
  const counter: WalkCounter = { n: 0 };

  function walk(dirPath: string, depth: number): void {
    if (depth > maxDepth || counter.n > maxEntries) return;
    let entries: string[];
    try {
      entries = readdirSync(dirPath);
    } catch {
      return;
    }
    for (const name of entries) {
      if (counter.n > maxEntries) return;
      if (isExcludedDirName(name)) continue;
      const full = join(dirPath, name);
      if (isDenied(full) || isProtectedUserDir(full)) continue;
      const lst = safeLstat(full);
      if (!lst || lst.isSymbolicLink()) continue;
      counter.n++;
      if (lst.isDirectory()) {
        walk(full, depth + 1);
      } else if (lst.size >= thresholdBytes) {
        items.push({ path: full, size: lst.size, isDir: false, mtimeMs: lst.mtimeMs, atimeMs: lst.atimeMs });
      }
    }
  }
  walk(homeDir, 0);
  const totalSize = items.reduce((s, i) => s + i.size, 0);
  return { id: "largeFiles", label: "Large Files", totalSize, items, available: true };
}

export function unavailableCategory(id: string, label: string): ScanCategory {
  return { id, label, totalSize: 0, items: [], available: false };
}
