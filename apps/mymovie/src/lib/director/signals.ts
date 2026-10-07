// AI Director — 분석 시그널 타입.
// 모든 시그널은 무료/로컬 도구로 수집. 외부 유료 API 금지.

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string;
}

export interface SceneCut {
  /** 컷이 감지된 시점 (ms). 컷 이전 프레임 종료 시점 기준. */
  atMs: number;
  /** ffmpeg scene 점수 (0..1, 1에 가까울수록 큰 변화). */
  score: number;
}

export interface SilenceRange {
  startMs: number;
  endMs: number;
  /** 감지 임계 (dB, 음수 값). */
  thresholdDb: number;
}

export interface HighlightCandidate {
  startMs: number;
  endMs: number;
  /** 0..1 정규화 점수 — 컷·발화·키워드 휴리스틱 합성. */
  score: number;
  reason: string;
}

export interface VideoMeta {
  durationMs: number;
  width: number;
  height: number;
}

export interface DirectorSignals {
  meta: VideoMeta;
  transcript: TranscriptSegment[];
  sceneCuts: SceneCut[];
  silences: SilenceRange[];
  highlights: HighlightCandidate[];
}

export const EMPTY_SIGNALS: DirectorSignals = {
  meta: { durationMs: 0, width: 0, height: 0 },
  transcript: [],
  sceneCuts: [],
  silences: [],
  highlights: [],
};
