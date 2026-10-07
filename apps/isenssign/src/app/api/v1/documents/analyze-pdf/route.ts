/**
 * Document Analyze-PDF API
 * POST /api/v1/documents/analyze-pdf
 *
 * PDF 파일을 업로드하면 페이지 수와 base64 data URI를 반환합니다.
 * 클라이언트 사이드 렌더링용.
 * 최대 파일 크기: 20MB
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB for PDFs

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    if (session instanceof NextResponse) return session;

    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "파일이 첨부되지 않았습니다" },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          error: `파일 크기가 20MB를 초과합니다 (${(file.size / 1024 / 1024).toFixed(1)}MB)`,
        },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const dataUri = `data:application/pdf;base64,${base64}`;

    // Count PDF pages by searching for /Type /Page entries (rough estimate)
    // A proper library would be more accurate, but this avoids extra dependencies
    const pdfBuffer = Buffer.from(arrayBuffer);
    const pdfText = pdfBuffer.toString("latin1");
    const pageMatches = pdfText.match(/\/Type\s*\/Page[^s]/g);
    const estimatedPageCount = pageMatches ? pageMatches.length : 1;

    return NextResponse.json({
      dataUri,
      fileName: file.name,
      totalPages: estimatedPageCount,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "PDF 분석 중 오류가 발생했습니다";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
