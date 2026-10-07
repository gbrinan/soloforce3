// 대용량 텍스트 라인슬라이스 임시파일 표준화 (2026-08-06 data-ingest 개선, 회고 보류 #3)
//
// 배경: 대용량 STT/인터뷰 원문을 부분 확인하려고 만든 라인슬라이스 임시파일이
// 프로젝트 루트에 제각각 이름으로 흩어지고(예: slice_941_1410.txt, _jh_extract_1_470.txt,
// range_871_1740.txt) 정리되지 않았다. 루트는 SafeFS writePaths 밖이라 SafeDelete로도
// 못 지우는 잔여물이 쌓였다.
//
// 표준: 슬라이스는 항상 history/attachments/<KST날짜>/_slices/ 아래에 만든다(writePaths 내부).
// 명명은 slice_<start>_<end>_<hash8>.txt 로 고정해 정리 대상을 정규식으로 안전하게 식별한다.
import { mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { HISTORY_DIR, toKstDate } from "../../config.js";

const SLICE_NAME_RE = /^slice_\d+_\d+_[0-9a-f]{8}\.txt$/;

/** 슬라이스 임시파일 표준 디렉터리 (history/attachments/<date>/_slices). */
export function slicesDir(date: string = toKstDate()): string {
  return join(HISTORY_DIR, "attachments", date, "_slices");
}

/**
 * 텍스트 조각을 표준 경로의 임시파일로 저장하고 그 절대경로를 반환한다.
 * @param content 저장할 조각 내용
 * @param start   시작 라인(표시용, 1-기반 권장)
 * @param end     끝 라인(표시용)
 * @param date    KST 날짜(YYYY-MM-DD). 기본값은 오늘.
 */
export function sliceToTemp(content: string, start: number, end: number, date: string = toKstDate()): string {
  const dir = slicesDir(date);
  mkdirSync(dir, { recursive: true });
  const hash8 = createHash("sha256").update(content).digest("hex").slice(0, 8);
  const fp = join(dir, `slice_${start}_${end}_${hash8}.txt`);
  writeFileSync(fp, content);
  return fp;
}

/**
 * 전체 텍스트에서 [start, end] 라인 구간(1-기반, 양끝 포함)을 잘라 표준 임시파일로 저장한다.
 * 라인 계산과 파일 생성을 한곳에 모아, 호출부가 경로·명명을 직접 다루지 않게 한다.
 */
export function lineSliceToTemp(fullText: string, start: number, end: number, date: string = toKstDate()): string {
  const lines = fullText.split(/\r?\n/);
  const from = Math.max(1, start);
  const to = Math.min(lines.length, end);
  const chunk = lines.slice(from - 1, to).join("\n");
  return sliceToTemp(chunk, from, to, date);
}

/**
 * 표준 슬라이스 디렉터리의 임시파일을 정리한다(명명 규칙에 맞는 것만).
 * @returns 삭제한 파일 수
 */
export function cleanupSlices(date: string = toKstDate()): number {
  const dir = slicesDir(date);
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const f of readdirSync(dir)) {
    if (SLICE_NAME_RE.test(f)) {
      rmSync(join(dir, f), { force: true });
      n++;
    }
  }
  return n;
}
