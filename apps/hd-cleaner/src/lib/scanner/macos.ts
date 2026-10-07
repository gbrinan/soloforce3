// macOS 카테고리 스캔 — 기획 스펙 §2 경로 매트릭스 그대로 반영.
import os from "node:os";
import { join } from "node:path";
import {
  buildCategory,
  buildMultiPathCategory,
  scanLargeFilesUnder,
  LARGE_FILE_DEFAULT_THRESHOLD,
  type ScanCategory,
} from "./common";

const HOME = os.homedir();

export function scanDownloads(): ScanCategory {
  return buildCategory("downloads", "Downloads", join(HOME, "Downloads"));
}

export function scanCaches(): ScanCategory {
  // 사용자 영역만 (~/Library/Caches). 시스템 영역(/Library/Caches)은 admin 필요 → v0.1 제외 (기획 스펙 §2)
  return buildCategory("caches", "Caches", join(HOME, "Library", "Caches"));
}

export function scanLogs(): ScanCategory {
  // 사용자 영역만 (~/Library/Logs). 시스템 영역(/Library/Logs)은 제외.
  return buildCategory("logs", "Logs", join(HOME, "Library", "Logs"));
}

export function scanTrash(): ScanCategory {
  return buildCategory("trash", "Trash", join(HOME, ".Trash"));
}

export function scanBrowserCache(): ScanCategory {
  return buildMultiPathCategory("browserCache", "Browser Cache", {
    Chrome: join(HOME, "Library", "Caches", "Google", "Chrome"),
    Safari: join(HOME, "Library", "Caches", "com.apple.Safari"),
    Edge: join(HOME, "Library", "Caches", "Microsoft Edge"),
    Firefox: join(HOME, "Library", "Caches", "Firefox"),
  });
}

export function scanMailDownloads(): ScanCategory {
  return buildCategory(
    "mailDownloads",
    "Mail Downloads",
    join(HOME, "Library", "Containers", "com.apple.mail", "Data", "Library", "Mail Downloads"),
  );
}

export function scanOldIosUpdates(): ScanCategory {
  return buildCategory(
    "oldIosUpdates",
    "Old iOS Updates",
    join(HOME, "Library", "Application Support", "MobileSync", "iPhone Software Updates"),
  );
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
