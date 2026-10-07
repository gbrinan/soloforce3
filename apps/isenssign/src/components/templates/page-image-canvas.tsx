"use client"

import { useCallback, type MouseEvent } from "react"
import { useTranslations } from "next-intl"
import { useDroppable } from "@dnd-kit/core"
import type { TemplateField } from "@/lib/pdf"
import type { TextBlock, DocumentPage } from "@/lib/text-block"
import { createTextBlock } from "@/lib/text-block"
import { BASE_PATH } from "@/lib/api"
import { FieldOverlay } from "@/components/templates/field-overlay"
import { TextBlockOverlay } from "@/components/templates/text-block-overlay"
import { useEditorStore } from "@/lib/template-editor-store"

interface PageImageCanvasProps {
  pageIndex: number
  pageImage: DocumentPage
  textBlocks: TextBlock[]
  fields: TemplateField[]
  selectedFieldId: string | null
  selectedTextBlockId: string | null
  editingTextBlockId: string | null
  scale: number
  onStartEditTextBlock: (id: string) => void
  onEndEditTextBlock: () => void
}

export function PageImageCanvas({
  pageIndex,
  pageImage,
  textBlocks,
  fields,
  selectedFieldId,
  selectedTextBlockId,
  editingTextBlockId,
  scale,
  onStartEditTextBlock,
  onEndEditTextBlock,
}: PageImageCanvasProps) {
  const t = useTranslations("templates")
  const { setNodeRef, isOver } = useDroppable({
    id: `page-${pageIndex}`,
    data: { type: "page", pageIndex },
  })

  const selectField = useEditorStore((s) => s.selectField)
  const selectTextBlock = useEditorStore((s) => s.selectTextBlock)
  const addTextBlock = useEditorStore((s) => s.addTextBlock)

  // 빈 영역 클릭 → 모든 선택 해제
  const handleCanvasClick = useCallback(
    (e: MouseEvent) => {
      // 자식 요소에서 전파된 클릭은 무시
      if (e.target !== e.currentTarget) return
      selectField(null)
      selectTextBlock(null)
      onEndEditTextBlock()
    },
    [selectField, selectTextBlock, onEndEditTextBlock]
  )

  // 빈 영역 더블클릭 → 새 텍스트 블록 생성
  const handleCanvasDoubleClick = useCallback(
    (e: MouseEvent) => {
      if (e.target !== e.currentTarget) return
      const rect = e.currentTarget.getBoundingClientRect()
      const x = (e.clientX - rect.left) / scale
      const y = (e.clientY - rect.top) / scale
      const newBlock = createTextBlock(pageIndex, Math.round(x), Math.round(y))
      addTextBlock(newBlock)
    },
    [pageIndex, scale, addTextBlock]
  )

  // 사용자가 추가한 텍스트 블록만 표시 (원본 텍스트는 배경 이미지에 이미 포함됨)
  const pageTextBlocks = textBlocks.filter(
    (b) => b.pageIndex === pageIndex && !b.isOriginal,
  )
  const pageFields = fields.filter((f) => f.position.page === pageIndex)

  return (
    <div
      ref={setNodeRef}
      className={`relative mx-auto overflow-hidden rounded-sm border bg-white shadow-sm ${
        isOver ? "ring-2 ring-blue-400 ring-offset-2" : ""
      }`}
      style={{
        width: pageImage.width * scale,
        height: pageImage.height * scale,
      }}
      onClick={handleCanvasClick}
      onDoubleClick={handleCanvasDoubleClick}
    >
      {/* 배경 이미지 */}
      <img
        src={`${BASE_PATH}${pageImage.imageUrl}`}
        alt={t("pageNumber", { page: pageIndex + 1 })}
        className="pointer-events-none absolute inset-0 size-full"
        draggable={false}
      />

      {/* 텍스트 블록 오버레이 */}
      {pageTextBlocks.map((block) => (
        <TextBlockOverlay
          key={block.id}
          block={block}
          isSelected={selectedTextBlockId === block.id}
          isEditing={editingTextBlockId === block.id}
          scale={scale}
          onSelect={() => selectTextBlock(block.id)}
          onStartEdit={() => onStartEditTextBlock(block.id)}
          onEndEdit={onEndEditTextBlock}
        />
      ))}

      {/* 필드 오버레이 (기존) */}
      {pageFields.map((field) => (
        <FieldOverlay
          key={field.id}
          field={field}
          isSelected={selectedFieldId === field.id}
          scale={scale}
        />
      ))}
    </div>
  )
}
