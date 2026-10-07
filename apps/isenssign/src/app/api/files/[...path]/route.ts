/**
 * File Serving API
 * GET /api/files/{...path} - 스토리지에서 파일 다운로드
 *
 * 스토리지 getUrl()이 반환하는 /api/files/{encodedKey} 경로를 처리
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { getStorage } from "@/lib/storage";

const CONTENT_TYPE_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
};

function getContentType(key: string): string {
  const ext = key.slice(key.lastIndexOf(".")).toLowerCase();
  return CONTENT_TYPE_MAP[ext] || "application/octet-stream";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const session = await requireAuth();
    if (session instanceof NextResponse) return session;

    const { path: pathSegments } = await params;

    // path 세그먼트를 디코딩하여 스토리지 키 복원
    const storageKey = pathSegments
      .map((segment) => decodeURIComponent(segment))
      .join("/");

    if (!storageKey) {
      return NextResponse.json(
        { error: "파일 경로가 지정되지 않았습니다" },
        { status: 400 }
      );
    }

    // 경로 순회 공격 방지 (Path Traversal)
    if (
      storageKey.includes("..") ||
      storageKey.startsWith("/") ||
      storageKey.includes("\\")
    ) {
      return NextResponse.json(
        { error: "잘못된 파일 경로입니다" },
        { status: 400 }
      );
    }

    const storage = getStorage();
    let data: Buffer;

    try {
      data = await storage.download(storageKey);
    } catch {
      return NextResponse.json(
        { error: "파일을 찾을 수 없습니다" },
        { status: 404 }
      );
    }

    const contentType = getContentType(storageKey);

    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(data.length),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "파일을 가져오는 중 오류가 발생했습니다";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
