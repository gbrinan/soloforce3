import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Stack, Group, Text, Card, ActionIcon, Modal, ScrollArea, TextInput,
  Tabs, Checkbox, Box, Switch, CopyButton, Tooltip, Menu, Badge,
} from '@mantine/core';
import { IconX, IconSearch, IconDownload, IconTrash, IconBookmark, IconBookmarkFilled, IconFolder, IconFolderFilled, IconFolderPlus, IconCopy, IconCheck, IconDotsVertical, IconMail } from '@tabler/icons-react';
import { fileIcon, fileSize, timeAgo } from '../../utils/format';
import ReportViewer from '../ReportViewer/ReportViewer';
import FileEditorModal from './FileEditorModal';
import { uiAlert, uiConfirm, uiPrompt } from '../Dialog/dialog';
import { useT } from '../../i18n/I18nProvider';
import { btn } from '../../ui/controls';
import { openAppWithAsset, isAppAvailable } from '../../utils/assetHandoff';
import { notifications } from '@mantine/notifications';
import { loadSharedFolders, saveSharedFolders, hydrateSharedFoldersCache, SHARED_FOLDERS_CHANGED_EVENT } from '../../utils/sharedFolders';
import { fetchWorkspace, pushWorkspace, flushWorkspace } from '../../utils/workspaceSync';

// MD/TXT/CSV/JSON/HTML — 백엔드 PUT /api/files/edit 화이트리스트와 동기화.
const EDITABLE_EXTS = new Set(['md', 'txt', 'csv', 'json', 'html']);

function parseShelfSource(filename: string): 'chat' | 'upload' | null {
  if (filename.startsWith('chat_')) return 'chat';
  if (filename.startsWith('upload_')) return 'upload';
  return null;
}

interface FileInfo {
  name: string;
  relativePath?: string;
  size: number;
  mtime: string;
  title?: string;
}

// Map file extension to mail attachment kind for openAppWithAsset handoff.
function kindFromExt(ext: string): 'image' | 'video' | 'file' {
  if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) return 'video';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image';
  return 'file';
}

// 파일명에서 표시용 라벨 생성: title 우선 → 파일명 suffix 제거 + kebab→공백.
// 예: 'chrome-devtools-mcp-analysis_planner-researcher_2026-05-28.md' → 'chrome devtools mcp analysis'
function displayLabel(f: FileInfo, fallbackFn: string): string {
  if (f.title && f.title.trim()) return f.title.trim();
  const noExt = fallbackFn.replace(/\.[^.]+$/, '');
  const noDate = noExt.replace(/_\d{4}-\d{2}-\d{2}([_-]\d{6})?$/, '');
  const noAgentSuffix = noDate.replace(/_[a-z][a-z0-9-]*$/, '');
  return noAgentSuffix.replace(/[-_]/g, ' ').trim() || fallbackFn;
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

// 북마크는 서버 메타 저장소가 없어 localStorage에 식별자(relativePath||name) 집합으로 보관.
// 기기/브라우저 간 동기화는 되지 않음(승인된 한계).
const BOOKMARKS_KEY = 'jarvis:fileBookmarks';

function loadBookmarks(): Set<string> {
  try {
    const raw = localStorage.getItem(BOOKMARKS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveBookmarks(set: Set<string>): void {
  try {
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // ignore
  }
  pushWorkspace({ fileBookmarks: Array.from(set) });   // 서버 동기화(기기 간) — localStorage는 캐시.
}

// 가상 폴더 — 실제 파일시스템은 건드리지 않고 localStorage 메타 레이어로 관리(승인된 한계: 기기 간 비동기).
// 탭별 독립 트리(staff/external). 파일→폴더 배정은 fileKey(relativePath||name) 기준 단일 맵(fileKey가 탭 무관 고유).
type LibTab = 'staff' | 'external' | 'projects';
type FolderColor = 'yellow' | 'blue' | 'green' | 'red' | 'violet' | 'orange';
interface LibFolder { id: string; name: string; parentId: string | null; color?: FolderColor }

const FOLDER_COLORS: FolderColor[] = ['yellow', 'blue', 'green', 'red', 'violet', 'orange'];
function isFolderColor(v: unknown): v is FolderColor {
  return typeof v === 'string' && (FOLDER_COLORS as string[]).includes(v);
}
// 폴더 색상 → Mantine 색 토큰. 미지정 시 yellow(기존 기본).
function folderColorVar(color?: FolderColor): string {
  return `var(--mantine-color-${color ?? 'yellow'}-5)`;
}

const FOLDERS_KEY = 'jarvis:libraryFolders';     // Record<LibTab, LibFolder[]>
const FILE_FOLDERS_KEY = 'jarvis:fileFolders';   // Record<fileKey, folderId>

function loadFolders(): Record<LibTab, LibFolder[]> {
  try {
    const raw = localStorage.getItem(FOLDERS_KEY);
    const obj = raw ? JSON.parse(raw) : null;
    const norm = (arr: unknown): LibFolder[] => Array.isArray(arr)
      ? arr
        .filter((x): x is LibFolder => !!x && typeof (x as LibFolder).id === 'string' && typeof (x as LibFolder).name === 'string')
        .map((x) => ({
          id: x.id,
          name: x.name,
          parentId: typeof x.parentId === 'string' ? x.parentId : null,
          ...(isFolderColor(x.color) ? { color: x.color } : {}),
        }))
      : [];
    return { staff: norm(obj?.staff), external: norm(obj?.external), projects: norm(obj?.projects) };
  } catch {
    return { staff: [], external: [], projects: [] };
  }
}

function saveFolders(v: Record<LibTab, LibFolder[]>): void {
  try { localStorage.setItem(FOLDERS_KEY, JSON.stringify(v)); } catch { /* ignore */ }
  pushWorkspace({ libraryFolders: v });   // 서버 동기화(기기 간) — localStorage는 캐시.
}

function loadFileFolders(): Record<string, string> {
  try {
    const raw = localStorage.getItem(FILE_FOLDERS_KEY);
    const obj = raw ? JSON.parse(raw) : null;
    if (!obj || typeof obj !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(obj)) if (typeof val === 'string') out[k] = val;
    return out;
  } catch {
    return {};
  }
}

function saveFileFolders(v: Record<string, string>): void {
  try { localStorage.setItem(FILE_FOLDERS_KEY, JSON.stringify(v)); } catch { /* ignore */ }
  pushWorkspace({ fileFolders: v });   // 서버 동기화(기기 간) — localStorage는 캐시.
}

// 폐기·옛 디렉토리명 → 현 직원 id 정규화. history/outputs/ 잔재 디렉토리(예: 'dairs',
// 'frontend', 'noah')는 현 agents.json 기준 id로 합치고, 폐기 직원(빈 문자열 매핑)은
// 필터 칩·메타 표시에서 제외해 영문 슬러그 노출을 차단한다.
const AGENT_ID_ALIASES: Record<string, string> = {
  dairs: 'genie',     // 데어스 = 마이크루(메인 어시스턴트) 옛 영문 표기
  jarvis: 'genie',    // 데어스 = 마이크루 옛 코드네임
  frontend: 'paul',   // 프론트엔드 직군 옛 alias
  noah: '',           // 2026-06-09 해고. 산출물 잔재만 남음 — 칩/메타 숨김
};

function extractAgentId(path: string): string {
  const m = path.match(/^history\/outputs\/([^/]+)/);
  const raw = m ? m[1] : path.split('/')[0];
  return AGENT_ID_ALIASES[raw] !== undefined ? AGENT_ID_ALIASES[raw] : raw;
}

// slug → 사람 친화 라벨 매핑. 카테고리 확장 시 여기에 추가.
const SLUG_LABELS: Record<string, string> = {
  'meetings': '회의록',
  'video-summary': '영상 요약',
};

// 카테고리 체크박스 표시 순서 — 여기가 단일 source-of-truth.
// 정의 순서: 에이전트 필터 다음에 회의록 → 영상 요약. 미정의 카테고리는 뒤에 자동 추가.
const CATEGORY_ORDER: string[] = ['meetings', 'video-summary'];

// 파일 카테고리 추출. 경로 기반(history/outputs/video-summary/) 또는 파일명 패턴(youtube-summary-*) 기반.
function extractCategory(relativePath: string): string | null {
  const agentId = extractAgentId(relativePath);
  if (SLUG_LABELS[agentId]) return agentId;
  const fn = (relativePath.split('/').pop() || relativePath);
  if (/^youtube-summary-|^vimeo-summary-|^video-summary-/.test(fn)) return 'video-summary';
  return null;
}

export default function FilesPanel({ visible, onClose }: Props) {
  const t = useT();
  const [tab, setTab] = useState<'external' | 'staff' | 'projects'>('staff');
  const [externalFiles, setExternalFiles] = useState<FileInfo[]>([]);
  const [externalUploading, setExternalUploading] = useState(false);
  const [externalDragOver, setExternalDragOver] = useState(false);
  const externalFileInputRef = useRef<HTMLInputElement>(null);
  const [staffFiles, setStaffFiles] = useState<FileInfo[]>([]);
  const [projectFiles, setProjectFiles] = useState<FileInfo[]>([]);
  const [filteredFiles, setFilteredFiles] = useState<FileInfo[]>([]);
  const [agents, setAgents] = useState<string[]>([]);
  const [agentNames, setAgentNames] = useState<Record<string, string>>({});
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [bookmarks, setBookmarks] = useState<Set<string>>(() => loadBookmarks());
  const [bookmarkOnly, setBookmarkOnly] = useState(false);
  const [folders, setFolders] = useState<Record<LibTab, LibFolder[]>>(() => loadFolders());
  // 'staff' 탭 폴더는 노트와 공유(sharedFolders 저장소). color는 LibFolder 유니온으로 정규화.
  const [sharedFolders, setSharedFolders] = useState<LibFolder[]>(() =>
    loadSharedFolders().map((f) => ({ id: f.id, name: f.name, parentId: f.parentId, ...(isFolderColor(f.color) ? { color: f.color } : {}) })),
  );
  const [fileFolders, setFileFolders] = useState<Record<string, string>>(() => loadFileFolders());
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [displayed, setDisplayed] = useState(30);
  const [viewContent, setViewContent] = useState<{ file: FileInfo; raw: string } | null>(null);
  const [videoContent, setVideoContent] = useState<{ name: string; url: string } | null>(null);
  const [editTarget, setEditTarget] = useState<{ base: 'history' | 'reports'; subpath: string; name: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 폴더 정의는 'staff'/'external' 양 탭과 노트가 모두 공유(sharedFolders). 한 곳에서 폴더 추가/이름/색을 바꾸면
  // 양쪽 탭과 노트 패널에 즉시 반영. 사용자 요청(2026-06-11). 파일→폴더 "배정"은 종전대로 fileFolders 맵에서 관리.
  // 기존 'jarvis:libraryFolders.external' 로컬 저장소는 더 이상 신규 폴더를 만들지 않지만, 과거 폴더가 있는 기기는
  // hydrate 단계(아래)에서 sharedFolders에 1회 병합한다.
  const tabFolders: LibFolder[] = sharedFolders;
  const updateTabFolders = useCallback((fn: (cur: LibFolder[]) => LibFolder[]) => {
    setSharedFolders((prev) => { const next = fn(prev); saveSharedFolders(next); return next; });
  }, []);

  // 공유 폴더 동기화 — 노트(또는 다른 탭)에서 폴더가 추가/수정되면 즉시 반영.
  useEffect(() => {
    const reload = () => setSharedFolders(loadSharedFolders().map((f) => ({ id: f.id, name: f.name, parentId: f.parentId, ...(isFolderColor(f.color) ? { color: f.color } : {}) })));
    window.addEventListener(SHARED_FOLDERS_CHANGED_EVENT, reload);
    window.addEventListener('storage', reload);
    return () => {
      window.removeEventListener(SHARED_FOLDERS_CHANGED_EVENT, reload);
      window.removeEventListener('storage', reload);
    };
  }, []);

  // 레거시 external 로컬 폴더 → sharedFolders 1회 병합(기존 기기 호환). 패널 첫 오픈 시 1회만 실행.
  // 병합 후에도 folders.external 자체는 비우지 않고 그대로 둔다(다른 코드가 참조하지 않으므로 부작용 없음, 롤백 안전).
  useEffect(() => {
    if (!visible) return;
    if (folders.external.length === 0) return;
    const shared = loadSharedFolders();
    const sharedIds = new Set(shared.map((f) => f.id));
    const incoming = folders.external.filter((f) => !sharedIds.has(f.id));
    if (incoming.length === 0) return;
    const merged = [...shared, ...incoming.map((f) => ({ id: f.id, name: f.name, parentId: f.parentId, ...(f.color ? { color: f.color } : {}) }))];
    saveSharedFolders(merged);
    setSharedFolders(merged.map((f) => ({ id: f.id, name: f.name, parentId: f.parentId, ...(isFolderColor(f.color) ? { color: f.color } : {}) })));
  }, [visible, folders.external]);

  useEffect(() => {
    if (!viewContent) return;
    let ro: ResizeObserver | null = null;
    const t = setTimeout(() => {
      const el = document.querySelector('.modal-resizable-report') as HTMLElement | null;
      if (!el) return;
      const saved = sessionStorage.getItem('jarvis:reportModalSize');
      if (saved) {
        try {
          const { w, h } = JSON.parse(saved);
          if (typeof w === 'number' && typeof h === 'number') {
            const minDefaultW = 1000;
            const adjustedW = Math.max(w, minDefaultW);
            el.style.width = Math.min(adjustedW, window.innerWidth * 0.95) + 'px';
            el.style.height = Math.min(h, window.innerHeight * 0.95) + 'px';
          }
        } catch { /* */ }
      }
      ro = new ResizeObserver(() => {
        sessionStorage.setItem('jarvis:reportModalSize', JSON.stringify({
          w: el.offsetWidth,
          h: el.offsetHeight,
        }));
      });
      ro.observe(el);
    }, 50);
    return () => {
      clearTimeout(t);
      ro?.disconnect();
    };
  }, [viewContent]);

  const extractFiles = (data: any): FileInfo[] => {
    if (Array.isArray(data) && data.length > 0 && data[0].files) {
      const BASE_MAP: Record<string, string> = { history: 'history/outputs', reports: 'history/external-reports' };
      return data.flatMap((group: any) => {
        const prefix = BASE_MAP[group.base] || group.base;
        return (group.files || []).map((f: any) => ({
          ...f,
          relativePath: prefix + '/' + (f.relativePath || f.name),
        }));
      });
    }
    if (Array.isArray(data)) return data;
    return [];
  };

  const loadExternal = async () => {
    try {
      const res = await fetch('/api/files?base=reports');
      const data = await res.json();
      setExternalFiles(extractFiles(data));
    } catch { /* */ }
  };

  const handleExternalUpload = async (files: File[]) => {
    if (!files.length || externalUploading) return;
    setExternalUploading(true);
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    try {
      const res = await fetch('/api/files/upload/reports', { method: 'POST', body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
        throw new Error(err.error ?? res.statusText);
      }
      const json = await res.json() as { saved: string[]; warning?: string };
      if (json.warning) {
        notifications.show({ color: 'yellow', title: t('files.storageWarning'), message: json.warning });
      }
      void loadExternal();
    } catch (err) {
      notifications.show({ color: 'red', title: t('files.uploadFailed'), message: String(err) });
    } finally {
      setExternalUploading(false);
    }
  };

  // R6: 프로젝트 자료실 — mycrew-works/{project}/outputs/ 산출물 (읽기 전용)
  const loadProjects = async () => {
    try {
      const res = await fetch('/api/files?base=projects');
      const data = await res.json();
      setProjectFiles(extractFiles(data));
    } catch { /* */ }
  };

  const loadStaff = async () => {
    try {
      const res = await fetch('/api/files?base=history');
      const data = await res.json();
      const files = extractFiles(data);
      setStaffFiles(files);
      const agentSet = new Set<string>();
      const categorySet = new Set<string>();
      for (const f of files) {
        const cat = extractCategory(f.relativePath || f.name);
        if (cat) { categorySet.add(cat); continue; }
        const agentId = extractAgentId(f.relativePath || f.name);
        if (agentId) agentSet.add(agentId);
      }
      setAgents(Array.from(agentSet));
      setSelectedAgents(new Set(agentSet));
      setCategories([
        ...CATEGORY_ORDER.filter(c => categorySet.has(c)),
        ...Array.from(categorySet).filter(c => !CATEGORY_ORDER.includes(c)),
      ]);
      setSelectedCategories(new Set(categorySet));
      try {
        const staffRes = await fetch('/api/staff');
        const staffData = await staffRes.json();
        const names: Record<string, string> = {};
        if (staffData.genie) names[staffData.genie.id] = staffData.genie.name;
        for (const t of staffData.teams || []) {
          if (t.lead) names[t.lead.id] = t.lead.name;
          for (const m of t.members || []) names[m.id] = m.name;
        }
        setAgentNames(names);
      } catch { /* */ }
    } catch { /* */ }
  };

  useEffect(() => {
    if (!visible) return;
    if (tab === 'external') loadExternal();
    else if (tab === 'projects') loadProjects();
    else loadStaff();
  }, [visible, tab]);

  // 서버 워크스페이스 동기화 — 패널이 열릴 때 서버에서 폴더/배정/북마크/공유폴더를 불러와 적용(기기 간 동기화).
  // 서버에 해당 필드가 없으면(최초) 이 기기의 로컬값을 1회 업로드해 서버를 단일 진실 소스로 채운다.
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    fetchWorkspace().then((ws) => {
      if (!alive || !ws) return;
      if (ws.libraryFolders && typeof ws.libraryFolders === 'object') {
        try { localStorage.setItem(FOLDERS_KEY, JSON.stringify(ws.libraryFolders)); } catch { /* */ }
        setFolders(loadFolders());
      } else {
        pushWorkspace({ libraryFolders: loadFolders() });
      }
      if (ws.fileFolders && typeof ws.fileFolders === 'object') {
        try { localStorage.setItem(FILE_FOLDERS_KEY, JSON.stringify(ws.fileFolders)); } catch { /* */ }
        setFileFolders(loadFileFolders());
      } else {
        pushWorkspace({ fileFolders: loadFileFolders() });
      }
      if (Array.isArray(ws.fileBookmarks)) {
        try { localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(ws.fileBookmarks)); } catch { /* */ }
        setBookmarks(new Set(ws.fileBookmarks.filter((x): x is string => typeof x === 'string')));
      } else {
        pushWorkspace({ fileBookmarks: Array.from(loadBookmarks()) });
      }
      if (Array.isArray(ws.sharedFolders)) {
        hydrateSharedFoldersCache(ws.sharedFolders);
        setSharedFolders(loadSharedFolders().map((f) => ({ id: f.id, name: f.name, parentId: f.parentId, ...(isFolderColor(f.color) ? { color: f.color } : {}) })));
      } else {
        pushWorkspace({ sharedFolders: loadSharedFolders() });
      }
    });
    return () => { alive = false; };
  }, [visible]);

  // 폴더 트리는 양 탭이 공유하므로 탭 전환 시 현재 폴더를 유지(사용자가 같은 폴더 안에서 staff↔external을 오갈 수 있게).

  useEffect(() => {
    let files = tab === 'external' ? externalFiles : tab === 'projects' ? projectFiles : staffFiles;
    if (tab === 'staff') {
      const agentAllOn = selectedAgents.size === agents.length;
      const catAllOn = selectedCategories.size === categories.length;
      if (!agentAllOn || !catAllOn) {
        files = files.filter(f => {
          const cat = extractCategory(f.relativePath || f.name);
          if (cat) return selectedCategories.has(cat);
          return selectedAgents.has(extractAgentId(f.relativePath || f.name));
        });
      }
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      files = files.filter(f => f.name.toLowerCase().includes(q));
    }
    if (bookmarkOnly) {
      files = files.filter(f => bookmarks.has(f.relativePath || f.name));
    }
    files = [...files].sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());
    setFilteredFiles(files);
    setDisplayed(30);
  }, [tab, externalFiles, staffFiles, projectFiles, selectedAgents, selectedCategories, search, agents.length, categories.length, bookmarkOnly, bookmarks]);

  const handleScroll = useCallback((pos: { x: number; y: number }) => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollHeight - pos.y - el.clientHeight < 100) {
      setDisplayed(prev => Math.min(prev + 30, filteredFiles.length));
    }
  }, [filteredFiles.length]);

  const toggleBookmark = (f: FileInfo) => {
    const key = f.relativePath || f.name;
    setBookmarks(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      saveBookmarks(next);
      return next;
    });
  };

  // 파일을 폴더에 배정(folderId) 또는 루트로 이동(null). localStorage 메타 레이어만 갱신.
  const assignFile = (key: string, folderId: string | null) => {
    setFileFolders(prev => {
      const next = { ...prev };
      if (folderId === null) delete next[key]; else next[key] = folderId;
      saveFileFolders(next);
      return next;
    });
  };

  const toggleAgent = (agent: string) => {
    setSelectedAgents(prev => {
      const next = new Set(prev);
      if (next.has(agent)) next.delete(agent); else next.add(agent);
      return next;
    });
  };

  const handleNewFolder = async () => {
    const name = await uiPrompt({
      title: t('files.newFolder'),
      label: t('files.folderName'),
      placeholder: t('files.folderName'),
      confirmLabel: t('files.newFolder'),
      validate: (v) => (v.trim() ? null : t('files.folderName')),
    });
    if (!name || !name.trim()) return;
    const folder: LibFolder = { id: crypto.randomUUID(), name: name.trim(), parentId: currentFolderId };
    updateTabFolders(cur => [...cur, folder]);
  };

  // 폴더 색상 변경 — 현재 탭의 해당 폴더 color 갱신 후 영속화.
  const setFolderColor = (folderId: string, color: FolderColor) => {
    updateTabFolders(cur => cur.map(fo => fo.id === folderId ? { ...fo, color } : fo));
  };

  // 폴더 이름 변경.
  const renameFolder = async (folderId: string) => {
    const cur = tabFolders.find(fo => fo.id === folderId);
    const name = await uiPrompt({
      title: t('files.renameFolder'),
      label: t('files.folderName'),
      placeholder: t('files.folderName'),
      initialValue: cur?.name ?? '',
      confirmLabel: t('files.renameFolder'),
      validate: (v) => (v.trim() ? null : t('files.folderName')),
    });
    if (!name || !name.trim()) return;
    updateTabFolders(list => list.map(fo => fo.id === folderId ? { ...fo, name: name.trim() } : fo));
  };

  // 폴더 삭제 — 자료(파일) 자체는 보존. 폴더 정의(sharedFolders)에서 제거하고
  // 하위 폴더는 부모로 승격, 해당 폴더에 배정된 파일은 fileFolders 맵에서 항목을 제거해 루트("분류 안됨")로 이동.
  // 자료 보존 핵심: 백엔드 DELETE /api/files 호출 없음. 가상 폴더 메타 레이어(localStorage)만 갱신.
  const deleteFolder = async (folderId: string) => {
    const cur = tabFolders.find(fo => fo.id === folderId);
    const folderName = cur?.name ?? '';
    const ok = await uiConfirm({
      title: t('files.deleteFolderConfirm', { name: folderName }),
      description: t('files.deleteFolderDesc'),
      variant: 'danger',
      confirmLabel: t('files.deleteFolder'),
    });
    if (!ok) return;
    const parentId = cur?.parentId ?? null;
    // 1) 파일 배정 먼저 정리(레이스 회피): 해당 폴더에 속한 fileKey 매핑 제거 → 자동으로 루트로 이동.
    setFileFolders((prev) => {
      const next: Record<string, string> = {};
      for (const [k, fid] of Object.entries(prev)) if (fid !== folderId) next[k] = fid;
      saveFileFolders(next);
      return next;
    });
    // 2) 폴더 제거 + 하위 폴더는 부모로 승격(노트 패널의 handleDeleteFolder와 동일 정책).
    updateTabFolders((list) =>
      list
        .filter((fo) => fo.id !== folderId)
        .map((fo) => (fo.parentId === folderId ? { ...fo, parentId } : fo)),
    );
    // 3) 현재 폴더가 삭제 대상이면 부모(또는 루트)로 이동해 빈 화면 방지.
    if (currentFolderId === folderId) setCurrentFolderId(parentId);
    // 4) 서버 동기화를 디바운스 없이 즉시 실행(재진입 시 복구 방지). await로 완료 보장.
    await flushWorkspace();
  };

  // 편집 가능한 파일이면 (base, subpath) 반환. PUT 엔드포인트와 동일한 화이트리스트(history/reports)만 허용.
  // projects/* 자료는 편집 비대상 (백엔드 PUT이 없음).
  const getEditTarget = (f: FileInfo): { base: 'history' | 'reports'; subpath: string } | null => {
    const ext = f.name.split('.').pop()?.toLowerCase() || '';
    if (!EDITABLE_EXTS.has(ext)) return null;
    const path = f.relativePath || f.name;
    const histIdx = path.indexOf('history/outputs/');
    const repIdx = path.indexOf('history/external-reports/');
    if (histIdx >= 0) return { base: 'history', subpath: path.slice(histIdx + 'history/outputs/'.length) };
    if (repIdx >= 0) return { base: 'reports', subpath: path.slice(repIdx + 'history/external-reports/'.length) };
    if (tab === 'external') return { base: 'reports', subpath: path };
    if (tab === 'staff' && !path.startsWith('projects/')) return { base: 'history', subpath: path };
    return null;
  };

  const getDownloadUrl = (f: FileInfo) => {
    const path = f.relativePath || f.name;
    const histIdx = path.indexOf('history/outputs/');
    const repIdx = path.indexOf('history/external-reports/');
    if (histIdx >= 0) return `/api/files/download/history/${path.slice(histIdx + 'history/outputs/'.length)}`;
    if (repIdx >= 0) return `/api/files/download/reports/${path.slice(repIdx + 'history/external-reports/'.length)}`;
    if (path.startsWith('projects/')) return `/api/files/download/projects/${path.slice('projects/'.length)}`;
    return tab === 'external'
      ? `/api/files/download/reports/${path}`
      : `/api/files/download/history/${path}`;
  };

  const handleView = async (f: FileInfo) => {
    const ext = f.name.split('.').pop()?.toLowerCase() || '';
    if (['mp4', 'webm'].includes(ext)) {
      setVideoContent({ name: f.name, url: getDownloadUrl(f) });
      return;
    }
    try {
      const res = await fetch(getDownloadUrl(f));
      if (!res.ok) return;
      const text = await res.text();
      setViewContent({ file: f, raw: text });
    } catch { /* */ }
  };

  const handleDownload = (f: FileInfo) => {
    const a = document.createElement('a');
    a.href = getDownloadUrl(f);
    a.download = f.name.split('/').pop() || f.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const getDeleteUrl = (f: FileInfo): string | null => {
    const path = f.relativePath || f.name;
    const histIdx = path.indexOf('history/outputs/');
    const repIdx = path.indexOf('history/external-reports/');
    if (histIdx >= 0) return `/api/files/history/${path.slice(histIdx + 'history/outputs/'.length)}`;
    if (repIdx >= 0) return `/api/files/reports/${path.slice(repIdx + 'history/external-reports/'.length)}`;
    if (tab === 'external') return `/api/files/reports/${path}`;
    if (tab === 'staff' && !path.startsWith('projects/')) return `/api/files/history/${path}`;
    return null;
  };

  const handleDelete = async (f: FileInfo) => {
    const url = getDeleteUrl(f);
    if (!url) {
      await uiAlert({ title: t('files.deleteNotAllowed'), variant: 'info' });
      return;
    }
    const fn = f.name.split('/').pop() || f.name;
    const ok = await uiConfirm({
      title: t('files.deleteConfirm', { name: fn }),
      description: t('files.irreversible'),
      variant: 'danger',
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    try {
      const res = await fetch(url, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        await uiAlert({ title: t('files.deleteFailed'), description: String(err.error || res.statusText), variant: 'info' });
        return;
      }
      if (tab === 'external') void loadExternal(); else void loadStaff();
    } catch (err) {
      await uiAlert({ title: t('files.deleteFailed'), description: err instanceof Error ? err.message : String(err), variant: 'info' });
    }
  };

  if (!visible) return null;

  // 현재 폴더 기준 표시 분리 — 하위 폴더 + 현재 폴더에 배정된 파일(미배정=루트).
  const folderOf = (f: FileInfo): string | null => fileFolders[f.relativePath || f.name] ?? null;
  const currentFolders = tabFolders.filter(fo => fo.parentId === currentFolderId);
  // 루트 뷰(currentFolderId === null)에서는 폴더에 속한 파일도 함께 표시(소속은 카드 폴더 배지로 구분).
  // 폴더 진입 시에는 해당 폴더에 배정된 파일만 표시(기존 동작 유지).
  const currentFiles = currentFolderId === null
    ? filteredFiles
    : filteredFiles.filter(f => folderOf(f) === currentFolderId);

  // 폴더별 직접 포함 파일 수(현재 탭 필터된 파일 기준) — 폴더 카드 카운트 표시용.
  const fileCountByFolder = new Map<string, number>();
  for (const f of filteredFiles) {
    const fid = folderOf(f);
    if (fid) fileCountByFolder.set(fid, (fileCountByFolder.get(fid) ?? 0) + 1);
  }

  // breadcrumb: 루트 → ... → 현재 폴더 (parentId 체인 역추적).
  const breadcrumb: LibFolder[] = (() => {
    const byId = new Map(tabFolders.map(fo => [fo.id, fo]));
    const chain: LibFolder[] = [];
    let id: string | null = currentFolderId;
    const guard = new Set<string>();
    while (id && !guard.has(id)) {
      guard.add(id);
      const fo = byId.get(id);
      if (!fo) break;
      chain.unshift(fo);
      id = fo.parentId;
    }
    return chain;
  })();

  return (
    <>
      <Stack h="100%" gap={0}>
        <Group justify="space-between" align="center" p="md">
          <Text fw={600} size="md">{t('nav.files')}</Text>
          <ActionIcon variant="subtle" color="gray" size={36} className="drawer-close" onClick={onClose} aria-label={t('common.close')}>
            <IconX size={18} stroke={1.5} />
          </ActionIcon>
        </Group>

        <Tabs value={tab} onChange={(v) => setTab((v as 'external' | 'staff' | 'projects') || 'staff')} keepMounted={false}>
          <Tabs.List grow>
            <Tabs.Tab value="staff">{t('files.tabStaff')}</Tabs.Tab>
            <Tabs.Tab value="external">{t('files.tabExternal')}</Tabs.Tab>
            <Tabs.Tab value="projects">{t('files.tabProjects')}</Tabs.Tab>
          </Tabs.List>
        </Tabs>

        <ScrollArea
          style={{ flex: 1 }}
          viewportRef={scrollRef}
          onScrollPositionChange={handleScroll}
        >
          {/* 검색 + 북마크 토글 — 탭 하단 sticky 고정 */}
          <Box style={{ position: 'sticky', top: 0, zIndex: 3, background: 'var(--mantine-color-body)' }}>
            <Group p="sm" gap="sm" wrap="nowrap" align="center">
              <TextInput
                size="xs"
                placeholder={t('files.searchPlaceholder')}
                leftSection={<IconSearch size={14} stroke={1.5} />}
                value={search}
                onChange={(e) => setSearch(e.currentTarget.value)}
                style={{ flex: 1 }}
              />
              <Switch
                size="xs"
                label={t('files.bookmarkOnly')}
                checked={bookmarkOnly}
                onChange={(e) => setBookmarkOnly(e.currentTarget.checked)}
                styles={{ label: { whiteSpace: 'nowrap' } }}
              />
            </Group>
          </Box>

        {tab === 'staff' && (agents.length > 0 || categories.length > 0) && (
          <Group gap="xs" px="sm" py="xs" wrap="wrap">
            <Checkbox
              size="xs"
              label={<Text size="xs" fw={600}>{t('files.all')}</Text>}
              checked={selectedAgents.size === agents.length && selectedCategories.size === categories.length}
              onChange={() => {
                const allAgentOn = selectedAgents.size === agents.length;
                const allCatOn = selectedCategories.size === categories.length;
                if (allAgentOn && allCatOn) {
                  setSelectedAgents(new Set());
                  setSelectedCategories(new Set());
                } else {
                  setSelectedAgents(new Set(agents));
                  setSelectedCategories(new Set(categories));
                }
              }}
            />
            {agents.map(a => (
              <Checkbox
                key={a}
                size="xs"
                label={<Text size="xs" c="dimmed">{SLUG_LABELS[a] || agentNames[a] || a}</Text>}
                checked={selectedAgents.has(a)}
                onChange={() => toggleAgent(a)}
              />
            ))}
            {categories.map(cat => (
              <Checkbox
                key={cat}
                size="xs"
                label={<Text size="xs" c="dimmed">{SLUG_LABELS[cat] || cat}</Text>}
                checked={selectedCategories.has(cat)}
                onChange={() => {
                  setSelectedCategories(prev => {
                    const next = new Set(prev);
                    if (next.has(cat)) next.delete(cat); else next.add(cat);
                    return next;
                  });
                }}
              />
            ))}
          </Group>
        )}

        <Group px="sm" pb="xs" gap="xs" wrap="nowrap" align="center" justify="space-between">
          <Group gap={2} wrap="nowrap" style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
            <Text
              size="xs"
              fw={currentFolderId === null ? 600 : 400}
              c={currentFolderId === null ? undefined : 'dimmed'}
              style={{ cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
              onClick={() => setCurrentFolderId(null)}
            >
              {t('files.root')}
            </Text>
            {breadcrumb.map((fo, idx) => (
              <React.Fragment key={fo.id}>
                <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>/</Text>
                <Text
                  size="xs"
                  fw={idx === breadcrumb.length - 1 ? 600 : 400}
                  c={idx === breadcrumb.length - 1 ? undefined : 'dimmed'}
                  truncate
                  style={{ cursor: 'pointer', minWidth: 0 }}
                  onClick={() => setCurrentFolderId(fo.id)}
                >
                  {fo.name}
                </Text>
              </React.Fragment>
            ))}
          </Group>
          <button
            onClick={handleNewFolder}
            style={btn('sm', 'neutral', { flexShrink: 0 })}
          >
            <IconFolderPlus size={14} stroke={1.5} />
            {t('files.newFolder')}
          </button>
        </Group>

        {currentFolders.length > 0 && (
          <ScrollArea type="auto" px="sm" pb="xs" scrollbarSize={6}>
            <Group gap="xs" wrap="nowrap">
              {currentFolders.map((fo) => (
                <Card
                  key={`fo:${fo.id}`}
                  withBorder
                  padding="xs"
                  onClick={() => setCurrentFolderId(fo.id)}
                  style={{ cursor: 'pointer', flexShrink: 0 }}
                >
                  <Group gap={6} wrap="nowrap" align="center">
                    <IconFolderFilled size={16} stroke={1.5} style={{ color: folderColorVar(fo.color), flexShrink: 0 }} />
                    <Text size="xs" fw={600} style={{ whiteSpace: 'nowrap' }}>{fo.name}</Text>
                    {fileCountByFolder.get(fo.id) ? (
                      <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>{fileCountByFolder.get(fo.id)}</Text>
                    ) : null}
                    <Menu shadow="md" width={180} position="bottom-end" withinPortal>
                      <Menu.Target>
                        <ActionIcon variant="subtle" color="gray" size="xs" onClick={(e) => e.stopPropagation()} aria-label={t('files.folderColor')}>
                          <IconDotsVertical size={12} stroke={1.5} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
                        <Menu.Label>{t('files.folderColor')}</Menu.Label>
                        {FOLDER_COLORS.map((c) => (
                          <Menu.Item
                            key={c}
                            leftSection={<IconFolderFilled size={14} stroke={1.5} style={{ color: folderColorVar(c) }} />}
                            rightSection={(fo.color ?? 'yellow') === c ? <IconCheck size={12} stroke={2} /> : null}
                            onClick={(e) => { e.stopPropagation(); setFolderColor(fo.id, c); }}
                          >
                            {t(`color.${c}`)}
                          </Menu.Item>
                        ))}
                        <Menu.Divider />
                        <Menu.Item leftSection={<IconFolder size={14} stroke={1.5} />} onClick={(e) => { e.stopPropagation(); void renameFolder(fo.id); }}>
                          {t('files.renameFolder')}
                        </Menu.Item>
                        <Menu.Item
                          color="red"
                          leftSection={<IconTrash size={14} stroke={1.5} />}
                          onClick={(e) => { e.stopPropagation(); void deleteFolder(fo.id); }}
                        >
                          {t('files.deleteFolder')}
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  </Group>
                </Card>
              ))}
            </Group>
          </ScrollArea>
        )}

          {tab === 'external' && (
            <>
              <Box
                mx="sm" mb="xs"
                onClick={() => !externalUploading && externalFileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setExternalDragOver(true); }}
                onDragLeave={() => setExternalDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setExternalDragOver(false);
                  void handleExternalUpload(Array.from(e.dataTransfer.files));
                }}
                style={{
                  border: externalDragOver
                    ? '2px solid var(--mantine-color-blue-5)'
                    : '2px dashed var(--mantine-color-default-border)',
                  background: externalDragOver ? 'rgba(99,102,241,0.08)' : undefined,
                  borderRadius: 10, minHeight: 72,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: externalUploading ? 'not-allowed' : 'pointer',
                  opacity: externalUploading ? 0.6 : 1,
                  transition: 'border-color 120ms ease, background 120ms ease',
                }}
              >
                <Text size="xs" c="dimmed" ta="center">
                  {externalUploading ? t('files.uploading') : t('files.dropHere')}
                </Text>
              </Box>
              <input
                ref={externalFileInputRef}
                type="file"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length) void handleExternalUpload(files);
                  e.target.value = '';
                }}
              />
            </>
          )}

          <Stack gap="xs" px="sm" pb="sm">
            {currentFolders.length === 0 && currentFiles.length === 0 ? (
              <Text c="dimmed" ta="center" py="lg">
                {currentFolderId === null ? t('files.empty') : t('files.emptyFolder')}
              </Text>
            ) : currentFiles.slice(0, displayed).map((f, i) => {
              const ext = f.name.split('.').pop()?.toLowerCase() || '';
              const fn = f.name.split('/').pop() || f.name;
              const isViewable = ['md', 'txt', 'mp4', 'webm'].includes(ext);
              const agentId = extractAgentId(f.relativePath || f.name);
              const agentName = agentNames[agentId];
              const fileFolderId = folderOf(f);
              const fileFolder = fileFolderId ? tabFolders.find(fo => fo.id === fileFolderId) : undefined;
              return (
                <Card
                  key={i}
                  withBorder
                  padding="xs"
                  draggable
                  onDragStart={(e) => {
                    e.stopPropagation();
                    e.dataTransfer.setData('application/x-mycrew-attachment', JSON.stringify({ type: 'library', name: displayLabel(f, fn), path: f.relativePath || f.name }));
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => isViewable ? handleView(f) : handleDownload(f)}
                  style={{ cursor: 'pointer' }}
                >
                  <Group gap="xs" align="flex-start" wrap="nowrap">
                    <Text size="md">{fileIcon(ext)}</Text>
                    <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                      <Text size="sm" fw={600} title={fn} truncate>{displayLabel(f, fn)}</Text>
                      <Text size="xs" c="dimmed" title={fn} truncate>{fn}</Text>
                      {tab === 'external' && (() => {
                        const src = parseShelfSource(fn);
                        if (!src) return null;
                        return (
                          <Badge size="xs" variant="light" color={src === 'chat' ? 'blue' : 'green'} style={{ flexShrink: 0 }}>
                            {src === 'chat' ? t('files.sourceChatBadge') : t('files.sourceUploadBadge')}
                          </Badge>
                        );
                      })()}

                      {/* 메타(좌) + 버튼(우) 같은 행 양쪽 정렬 */}
                      <Group justify="space-between" wrap="nowrap" align="center" gap="xs">
                        <Group gap={6} wrap="nowrap" align="center" style={{ minWidth: 0, flex: 1 }}>
                        <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>{fileSize(f.size)}</Text>
                        <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>·</Text>
                        <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>{timeAgo(f.mtime)}</Text>
                        {(agentName || (tab === 'staff' ? agentId : '')) && (
                          <>
                            <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>·</Text>
                            <Text size="xs" c="dimmed" truncate style={{ minWidth: 0 }}>{agentName || agentId}</Text>
                          </>
                        )}
                        {fileFolder && (
                          <Badge
                            size="xs"
                            variant="light"
                            leftSection={<IconFolder size={10} stroke={1.5} style={{ color: folderColorVar(fileFolder.color) }} />}
                            style={{ flexShrink: 0, textTransform: 'none' }}
                            title={fileFolder.name}
                          >
                            {fileFolder.name}
                          </Badge>
                        )}
                        </Group>
                        <Group gap={2} wrap="nowrap" align="center" style={{ flexShrink: 0 }}>
                      <ActionIcon
                        variant="subtle"
                        color={bookmarks.has(f.relativePath || f.name) ? 'yellow.6' : 'gray'}
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); toggleBookmark(f); }}
                        aria-label={t('files.bookmark')}
                      >
                        {bookmarks.has(f.relativePath || f.name)
                          ? <IconBookmarkFilled size={14} stroke={1.5} />
                          : <IconBookmark size={14} stroke={1.5} />}
                      </ActionIcon>
                      <Menu shadow="md" width={200} position="bottom-end" withinPortal>
                        <Menu.Target>
                          <ActionIcon
                            variant="subtle"
                            color={fileFolder ? undefined : 'gray'}
                            size="sm"
                            onClick={(e) => e.stopPropagation()}
                            aria-label={t('files.moveToFolder')}
                            style={fileFolder ? { color: folderColorVar(fileFolder.color) } : undefined}
                          >
                            <IconFolderPlus size={14} stroke={1.5} />
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
                          <Menu.Item
                            leftSection={<IconFolder size={14} stroke={1.5} />}
                            onClick={(e) => { e.stopPropagation(); assignFile(f.relativePath || f.name, null); }}
                          >
                            {t('files.root')}
                          </Menu.Item>
                          {tabFolders.map((fo) => (
                            <Menu.Item
                              key={fo.id}
                              leftSection={<IconFolderFilled size={14} stroke={1.5} />}
                              onClick={(e) => { e.stopPropagation(); assignFile(f.relativePath || f.name, fo.id); }}
                            >
                              {fo.name}
                            </Menu.Item>
                          ))}
                        </Menu.Dropdown>
                      </Menu>
                      <CopyButton value={`${window.location.origin}${getDownloadUrl(f)}`} timeout={1500}>
                        {({ copied, copy }) => (
                          <Tooltip label={copied ? t('common.copied') : t('partner.copy')} withArrow>
                            <ActionIcon
                              variant="subtle"
                              color={copied ? 'teal' : 'gray'}
                              size="sm"
                              onClick={(e) => { e.stopPropagation(); copy(); }}
                              aria-label={copied ? t('common.copied') : t('partner.copy')}
                            >
                              {copied ? <IconCheck size={14} stroke={1.5} /> : <IconCopy size={14} stroke={1.5} />}
                            </ActionIcon>
                          </Tooltip>
                        )}
                      </CopyButton>
                      {isAppAvailable('mail') && (
                        <Tooltip label={t('files.sendToMail')} withArrow>
                          <ActionIcon
                            variant="subtle"
                            color="gray"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              const url = `${window.location.origin}${getDownloadUrl(f)}`;
                              openAppWithAsset({ appId: 'mail', kind: kindFromExt(ext), url, name: displayLabel(f, fn) });
                            }}
                            aria-label={t('files.sendToMail')}
                          >
                            <IconMail size={14} stroke={1.5} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); handleDownload(f); }}
                        aria-label={t('files.download')}
                      >
                        <IconDownload size={14} stroke={1.5} />
                      </ActionIcon>
                      {getDeleteUrl(f) && (
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          size="sm"
                          onClick={(e) => { e.stopPropagation(); void handleDelete(f); }}
                          aria-label={t('common.delete')}
                        >
                          <IconTrash size={14} stroke={1.5} />
                        </ActionIcon>
                      )}
                        </Group>
                      </Group>
                    </Stack>
                  </Group>
                </Card>
              );
            })}
            {displayed < currentFiles.length && (
              <Text c="dimmed" ta="center" size="xs" py="xs">
                {t('files.scrollMore', { n: currentFiles.length - displayed })}
              </Text>
            )}
          </Stack>
        </ScrollArea>
      </Stack>

      <Modal
        opened={!!viewContent}
        onClose={() => setViewContent(null)}
        title={viewContent?.file.name.split('/').pop() || ''}
        size="auto"
        centered
        scrollAreaComponent={ScrollArea.Autosize}
        classNames={{ content: 'modal-resizable modal-resizable-report' }}
        overlayProps={{ backgroundOpacity: 0.8, blur: 2 }}
      >
        {viewContent && (() => {
          const et = getEditTarget(viewContent.file);
          const fn = viewContent.file.name.split('/').pop() || viewContent.file.name;
          return (
            <ReportViewer
              raw={viewContent.raw}
              fileName={fn}
              editable={!!et}
              onEdit={et ? () => {
                setEditTarget({ base: et.base, subpath: et.subpath, name: fn });
                setViewContent(null);
              } : undefined}
              onDownload={() => handleDownload(viewContent.file)}
            />
          );
        })()}
      </Modal>

      <Modal
        opened={!!videoContent}
        onClose={() => setVideoContent(null)}
        title={videoContent?.name.split('/').pop() || ''}
        size="auto"
        centered
        overlayProps={{ backgroundOpacity: 0.8, blur: 2 }}
      >
        {videoContent && (
          <video
            controls
            preload="metadata"
            src={videoContent.url}
            style={{ maxWidth: '100%', maxHeight: '80vh', display: 'block', margin: '0 auto', borderRadius: 10, background: '#000' }}
          />
        )}
      </Modal>

      {editTarget && (
        <FileEditorModal
          open={!!editTarget}
          base={editTarget.base}
          subpath={editTarget.subpath}
          displayName={editTarget.name}
          onClose={() => setEditTarget(null)}
          onSaved={() => { if (tab === 'external') void loadExternal(); else void loadStaff(); }}
        />
      )}
    </>
  );
}
