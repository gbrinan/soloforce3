// MyMovie 패키지 루트/데이터 디렉토리 경로 헬퍼.
// process.cwd()는 호출 위치에 따라 mycrew-system 루트일 수도, apps/mymovie 일 수도 있어
// 단순 `cwd + "apps/mymovie/.data"` 는 이중 중첩(`apps/mymovie/apps/mymovie/.data`)을 만든다.
// 모든 데이터 경로는 이 헬퍼를 통해 패키지 루트 기준으로 정규화한다.
//
// 우선순위:
//   1) ENV `MYMOVIE_ROOT`
//   2) cwd basename === "mymovie"
//   3) cwd 안에 apps/mymovie/package.json 이 존재
//   4) fallback: cwd

import { existsSync } from "node:fs";
import { resolve as resolvePath, basename } from "node:path";

let cachedRoot: string | null = null;

export function mymovieRoot(): string {
  if (cachedRoot) return cachedRoot;
  if (process.env.MYMOVIE_ROOT) {
    cachedRoot = process.env.MYMOVIE_ROOT;
    return cachedRoot;
  }
  const cwd = process.cwd();
  if (basename(cwd) === "mymovie") {
    cachedRoot = cwd;
    return cwd;
  }
  const nested = resolvePath(cwd, "apps/mymovie");
  if (existsSync(resolvePath(nested, "package.json"))) {
    cachedRoot = nested;
    return nested;
  }
  cachedRoot = cwd;
  return cwd;
}

export function dataDir(): string {
  return process.env.MYMOVIE_DATA_DIR || resolvePath(mymovieRoot(), ".data");
}

export function rendersDir(): string {
  return resolvePath(dataDir(), "renders");
}

export function uploadsDir(): string {
  return process.env.MYMOVIE_UPLOADS_DIR || resolvePath(mymovieRoot(), "uploads");
}

export function rootPath(...segments: string[]): string {
  return resolvePath(mymovieRoot(), ...segments);
}
