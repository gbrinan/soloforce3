// 백링크 인덱스 — 에디터 밖 앱레벨에서 마크다운 문자열의 [[...]]를 파싱한다.
// (스펙 §1-4: 저장 시 [[...]] 파싱 → link 인덱스, 역방향 질의로 백링크)

export interface NoteLite {
  id: string;
  title: string;
  content: string;
}

const LINK_INDEX_KEY = 'jarvis:note-links';
const WIKI_RE = /\[\[([^\]\n]+)\]\]/g;

// 마크다운 본문에서 [[대상]] 제목 목록을 추출(중복 제거).
export function parseWikiTargets(md: string): string[] {
  const set = new Set<string>();
  let m: RegExpExecArray | null;
  WIKI_RE.lastIndex = 0;
  while ((m = WIKI_RE.exec(md)) !== null) {
    const target = m[1].trim();
    if (target) set.add(target);
  }
  return [...set];
}

// 전체 노트의 source(id) → target 제목 배열 인덱스를 localStorage에 저장.
export function persistLinkIndex(notes: NoteLite[]): void {
  const index: Record<string, string[]> = {};
  for (const n of notes) index[n.id] = parseWikiTargets(n.content);
  try {
    localStorage.setItem(LINK_INDEX_KEY, JSON.stringify(index));
  } catch {
    // ignore (quota/비활성)
  }
}

// target 노트를 [[제목]]으로 언급한 다른 노트들(제목 대소문자 무시 매칭).
export function getBacklinks(target: NoteLite, notes: NoteLite[]): NoteLite[] {
  const title = target.title.trim().toLowerCase();
  if (!title) return [];
  return notes.filter((n) =>
    n.id !== target.id
    && parseWikiTargets(n.content).some((t) => t.toLowerCase() === title));
}
