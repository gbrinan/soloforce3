/**
 * Document Convert API
 * POST /api/v1/documents/convert - 문서를 배경이미지 + 텍스트 오버레이로 변환
 *
 * 지원 형식: .docx, .xlsx, .xls, .pptx, .pdf
 * 최대 파일 크기: 10MB
 *
 * 흐름:
 *   Upload → /tmp 저장 → (Office면 LibreOffice→PDF) → renderPdfPages + extractTextBlocks → 응답
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { promises as fs } from "fs";
import path from "path";
import { nanoid } from "nanoid";
import { convertToPdf } from "@/lib/libreoffice";
import { renderPdfPages, PdfRenderError } from "@/lib/pdf-page-renderer";
import { extractTextBlocks } from "@/lib/pdf-text-extract";
import type { TextBlock } from "@/lib/text-block";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

type SourceType = "docx" | "xlsx" | "pdf" | "pptx";

const ALLOWED_EXTENSIONS: Record<string, SourceType> = {
  ".docx": "docx",
  ".xlsx": "xlsx",
  ".xls": "xlsx",
  ".pptx": "pptx",
  ".pdf": "pdf",
};

function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1) return "";
  return filename.slice(lastDot).toLowerCase();
}

export async function POST(request: NextRequest) {
  let tmpDir: string | null = null;

  try {
    const session = await requireAuth();
    if (session instanceof NextResponse) return session;

    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "multipart/form-data 형식으로 요청해주세요" },
        { status: 400 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const password = formData.get("password");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "파일이 첨부되지 않았습니다. 'file' 필드에 파일을 첨부해주세요" },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `파일 크기가 10MB를 초과합니다 (${(file.size / 1024 / 1024).toFixed(1)}MB)` },
        { status: 400 }
      );
    }

    const fileName = file.name;
    const ext = getFileExtension(fileName);
    const sourceType = ALLOWED_EXTENSIONS[ext];

    if (!sourceType) {
      return NextResponse.json(
        {
          error: `지원하지 않는 파일 형식입니다: ${ext || "(확장자 없음)"}. 지원 형식: .docx, .xlsx, .xls, .pptx, .pdf`,
        },
        { status: 400 }
      );
    }

    // 임시 디렉터리에 파일 저장
    const tmpId = nanoid();
    tmpDir = path.join("/tmp", `isens-${tmpId}`);
    await fs.mkdir(tmpDir, { recursive: true });

    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);
    const tmpFilePath = path.join(tmpDir, fileName);
    await fs.writeFile(tmpFilePath, fileBuffer);

    // PDF 획득
    let pdfBuffer: Buffer;

    if (sourceType === "pdf") {
      pdfBuffer = fileBuffer;
    } else {
      // Office 문서 → LibreOffice → PDF
      try {
        const pdfPath = await convertToPdf(tmpFilePath, tmpDir);
        pdfBuffer = await fs.readFile(pdfPath);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "문서 변환 중 오류가 발생했습니다";
        return NextResponse.json(
          {
            error: `LibreOffice 변환 실패: ${message}`,
          },
          { status: 500 }
        );
      }
    }

    const pdfData = new Uint8Array(pdfBuffer);
    const storagePrefix = `documents/${nanoid(12)}`;

    // 페이지 이미지 렌더링 + 텍스트 블록 추출 (병렬)
    let renderedPages, textResult;
    try {
      const passwordStr = typeof password === "string" ? password : undefined;
      [renderedPages, textResult] = await Promise.all([
        renderPdfPages(pdfData, storagePrefix, passwordStr),
        extractTextBlocks(pdfData),
      ]);
    } catch (err) {
      if (err instanceof PdfRenderError) {
        const statusCode = err.code === "PASSWORD_REQUIRED" ? 400 : 500;
        return NextResponse.json(
          { error: err.message, code: err.code },
          { status: statusCode }
        );
      }
      throw err;
    }

    const pages = renderedPages.map((p) => ({
      pageIndex: p.pageIndex,
      width: p.width,
      height: p.height,
      imageUrl: p.imageUrl,
    }));

    return NextResponse.json({
      pages,
      textBlocks: textResult.textBlocks,
      sourceType,
      fileName,
      totalPages: textResult.pageCount,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "문서 변환 중 오류가 발생했습니다";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    // 임시 파일 정리
    if (tmpDir) {
      fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
