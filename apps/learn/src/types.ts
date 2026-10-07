export type Grade = "again" | "hard" | "good" | "easy";
export type SourceType = "paste" | "book" | "note" | "file" | "link";

export interface KeyConcept {
  term: string;
  explanation: string;
}

/** SM-2 상태를 가진 플래시카드 */
export interface SrsCard {
  id: string;
  front: string;
  back: string;
  ease: number;
  intervalDays: number;
  reps: number;
  lapses: number;
  /** KST 기준 YYYY-MM-DD */
  due: string;
  lastReviewedAt: string | null;
}

export interface QuizItem {
  question: string;
  choices: string[];
  answerIndex: number;
  explanation: string;
}

export interface Deck {
  id: string;
  title: string;
  summary: string;
  keyConcepts: KeyConcept[];
  cards: SrsCard[];
  quiz: QuizItem[];
  source: { type: SourceType; title: string };
  createdAt: string;
  updatedAt: string;
}

/** 목록용 요약 (GET /api/decks) */
export interface DeckSummary {
  id: string;
  title: string;
  summary: string;
  source: { type: SourceType; title: string };
  cardCount: number;
  dueCount: number;
  newCount: number;
  quizCount: number;
  createdAt: string;
}

/** 복습 큐 항목 (덱 정보 포함) */
export interface QueueCard extends SrsCard {
  deckId: string;
  deckTitle: string;
}

export interface Stats {
  todayReviews: number;
  dueCount: number;
  totalCards: number;
  deckCount: number;
  streak: number;
}

/** 책장 앱에서 가져온 소스 */
export interface BookSource {
  id: string;
  title: string;
  authors: string[];
  publisher: string;
  description: string;
  memo: string;
  thumbnail: string;
  status: string;
}

/** notes 앱 IndexedDB에서 가져온 소스 */
export interface NoteSource {
  id: string;
  title: string;
  /** HTML 본문 */
  content: string;
}
