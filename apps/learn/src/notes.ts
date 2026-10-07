import type { NoteSource } from "./types";

// MyCrew notes 앱은 IndexedDB("mycrew-notes", store "notes")에 오프라인 저장한다.
// 호스트 프록시로 서빙되면 대시보드와 same-origin이라 여기서 직접 열어 읽을 수 있다.
// DB가 없거나 접근 불가하면 빈 배열 반환 → UI가 "노트 없음"으로 우아하게 처리.
const DB_NAME = "mycrew-notes";
const STORE = "notes";

export function loadNotes(): Promise<NoteSource[]> {
  if (typeof indexedDB === "undefined") return Promise.resolve([]);
  return new Promise((resolve) => {
    let settled = false;
    const done = (items: NoteSource[]) => {
      if (!settled) { settled = true; resolve(items); }
    };
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME);
    } catch {
      return done([]);
    }
    request.onerror = () => done([]);
    request.onblocked = () => done([]);
    // upgradeneeded = DB가 원래 없었음 → 빈 DB를 만들지 않도록 트랜잭션 중단
    request.onupgradeneeded = () => {
      try { request.transaction?.abort(); } catch { /* */ }
      done([]);
    };
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.close();
        return done([]);
      }
      try {
        const tx = db.transaction(STORE, "readonly");
        const getAll = tx.objectStore(STORE).getAll();
        getAll.onsuccess = () => {
          db.close();
          const rows = Array.isArray(getAll.result) ? getAll.result : [];
          done(
            rows
              .filter((r) => r && (r.title || r.content))
              .map((r) => ({
                id: String(r.id ?? ""),
                title: String(r.title ?? ""),
                content: String(r.content ?? ""),
              })),
          );
        };
        getAll.onerror = () => { db.close(); done([]); };
      } catch {
        db.close();
        done([]);
      }
    };
  });
}

/** 노트 HTML 본문 → 프롬프트용 플레인 텍스트 */
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.textContent ?? "").replace(/\s{2,}/g, " ").trim();
}
