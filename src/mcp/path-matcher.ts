// SafeFS 경로 화이트리스트 매처 — picomatch 기반
// 끝 **, 중간 **, 끝 *, 중간 *, 단일 파일 경로 모두 지원
// 끝이 /** 인 패턴은 디렉토리 자체도 매칭(기존 prefix 매칭 호환)

import picomatch from "picomatch";
import { realpathSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

let BASES: string[] = [];
let PROJECTS_DIR = "";
const matcherCache = new Map<string, (abs: string) => boolean>();

// Windows 경로 구분자 정규화 — base가 역슬래시(C:\...)로 들어오면 아래 '**' 분기의
// `normAbs.startsWith(b + "/")`가 절대 매칭되지 않아 '/**' 허용목록 전체가 무효화된다.
// (증상: 모든 읽기가 승인行 → 워커 건당 55초~2분 정지 → 잡 리스 만료/타임아웃 연쇄)
const normSep = (p: string): string => p.replace(/\\/g, "/");

export function configurePathMatcher(opts: { bases: string[]; projectsDir?: string }): void {
  BASES = opts.bases.map(normSep);
  PROJECTS_DIR = normSep(opts.projectsDir ?? "");
  matcherCache.clear();
}

function getMatcher(p: string, base: string): (abs: string) => boolean {
  const key = `${base}::${p}`;
  const cached = matcherCache.get(key);
  if (cached) return cached;
  const rel = p.replace(/^\//, "");
  let realBase: string;
  try { realBase = realpathSync(base); } catch { realBase = base; }
  const absPattern = pathResolve(realBase, rel).replace(/\\/g, "/");
  const isMatch = picomatch(absPattern, { dot: true });
  let fn: (abs: string) => boolean;
  if (absPattern.endsWith("/**")) {
    const dirPath = absPattern.slice(0, -3);
    fn = (abs) => abs === dirPath || isMatch(abs);
  } else {
    fn = isMatch;
  }
  matcherCache.set(key, fn);
  return fn;
}

export function matchesAllowList(abs: string, paths: string[], basesOverride?: string[]): boolean {
  const normAbs = abs.replace(/\\/g, "/");
  // basesOverride는 호출부가 원시(Windows 역슬래시) 경로를 넘길 수 있으므로 여기서도 정규화.
  const useBases = (basesOverride ?? BASES).map(normSep);
  for (const p of paths) {
    const trimmed = p.replace(/^\//, "").replace(/\/\*\*$/, "").replace(/\/\*$/, "").replace(/\/$/, "");
    if (trimmed === "**") {
      for (const b of useBases) {
        if (normAbs === b || normAbs.startsWith(b + "/")) return true;
      }
      if (PROJECTS_DIR && (normAbs === PROJECTS_DIR || normAbs.startsWith(PROJECTS_DIR + "/"))) return true;
      continue;
    }
    for (const b of useBases) {
      if (getMatcher(p, b)(normAbs)) return true;
    }
  }
  return false;
}
