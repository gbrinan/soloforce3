// IndexedDB 기반 오프라인 우선 노트 저장소. 서버 DB 의존 없이 브라우저에만 저장하고,
// syncNote()는 스텁 백업 엔드포인트(POST /api/notes/sync)를 베스트에포트로 호출한다(실패해도 무시).
import { apiUrl } from "./api-url";

export interface Note {
  id: string;
  title: string;
  content: string; // Tiptap HTML
  updatedAt: number;
  order?: number; // 리스트 표시 순서 (오름차순). 없으면 listNotes()가 최초 로드 시 마이그레이션.
  tags?: string[]; // AI 태깅 결과. 없으면 미태깅 노트(IndexedDB는 스키마리스라 버전업 불필요).
}

const DB_NAME = "mycrew-notes";
const STORE_NAME = "notes";
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function putNoteRaw(note: Note): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(note);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listNotes(): Promise<Note[]> {
  const db = await openDB();
  const notes = await new Promise<Note[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result as Note[]);
    req.onerror = () => reject(req.error);
  });

  // order 필드가 없는 레거시 노트가 있으면, 기존 updatedAt 내림차순 순서를 그대로 order로 고정한다
  // (최초 1회만 발생 — 이후엔 order가 항상 존재해 이 분기를 타지 않음).
  if (notes.some((n) => n.order === undefined)) {
    notes.sort((a, b) => b.updatedAt - a.updatedAt);
    notes.forEach((n, i) => {
      n.order = i;
    });
    await Promise.all(notes.map((n) => putNoteRaw(n)));
  }

  return notes.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export async function saveNote(note: Note): Promise<void> {
  await putNoteRaw(note);
  void syncNote(note);
}

export async function deleteNote(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// title: 호출부(클라이언트 컴포넌트)에서 t("note.untitled")로 로케일별 기본 제목을 전달한다
// (이 유틸은 훅을 못 쓰므로 i18n은 호출부 책임).
export function createNote(order: number, title: string): Note {
  return {
    id: crypto.randomUUID(),
    title,
    content: "",
    updatedAt: Date.now(),
    order,
  };
}

// HTML 콘텐츠를 태그 제거한 순수 텍스트로 변환 (드래그 첨부·메일 본문·리스트 미리보기 공용).
export function plainTextFromHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function syncNote(note: Note): Promise<void> {
  try {
    await fetch(apiUrl("/api/notes/sync"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(note),
    });
  } catch {
    // 오프라인 우선 설계 — 백업 실패는 무시(IndexedDB가 원본)
  }
}
