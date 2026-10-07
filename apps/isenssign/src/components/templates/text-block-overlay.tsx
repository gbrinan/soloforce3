"use client"

import { useState, useCallback, useRef, useEffect, type MouseEvent } from "react"
import { useTranslations } from "next-intl"
import type { TextBlock } from "@/lib/text-block"
import { useEditorStore } from "@/lib/template-editor-store"
import { TextBlockToolbar } from "@/components/templates/text-block-toolbar"

const MIN_WIDTH = 30
const MIN_HEIGHT = 14

interface TextBlockOverlayProps {
  block: TextBlock
  isSelected: boolean
  isEditing: boolean
  scale: number
  onSelect: () => void
  onStartEdit: () => void
  onEndEdit: () => void
}

export function TextBlockOverlay({
  block,
  isSelected,
  isEditing,
  scale,
  onSelect,
  onStartEdit,
  onEndEdit,
}: TextBlockOverlayProps) {
  const t = useTranslations("templates")
  const { moveTextBlock, resizeTextBlock, updateTextBlock, removeTextBlock } =
    useEditorStore()
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const dragStartRef = useRef<{
    x: number
    y: number
    blockX: number
    blockY: number
  } | null>(null)
  const resizeStartRef = useRef<{
    x: number
    y: number
    blockW: number
    blockH: number
    blockX: number
    blockY: number
    corner: string
  } | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // 편집 모드 진입 시 contentEditable에 포커스
  useEffect(() => {
    if (isEditing && contentRef.current) {
      contentRef.current.focus()
      // 커서를 끝으로 이동
      const range = document.createRange()
      const sel = window.getSelection()
      range.selectNodeContents(contentRef.current)
      range.collapse(false)
      sel?.removeAllRanges()
      sel?.addRange(range)
    }
  }, [isEditing])

  // Delete 키로 선택된 블록 삭제 (편집 모드가 아닐 때)
  useEffect(() => {
    if (!isSelected || isEditing) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault()
        removeTextBlock(block.id)
      }
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [isSelected, isEditing, block.id, removeTextBlock])

  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      if (isResizing || isEditing) return
      e.stopPropagation()
      e.preventDefault()
      onSelect()
      setIsDragging(true)

      const startX = e.clientX
      const startY = e.clientY
      const blockX = block.x
      const blockY = block.y
      dragStartRef.current = { x: startX, y: startY, blockX, blockY }

      const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
        if (!dragStartRef.current) return
        const dx = (moveEvent.clientX - dragStartRef.current.x) / scale
        const dy = (moveEvent.clientY - dragStartRef.current.y) / scale
        const newX = Math.max(0, dragStartRef.current.blockX + dx)
        const newY = Math.max(0, dragStartRef.current.blockY + dy)
        moveTextBlock(block.id, { x: Math.round(newX), y: Math.round(newY) })
      }

      const handleMouseUp = () => {
        setIsDragging(false)
        dragStartRef.current = null
        window.removeEventListener("mousemove", handleMouseMove)
        window.removeEventListener("mouseup", handleMouseUp)
      }

      window.addEventListener("mousemove", handleMouseMove)
      window.addEventListener("mouseup", handleMouseUp)
    },
    [block.id, block.x, block.y, scale, isResizing, isEditing, onSelect, moveTextBlock]
  )

  const handleResizeMouseDown = useCallback(
    (corner: string) => (e: MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      setIsResizing(true)

      resizeStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        blockW: block.width,
        blockH: block.height,
        blockX: block.x,
        blockY: block.y,
        corner,
      }

      const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
        if (!resizeStartRef.current) return
        const dx = (moveEvent.clientX - resizeStartRef.current.x) / scale
        const dy = (moveEvent.clientY - resizeStartRef.current.y) / scale
        const ref = resizeStartRef.current

        let newW = ref.blockW
        let newH = ref.blockH
        let newX = ref.blockX
        let newY = ref.blockY

        if (corner.includes("right")) {
          newW = Math.max(MIN_WIDTH, ref.blockW + dx)
        }
        if (corner.includes("left")) {
          newW = Math.max(MIN_WIDTH, ref.blockW - dx)
          newX = ref.blockX + (ref.blockW - newW)
        }
        if (corner.includes("bottom")) {
          newH = Math.max(MIN_HEIGHT, ref.blockH + dy)
        }
        if (corner.includes("top")) {
          newH = Math.max(MIN_HEIGHT, ref.blockH - dy)
          newY = ref.blockY + (ref.blockH - newH)
        }

        resizeTextBlock(block.id, {
          width: Math.round(newW),
          height: Math.round(newH),
        })
        moveTextBlock(block.id, { x: Math.round(newX), y: Math.round(newY) })
      }

      const handleMouseUp = () => {
        setIsResizing(false)
        resizeStartRef.current = null
        window.removeEventListener("mousemove", handleMouseMove)
        window.removeEventListener("mouseup", handleMouseUp)
      }

      window.addEventListener("mousemove", handleMouseMove)
      window.addEventListener("mouseup", handleMouseUp)
    },
    [
      block.id,
      block.width,
      block.height,
      block.x,
      block.y,
      scale,
      moveTextBlock,
      resizeTextBlock,
    ]
  )

  const handleDoubleClick = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation()
      onStartEdit()
    },
    [onStartEdit]
  )

  const handleContentBlur = useCallback(() => {
    if (!contentRef.current) return
    const newContent = contentRef.current.innerText
    updateTextBlock(block.id, { content: newContent })
    onEndEdit()
  }, [block.id, updateTextBlock, onEndEdit])

  const handleContentKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Escape으로 편집 종료
      if (e.key === "Escape") {
        e.preventDefault()
        contentRef.current?.blur()
      }
      // 이벤트 전파 차단 (Delete 키 등이 블록 삭제를 트리거하지 않도록)
      e.stopPropagation()
    },
    []
  )

  // 스타일 구분: isOriginal → 연한 파란 테두리, 사용자 추가 → 초록 점선
  const borderClass = block.isOriginal
    ? "border border-blue-300/60"
    : "border border-dashed border-green-400/70"

  const selectionRing = isEditing
    ? "ring-2 ring-green-500"
    : isSelected
      ? "ring-2 ring-blue-500"
      : ""

  const resizeHandles = [
    { corner: "top-left", className: "-left-1 -top-1 cursor-nwse-resize" },
    { corner: "top-right", className: "-right-1 -top-1 cursor-nesw-resize" },
    { corner: "bottom-left", className: "-bottom-1 -left-1 cursor-nesw-resize" },
    { corner: "bottom-right", className: "-bottom-1 -right-1 cursor-nwse-resize" },
  ]

  return (
    <>
      {/* 선택 시 툴바 표시 */}
      {isSelected && !isEditing && (
        <TextBlockToolbar block={block} scale={scale} />
      )}

      <div
        className={`group absolute overflow-hidden ${borderClass} ${selectionRing} ${
          isDragging ? "cursor-grabbing opacity-75" : isEditing ? "cursor-text" : "cursor-grab"
        } select-none rounded-sm transition-shadow`}
        style={{
          left: block.x * scale,
          top: block.y * scale,
          width: block.width * scale,
          height: block.height * scale,
        }}
        onMouseDown={isEditing ? undefined : handleMouseDown}
        onDoubleClick={handleDoubleClick}
      >
        {/* 텍스트 내용 */}
        {isEditing ? (
          <div
            ref={contentRef}
            contentEditable
            suppressContentEditableWarning
            className="size-full outline-none"
            style={{
              fontSize: block.fontSize * scale,
              fontWeight: block.fontWeight,
              fontStyle: block.fontStyle,
              color: block.color,
              textAlign: block.textAlign,
              fontFamily: block.fontFamily,
              lineHeight: 1.4,
              padding: `${2 * scale}px`,
              overflowWrap: "break-word",
              wordBreak: "break-word",
            }}
            onBlur={handleContentBlur}
            onKeyDown={handleContentKeyDown}
          >
            {block.content}
          </div>
        ) : (
          <div
            className="pointer-events-none size-full overflow-hidden"
            style={{
              fontSize: block.fontSize * scale,
              fontWeight: block.fontWeight,
              fontStyle: block.fontStyle,
              color: block.color,
              textAlign: block.textAlign,
              fontFamily: block.fontFamily,
              lineHeight: 1.4,
              padding: `${2 * scale}px`,
              overflowWrap: "break-word",
              wordBreak: "break-word",
            }}
          >
            {block.content || (
              <span className="text-muted-foreground/40 italic">
                {t("textBlock.doubleClickToEdit")}
              </span>
            )}
          </div>
        )}

        {/* 리사이즈 핸들 */}
        {isSelected &&
          resizeHandles.map(({ corner, className }) => (
            <div
              key={corner}
              className={`absolute size-2.5 rounded-sm border border-white bg-blue-500 ${className}`}
              onMouseDown={handleResizeMouseDown(corner)}
            />
          ))}
      </div>
    </>
  )
}
