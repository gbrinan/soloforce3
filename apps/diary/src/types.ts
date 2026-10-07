/** AI 감정 분석 + 성찰 질문 (일기당 1개, 서버가 entry에 저장) */
export interface AiReflection {
  emotions: { label: string; intensity: number }[]; // intensity 1~5
  comment: string;
  questions: string[];
  createdAt: string;
}

/** 작성 템플릿 — basic(자유), quad(2×2 4분할), kpt(Keep/Problem/Try), 3l(Liked/Learned/Lacked) */
export type TemplateKey = "basic" | "quad" | "kpt" | "3l";

/** 일기 항목 — 하루 1편 (data/diary.json) */
export interface DiaryEntry {
  id: string;
  date: string; // YYYY-MM-DD
  /** 하위호환용 합성 본문 — 섹션 템플릿이면 "## 타이틀\n본문" 마크다운으로 합성됨 */
  content: string;
  mood: string; // 무드 slug ("happy" 등) — 구버전 이모지 값도 허용 (MoodIcon이 매핑 폴백)
  template?: TemplateKey;
  /** 섹션 템플릿 본문 ({q1..q4} | {keep,problem,try} | {liked,learned,lacked}) — basic이면 null */
  sections?: Record<string, string> | null;
  aiReflection: AiReflection | null;
  createdAt: string;
  updatedAt: string;
}

/** 오늘의 글감 (data/prompts.json) */
export interface WritingPrompt {
  id: string;
  date: string;
  prompt: string;
  createdAt: string;
}

/** 데일리 회고 (data/retros.json) — 날짜당 1건 */
export interface DailyRetro {
  id: string;
  date: string; // YYYY-MM-DD
  markdown: string;
  sources: { diary: number; todos: number; meetings: number; finance: number; reading: number };
  createdAt: string;
}

/** 생성·알림 설정 (data/settings.json) */
export interface DiarySettings {
  dailyTime: string; // "21:00"
  autoGenerate: boolean;
  template: TemplateKey;
  /** quad 템플릿의 4개 영역 타이틀 */
  quadTitles: string[];
  lastDailyDate: string;
}
