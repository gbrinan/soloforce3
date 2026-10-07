// STT 어댑터 — HyperFrames `transcribe` 1순위, whisper.cpp 2순위(@mycrew/whisper-local 공용 모듈),
// 둘 다 미가용 시 빈 transcript 반환. 유료 Whisper API 금지. 외부 전송 0.
// whisper.cpp 바이너리·모델 탐지/실행 로직은 @mycrew/whisper-local로 이관됨(meetings.ts STT 폴백과 공유,
// 중복 구현 방지). 이 파일은 HyperFrames 우선순위 + stub 폴백 등 mymovie 고유 흐름만 담당한다.

import { transcribeLocal } from "@mycrew/whisper-local";
import { TMP_DIR, ensureDir } from "../paths";
import type { TranscriptSegment } from "./signals";

export interface TranscribeResult {
  ok: boolean;
  source: "hyperframes" | "whisper.cpp" | "stub";
  segments: TranscriptSegment[];
  note?: string;
}

/**
 * 영상 경로 → 트랜스크립트.
 * 우선순위:
 * 1) HyperFrames `transcribe` 모듈이 HYPERFRAMES_TRANSCRIBE_URL로 노출돼 있으면 HTTP 호출
 * 2) whisper.cpp 바이너리 + 모델 파일이 자동 탐지/다운로드되면 wav 변환 후 로컬 실행
 * 3) 둘 다 없으면 빈 segment + ok=true (Director가 STT 없이도 동작하도록 — 컷·무음 시그널만으로)
 */
export async function transcribe(inputPath: string): Promise<TranscribeResult> {
  const hfUrl = process.env.HYPERFRAMES_TRANSCRIBE_URL;
  if (hfUrl) {
    try {
      return await transcribeViaHyperFrames(hfUrl, inputPath);
    } catch (e) {
      console.warn("[director.transcribe] HyperFrames failed, fallback:", e);
    }
  }

  try {
    ensureDir(TMP_DIR);
    const result = await transcribeLocal(inputPath, { tmpDir: TMP_DIR });
    const segments: TranscriptSegment[] = result.segments.map((s) => ({
      startMs: s.startMs,
      endMs: s.endMs,
      text: s.text,
    }));
    return { ok: true, source: "whisper.cpp", segments };
  } catch (e) {
    console.warn("[director.transcribe] whisper.cpp failed, fallback to stub:", e);
    return stubResult(`whisper.cpp 실행 실패: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function stubResult(reason: string): TranscribeResult {
  return {
    ok: true,
    source: "stub",
    segments: [],
    note: reason,
  };
}

async function transcribeViaHyperFrames(url: string, inputPath: string): Promise<TranscribeResult> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ inputPath }),
  });
  if (!res.ok) throw new Error(`HyperFrames transcribe HTTP ${res.status}`);
  const data = (await res.json()) as { segments?: TranscriptSegment[] };
  return {
    ok: true,
    source: "hyperframes",
    segments: Array.isArray(data.segments) ? data.segments : [],
  };
}
