/**
 * PDF 처리 라이브러리
 * - PDF 업로드 및 파싱
 * - 서명 필드 배치
 * - 서명된 PDF 생성
 */
import { PDFDocument, PDFPage, rgb, StandardFonts } from "pdf-lib";

// ============================================
// Types
// ============================================

export interface FieldPosition {
  x: number;
  y: number;
  width: number;
  height: number;
  page: number;
}

export interface TemplateField {
  id: string;
  type: "signature" | "text" | "date" | "checkbox" | "initials" | "stamp";
  name: string;
  required: boolean;
  signerRole: string;
  position: FieldPosition;
  defaultValue?: string;
  placeholder?: string;
}

export interface SignedFieldValue {
  fieldId: string;
  value: string; // text value or base64 image for signatures
  type: TemplateField["type"];
}

// ============================================
// PDF Operations
// ============================================

/**
 * PDF 파일에서 메타데이터 추출
 */
export async function extractPdfMetadata(pdfBytes: Uint8Array) {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  return {
    pageCount: pdfDoc.getPageCount(),
    title: pdfDoc.getTitle() ?? "",
    author: pdfDoc.getAuthor() ?? "",
    pages: Array.from({ length: pdfDoc.getPageCount() }, (_, i) => {
      const page = pdfDoc.getPage(i);
      const { width, height } = page.getSize();
      return { index: i, width, height };
    }),
  };
}

/**
 * PDF 페이지를 이미지(PNG)로 변환하기 위한 데이터 추출
 * 실제 렌더링은 클라이언트(pdfjs-dist)에서 수행
 */
export async function getPdfPageCount(pdfBytes: Uint8Array): Promise<number> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  return pdfDoc.getPageCount();
}

/**
 * 서명된 필드 값을 PDF에 적용하여 최종 문서 생성
 */
export async function generateSignedPdf(
  originalPdfBytes: Uint8Array,
  fields: TemplateField[],
  values: SignedFieldValue[]
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(originalPdfBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const valueMap = new Map(values.map((v) => [v.fieldId, v]));

  for (const field of fields) {
    const value = valueMap.get(field.id);
    if (!value) continue;

    const page = pdfDoc.getPage(field.position.page);
    const { height: pageHeight } = page.getSize();

    // PDF 좌표계는 좌하단 기준 → 변환
    const pdfY =
      pageHeight - field.position.y - field.position.height;

    switch (field.type) {
      case "signature":
      case "initials":
      case "stamp":
        await embedImageField(pdfDoc, page, value.value, {
          x: field.position.x,
          y: pdfY,
          width: field.position.width,
          height: field.position.height,
        });
        break;

      case "text":
      case "date":
        page.drawText(value.value, {
          x: field.position.x + 4,
          y: pdfY + field.position.height / 2 - 5,
          size: 11,
          font,
          color: rgb(0, 0, 0),
          maxWidth: field.position.width - 8,
        });
        break;

      case "checkbox":
        if (value.value === "true") {
          // 체크마크 그리기
          page.drawText("✓", {
            x: field.position.x + 2,
            y: pdfY + 2,
            size: field.position.height - 4,
            font,
            color: rgb(0, 0, 0),
          });
        }
        break;
    }
  }

  // 서명 타임스탬프 메타데이터 추가
  pdfDoc.setModificationDate(new Date());
  pdfDoc.setProducer("MySign v1.0");

  return pdfDoc.save();
}

/**
 * Base64 이미지를 PDF 페이지에 임베드
 */
async function embedImageField(
  pdfDoc: PDFDocument,
  page: PDFPage,
  base64Data: string,
  position: { x: number; y: number; width: number; height: number }
) {
  try {
    // data:image/png;base64,... 형식에서 순수 base64 추출
    const rawBase64 = base64Data.includes(",")
      ? base64Data.split(",")[1]
      : base64Data;
    const imageBytes = Uint8Array.from(atob(rawBase64), (c) =>
      c.charCodeAt(0)
    );

    let image;
    if (base64Data.includes("image/png")) {
      image = await pdfDoc.embedPng(imageBytes);
    } else {
      image = await pdfDoc.embedJpg(imageBytes);
    }

    // 이미지 비율 유지하며 필드 영역에 맞춤
    const scaledDims = image.scaleToFit(position.width, position.height);

    page.drawImage(image, {
      x: position.x + (position.width - scaledDims.width) / 2,
      y: position.y + (position.height - scaledDims.height) / 2,
      width: scaledDims.width,
      height: scaledDims.height,
    });
  } catch (error) {
    console.error("이미지 임베드 실패:", error);
  }
}

/**
 * 서명 감사 페이지(Signing Certificate) 생성 후 PDF에 추가
 */
export async function appendAuditPage(
  pdfBytes: Uint8Array,
  auditInfo: {
    documentName: string;
    documentId: string;
    signers: Array<{
      name: string;
      email: string;
      signedAt: string;
      ipAddress: string;
      verificationMethod?: string;
    }>;
  }
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const page = pdfDoc.addPage([595, 842]); // A4
  let y = 790;

  // 제목
  page.drawText("서명 인증서 (Signing Certificate)", {
    x: 50,
    y,
    size: 18,
    font: boldFont,
    color: rgb(0, 0, 0),
  });
  y -= 35;

  // 문서 정보
  page.drawText(`문서명: ${auditInfo.documentName}`, {
    x: 50,
    y,
    size: 11,
    font,
  });
  y -= 18;
  page.drawText(`문서 ID: ${auditInfo.documentId}`, {
    x: 50,
    y,
    size: 11,
    font,
  });
  y -= 30;

  // 서명자 정보
  page.drawText("서명자 정보", {
    x: 50,
    y,
    size: 14,
    font: boldFont,
  });
  y -= 25;

  for (const signer of auditInfo.signers) {
    page.drawText(`이름: ${signer.name}`, { x: 70, y, size: 10, font });
    y -= 16;
    page.drawText(`이메일: ${signer.email}`, { x: 70, y, size: 10, font });
    y -= 16;
    page.drawText(`서명일시: ${signer.signedAt}`, {
      x: 70,
      y,
      size: 10,
      font,
    });
    y -= 16;
    page.drawText(`IP 주소: ${signer.ipAddress}`, {
      x: 70,
      y,
      size: 10,
      font,
    });
    y -= 16;
    if (signer.verificationMethod) {
      page.drawText(`본인인증: ${signer.verificationMethod}`, {
        x: 70,
        y,
        size: 10,
        font,
      });
      y -= 16;
    }
    y -= 10;
  }

  y -= 20;
  page.drawText(
    `이 문서는 MySign 전자서명 플랫폼을 통해 서명되었습니다.`,
    { x: 50, y, size: 9, font, color: rgb(0.4, 0.4, 0.4) }
  );
  y -= 14;
  page.drawText(`생성일시: ${new Date().toISOString()}`, {
    x: 50,
    y,
    size: 9,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });

  return pdfDoc.save();
}
