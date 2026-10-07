// 개인 데이터 백업/복원 — 재설치 시 history/ 전체 + 각 앱 로컬 데이터(apps/*/data)를
// ZIP으로 내보내고 되돌린다.
// 백업: archiver('zip') 스트리밍 압축(대용량 안전). 복원: adm-zip 해제(zip-slip 방지).
// 앱 데이터는 "app-data/<appId>/..." 프리픽스로 담아, 복원 시 apps/<appId>/data 로 되돌린다.
import { existsSync, mkdirSync, rmSync, readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import AdmZip from "adm-zip";
import { HISTORY_DIR, PROJECT_SELF_DIR } from "../config.js";

// 재생성되는 캐시/로그 — 백업에서 제외(복원 불필요, 용량만 차지).
const EXCLUDE_PREFIXES = ["debug", "_v011check"];

// 앱 로컬 데이터 루트 — apps/<id>/data. 스토어 스캐폴드는 앱이 아니므로 제외.
const APPS_DIR = join(PROJECT_SELF_DIR, "apps");
const APP_DATA_PREFIX = "app-data";
const NON_APP_DIRS = new Set(["mycrew-store-scaffold"]);

/** apps/ 하위에서 data 디렉터리가 존재하는 앱들을 동적으로 수집(신규 앱 자동 포함). */
function listAppDataDirs(): { appId: string; dir: string }[] {
  try {
    return readdirSync(APPS_DIR)
      .filter((id) => !NON_APP_DIRS.has(id) && !id.startsWith("."))
      .map((id) => ({ appId: id, dir: join(APPS_DIR, id, "data") }))
      .filter((x) => existsSync(x.dir) && statSync(x.dir).isDirectory());
  } catch {
    return [];
  }
}

function backupBasename(): string {
  // YYYY-MM-DD (KST) — 파일명 충돌 방지용 날짜 스탬프.
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const d = kst.toISOString().slice(0, 10);
  return `mycrew-backup-${d}.zip`;
}

/**
 * HISTORY_DIR 전체 + 각 앱의 data 디렉터리를 임시 ZIP으로 압축하고
 * 파일 경로 + 다운로드용 파일명을 반환한다.
 * 호출자(라우트)가 스트리밍 후 임시 파일을 삭제해야 한다.
 */
export function createBackupZip(): { path: string; filename: string } {
  if (!existsSync(HISTORY_DIR)) {
    throw new Error("history directory not found");
  }
  const workDir = join(tmpdir(), "mycrew-backup");
  if (!existsSync(workDir)) mkdirSync(workDir, { recursive: true });
  const filename = backupBasename();
  const outPath = join(workDir, `${Date.now()}-${filename}`);

  const zip = new AdmZip();
  // 엔트리를 "conversations/..." 형태(HISTORY_DIR 상대)로 담아 복원 시 그대로 풀리게 한다.
  // filter=true인 항목만 포함 — 재생성 캐시(debug/·_v011check/) 제외.
  zip.addLocalFolder(HISTORY_DIR, "", (name: string) => {
    const n = name.replace(/\\/g, "/");
    return !EXCLUDE_PREFIXES.some((p) => n === p || n.startsWith(p + "/"));
  });
  // 각 앱 로컬 데이터 → "app-data/<appId>/..." 프리픽스로 포함.
  for (const { appId, dir } of listAppDataDirs()) {
    zip.addLocalFolder(dir, `${APP_DATA_PREFIX}/${appId}`);
  }
  zip.writeZip(outPath);
  return { path: outPath, filename };
}

/**
 * 업로드된 ZIP을 복원한다. "app-data/<appId>/..." 엔트리는 apps/<appId>/data 로,
 * 그 외 엔트리는 HISTORY_DIR 로 해제(덮어쓰기)한다. zip-slip(경로 탈출) 방지.
 * 서버 재시작 전까지 in-memory 상태와 디스크가 불일치하므로 호출 후 재시작이 필요하다.
 */
export function restoreFromZip(zipPath: string): { restored: number } {
  const zip = new AdmZip(zipPath);
  const historyBase = resolve(HISTORY_DIR);
  const appsBase = resolve(APPS_DIR);
  const entries = zip.getEntries();
  if (entries.length === 0) throw new Error("empty archive");

  // 엔트리별 복원 대상(base, 상대경로) 계산 + zip-slip 검증.
  type Plan = { entry: AdmZip.IZipEntry; base: string; rel: string };
  const plans: Plan[] = [];
  for (const e of entries) {
    if (e.isDirectory) continue;
    const name = e.entryName.replace(/\\/g, "/");
    let base: string;
    let rel: string;
    if (name === APP_DATA_PREFIX || name.startsWith(APP_DATA_PREFIX + "/")) {
      // app-data/<appId>/<...> → apps/<appId>/data/<...>
      const rest = name.slice(APP_DATA_PREFIX.length + 1); // "<appId>/<...>"
      const slash = rest.indexOf("/");
      if (slash <= 0) continue; // appId만 있고 파일 경로 없음 → 스킵
      const appId = rest.slice(0, slash);
      const sub = rest.slice(slash + 1);
      if (!appId || appId.includes("..") || !sub) continue;
      base = appsBase;
      rel = join(appId, "data", sub);
    } else {
      base = historyBase;
      rel = name;
    }
    const target = resolve(base, rel);
    if (target !== base && !target.startsWith(base + sep)) {
      throw new Error(`unsafe entry path: ${e.entryName}`);
    }
    plans.push({ entry: e, base, rel });
  }

  if (!existsSync(historyBase)) mkdirSync(historyBase, { recursive: true });
  let restored = 0;
  for (const { entry, base, rel } of plans) {
    // maintainEntryPath=false + 명시적 targetPath 로 라우팅된 상대경로에 정확히 푼다.
    const targetDir = resolve(base, rel, "..");
    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
    zip.extractEntryTo(entry, targetDir, /* maintainEntryPath */ false, /* overwrite */ true);
    restored++;
  }
  return { restored };
}

/** 임시 백업 파일 정리(스트리밍 완료 후 호출). */
export function cleanupBackupFile(path: string): void {
  try {
    if (existsSync(path)) rmSync(path, { force: true });
  } catch { /* 정리 실패는 무시 */ }
}
