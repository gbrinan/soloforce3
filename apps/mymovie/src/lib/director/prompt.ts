// AI Director 프롬프트 빌더 — 시그널 → LLM에 던질 system/user 텍스트 구성.
// 출력 스키마는 OpenReel core의 Action 타입과 1:1 매핑.

import type { DirectorSignals } from "./signals";

export const DIRECTOR_SYSTEM_PROMPT = `당신은 마이크루의 AI 비디오 디렉터입니다.
입력 영상의 시그널(트랜스크립트, 씬컷, 무음구간, 메타데이터)을 분석해 자동 편집 액션을 JSON 배열로만 출력합니다.

규칙:
- 출력은 \`\`\`json 코드블록 안의 단일 JSON 배열이어야 합니다. 다른 어떤 텍스트도 출력하지 마세요.
- 각 액션은 다음 type 중 하나: "cut", "trim", "reframe", "caption", "bgm", "transition"
- 모든 시간 단위는 ms(정수). 영상 길이를 초과하지 마세요.
- 액션 메타: meta.id(고유), meta.createdAt(epoch ms), meta.source="ai"
- 무음 구간(silences) 0.8초 이상은 trim으로 제거 후보
- 컷 스코어 0.5 이상의 강한 씬컷에는 transition(fade, 300ms) 부여
- 트랜스크립트가 있으면 발화 구간에 caption 액션 부여 (style.pos="bottom")
- 결과 액션 수는 입력 영상 시그널 밀도에 비례하되 최대 50개 이내`;

export interface DirectorPromptInput {
  signals: DirectorSignals;
  /** OpenReel footage clipId — 기본 1개 클립 가정. Step 3 범위. */
  clipId: string;
  /** 사용자 의도 힌트 (예: "1분 쇼츠로 정리", "강의 컷편집") — 선택. */
  intent?: string;
}

export function buildDirectorUserPrompt(input: DirectorPromptInput): string {
  const { signals, clipId, intent } = input;
  const compact = {
    clipId,
    intent: intent ?? "auto",
    meta: signals.meta,
    sceneCuts: signals.sceneCuts.slice(0, 200), // 토큰 폭발 방지.
    silences: signals.silences.slice(0, 200),
    transcript: signals.transcript.slice(0, 300).map((s) => ({
      s: s.startMs,
      e: s.endMs,
      t: s.text.length > 200 ? `${s.text.slice(0, 200)}…` : s.text,
    })),
    highlights: signals.highlights.slice(0, 20),
  };
  return [
    "다음은 영상 분석 시그널입니다. 이 시그널을 바탕으로 자동 편집 액션 배열을 JSON으로 출력하세요.",
    "",
    "```json-input",
    JSON.stringify(compact, null, 2),
    "```",
    "",
    "출력 형식 예시:",
    "```json",
    `[
  {"type":"trim","meta":{"id":"a1","createdAt":${Date.now()},"source":"ai"},"clipId":"${clipId}","start":12000,"end":12800},
  {"type":"caption","meta":{"id":"a2","createdAt":${Date.now()},"source":"ai"},"clipId":"${clipId}","start":3000,"end":4500,"text":"오프닝","style":{"pos":"bottom"}}
]`,
    "```",
  ].join("\n");
}

/**
 * LLM 응답 텍스트에서 JSON 배열을 추출. 코드펜스 없는 raw 응답도 best-effort 대응.
 * 환각/잡음에 강하게: 첫 '['와 마지막 ']' 사이를 시도.
 */
export function extractJsonArray(raw: string): unknown[] | null {
  if (!raw) return null;
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const block = fenceMatch ? fenceMatch[1] : raw;
  // 코드펜스 안에서도 텍스트가 섞일 수 있어 한번 더 정제.
  const firstBracket = block.indexOf("[");
  const lastBracket = block.lastIndexOf("]");
  if (firstBracket === -1 || lastBracket === -1 || lastBracket <= firstBracket) return null;
  const candidate = block.slice(firstBracket, lastBracket + 1);
  try {
    const parsed = JSON.parse(candidate);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
