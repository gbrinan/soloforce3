import type { ReactNode } from "react";

// 커스텀 무드 아이콘 8종 — 카와이 스타일 (둥근 얼굴 + 볼터치 + 단순 표정).
// 얼굴색은 라이트/다크 양쪽에서 대비가 유지되는 파스텔 고정색,
// 이목구비는 웜 브라운(#4a3b33) 고정 — 어떤 배경(무드색) 위에서도 판독 가능.
export type MoodKey = "happy" | "calm" | "excited" | "neutral" | "thinking" | "sad" | "angry" | "tired";

export const MOOD_KEYS: MoodKey[] = ["happy", "calm", "excited", "neutral", "thinking", "sad", "angry", "tired"];

// 구버전 이모지 저장값 → slug 매핑 폴백 (렌더 깨짐 방지)
const EMOJI_TO_MOOD: Record<string, MoodKey> = {
  "😊": "happy", "😌": "calm", "🥳": "excited", "😐": "neutral",
  "🤔": "thinking", "😢": "sad", "😡": "angry", "😴": "tired",
};

export function normalizeMood(value: string | null | undefined): MoodKey | null {
  if (!value) return null;
  if ((MOOD_KEYS as string[]).includes(value)) return value as MoodKey;
  return EMOJI_TO_MOOD[value] ?? null;
}

const INK = "#4a3b33";
const BLUSH = "#f58fa0";

const FACE_FILL: Record<MoodKey, string> = {
  happy: "#ffd98e",
  calm: "#bee3c7",
  excited: "#ffb3c7",
  neutral: "#e2ddd1",
  thinking: "#c7d8f5",
  sad: "#a9c6e8",
  angry: "#ff9e8e",
  tired: "#cdbbe8",
};

function Face({ mood, children }: { mood: MoodKey; children: ReactNode }) {
  return (
    <g>
      <circle cx="24" cy="25" r="17" fill={FACE_FILL[mood]} stroke={INK} strokeWidth="2" />
      <ellipse cx="14.5" cy="29" rx="3.2" ry="2" fill={BLUSH} opacity="0.55" />
      <ellipse cx="33.5" cy="29" rx="3.2" ry="2" fill={BLUSH} opacity="0.55" />
      <g stroke={INK} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none">
        {children}
      </g>
    </g>
  );
}

const FACES: Record<MoodKey, ReactNode> = {
  // 행복 — ∪∪ 웃는 눈 + 함박 미소
  happy: (
    <Face mood="happy">
      <path d="M14 22.5 q 3 -4 6 0" />
      <path d="M28 22.5 q 3 -4 6 0" />
      <path d="M17 29 q 7 6.5 14 0" />
    </Face>
  ),
  // 평온 — 지그시 감은 눈 + 옅은 미소
  calm: (
    <Face mood="calm">
      <path d="M14 23 q 3 2.6 6 0" />
      <path d="M28 23 q 3 2.6 6 0" />
      <path d="M20.5 30.5 q 3.5 2.4 7 0" />
    </Face>
  ),
  // 신남 — 반짝 ^^ 눈 + 활짝 벌린 입 + 스파클
  excited: (
    <Face mood="excited">
      <path d="M14 22 l 3 -3 l 3 3" />
      <path d="M28 22 l 3 -3 l 3 3" />
      <path d="M17.5 28 q 6.5 8 13 0 z" fill={INK} />
      <path d="M6 4 v 6 M3 7 h 6" strokeWidth="1.8" />
      <path d="M42.5 6.5 v 5 M40 9 h 5" strokeWidth="1.8" />
    </Face>
  ),
  // 무덤덤 — 점 눈 + 일자 입
  neutral: (
    <Face mood="neutral">
      <circle cx="17.5" cy="23" r="1.9" fill={INK} stroke="none" />
      <circle cx="30.5" cy="23" r="1.9" fill={INK} stroke="none" />
      <path d="M19 30.5 h 10" />
    </Face>
  ),
  // 생각 — 위를 보는 눈 + 갸웃한 입 + 생각 방울
  thinking: (
    <Face mood="thinking">
      <circle cx="18.5" cy="21.5" r="1.9" fill={INK} stroke="none" />
      <circle cx="31.5" cy="21.5" r="1.9" fill={INK} stroke="none" />
      <path d="M20 31 q 1.75 -2.2 3.5 0 q 1.75 2.2 3.5 0" strokeWidth="1.9" />
      <circle cx="40" cy="9.5" r="2.6" strokeWidth="1.8" />
      <circle cx="44.6" cy="4.4" r="1.5" strokeWidth="1.6" />
    </Face>
  ),
  // 슬픔 — 처진 눈썹 + 울상 입 + 눈물 한 방울
  sad: (
    <Face mood="sad">
      <path d="M14 19.5 l 5 -1.8" strokeWidth="1.9" />
      <path d="M34 19.5 l -5 -1.8" strokeWidth="1.9" />
      <circle cx="17.5" cy="24" r="1.9" fill={INK} stroke="none" />
      <circle cx="30.5" cy="24" r="1.9" fill={INK} stroke="none" />
      <path d="M19 32.5 q 5 -4.5 10 0" />
      <path d="M34 25.5 q 2.8 3.6 0 5.2 q -2.8 -1.6 0 -5.2 z" fill="#7fb3e8" stroke="none" />
    </Face>
  ),
  // 화남 — 치켜 올라간 눈썹 + 뿔난 입 + 💢 마크
  angry: (
    <Face mood="angry">
      <path d="M14 19 l 6 2.4" strokeWidth="1.9" />
      <path d="M34 19 l -6 2.4" strokeWidth="1.9" />
      <circle cx="18" cy="25" r="1.9" fill={INK} stroke="none" />
      <circle cx="30" cy="25" r="1.9" fill={INK} stroke="none" />
      <path d="M19.5 32.5 q 4.5 -3.6 9 0" />
      <path d="M39.5 4.5 l 4.5 4.5 M44 4.5 l -4.5 4.5" stroke="#e2574c" strokeWidth="2" />
    </Face>
  ),
  // 피곤 — 반쯤 감긴 눈 + 하품 입 + zZ
  tired: (
    <Face mood="tired">
      <path d="M14.5 23 h 6" />
      <path d="M27.5 23 h 6" />
      <ellipse cx="24" cy="31" rx="2.7" ry="3.2" fill={INK} stroke="none" />
      <path d="M37.5 5 h 5.5 l -5.5 5.5 h 5.5" strokeWidth="1.9" />
      <path d="M44 14 h 3.6 l -3.6 3.6 h 3.6" strokeWidth="1.6" />
    </Face>
  ),
};

export function MoodIcon({ mood, size = 24 }: { mood: string | null | undefined; size?: number }) {
  const key = normalizeMood(mood);
  if (!key) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false" style={{ display: "block" }}>
      {FACES[key]}
    </svg>
  );
}
