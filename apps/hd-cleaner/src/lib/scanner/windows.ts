// Windows 카테고리 스캔 — 기획 스펙 §2 경로 매트릭스 그대로 반영.
// Trash(Recycle Bin)는 Shell API(SHEmptyRecycleBin) 경유가 필요하고 직접 FS 조작은
// 권한 오류·손상 위험이 있어(스펙 §2) v0.1 서버 사이드 스캔에서는 미지원으로 숨김 처리한다.
// Old iOS Updates 대응 경로("Windows Update 정리 캐시")는 admin 권한이 필요해 v0.1에서 숨김(스펙 §5-1).
import os from "node:os";
import { join } from "node:path";
import {
  buildCategory,
  buildMultiPathCategory,
  scanLargeFilesUnder,
  unavailableCategory,
  LARGE_FILE_DEFAULT_THRESHOLD,
  type ScanCategory,
} from "./common";

const HOME = os.homedir();
const LOCALAPPDATA = process.env.LOCALAPPDATA || join(HOME, "AppData", "Local");
const TEMP = process.env.TEMP || join(LOCALAPPDATA, "Temp");

export function scanDownloads(): ScanCategory {
  return buildCategory("downloads", "Downloads", join(HOME, "Downloads"));
}

export function scanCaches(): ScanCategory {
  return buildMultiPathCategory("caches", "Caches", {
    Temp: TEMP,
    INetCache: join(LOCALAPPDATA, "Microsoft", "Windows", "INetCache"),
  });
}

export function scanLogs(): ScanCategory {
  // 앱마다 로그 경로 패턴이 상이(%LOCALAPPDATA%\{AppName}\Logs) — 화이트리스트 매칭 미구현이라
  // 잘못된 상위 디렉토리 스캔(R3) 위험을 피하기 위해 v0.1은 보수적으로 숨김 처리.
  return unavailableCategory("logs", "Logs");
}

export function scanTrash(): ScanCategory {
  return unavailableCategory("trash", "Recycle Bin");
}

export function scanBrowserCache(): ScanCategory {
  // Safari는 Windows용 2012년 단종 → 자동 숨김.
  // Firefox는 프로필 폴더명이 와일드카드(*.default-release)라 v0.1은 오탐(R3) 방지를 위해 보수적으로 제외.
  return buildMultiPathCategory("browserCache", "Browser Cache", {
    Chrome: join(LOCALAPPDATA, "Google", "Chrome", "User Data", "Default", "Cache"),
    Edge: join(LOCALAPPDATA, "Microsoft", "Edge", "User Data", "Default", "Cache"),
  });
}

export function scanMailDownloads(): ScanCategory {
  return buildCategory(
    "mailDownloads",
    "Mail Downloads",
    join(LOCALAPPDATA, "Microsoft", "Windows", "INetCache", "Content.Outlook"),
  );
}

export function scanOldIosUpdates(): ScanCategory {
  return unavailableCategory("oldIosUpdates", "Old iOS Updates");
}

export function scanLargeFiles(thresholdBytes: number = LARGE_FILE_DEFAULT_THRESHOLD): ScanCategory {
  return scanLargeFilesUnder(HOME, thresholdBytes);
}

export function scanAll(largeFileThreshold: number = LARGE_FILE_DEFAULT_THRESHOLD): ScanCategory[] {
  return [
    scanDownloads(),
    scanCaches(),
    scanLogs(),
    scanTrash(),
    scanBrowserCache(),
    scanMailDownloads(),
    scanOldIosUpdates(),
    scanLargeFiles(largeFileThreshold),
  ];
}
