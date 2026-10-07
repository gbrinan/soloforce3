import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Stack, Group, Text, ActionIcon, Button, Box, ScrollArea, TextInput, UnstyledButton, Loader, Badge, Tooltip,
  Tree, useTree, type TreeNodeData, type RenderTreeNodePayload, Menu,
} from '@mantine/core';
import {
  IconX, IconPlus, IconTrash, IconSearch, IconFolder, IconFolderFilled, IconFolderPlus,
  IconChevronRight, IconDotsVertical, IconFileText, IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand,
  IconDownload, IconFileTypePdf, IconPrinter, IconClipboard, IconCheck, IconMail, IconChartDots3,
} from '@tabler/icons-react';
import NotesGraph from './NotesGraph';
import { openAppWithAsset, isAppAvailable } from '../../utils/assetHandoff';
import { notifications } from '@mantine/notifications';
import { useI18n } from '../../i18n/I18nProvider';
import { uiPrompt, uiConfirm, uiAlert } from '../Dialog/dialog';
import { renderMarkdown } from '../../utils/markdown';
import { loadNoteViewSettings, noteViewCssVars, NOTE_VIEW_CHANGED_EVENT } from '../../utils/noteViewSettings';
import { ensureFontLoaded } from '../../utils/fonts';
import NoteEditor, { type NoteEditorHandle, type EntityItem } from './NoteEditor';
import PaneResizer from '../PaneResizer';
import type { SuggestionItem } from './tiptap/SuggestionList';
import { getBacklinks, persistLinkIndex } from './tiptap/backlinks';
import { useNoteEmbeddings } from './embeddings/useNoteEmbeddings';
import ErrorBoundary from '../ErrorBoundary';
import { cosine } from './embeddings/embeddingClient';
import { fetchSchedules, fetchTaskTree, createTaskFromNote, type Schedule, type TaskWithTodos } from '../../utils/api';
import { loadSharedFolders, saveSharedFolders, hydrateSharedFoldersCache, SHARED_FOLDERS_CHANGED_EVENT } from '../../utils/sharedFolders';
import { fetchWorkspace, pushWorkspace, flushWorkspace } from '../../utils/workspaceSync';

interface Props {
  visible: boolean;
  onClose: () => void;
  onOpenEntity?: (kind: string, id: string) => void;  // 엔티티 링크 클릭 시 패널 전환
  openNoteId?: string | null;          // 외부(태스크 상세)에서 열 노트 id — 패널 열릴 때 해당 노트 선택
  onConsumeOpenNote?: () => void;      // openNoteId 소비 후 부모가 hint를 비우도록 알림
}

interface Note {
  id: string;
  title: string;
  content: string;          // 마크다운(단일 진실 소스)
  createdAt: number;
  updatedAt: number;
}

const NOTES_KEY = 'jarvis:notes';
const LAST_OPENED_KEY = 'jarvis:notes:lastOpenedId';
const SAVE_DEBOUNCE_MS = 500;

// localStorage에서 노트 배열 로드 — 파싱 실패/형식 불일치 시 빈 배열로 안전 복구.
function loadNotes(): Note[] {
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n): n is Note =>
      n && typeof n.id === 'string' && typeof n.title === 'string' && typeof n.content === 'string');
  } catch {
    return [];
  }
}

// 노트 저장 + 백링크 link 인덱스를 함께 갱신.
function writeNotes(notes: Note[]): void {
  try {
    localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
  } catch {
    // ignore (quota/비활성 등)
  }
  persistLinkIndex(notes);
  pushWorkspace({ notes });   // 서버 동기화(기기 간) — localStorage는 캐시.
}

// 최근 열었던 노트 ID 로드 — 파싱 실패 시 null 반환.
function loadLastOpenedId(): string | null {
  try {
    return localStorage.getItem(LAST_OPENED_KEY);
  } catch {
    return null;
  }
}

// 최근 열었던 노트 ID 저장 — null이면 삭제.
function saveLastOpenedId(id: string | null): void {
  try {
    if (id) localStorage.setItem(LAST_OPENED_KEY, id);
    else localStorage.removeItem(LAST_OPENED_KEY);
  } catch {
    // ignore (quota/비활성 등)
  }
}

// 목록 미리보기 — 본문 첫 줄에서 마크다운 머리기호를 가볍게 제거.
function previewOf(content: string): string {
  const line = content.split('\n').find((l) => l.trim().length > 0) ?? '';
  return line.replace(/^[#>\-*\s]+/, '').trim().slice(0, 60);
}

// 년월 그룹 키(YYYY-M) — 같은 달이면 동일 키.
function monthGroupKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}`;
}
// 년월 그룹 헤더 라벨 — 현재 연도면 월만, 다른 연도면 연도 포함. 로케일별 포맷.
function monthGroupLabel(ts: number, locale: string, currentYear: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const sameYear = y === currentYear;
  if (locale === 'ja') return sameYear ? `${m}月` : `${y}年${m}月`;
  if (locale === 'en') {
    const mn = new Intl.DateTimeFormat('en', { month: 'long' }).format(d);
    return sameYear ? mn : `${mn} ${y}`;
  }
  // ko(기본)
  return sameYear ? `${m}월` : `${y}년 ${m}월`;
}

// 모든 노트 본문에서 #태그 수집(행 머리 '# ' 헤딩은 제외 — '#' 뒤 단어 문자 직결만).
const TAG_RE = /(?:^|[\s(])#([0-9A-Za-z가-힣_/-]+)/g;
// 단일 노트 본문에서 #태그 수집.
function tagsOf(content: string): string[] {
  const set = new Set<string>();
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(content)) !== null) set.add(m[1]);
  return [...set];
}
function collectTags(notes: Note[]): string[] {
  const set = new Set<string>();
  for (const n of notes) for (const tg of tagsOf(n.content)) set.add(tg);
  return [...set];
}

// 노트 폴더(가상) — 실제 파일시스템 없이 localStorage 메타 레이어로 관리(승인된 한계: 기기 간 비동기).
interface NoteFolder { id: string; name: string; parentId: string | null; color?: string }
// 폴더 색상 팔레트(Mantine 색상명) — 기본 yellow.
const NOTE_FOLDER_COLORS = ['yellow', 'blue', 'green', 'red', 'violet', 'orange'] as const;
const NOTE_FOLDER_MAP_KEY = 'jarvis:noteFolderMap'; // Record<noteId, folderId>

// 폴더 "정의"는 자료실('staff' 탭)과 공유한다(sharedFolders 저장소). 한쪽에서 폴더를 만들거나
// 이름·색을 바꾸면 양쪽에 반영. 노트→폴더 "배정"(noteFolderMap)은 노트 전용으로 유지.
function loadNoteFolders(): NoteFolder[] {
  return loadSharedFolders();
}
function saveNoteFolders(v: NoteFolder[]): void {
  saveSharedFolders(v);
}
function loadNoteFolderMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(NOTE_FOLDER_MAP_KEY);
    const obj = raw ? JSON.parse(raw) : null;
    if (!obj || typeof obj !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(obj)) if (typeof val === 'string') out[k] = val;
    return out;
  } catch { return {}; }
}
function saveNoteFolderMap(v: Record<string, string>): void {
  try { localStorage.setItem(NOTE_FOLDER_MAP_KEY, JSON.stringify(v)); } catch { /* ignore */ }
  pushWorkspace({ noteFolderMap: v });   // 서버 동기화(기기 간) — localStorage는 캐시.
}

export default function NotesPanel({ visible, onClose, onOpenEntity, openNoteId, onConsumeOpenNote }: Props) {
  const { t, locale } = useI18n();
  const [notes, setNotes] = useState<Note[]>(() => loadNotes());
  // @멘션용 마이크루 엔티티(일정/태스크) — 노트 패널이 열릴 때 로드.
  const [entitySchedules, setEntitySchedules] = useState<Schedule[]>([]);
  const [entityTasks, setEntityTasks] = useState<TaskWithTodos[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [folders, setFolders] = useState<NoteFolder[]>(() => loadNoteFolders());
  const [folderMap, setFolderMap] = useState<Record<string, string>>(() => loadNoteFolderMap());
  const [searchQuery, setSearchQuery] = useState('');
  // 그래프 뷰 — 우측 편집 영역을 위키링크 연결 그래프로 전환.
  const [graphOpen, setGraphOpen] = useState(false);
  // 좌측 사이드바 접기/펼치기 — localStorage 영속('0'=접힘, 그 외/없음=펼침).
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('jarvis:noteSidebarOpen') !== '0'; } catch { return true; }
  });
  const toggleSidebar = useCallback(() => {
    setSidebarOpen((v) => {
      const next = !v;
      try { localStorage.setItem('jarvis:noteSidebarOpen', next ? '1' : '0'); } catch { /* */ }
      return next;
    });
  }, []);
  // 좌측 사이드바 너비(드래그 조절) — localStorage 영속('jarvis:noteSidebarWidth', 기본 200, 160~480).
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try { const v = Number(localStorage.getItem('jarvis:noteSidebarWidth')); if (Number.isFinite(v) && v >= 160) return v; } catch { /* */ }
    return 200;
  });
  // 리사이저는 데스크탑에서만 노출(모바일은 사이드바가 전체 폭 흐름).
  const [isDesktop, setIsDesktop] = useState<boolean>(() => typeof window !== 'undefined' && window.innerWidth > 768);
  useEffect(() => {
    const onR = () => setIsDesktop(window.innerWidth > 768);
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, []);
  const handleSidebarResize = useCallback((next: number) => {
    setSidebarWidth(next);
    try { localStorage.setItem('jarvis:noteSidebarWidth', String(next)); } catch { /* */ }
  }, []);
  const [searchRanked, setSearchRanked] = useState<string[] | null>(null);   // 시맨틱 결과 노트 id 순서(없으면 텍스트 폴백)
  const [suggestedTags, setSuggestedTags] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [noteView, setNoteView] = useState(() => loadNoteViewSettings());
  const editorApiRef = useRef<NoteEditorHandle | null>(null);
  const printRef = useRef<HTMLDivElement | null>(null);

  // 노트 보기 설정 동기화 — 설정 모달 저장 시 발화되는 이벤트 + 패널 열릴 때 재로드.
  useEffect(() => {
    const reload = () => setNoteView(loadNoteViewSettings());
    window.addEventListener(NOTE_VIEW_CHANGED_EVENT, reload);
    return () => window.removeEventListener(NOTE_VIEW_CHANGED_EVENT, reload);
  }, []);

  // 공유 폴더 동기화 — 자료실에서 폴더가 추가/수정되면(다른 컴포넌트·다른 탭) 노트 트리에 즉시 반영.
  useEffect(() => {
    const reload = () => setFolders(loadSharedFolders());
    window.addEventListener(SHARED_FOLDERS_CHANGED_EVENT, reload);
    window.addEventListener('storage', reload);
    return () => {
      window.removeEventListener(SHARED_FOLDERS_CHANGED_EVENT, reload);
      window.removeEventListener('storage', reload);
    };
  }, []);
  useEffect(() => {
    if (visible) setNoteView(loadNoteViewSettings());
  }, [visible]);

  // 선택된 본문/코드 글꼴을 동적 로드 — 설정 모달을 거치지 않고 새로고침 후 패널만 열어도 적용 보장.
  // 인터넷 없거나 로드 실패 시 graceful 폴백(에러 없음).
  useEffect(() => {
    ensureFontLoaded(noteView.bodyFont);
    ensureFontLoaded(noteView.codeFont);
  }, [noteView.bodyFont, noteView.codeFont]);

  // 로컬 임베딩 인덱스 — 노트 패널이 보일 때만 동작(미사용 시 모델 미로드).
  const { status: embedStatus, index: embedIndex, embedQuery, suggestTags } = useNoteEmbeddings(notes, visible);

  // 패널이 열릴 때 일정/태스크 로드(@ 멘션 자동완성용). 실패는 빈 목록으로 무시.
  useEffect(() => {
    if (!visible) return;
    fetchSchedules({}).then(setEntitySchedules).catch(() => setEntitySchedules([]));
    fetchTaskTree().then(setEntityTasks).catch(() => setEntityTasks([]));
  }, [visible]);

  // @멘션 자동완성 — 일정(event) + 태스크(task)를 라벨/쿼리로 필터.
  const getEntityItems = useCallback((query: string): EntityItem[] => {
    const q = query.trim().toLowerCase();
    const items: EntityItem[] = [];
    for (const s of entitySchedules) {
      const label = s.title?.trim() || t('notes.untitled');
      if (!q || label.toLowerCase().includes(q)) items.push({ kind: 'event', id: s.id, label });
    }
    for (const tk of entityTasks) {
      const label = tk.instruction?.trim() || t('notes.untitled');
      if (!q || label.toLowerCase().includes(q)) items.push({ kind: 'task', id: tk.id, label: label.slice(0, 60) });
    }
    return items.slice(0, 20);
  }, [entitySchedules, entityTasks, t]);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingNotesRef = useRef<Note[] | null>(null);   // 디바운스 대기 중인 최신 노트 배열(즉시 flush 시 기록 대상)
  const notesRef = useRef<Note[]>(notes);
  notesRef.current = notes;
  const selectedIdRef = useRef<string | null>(selectedId);
  selectedIdRef.current = selectedId;

  // 외부(태스크 상세 "관련 노트")에서 전달된 openNoteId가 있으면 해당 노트를 선택. 소비 후 부모에 알림.
  useEffect(() => {
    if (!visible || !openNoteId) return;
    if (notesRef.current.some((n) => n.id === openNoteId)) {
      setSelectedId(openNoteId);
      setConfirmDeleteId(null);
    }
    onConsumeOpenNote?.();
  }, [visible, openNoteId, onConsumeOpenNote]);

  // 패널 진입 시 자동 선택 — (1) lastOpenedId 유효하면 선택, (2) 없으면 최근 수정 노트 선택.
  useEffect(() => {
    if (!visible || openNoteId || selectedId !== null || notes.length === 0) return;
    
    // (1순위) lastOpenedId가 유효하면 선택
    const lastId = loadLastOpenedId();
    if (lastId && notes.some((n) => n.id === lastId)) {
      setSelectedId(lastId);
      setConfirmDeleteId(null);
      return;
    }
    
    // (2순위) 최근 수정(updatedAt) 노트 선택
    const sorted = [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
    if (sorted.length > 0) {
      setSelectedId(sorted[0].id);
      setConfirmDeleteId(null);
    }
  }, [visible, openNoteId, selectedId, notes]);

  // selectedId 변경 시 lastOpenedId 저장 — 드로어 닫았다 열어도 같은 노트 선택 보장.
  useEffect(() => {
    if (selectedId) {
      saveLastOpenedId(selectedId);
    }
  }, [selectedId]);

  const persistDebounced = useCallback((next: Note[]) => {
    pendingNotesRef.current = next;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      writeNotes(next);
      saveTimer.current = null;
      pendingNotesRef.current = null;
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const persistNow = useCallback((next: Note[]) => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    writeNotes(next);
    pendingNotesRef.current = null;
  }, []);

  // 언마운트 시 보류 저장 flush(에디터 언마운트가 먼저 일어나 pendingNotesRef에 최신값이 들어올 수 있음).
  useEffect(() => {
    return () => {
      if (saveTimer.current || pendingNotesRef.current !== null) {
        if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
        writeNotes(pendingNotesRef.current ?? notesRef.current);
        pendingNotesRef.current = null;
      }
    };
  }, []);

  // 보류 중인 저장을 즉시 flush. NoteEditor 내부 디바운스(400ms)를 먼저 flush해 최신 입력을 끌어온 뒤 기록.
  // 보류가 전혀 없으면 no-op → 중복 저장 방지.
  const flushPending = useCallback(() => {
    editorApiRef.current?.flush?.();   // 에디터 디바운스 → onChange → persistDebounced로 pendingNotesRef 갱신
    if (!saveTimer.current && pendingNotesRef.current === null) return;
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    writeNotes(pendingNotesRef.current ?? notesRef.current);
    pendingNotesRef.current = null;
  }, []);

  // 페이지 이탈(beforeunload) / 탭 숨김(visibilitychange=hidden) 시 즉시 저장 — 0.5초 디바운스 내 새로고침 소실 방지.
  useEffect(() => {
    const onBeforeUnload = () => flushPending();
    const onVisibility = () => { if (document.visibilityState === 'hidden') flushPending(); };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [flushPending]);

  // 서버 워크스페이스 동기화 — 패널이 열릴 때 서버에서 노트/배정/공유폴더를 불러와 적용(기기 간 동기화).
  // 서버에 해당 필드가 없으면(최초) 이 기기의 로컬값을 1회 업로드해 서버를 단일 진실 소스로 채운다.
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    fetchWorkspace().then((ws) => {
      if (!alive || !ws) return;
      if (Array.isArray(ws.notes)) {
        try { localStorage.setItem(NOTES_KEY, JSON.stringify(ws.notes)); } catch { /* */ }
        setNotes(ws.notes as Note[]);
      } else {
        pushWorkspace({ notes: notesRef.current });
      }
      if (ws.noteFolderMap && typeof ws.noteFolderMap === 'object') {
        try { localStorage.setItem(NOTE_FOLDER_MAP_KEY, JSON.stringify(ws.noteFolderMap)); } catch { /* */ }
        setFolderMap(ws.noteFolderMap);
      } else {
        pushWorkspace({ noteFolderMap: loadNoteFolderMap() });
      }
      if (Array.isArray(ws.sharedFolders)) {
        hydrateSharedFoldersCache(ws.sharedFolders);
        setFolders(ws.sharedFolders as NoteFolder[]);
      } else {
        pushWorkspace({ sharedFolders: loadSharedFolders() });
      }
    });
    return () => { alive = false; };
  }, [visible]);

  const sortedNotes = useMemo(
    () => [...notes].sort((a, b) => b.updatedAt - a.updatedAt),
    [notes],
  );

  const selected = useMemo(
    () => notes.find((n) => n.id === selectedId) ?? null,
    [notes, selectedId],
  );

  const backlinks = useMemo(
    () => (selected ? getBacklinks(selected, notes) : []),
    [selected, notes],
  );

  // 프린트/PDF 출력용 HTML — 선택 노트 본문 마크다운을 렌더. 본문 변경 시에만 재계산.
  const printHtml = useMemo(
    () => (selected ? renderMarkdown(selected.content || '') : ''),
    [selected],
  );

  // 표시 노트 목록 — 검색어 있으면 시맨틱 순위(폴백: 텍스트 부분일치), 없으면 최신순.
  const displayedNotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sortedNotes;
    const textHit = (n: Note) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q);
    if (searchRanked) {
      const byId = new Map(notes.map((n) => [n.id, n] as const));
      const semantic = searchRanked.map((id) => byId.get(id)).filter((n): n is Note => !!n);
      const seen = new Set(semantic.map((n) => n.id));
      const extra = sortedNotes.filter((n) => !seen.has(n.id) && textHit(n));
      return [...semantic, ...extra];
    }
    return sortedNotes.filter(textHit);
  }, [searchQuery, searchRanked, sortedNotes, notes]);

  // 관련 노트 — 선택 노트 벡터와 코사인 유사도 상위 3.
  const relatedNotes = useMemo(() => {
    if (!selected) return [] as { id: string; title: string; score: number }[];
    const sv = embedIndex[selected.id];
    if (!sv) return [];
    return notes
      .filter((n) => n.id !== selected.id && embedIndex[n.id])
      .map((n) => ({ id: n.id, title: n.title, score: cosine(sv, embedIndex[n.id]) }))
      .filter((r) => r.score >= 0.35)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }, [selected, embedIndex, notes]);

  // 시맨틱 검색 — 쿼리 임베딩(디바운스) → 코사인 정렬. 실패/미준비 시 텍스트 폴백(null).
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) { setSearchRanked(null); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      embedQuery(q).then((qvec) => {
        if (cancelled) return;
        const idx = embedIndex;
        const ranked = notesRef.current
          .map((n) => ({ id: n.id, score: idx[n.id] ? cosine(qvec, idx[n.id]) : -1 }))
          .filter((s) => s.score > 0.2)
          .sort((a, b) => b.score - a.score)
          .map((s) => s.id);
        setSearchRanked(ranked);
      }).catch(() => { if (!cancelled) setSearchRanked(null); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [searchQuery, embedIndex, embedQuery]);

  // 추천 태그 — 선택 노트 벡터 기준 기존 태그 유사도 상위(현재 노트 태그 제외).
  useEffect(() => {
    if (!selected) { setSuggestedTags([]); return; }
    const sv = embedIndex[selected.id];
    if (!sv) { setSuggestedTags([]); return; }
    let cancelled = false;
    const allTags = collectTags(notesRef.current);
    const currentTags = tagsOf(selected.content);
    suggestTags(sv, currentTags, allTags, 5)
      .then((res) => { if (!cancelled) setSuggestedTags(res.map((r) => r.tag)); })
      .catch(() => { if (!cancelled) setSuggestedTags([]); });
    return () => { cancelled = true; };
  }, [selected, embedIndex, suggestTags]);

  const handleNew = useCallback(() => {
    const now = Date.now();
    const note: Note = { id: crypto.randomUUID(), title: '', content: '', createdAt: now, updatedAt: now };
    const next = [note, ...notesRef.current];
    setNotes(next);
    setSelectedId(note.id);
    setConfirmDeleteId(null);
    persistNow(next);
  }, [persistNow]);

  // 제목 수정(선택된 노트).
  const updateTitle = useCallback((title: string) => {
    const id = selectedIdRef.current;
    if (!id) return;
    const next = notesRef.current.map((n) =>
      n.id === id ? { ...n, title, updatedAt: Date.now() } : n);
    setNotes(next);
    persistDebounced(next);
  }, [persistDebounced]);

  // 본문 수정 — 에디터가 noteId와 함께 호출(전환 중 오염 방지).
  const updateContent = useCallback((id: string, markdown: string) => {
    const next = notesRef.current.map((n) =>
      n.id === id ? { ...n, content: markdown, updatedAt: Date.now() } : n);
    setNotes(next);
    persistDebounced(next);
  }, [persistDebounced]);

  const handleDelete = useCallback((id: string) => {
    const next = notesRef.current.filter((n) => n.id !== id);
    setNotes(next);
    if (selectedIdRef.current === id) setSelectedId(null);
    setConfirmDeleteId(null);
    persistNow(next);
  }, [persistNow]);

  // ── 더보기 메뉴: 복사 / 저장(.md) / PDF / 프린트 ──────────────
  // ReportViewer.tsx 패턴 차용. 선택 노트 본문(마크다운)이 단일 진실 소스.
  const handleCopy = useCallback(() => {
    const note = notesRef.current.find((n) => n.id === selectedIdRef.current);
    if (!note?.content) return;
    navigator.clipboard.writeText(note.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    notifications.show({ message: t('notes.copied'), color: 'teal' });
  }, [t]);

  const handleSaveMd = useCallback(() => {
    const note = notesRef.current.find((n) => n.id === selectedIdRef.current);
    if (!note) return;
    const blob = new Blob([note.content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(note.title.trim() || t('notes.untitled'))}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [t]);

  // Send current note as a .md attachment to the Mail app via the asset-handoff bus.
  // Blob URL is same-origin with host, so mail iframe (also same host) can fetch it.
  const handleSendMail = useCallback(() => {
    const note = notesRef.current.find((n) => n.id === selectedIdRef.current);
    if (!note) return;
    const blob = new Blob([note.content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const name = `${(note.title.trim() || t('notes.untitled'))}.md`;
    openAppWithAsset({ appId: 'mail', kind: 'file', url, name, localFile: true });
  }, [t]);

  // 숨겨진 print 영역(printRef)에 .print-area 부여 → window.print() → afterprint 정리.
  // styles.css @media print의 body.jarvis-print-mode .print-area 규칙 재사용.
  const triggerPrint = useCallback((mode: 'pdf' | 'print') => {
    const el = printRef.current;
    if (!el) { window.print(); return; }
    el.classList.add('print-area');
    document.body.classList.add('jarvis-print-mode');
    const cleanup = () => {
      el.classList.remove('print-area');
      document.body.classList.remove('jarvis-print-mode');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    if (mode === 'pdf') {
      void uiAlert({
        title: t('notes.exportPdf'),
        description: t('notes.pdfHint'),
        variant: 'info',
      }).then(() => { setTimeout(() => window.print(), 50); });
    } else {
      setTimeout(() => window.print(), 50);
    }
  }, [t]);

  // 위키링크 자동완성 — 노트 제목 목록 + 신규 항목.
  const getWikiItems = useCallback((query: string): SuggestionItem[] => {
    const q = query.trim().toLowerCase();
    const items: SuggestionItem[] = notesRef.current
      .filter((n) => n.title.trim() && n.id !== selectedIdRef.current)
      .filter((n) => !q || n.title.toLowerCase().includes(q))
      .slice(0, 20)
      .map((n) => ({ id: n.id, label: n.title.trim() }));
    if (query.trim() && !items.some((i) => i.label.toLowerCase() === q)) {
      items.unshift({ id: query.trim(), label: query.trim() });
    }
    return items;
  }, []);

  // 태그 자동완성 — 기존 태그 + 신규 태그.
  const getTagItems = useCallback((query: string): SuggestionItem[] => {
    const q = query.trim().toLowerCase();
    let tags = collectTags(notesRef.current);
    if (q) tags = tags.filter((tg) => tg.toLowerCase().includes(q));
    const items: SuggestionItem[] = tags.slice(0, 20).map((tg) => ({ id: tg, label: tg }));
    if (query.trim() && !items.some((i) => i.label.toLowerCase() === q)) {
      items.unshift({ id: query.trim(), label: query.trim() });
    }
    return items;
  }, []);

  // [[위키링크]] 클릭 — 제목 일치 노트로 이동, 없으면 새로 생성.
  const handleNavigate = useCallback((title: string) => {
    const tl = title.trim().toLowerCase();
    const found = notesRef.current.find((n) => n.title.trim().toLowerCase() === tl);
    if (found) {
      setSelectedId(found.id);
      setConfirmDeleteId(null);
      return;
    }
    const now = Date.now();
    const note: Note = { id: crypto.randomUUID(), title: title.trim(), content: '', createdAt: now, updatedAt: now };
    const next = [note, ...notesRef.current];
    setNotes(next);
    setSelectedId(note.id);
    persistNow(next);
  }, [persistNow]);

  // ── 폴더 관리 (가상 트리) ──────────────────────────────
  const handleNewFolder = useCallback(async (parentId: string | null = null) => {
    const name = await uiPrompt({
      title: t('notes.newFolder'),
      label: t('notes.folderName'),
      placeholder: t('notes.folderName'),
      confirmLabel: t('notes.newFolder'),
      validate: (v) => (v.trim() ? null : t('notes.folderName')),
    });
    if (!name || !name.trim()) return;
    const folder: NoteFolder = { id: crypto.randomUUID(), name: name.trim(), parentId };
    setFolders((prev) => { const next = [...prev, folder]; saveNoteFolders(next); return next; });
  }, [t]);

  const handleRenameFolder = useCallback(async (id: string) => {
    const cur = folders.find((f) => f.id === id);
    const name = await uiPrompt({
      title: t('notes.renameFolder'),
      label: t('notes.folderName'),
      placeholder: t('notes.folderName'),
      initialValue: cur?.name ?? '',
      confirmLabel: t('notes.renameFolder'),
      validate: (v) => (v.trim() ? null : t('notes.folderName')),
    });
    if (!name || !name.trim()) return;
    setFolders((prev) => { const next = prev.map((f) => f.id === id ? { ...f, name: name.trim() } : f); saveNoteFolders(next); return next; });
  }, [folders, t]);

  // 폴더 색상 변경 — 컨텍스트 메뉴 색상 스와치에서 호출.
  const setFolderColor = useCallback((id: string, color: string) => {
    setFolders((prev) => { const next = prev.map((f) => f.id === id ? { ...f, color } : f); saveNoteFolders(next); return next; });
  }, []);

  // 폴더 삭제 — 하위 폴더는 부모로 승격, 내부 노트는 루트로(노트 자체는 삭제 안 함).
  const handleDeleteFolder = useCallback(async (id: string) => {
    const ok = await uiConfirm({
      title: t('notes.deleteFolderConfirm'),
      description: t('notes.deleteFolderDesc'),
      confirmLabel: t('notes.delete'),
    });
    if (!ok) return;
    const target = folders.find((f) => f.id === id);
    const parentId = target?.parentId ?? null;
    setFolders((prev) => {
      const next = prev
        .filter((f) => f.id !== id)
        .map((f) => f.parentId === id ? { ...f, parentId } : f);
      saveNoteFolders(next);
      return next;
    });
    setFolderMap((prev) => {
      const next: Record<string, string> = {};
      for (const [nid, fid] of Object.entries(prev)) if (fid !== id) next[nid] = fid;
      saveNoteFolderMap(next);
      return next;
    });
    // 서버 동기화를 디바운스 없이 즉시 실행(재진입 시 복구 방지).
    await flushWorkspace();
  }, [folders, t]);

  const moveNoteToFolder = useCallback((noteId: string, folderId: string | null) => {
    setFolderMap((prev) => {
      const next = { ...prev };
      if (folderId === null) delete next[noteId]; else next[noteId] = folderId;
      saveNoteFolderMap(next);
      return next;
    });
  }, []);

  // 폴더 후보(이동 메뉴용) — 들여쓰기 라벨로 평면화.
  const folderOptions = useMemo(() => {
    const byParent = new Map<string | null, NoteFolder[]>();
    for (const f of folders) {
      const arr = byParent.get(f.parentId) ?? [];
      arr.push(f); byParent.set(f.parentId, arr);
    }
    const out: { id: string; label: string }[] = [];
    const walk = (parentId: string | null, depth: number) => {
      for (const f of (byParent.get(parentId) ?? [])) {
        out.push({ id: f.id, label: `${'　'.repeat(depth)}${f.name}` });
        walk(f.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [folders]);

  // 트리 데이터 — 폴더(중첩) + 각 폴더/루트에 배정된 노트. value: 'folder:<id>' / 'note:<id>'.
  const treeData = useMemo<TreeNodeData[]>(() => {
    const notesByFolder = new Map<string | null, Note[]>();
    for (const n of sortedNotes) {
      const fid = folderMap[n.id] ?? null;
      const arr = notesByFolder.get(fid) ?? [];
      arr.push(n); notesByFolder.set(fid, arr);
    }
    const foldersByParent = new Map<string | null, NoteFolder[]>();
    for (const f of folders) {
      const arr = foldersByParent.get(f.parentId) ?? [];
      arr.push(f); foldersByParent.set(f.parentId, arr);
    }
    const noteNode = (n: Note): TreeNodeData => ({
      value: `note:${n.id}`,
      label: n.title.trim() || t('notes.untitled'),
    });
    const buildFolder = (f: NoteFolder): TreeNodeData => ({
      value: `folder:${f.id}`,
      label: f.name,
      children: [
        ...(foldersByParent.get(f.id) ?? []).map(buildFolder),
        ...(notesByFolder.get(f.id) ?? []).map(noteNode),
      ],
    });
    // 루트(미분류) 노트는 트리에서 제외 — 아래 년월 그룹 섹션에서 별도 렌더.
    return [
      ...(foldersByParent.get(null) ?? []).map(buildFolder),
    ];
  }, [sortedNotes, folders, folderMap, t]);

  // 전체 노트 → 년월(updatedAt) 그룹(폴더 속 노트 포함, 루트 목록에 함께 표시). sortedNotes가 최신순이므로 그룹/항목 모두 내림차순 유지.
  const rootNoteGroups = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const groups: { key: string; label: string; notes: Note[] }[] = [];
    const idx = new Map<string, number>();
    for (const n of sortedNotes) {
      // 모든 노트를 루트 목록에 표시(폴더 속 노트도 포함). 폴더 노드 자식에도 동시 표시됨.
      const key = monthGroupKey(n.updatedAt);
      let i = idx.get(key);
      if (i === undefined) {
        i = groups.length;
        idx.set(key, i);
        groups.push({ key, label: monthGroupLabel(n.updatedAt, locale, currentYear), notes: [] });
      }
      groups[i].notes.push(n);
    }
    return groups;
  }, [sortedNotes, folderMap, locale]);

  // 루트 노트 행 — 트리 밖에서 렌더(클릭 선택 + 폴더 이동 메뉴). 트리 리프와 동일 동작.
  const renderRootNote = (n: Note) => {
    const active = n.id === selectedId;
    return (
      <Group
        key={n.id}
        className="note-tree-row"
        gap={4}
        wrap="nowrap"
        draggable
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.setData('application/x-mycrew-attachment', JSON.stringify({ type: 'note', name: n.title.trim() || t('notes.untitled'), content: n.content.slice(0, 5000) }));
          e.dataTransfer.effectAllowed = 'copy';
        }}
        onClick={() => { setSelectedId(n.id); setConfirmDeleteId(null); }}
        style={{ padding: '4px 6px', borderRadius: 4, cursor: 'pointer', background: active ? 'var(--mantine-color-default-hover)' : undefined }}
      >
        <IconFileText size={13} stroke={1.5} style={{ flexShrink: 0, color: 'var(--mantine-color-dimmed)' }} />
        <Text size="xs" fw={active ? 600 : 400} truncate="end" style={{ flex: 1, minWidth: 0 }}>{n.title.trim() || t('notes.untitled')}</Text>
        {folderMap[n.id] ? (
          <Box style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: `var(--mantine-color-${folderColorById[folderMap[n.id] ?? ''] ?? 'yellow'}-5)` }} />
        ) : null}
        <Menu shadow="md" width={200} position="bottom-end" withinPortal>
          <Menu.Target>
            <ActionIcon variant="subtle" color="gray" size="xs" onClick={(e) => e.stopPropagation()} aria-label={t('notes.moveToFolder')}>
              <IconDotsVertical size={12} stroke={1.5} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
            <Menu.Label>{t('notes.moveToFolder')}</Menu.Label>
            <Menu.Item leftSection={<IconFolder size={14} stroke={1.5} />} onClick={() => moveNoteToFolder(n.id, null)}>{t('notes.root')}</Menu.Item>
            {folderOptions.map((fo) => (
              <Menu.Item key={fo.id} leftSection={<IconFolderFilled size={14} stroke={1.5} />} onClick={() => moveNoteToFolder(n.id, fo.id)}>{fo.label}</Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      </Group>
    );
  };

  // 폴더별 직접 포함 노트 수(folderMap 기준) — 폴더 라벨 옆 카운트 표시용.
  const folderNoteCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const n of notes) {
      const fid = folderMap[n.id];
      if (fid) m[fid] = (m[fid] ?? 0) + 1;
    }
    return m;
  }, [notes, folderMap]);

  // 폴더 id → 색상(기본 yellow) 룩업 — 폴더 아이콘/노트 색상 dot 표시용.
  const folderColorById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const f of folders) m[f.id] = f.color || 'yellow';
    return m;
  }, [folders]);

  const tree = useTree();

  if (!visible) return null;

  const searching = searchQuery.trim().length > 0;

  return (
    <Stack h="100%" gap={0} style={noteViewCssVars(noteView)}>
      <Group justify="space-between" align="center" p="md" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
        <Group gap={6} align="baseline">
          <Text fw={600} size="md">{t('nav.notes')}</Text>
          <Text size="sm" c="dimmed">{notes.length}</Text>
        </Group>
        <ActionIcon variant="subtle" color="gray" size={36} className="drawer-close" onClick={onClose} aria-label={t('common.close')}>
          <IconX size={18} stroke={1.5} />
        </ActionIcon>
      </Group>

      <Group h={0} gap={0} align="stretch" wrap="nowrap" style={{ flex: 1, minHeight: 0 }}>
        {/* 좌측: 노트 파일트리 (접기/펼치기) */}
        {sidebarOpen ? (
        <Stack
          gap={0}
          style={{ width: sidebarWidth, flexShrink: 0, minHeight: 0, borderRight: '1px solid var(--mantine-color-default-border)' }}
        >
          {/* 좌측 상단 — 행1: 검색 / 행2: 새 노트·새 폴더 2분할(우측 툴바 행과 높이·구분선 정렬). 접기 버튼은 우측 제목 좌측으로 이동. */}
          <Box p="xs" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
            <TextInput
              size="xs"
              leftSection={<IconSearch size={13} stroke={1.5} />}
              rightSection={embedStatus === 'loading' ? <Loader size={12} /> : null}
              placeholder={t('notes.search')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.currentTarget.value)}
              aria-label={t('notes.search')}
            />
          </Box>
          <Group gap={6} px="xs" py={6} wrap="nowrap" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
            <Button size="compact-sm" variant="light" style={{ flex: 1 }} leftSection={<IconPlus size={14} stroke={1.5} />} onClick={handleNew}>{t('notes.new')}</Button>
            <Button size="compact-sm" variant="light" style={{ flex: 1 }} leftSection={<IconFolderPlus size={14} stroke={1.5} />} onClick={() => handleNewFolder(null)}>{t('notes.newFolder')}</Button>
            <Tooltip label={t('notes.graph')} withArrow>
              <ActionIcon
                size={28}
                variant={graphOpen ? 'filled' : 'light'}
                color={graphOpen ? 'jarvis' : 'gray'}
                onClick={() => setGraphOpen((v) => !v)}
                aria-label={t('notes.graph')}
              >
                <IconChartDots3 size={15} stroke={1.5} />
              </ActionIcon>
            </Tooltip>
          </Group>
          <ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto">
            {searching ? (
              // 검색 중에는 평면 결과 목록.
              displayedNotes.length === 0 ? (
                <Text size="xs" c="dimmed" ta="center" p="sm">{t('notes.empty')}</Text>
              ) : (
                <Stack gap={0}>
                  {displayedNotes.map((n) => {
                    const active = n.id === selectedId;
                    const title = n.title.trim() || t('notes.untitled');
                    const preview = previewOf(n.content);
                    return (
                      <UnstyledButton
                        key={n.id}
                        onClick={() => { setSelectedId(n.id); setConfirmDeleteId(null); }}
                        style={{
                          padding: '8px 10px',
                          borderBottom: '1px solid var(--mantine-color-default-border)',
                          background: active ? 'var(--mantine-color-default-hover)' : undefined,
                        }}
                      >
                        <Text size="xs" fw={600} truncate="end">{title}</Text>
                        {preview && <Text size="xs" c="dimmed" truncate="end">{preview}</Text>}
                      </UnstyledButton>
                    );
                  })}
                </Stack>
              )
            ) : (treeData.length === 0 && rootNoteGroups.length === 0) ? (
              <Text size="xs" c="dimmed" ta="center" p="sm">{t('notes.empty')}</Text>
            ) : (
              <>
              {treeData.length > 0 && <Tree
                data={treeData}
                tree={tree}
                levelOffset={16}
                p={4}
                renderNode={(payload: RenderTreeNodePayload) => {
                  const { node, expanded, elementProps } = payload;
                  const isFolder = node.value.startsWith('folder:');
                  const rawId = node.value.slice(node.value.indexOf(':') + 1);
                  if (isFolder) {
                    return (
                      <Group {...elementProps} className={`note-tree-row ${elementProps.className ?? ''}`} gap={4} wrap="nowrap" style={{ ...elementProps.style, padding: '4px 6px', borderRadius: 4 }}>
                        <IconChevronRight
                          size={12}
                          style={{ transform: expanded ? 'rotate(90deg)' : undefined, transition: 'transform 120ms', flexShrink: 0 }}
                        />
                        {expanded
                          ? <IconFolder size={14} stroke={1.5} style={{ color: `var(--mantine-color-${folderColorById[rawId] ?? 'yellow'}-5)`, flexShrink: 0 }} />
                          : <IconFolderFilled size={14} stroke={1.5} style={{ color: `var(--mantine-color-${folderColorById[rawId] ?? 'yellow'}-5)`, flexShrink: 0 }} />}
                        <Text size="xs" fw={600} truncate="end" style={{ flex: 1, minWidth: 0 }}>{node.label}</Text>
                        {folderNoteCounts[rawId] ? (
                          <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>{folderNoteCounts[rawId]}</Text>
                        ) : null}
                        <Menu shadow="md" width={180} position="bottom-end" withinPortal>
                          <Menu.Target>
                            <ActionIcon variant="subtle" color="gray" size="xs" onClick={(e) => e.stopPropagation()} aria-label={t('common.expand')}>
                              <IconDotsVertical size={12} stroke={1.5} />
                            </ActionIcon>
                          </Menu.Target>
                          <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
                            <Menu.Item leftSection={<IconFolderPlus size={14} stroke={1.5} />} onClick={() => handleNewFolder(rawId)}>{t('notes.newFolder')}</Menu.Item>
                            <Menu.Item leftSection={<IconFolder size={14} stroke={1.5} />} onClick={() => handleRenameFolder(rawId)}>{t('notes.renameFolder')}</Menu.Item>
                            <Menu.Item color="red" leftSection={<IconTrash size={14} stroke={1.5} />} onClick={() => handleDeleteFolder(rawId)}>{t('notes.delete')}</Menu.Item>
                            <Menu.Divider />
                            <Menu.Label>{t('notes.folderColor')}</Menu.Label>
                            <Group gap={4} px="xs" py={4} wrap="nowrap">
                              {NOTE_FOLDER_COLORS.map((c) => (
                                <Box
                                  key={c}
                                  onClick={() => setFolderColor(rawId, c)}
                                  aria-label={c}
                                  style={{ width: 16, height: 16, borderRadius: '50%', cursor: 'pointer', flexShrink: 0, background: `var(--mantine-color-${c}-5)`, border: (folderColorById[rawId] ?? 'yellow') === c ? '2px solid var(--mantine-color-text)' : '2px solid transparent' }}
                                />
                              ))}
                            </Group>
                          </Menu.Dropdown>
                        </Menu>
                      </Group>
                    );
                  }
                  // 노트 리프 — 클릭 시 선택(트리 기본 클릭 대신 자체 선택).
                  const active = rawId === selectedId;
                  const treeNote = notes.find(n => n.id === rawId);
                  return (
                    <Group
                      {...elementProps}
                      className={`note-tree-row ${elementProps.className ?? ''}`}
                      gap={4}
                      wrap="nowrap"
                      draggable
                      onDragStart={(e) => {
                        e.stopPropagation();
                        e.dataTransfer.setData('application/x-mycrew-attachment', JSON.stringify({ type: 'note', name: treeNote?.title.trim() || node.label || t('notes.untitled'), content: (treeNote?.content ?? '').slice(0, 5000) }));
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                      onClick={() => { setSelectedId(rawId); setConfirmDeleteId(null); }}
                      style={{ ...elementProps.style, padding: '4px 6px', borderRadius: 4, background: active ? 'var(--mantine-color-default-hover)' : undefined }}
                    >
                      <IconFileText size={13} stroke={1.5} style={{ flexShrink: 0, color: 'var(--mantine-color-dimmed)' }} />
                      <Text size="xs" fw={active ? 600 : 400} truncate="end" style={{ flex: 1, minWidth: 0 }}>{node.label}</Text>
                      {folderMap[rawId] ? (
                        <Box style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: `var(--mantine-color-${folderColorById[folderMap[rawId] ?? ''] ?? 'yellow'}-5)` }} />
                      ) : null}
                      <Menu shadow="md" width={200} position="bottom-end" withinPortal>
                        <Menu.Target>
                          <ActionIcon variant="subtle" color="gray" size="xs" onClick={(e) => e.stopPropagation()} aria-label={t('notes.moveToFolder')}>
                            <IconDotsVertical size={12} stroke={1.5} />
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
                          <Menu.Label>{t('notes.moveToFolder')}</Menu.Label>
                          <Menu.Item leftSection={<IconFolder size={14} stroke={1.5} />} onClick={() => moveNoteToFolder(rawId, null)}>{t('notes.root')}</Menu.Item>
                          {folderOptions.map((fo) => (
                            <Menu.Item key={fo.id} leftSection={<IconFolderFilled size={14} stroke={1.5} />} onClick={() => moveNoteToFolder(rawId, fo.id)}>{fo.label}</Menu.Item>
                          ))}
                        </Menu.Dropdown>
                      </Menu>
                    </Group>
                  );
                }}
              />}
              {rootNoteGroups.map((g) => (
                <Box key={g.key} pt={6}>
                  <Text size="xs" fw={700} c="dimmed" px={6} pb={2}>{g.label}</Text>
                  {g.notes.map(renderRootNote)}
                </Box>
              ))}
              </>
            )}
          </ScrollArea>
        </Stack>
        ) : null}
        {sidebarOpen && isDesktop ? (
          <PaneResizer width={sidebarWidth} onResize={handleSidebarResize} min={160} max={480} />
        ) : null}

        {/* 우측: 선택된 노트 편집 (그래프 뷰 토글 시 연결 그래프로 전환) */}
        <Box style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {graphOpen ? (
            <NotesGraph
              notes={notes}
              selectedId={selectedId}
              onSelect={(id) => { setSelectedId(id); setConfirmDeleteId(null); setGraphOpen(false); }}
            />
          ) : selected ? (
            <>
              <Group justify="space-between" align="center" wrap="nowrap" gap="xs" p="xs" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
                <Tooltip label={sidebarOpen ? t('notes.collapseSidebar') : t('notes.expandSidebar')} withArrow>
                  <ActionIcon size="sm" variant="subtle" color="gray" onClick={toggleSidebar} aria-label={sidebarOpen ? t('notes.collapseSidebar') : t('notes.expandSidebar')} style={{ flexShrink: 0 }}>
                    {sidebarOpen ? <IconLayoutSidebarLeftCollapse size={16} stroke={1.5} /> : <IconLayoutSidebarLeftExpand size={16} stroke={1.5} />}
                  </ActionIcon>
                </Tooltip>
                <TextInput
                  size="xs"
                  style={{ flex: 1, minWidth: 0 }}
                  variant="unstyled"
                  placeholder={t('notes.titlePlaceholder')}
                  value={selected.title}
                  onChange={(e) => updateTitle(e.currentTarget.value)}
                />
                <Menu shadow="md" width={180} position="bottom-end" withinPortal>
                  <Menu.Target>
                    <ActionIcon variant="subtle" color="gray" size="sm" aria-label={t('notes.more')}>
                      <IconDotsVertical size={14} stroke={1.5} />
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item
                      leftSection={copied
                        ? <IconCheck size={14} stroke={1.5} color="var(--accent-success)" />
                        : <IconClipboard size={14} stroke={1.5} />}
                      onClick={handleCopy}
                    >
                      {copied ? t('notes.copied') : t('notes.copy')}
                    </Menu.Item>
                    <Menu.Item leftSection={<IconDownload size={14} stroke={1.5} />} onClick={handleSaveMd}>
                      {t('notes.save')}
                    </Menu.Item>
                    {isAppAvailable('mail') && (
                      <Menu.Item leftSection={<IconMail size={14} stroke={1.5} />} onClick={handleSendMail}>
                        {t('notes.sendMail')}
                      </Menu.Item>
                    )}
                    <Menu.Item leftSection={<IconFileTypePdf size={14} stroke={1.5} />} onClick={() => triggerPrint('pdf')}>
                      {t('notes.exportPdf')}
                    </Menu.Item>
                    <Menu.Item leftSection={<IconPrinter size={14} stroke={1.5} />} onClick={() => triggerPrint('print')}>
                      {t('notes.print')}
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
                {confirmDeleteId === selected.id ? (
                  <Button
                    size="compact-xs"
                    color="red"
                    variant="filled"
                    leftSection={<IconTrash size={12} stroke={1.5} />}
                    onClick={() => handleDelete(selected.id)}
                  >
                    {t('notes.confirmDelete')}
                  </Button>
                ) : (
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    size="sm"
                    onClick={() => setConfirmDeleteId(selected.id)}
                    aria-label={t('notes.delete')}
                  >
                    <IconTrash size={14} stroke={1.5} />
                  </ActionIcon>
                )}
              </Group>

              <ErrorBoundary
                resetKey={selected.id}
                fallback={(_err, reset) => (
                  <Stack align="center" justify="center" style={{ flex: 1 }} p="md" gap="sm">
                    <Text size="sm" c="red" ta="center">{t('notes.panelError')}</Text>
                    <Button size="xs" variant="light" onClick={reset}>{t('notes.retry')}</Button>
                  </Stack>
                )}
              >
                <NoteEditor
                  ref={editorApiRef}
                  noteId={selected.id}
                  value={selected.content}
                  onChange={updateContent}
                  getWikiItems={getWikiItems}
                  getTagItems={getTagItems}
                  getEntityItems={getEntityItems}
                  onNavigate={handleNavigate}
                  onOpenEntity={onOpenEntity}
                  onConvertToTask={(text) => createTaskFromNote(text, selectedIdRef.current ?? undefined)}
                />
              </ErrorBoundary>

              {suggestedTags.length > 0 && (
                <Box p="xs" style={{ borderTop: '1px solid var(--mantine-color-default-border)', flexShrink: 0 }}>
                  <Text size="xs" fw={600} c="dimmed" mb={4}>{t('notes.suggestedTags')}</Text>
                  <Group gap={4}>
                    {suggestedTags.map((tg) => (
                      <Badge
                        key={tg}
                        variant="light"
                        color="grape"
                        size="sm"
                        style={{ cursor: 'pointer' }}
                        onClick={() => editorApiRef.current?.insertTag(tg)}
                      >
                        #{tg}
                      </Badge>
                    ))}
                  </Group>
                </Box>
              )}

              {relatedNotes.length > 0 && (
                <Box p="xs" style={{ borderTop: '1px solid var(--mantine-color-default-border)', flexShrink: 0, maxHeight: 120, overflowY: 'auto' }}>
                  <Text size="xs" fw={600} c="dimmed" mb={4}>{t('notes.related')}</Text>
                  <Stack gap={2}>
                    {relatedNotes.map((r) => (
                      <UnstyledButton key={r.id} onClick={() => { setSelectedId(r.id); setConfirmDeleteId(null); }}>
                        <Text size="xs" c="teal.5" truncate="end">{r.title.trim() || t('notes.untitled')}</Text>
                      </UnstyledButton>
                    ))}
                  </Stack>
                </Box>
              )}

              {backlinks.length > 0 && (
                <Box p="xs" style={{ borderTop: '1px solid var(--mantine-color-default-border)', flexShrink: 0, maxHeight: 120, overflowY: 'auto' }}>
                  <Text size="xs" fw={600} c="dimmed" mb={4}>{t('notes.backlinks')} ({backlinks.length})</Text>
                  <Stack gap={2}>
                    {backlinks.map((b) => (
                      <UnstyledButton key={b.id} onClick={() => { setSelectedId(b.id); setConfirmDeleteId(null); }}>
                        <Text size="xs" c="blue.5" truncate="end">{b.title.trim() || t('notes.untitled')}</Text>
                      </UnstyledButton>
                    ))}
                  </Stack>
                </Box>
              )}

              {/* 프린트/PDF 전용 영역 — 평소 숨김(.note-print-area), @media print에서 .print-area일 때만 표시. */}
              <div ref={printRef} className="note-print-area report-viewer-content">
                <h1>{selected.title.trim() || t('notes.untitled')}</h1>
                <div className="md" dangerouslySetInnerHTML={{ __html: printHtml }} />
              </div>
            </>
          ) : (
            <>
              {/* 노트 미선택 + 사이드바 접힘 시에도 펼치기 가능하도록 상단에 펼치기 버튼 노출 */}
              {!sidebarOpen && (
                <Group p="xs" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
                  <Tooltip label={t('notes.expandSidebar')} withArrow>
                    <ActionIcon size="sm" variant="subtle" color="gray" onClick={toggleSidebar} aria-label={t('notes.expandSidebar')}>
                      <IconLayoutSidebarLeftExpand size={16} stroke={1.5} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              )}
              <Stack align="center" justify="center" style={{ flex: 1 }} p="md">
                <Text size="sm" c="dimmed" ta="center">{t('notes.selectHint')}</Text>
              </Stack>
            </>
          )}
        </Box>
      </Group>
    </Stack>
  );
}
