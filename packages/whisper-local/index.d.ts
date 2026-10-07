export interface TranscribeLocalOpts { tmpDir?: string; language?: string }
// 세그먼트 타입 — 실제 whisper-local 패키지의 반환 계약이며, mymovie가 이 형태로 소비한다.
// (이 배포본의 index.js는 스텁이라 호출 시 throw 하지만, 타입은 원본 계약을 따라야
//  소비 측이 타입체크를 통과한다. 이 선언이 없어 mymovie 빌드가 깨져 있었다.)
export interface TranscribeLocalSegment { startMs: number; endMs: number; text: string }
export interface TranscribeLocalResult {
  text: string;
  engine?: string;
  segments: TranscribeLocalSegment[];
  [k: string]: unknown;
}
export declare function transcribeLocal(path: string, opts?: TranscribeLocalOpts): Promise<TranscribeLocalResult>;
