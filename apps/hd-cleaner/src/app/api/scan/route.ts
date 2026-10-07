// 서버 사이드(Node.js 런타임)에서 실제 fs 재귀 스캔을 수행한다. 브라우저는 fetch로만 호출.
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import * as macos from "@/lib/scanner/macos";
import * as windows from "@/lib/scanner/windows";
import {
  LARGE_FILE_DEFAULT_THRESHOLD,
  applyScanFilter,
  type ScanCategory,
  type ScanFilter,
} from "@/lib/scanner/common";
import { getFixtures, isTestMode } from "@/lib/test-hooks";

// Validate the optional AI filter from the request body (unknown keys/types dropped).
function readFilter(body: unknown): ScanFilter | null {
  const raw = (body as { filter?: unknown } | null)?.filter;
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const filter: ScanFilter = {};
  if (typeof r.minSizeMB === "number" && r.minSizeMB > 0) filter.minSizeMB = r.minSizeMB;
  if (typeof r.olderThanDays === "number" && r.olderThanDays > 0) filter.olderThanDays = r.olderThanDays;
  if (Array.isArray(r.extensions)) {
    const exts = r.extensions.filter((e): e is string => typeof e === "string" && e.length > 0);
    if (exts.length) filter.extensions = exts;
  }
  if (Array.isArray(r.pathIncludes)) {
    const incs = r.pathIncludes.filter((e): e is string => typeof e === "string" && e.length > 0);
    if (incs.length) filter.pathIncludes = incs;
  }
  return Object.keys(filter).length > 0 ? filter : null;
}

export async function POST(req: Request) {
  let threshold = LARGE_FILE_DEFAULT_THRESHOLD;
  let filter: ScanFilter | null = null;
  try {
    const body = await req.json();
    if (typeof body?.largeFileThresholdBytes === "number" && body.largeFileThresholdBytes > 0) {
      threshold = body.largeFileThresholdBytes;
    }
    filter = readFilter(body);
    // Filter minSizeMB overrides the large-file scan threshold.
    if (filter?.minSizeMB) threshold = filter.minSizeMB * 1024 * 1024;
  } catch {
    // 본문 없음 → 기본 임계값 사용
  }

  const scanner = process.platform === "win32" ? windows : macos;
  const categories: ScanCategory[] = scanner.scanAll(threshold);

  // Apply the AI filter to the Large Files category only (fixed categories are path-defined).
  if (filter) {
    const largeFiles = categories.find((c) => c.id === "largeFiles");
    if (largeFiles) {
      largeFiles.items = applyScanFilter(largeFiles.items, filter);
      largeFiles.totalSize = largeFiles.items.reduce((s, i) => s + i.size, 0);
    }
  }

  // 테스트 모드: fixture로 주입된 항목을 largeFiles 카테고리에 합산 — 실 파일시스템 없이 E2E 검증 가능.
  if (isTestMode()) {
    const fixtures = getFixtures();
    if (fixtures.length) {
      const largeFiles = categories.find((c) => c.id === "largeFiles");
      if (largeFiles) {
        const extra = fixtures.map((f) => ({
          path: f.path,
          size: f.size,
          isDir: false,
          mtimeMs: Date.now(),
          atimeMs: Date.now(),
        }));
        largeFiles.items.push(...extra);
        largeFiles.totalSize += extra.reduce((s, i) => s + i.size, 0);
      }
    }
  }

  return NextResponse.json({ ok: true, categories, platform: process.platform, largeFileThreshold: threshold });
}
