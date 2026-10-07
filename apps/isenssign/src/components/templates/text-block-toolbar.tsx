"use client"

import { useCallback } from "react"
import { useTranslations } from "next-intl"
import {
  Bold,
  Italic,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Trash2,
} from "lucide-react"
import type { TextBlock } from "@/lib/text-block"
import { useEditorStore } from "@/lib/template-editor-store"
import { Button } from "@/components/ui/button"

interface TextBlockToolbarProps {
  block: TextBlock
  scale: number
}

export function TextBlockToolbar({ block, scale }: TextBlockToolbarProps) {
  const t = useTranslations("templates")
  const tc = useTranslations("common")
  const { updateTextBlock, removeTextBlock } = useEditorStore()

  const handleFontSizeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = parseInt(e.target.value, 10)
      if (!isNaN(val) && val >= 6 && val <= 72) {
        updateTextBlock(block.id, { fontSize: val })
      }
    },
    [block.id, updateTextBlock]
  )

  const toggleBold = useCallback(() => {
    updateTextBlock(block.id, {
      fontWeight: block.fontWeight === "bold" ? "normal" : "bold",
    })
  }, [block.id, block.fontWeight, updateTextBlock])

  const toggleItalic = useCallback(() => {
    updateTextBlock(block.id, {
      fontStyle: block.fontStyle === "italic" ? "normal" : "italic",
    })
  }, [block.id, block.fontStyle, updateTextBlock])

  const handleColorChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      updateTextBlock(block.id, { color: e.target.value })
    },
    [block.id, updateTextBlock]
  )

  const setAlign = useCallback(
    (align: TextBlock["textAlign"]) => {
      updateTextBlock(block.id, { textAlign: align })
    },
    [block.id, updateTextBlock]
  )

  const handleDelete = useCallback(() => {
    removeTextBlock(block.id)
  }, [block.id, removeTextBlock])

  // 툴바를 블록 위에 배치
  const toolbarTop = block.y * scale - 36
  const toolbarLeft = block.x * scale

  return (
    <div
      className="absolute z-50 flex items-center gap-0.5 rounded-md border bg-background px-1 py-0.5 shadow-md"
      style={{
        left: Math.max(0, toolbarLeft),
        top: Math.max(0, toolbarTop),
      }}
      // 마우스 이벤트가 캔버스로 전파되지 않도록
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* 폰트 크기 */}
      <input
        type="number"
        min={6}
        max={72}
        value={block.fontSize}
        onChange={handleFontSizeChange}
        className="h-6 w-10 rounded border bg-transparent px-1 text-center text-xs tabular-nums outline-none focus:border-blue-400"
        title={t("textBlock.fontSize")}
      />

      <div className="mx-0.5 h-4 w-px bg-border" />

      {/* 굵게 */}
      <Button
        variant={block.fontWeight === "bold" ? "secondary" : "ghost"}
        size="icon-xs"
        onClick={toggleBold}
        title={t("textBlock.bold")}
      >
        <Bold className="size-3" />
      </Button>

      {/* 기울임 */}
      <Button
        variant={block.fontStyle === "italic" ? "secondary" : "ghost"}
        size="icon-xs"
        onClick={toggleItalic}
        title={t("textBlock.italic")}
      >
        <Italic className="size-3" />
      </Button>

      <div className="mx-0.5 h-4 w-px bg-border" />

      {/* 색상 */}
      <input
        type="color"
        value={block.color}
        onChange={handleColorChange}
        className="size-5 cursor-pointer rounded border-none bg-transparent p-0"
        title={t("textBlock.textColor")}
      />

      <div className="mx-0.5 h-4 w-px bg-border" />

      {/* 정렬 */}
      <Button
        variant={block.textAlign === "left" ? "secondary" : "ghost"}
        size="icon-xs"
        onClick={() => setAlign("left")}
        title={t("textBlock.alignLeft")}
      >
        <AlignLeft className="size-3" />
      </Button>
      <Button
        variant={block.textAlign === "center" ? "secondary" : "ghost"}
        size="icon-xs"
        onClick={() => setAlign("center")}
        title={t("textBlock.alignCenter")}
      >
        <AlignCenter className="size-3" />
      </Button>
      <Button
        variant={block.textAlign === "right" ? "secondary" : "ghost"}
        size="icon-xs"
        onClick={() => setAlign("right")}
        title={t("textBlock.alignRight")}
      >
        <AlignRight className="size-3" />
      </Button>

      <div className="mx-0.5 h-4 w-px bg-border" />

      {/* 삭제 */}
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={handleDelete}
        title={tc("delete")}
        className="text-destructive hover:text-destructive"
      >
        <Trash2 className="size-3" />
      </Button>
    </div>
  )
}
