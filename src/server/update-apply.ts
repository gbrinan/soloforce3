// 프로그램 자가 업데이트 — 스토어 패키지 zip을 받아 적용한다.
// 2단계 분리:
//   prepareUpdate()       — 안전(비파괴): 다운로드 → 스테이징 추출 → 버전 검증. 실행 설치본 미변경.
//   applyPreparedUpdate() — 파괴적: 스테이징을 설치 폴더에 덮어쓰고 setup 재실행 후 self-restart.
//     반드시 소유자의 명시적 확인(클릭)으로만 호출한다. 실패 시 설치본이 깨질 수 있어 스테이징
//     선검증 후에만 진행하고, 데이터 디렉토리(history/·.env·.sso-secret·node_modules·.git)는 보존한다.
import { spawn } from "node:child_process";
import { mkdir, rm, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { PROJECT_SELF_DIR, HISTORY_DIR } from "../config.js";
import { getUpdateStatus } from "./update-check.js";

const execFileAsync = promisify(execFile);

const UPDATE_DIR = join(HISTORY_DIR, ".update");
const ZIP_PATH = join(UPDATE_DIR, "package.zip");
const EXTRACT_DIR = join(UPDATE_DIR, "extract");
// zip 최상위 폴더(package-program.mjs 규약): mycrew-program/
const STAGED_ROOT = join(EXTRACT_DIR, "mycrew-program");

// 덮어쓰기에서 보존할 항목 — 사용자 데이터·시크릿·설치 의존성.
const PRESERVE = ["history", ".env", ".sso-secret", "node_modules", ".git", ".mycrew-B"];

export interface PrepareResult {
  ok: boolean;
  version?: string;
  stagedPath?: string;
  error?: string;
}

// 비파괴: 새 패키지를 내려받아 스테이징에 풀고 버전을 검증한다. 실행 중 설치본은 건드리지 않는다.
export async function prepareUpdate(): Promise<PrepareResult> {
  const status = getUpdateStatus();
  if (!status.updatable || !status.latestVersion) return { ok: false, error: "no_update_available" };
  const url = status.downloadUrl;
  if (!url) return { ok: false, error: "no_download_url" };

  try {
    await rm(UPDATE_DIR, { recursive: true, force: true });
    await mkdir(UPDATE_DIR, { recursive: true });

    // 다운로드
    const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
    if (!res.ok) return { ok: false, error: `download_failed_${res.status}` };
    const expectedLen = Number(res.headers.get("content-length") || 0);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1_000_000) return { ok: false, error: "download_too_small" };
    // 절단 다운로드 조기 감지(부분 파일이 unzip까지 가지 않게) — Content-Length와 대조.
    if (expectedLen > 0 && buf.length !== expectedLen) {
      return { ok: false, error: `download_incomplete_${buf.length}_of_${expectedLen}` };
    }
    const { writeFile } = await import("node:fs/promises");
    await writeFile(ZIP_PATH, buf);

    // 추출 — mac/linux: unzip, Windows 네이티브: tar.exe(bsdtar, Win10 1803+ 기본 탑재)가 zip 지원.
    await mkdir(EXTRACT_DIR, { recursive: true });
    if (process.platform === "win32") {
      await execFileAsync("tar", ["-xf", ZIP_PATH, "-C", EXTRACT_DIR], { maxBuffer: 64 * 1024 * 1024 });
    } else {
      await execFileAsync("unzip", ["-q", "-o", ZIP_PATH, "-d", EXTRACT_DIR], { maxBuffer: 64 * 1024 * 1024 });
    }

    // 검증: 스테이징 package.json 버전 === 기대 최신 버전
    const pkgPath = join(STAGED_ROOT, "package.json");
    if (!existsSync(pkgPath)) return { ok: false, error: "staged_package_missing" };
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8")) as { version?: string };
    if (pkg.version !== status.latestVersion) {
      return { ok: false, error: `version_mismatch_staged_${pkg.version}_expected_${status.latestVersion}` };
    }
    // 패키지는 소스(src/)를 담고 setup이 설치 시 빌드한다(dist 미포함). 필수 골격만 검증.
    if (!existsSync(join(STAGED_ROOT, "src", "index.ts"))) return { ok: false, error: "staged_src_missing" };
    const setupName =
      process.platform === "darwin" ? "setup.command"
      : process.platform === "win32" ? "setup-windows.ps1"
      : "setup-linux.sh";
    if (!existsSync(join(STAGED_ROOT, setupName))) return { ok: false, error: "staged_setup_missing" };

    return { ok: true, version: pkg.version, stagedPath: STAGED_ROOT };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface ApplyResult {
  ok: boolean;
  version?: string;
  error?: string;
}

// 파괴적: prepareUpdate 성공 후에만 호출. 스테이징을 설치 폴더에 덮어쓰는 작업은
// 실행 중 서버가 자기 파일을 바꾸다 중간 실패하면 위험하므로, 서버 종료 후 동작하는
// 분리(detached) 업데이터 프로세스에 위임한다. 업데이터가 rsync 덮어쓰기 → setup 재실행 →
// 재기동을 수행하고, 이 함수는 graceful shutdown을 트리거한다.
export async function applyPreparedUpdate(): Promise<ApplyResult> {
  const prep = await prepareUpdate();
  if (!prep.ok) return { ok: false, error: prep.error };

  const { writeFile, chmod } = await import("node:fs/promises");
  const logPath = join(HISTORY_DIR, "update-apply.log");
  let child: import("node:child_process").ChildProcess;

  if (process.platform === "win32") {
    // Windows 네이티브 업데이터 — robocopy 덮어쓰기 후 setup-windows.ps1 -Update 재실행.
    // /IS /IT 필수: zip이 보존한 과거 mtime 때문에 동일 파일 판정으로 skip되는 문제 방지
    // (아래 rsync --ignore-times와 동일 취지 — 전체 코드 트리를 무조건 교체).
    const xd = PRESERVE.map((p) => `"${join(STAGED_ROOT, p)}"`).join(" ");
    const script = `$ErrorActionPreference = 'Continue'
# 부모 서버(node/tsx)가 종료될 때까지 대기 (최대 30초)
for ($i = 0; $i -lt 30; $i++) {
  $p = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'tsx' -and $_.CommandLine -match 'index' }
  if (-not $p) { break }
  Start-Sleep -Seconds 1
}
# 스테이징을 설치 폴더에 덮어쓰기 (데이터·시크릿·의존성 보존 — PRESERVE 디렉토리는 스테이징 측 제외)
robocopy "${STAGED_ROOT}" "${PROJECT_SELF_DIR}" /E /IS /IT /NFL /NDL /NJH /XD ${xd} /XF .env .sso-secret >> "${logPath}" 2>&1
# robocopy 종료코드 0~7 = 성공 범주, 8 이상 = 실패
if ($LASTEXITCODE -ge 8) { "robocopy failed: $LASTEXITCODE" >> "${logPath}"; exit 1 }
# 의존성·빌드·재기동은 setup 스크립트에 위임 (-Update: 프롬프트·브라우저 없는 비대화 모드)
Set-Location "${PROJECT_SELF_DIR}"
powershell -ExecutionPolicy Bypass -File "${join(PROJECT_SELF_DIR, "setup-windows.ps1")}" -Update >> "${logPath}" 2>&1
`;
    const scriptPath = join(UPDATE_DIR, "apply.ps1");
    await writeFile(scriptPath, script, "utf-8");
    // 분리 실행 — 부모가 죽어도 계속 동작
    child = spawn("powershell.exe", ["-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", scriptPath], {
      detached: true,
      stdio: "ignore",
      cwd: UPDATE_DIR,
    });
  } else {
    // mac/linux 업데이터 셸 스크립트 — 부모(서버) 종료를 기다린 뒤 덮어쓰기·재빌드·재기동.
    const excludes = PRESERVE.map((p) => `--exclude=${p}`).join(" ");
    const setupCmd =
      process.platform === "darwin"
        ? `bash "${join(PROJECT_SELF_DIR, "setup.command")}"`
        : `bash "${join(PROJECT_SELF_DIR, "setup-linux.sh")}"`;
    const script = `#!/bin/bash
set -e
# 부모 서버가 포트를 놓을 때까지 대기 (최대 30초)
for i in $(seq 1 30); do
  if ! pgrep -f "tsx src/index.ts" >/dev/null 2>&1; then break; fi
  sleep 1
done
# 스테이징을 설치 폴더에 덮어쓰기 (데이터·시크릿·의존성 보존)
# --ignore-times 필수: unzip이 zip 내부(과거) mtime을 보존하므로, 기본 quick-check(크기+mtime)는
# "같은 크기 + 과거 mtime" 파일(예: 버전 문자열만 바뀐 package.json, 동일 길이 코드 변경)을 skip해
# 업데이트가 조용히 미적용된다. 전체 코드 트리를 무조건 교체하도록 강제한다.
rsync -a --ignore-times ${excludes} "${STAGED_ROOT}/" "${PROJECT_SELF_DIR}/"
# 의존성·빌드·재기동은 검증된 setup 스크립트에 위임
cd "${PROJECT_SELF_DIR}"
${setupCmd} >> "${logPath}" 2>&1
`;
    const scriptPath = join(UPDATE_DIR, "apply.sh");
    await writeFile(scriptPath, script, "utf-8");
    await chmod(scriptPath, 0o755);

    // 분리 실행 — 부모가 죽어도 계속 동작
    child = spawn("bash", [scriptPath], {
      detached: true,
      stdio: "ignore",
      cwd: UPDATE_DIR,
    });
  }
  child.unref();

  // graceful shutdown 트리거 (index.ts SIGTERM 핸들러가 5초 후 정리)
  setTimeout(() => process.kill(process.pid, "SIGTERM"), 1500).unref?.();
  return { ok: true, version: prep.version };
}

// 스테이징 정리 (검증/취소 후)
export async function clearUpdateStaging(): Promise<void> {
  try { await rm(UPDATE_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
}

// 스테이징 상태 조회 (준비 완료 여부)
export async function getStagedVersion(): Promise<string | null> {
  try {
    const pkgPath = join(STAGED_ROOT, "package.json");
    await stat(pkgPath);
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8")) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}
