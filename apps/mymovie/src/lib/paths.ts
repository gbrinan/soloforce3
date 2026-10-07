// 중앙 경로 모듈 (Group 1 normalize).
// process.cwd() 의존을 제거하기 위해 mymovie 패키지 루트를 import.meta.url 기반으로 산출한다.
// 기존 core/paths.ts 가 함수형 헬퍼(mymovieRoot/dataDir/rendersDir/uploadsDir/rootPath)를 노출하므로
// 본 모듈은 그것을 재사용하여 디렉토리 상수 및 추가 헬퍼(FIXTURES_DIR/TMP_DIR)를 export 한다.
// ENV override:
//   MYMOVIE_RUNTIME_ROOT   — 패키지 루트 강제 지정 (없으면 MYMOVIE_ROOT, 그것도 없으면 자동 탐색)
//   MYMOVIE_DATA_DIR       — .data 디렉토리 override
//   MYMOVIE_UPLOADS_DIR    — uploads 디렉토리 override
//   MYMOVIE_TMP_DIR        — tmp 디렉토리 override
//   MYMOVIE_FIXTURES_DIR   — verify-director 픽스처 override

import { mkdirSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import {
  mymovieRoot as coreRoot,
  dataDir as coreDataDir,
  rendersDir as coreRendersDir,
  uploadsDir as coreUploadsDir,
  rootPath as coreRootPath,
} from "./core/paths";

// MYMOVIE_RUNTIME_ROOT 우선 (Group 1 spec).
if (process.env.MYMOVIE_RUNTIME_ROOT && !process.env.MYMOVIE_ROOT) {
  process.env.MYMOVIE_ROOT = process.env.MYMOVIE_RUNTIME_ROOT;
}

/** mymovie 패키지 루트 (예: /Users/x/mycrew-system/apps/mymovie). */
export const RUNTIME_ROOT: string = coreRoot();

/** {RUNTIME_ROOT}/.data — env MYMOVIE_DATA_DIR 우선. */
export const DATA_DIR: string = coreDataDir();

/** {DATA_DIR}/renders — ffmpeg 산출물. */
export const RENDERS_DIR: string = coreRendersDir();

/** {DATA_DIR}/test-fixtures — verify-director 검증용 영상/오디오. env MYMOVIE_FIXTURES_DIR 우선. */
export const FIXTURES_DIR: string =
  process.env.MYMOVIE_FIXTURES_DIR || resolvePath(DATA_DIR, "test-fixtures");

/** {RUNTIME_ROOT}/uploads — 업로드 원본. env MYMOVIE_UPLOADS_DIR 우선. */
export const UPLOADS_DIR: string = coreUploadsDir();

/** {DATA_DIR}/tmp — STT wav 등 단명 중간 파일. env MYMOVIE_TMP_DIR 우선. */
export const TMP_DIR: string =
  process.env.MYMOVIE_TMP_DIR || resolvePath(DATA_DIR, "tmp");

/** 패키지 루트 기준 임의 상대경로(예: `.verify-director.log`). */
export function rootPath(...segments: string[]): string {
  return coreRootPath(...segments);
}

/** 지정 디렉토리를 mkdir -p 한다(이미 있어도 무시). */
export function ensureDir(p: string): string {
  mkdirSync(p, { recursive: true });
  return p;
}

/** RENDERS_DIR 하위에 jobId 별 디렉토리를 만들어 절대경로 반환. */
export function jobDirFor(jobId: string): string {
  return ensureDir(resolvePath(RENDERS_DIR, jobId));
}
