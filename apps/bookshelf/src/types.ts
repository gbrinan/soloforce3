export type ReadStatus = "todo" | "reading" | "done";

export interface SearchResult {
  sourceId: string;
  title: string;
  authors: string[];
  publisher: string;
  publishedDate: string;
  description: string;
  categories: string[];
  isbn: string | null;
  thumbnail: string;
  pageCount: number | null;
}

/** AI 표지 인식 결과 (등록 폼 프리필용) */
export interface CoverScan {
  title: string;
  author: string;
  publisher: string;
  isbn: string;
}

/** AI 다음 책 추천 */
export interface Recommendation {
  title: string;
  author: string;
  reason: string;
  thumbnail?: string;
}

/** BarcodeDetector 최소 타입 — lib.dom 미포함 브라우저 내장 API (Chrome/Android) */
export interface DetectedBarcode {
  rawValue: string;
  format: string;
}
declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => {
      detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
    };
  }
}

export interface BookEvent {
  type: "added" | "status";
  status?: ReadStatus;
  at: string;
}

export interface ShelfBook extends SearchResult {
  id: string;
  status: ReadStatus;
  liked: boolean;
  rating: number;
  memo: string;
  addedAt: string;
  updatedAt: string;
  /** 캘린더용 이벤트 이력 (추가·상태 변경) — 구버전 데이터엔 없을 수 있음 */
  events?: BookEvent[];
}
