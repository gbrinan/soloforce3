// 노트 보기 설정 — 설정 모달에서 편집, NotesPanel이 CSS 변수로 주입해 적용.
// localStorage 'jarvis:noteViewSettings'에 영속. 설정 저장 시 'note-view-settings-changed'
// 이벤트를 발화해 열려 있는 NotesPanel이 즉시 재로드하도록 한다.
import type React from 'react';

export type NoteSpacing = 'narrow' | 'normal' | 'wide';

export interface NoteViewSettings {
  bodyFont: string;
  codeFont: string;
  fontSize: number;        // px
  lineHeight: NoteSpacing;
  docWidth: NoteSpacing;
}

export const DEFAULT_NOTE_VIEW: NoteViewSettings = {
  bodyFont: 'Pretendard',
  codeFont: 'IBM Plex Mono',
  fontSize: 16,
  lineHeight: 'normal',
  docWidth: 'normal',
};

// SegmentedControl 값 → 실제 CSS 값 매핑.
export const LINE_HEIGHT_MAP: Record<NoteSpacing, string> = {
  narrow: '1.4',
  normal: '1.6',
  wide: '1.9',
};
export const DOC_WIDTH_MAP: Record<NoteSpacing, string> = {
  narrow: '560px',
  normal: '720px',
  wide: '100%',
};

const STORAGE_KEY = 'jarvis:noteViewSettings';
export const NOTE_VIEW_CHANGED_EVENT = 'note-view-settings-changed';

const SPACING_VALUES: NoteSpacing[] = ['narrow', 'normal', 'wide'];
function asSpacing(v: unknown, fallback: NoteSpacing): NoteSpacing {
  return typeof v === 'string' && (SPACING_VALUES as string[]).includes(v) ? (v as NoteSpacing) : fallback;
}

// 저장값 로드 — 누락/형식 불일치 필드는 기본값으로 방어 머지.
export function loadNoteViewSettings(): NoteViewSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_NOTE_VIEW };
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return { ...DEFAULT_NOTE_VIEW };
    const fontSize = Number((o as { fontSize?: unknown }).fontSize);
    return {
      bodyFont: typeof o.bodyFont === 'string' && o.bodyFont.trim() ? o.bodyFont : DEFAULT_NOTE_VIEW.bodyFont,
      codeFont: typeof o.codeFont === 'string' && o.codeFont.trim() ? o.codeFont : DEFAULT_NOTE_VIEW.codeFont,
      fontSize: Number.isFinite(fontSize) && fontSize >= 12 && fontSize <= 24 ? fontSize : DEFAULT_NOTE_VIEW.fontSize,
      lineHeight: asSpacing(o.lineHeight, DEFAULT_NOTE_VIEW.lineHeight),
      docWidth: asSpacing(o.docWidth, DEFAULT_NOTE_VIEW.docWidth),
    };
  } catch {
    return { ...DEFAULT_NOTE_VIEW };
  }
}

export function saveNoteViewSettings(v: NoteViewSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {
    // ignore (quota/비활성)
  }
  try {
    window.dispatchEvent(new Event(NOTE_VIEW_CHANGED_EVENT));
  } catch {
    // ignore (SSR/비브라우저)
  }
}

// NotesPanel 루트에 인라인 주입할 CSS 변수 객체 생성.
export function noteViewCssVars(v: NoteViewSettings): React.CSSProperties {
  return {
    ['--note-body-font']: v.bodyFont,
    ['--note-code-font']: v.codeFont,
    ['--note-font-size']: `${v.fontSize}px`,
    ['--note-line-height']: LINE_HEIGHT_MAP[v.lineHeight],
    ['--note-doc-width']: DOC_WIDTH_MAP[v.docWidth],
  } as React.CSSProperties;
}
