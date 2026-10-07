/**
 * 텍스트 블록 및 문서 데이터 타입 정의
 * 배경 이미지 + 텍스트 오버레이 구조
 */

export interface TextBlock {
  id: string
  pageIndex: number
  x: number // PDF 포인트 단위 (왼쪽 기준)
  y: number // PDF 포인트 단위 (위쪽 기준)
  width: number
  height: number
  content: string
  fontSize: number // pt
  fontFamily: string
  fontWeight: "normal" | "bold"
  fontStyle: "normal" | "italic"
  color: string // hex
  textAlign: "left" | "center" | "right"
  isOriginal: boolean // true = PDF에서 추출, false = 사용자 추가
}

export interface DocumentPage {
  pageIndex: number
  width: number // PDF 포인트 단위
  height: number // PDF 포인트 단위
  imageUrl: string // 페이지 PNG 이미지 URL
}

export interface TemplateDocumentData {
  version: 2
  sourceFileName: string
  sourceType: "docx" | "xlsx" | "pdf" | "gdoc" | "gsheet"
  pages: DocumentPage[]
  textBlocks: TextBlock[]
}

/**
 * 새 텍스트 블록 생성 헬퍼
 */
export function createTextBlock(
  pageIndex: number,
  x: number,
  y: number,
  overrides?: Partial<TextBlock>,
): TextBlock {
  return {
    id: `tb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    pageIndex,
    x,
    y,
    width: 150,
    height: 20,
    content: "",
    fontSize: 11,
    fontFamily: "sans-serif",
    fontWeight: "normal",
    fontStyle: "normal",
    color: "#000000",
    textAlign: "left",
    isOriginal: false,
    ...overrides,
  }
}
