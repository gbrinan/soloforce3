"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { FileText, ZoomIn, ZoomOut, Maximize2 } from "lucide-react"
import { useEditorStore } from "@/lib/template-editor-store"
import { PageImageCanvas } from "@/components/templates/page-image-canvas"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"

/** A4 base dimensions in points */
const PAGE_WIDTH = 595
const PAGE_HEIGHT = 842

const ZOOM_MIN = 50
const ZOOM_MAX = 200
const ZOOM_STEP = 10
const ZOOM_DEFAULT = 85

interface PdfCanvasProps {
  scale?: number
}

export function PdfCanvas({ scale: externalScale }: PdfCanvasProps) {
  const t = useTranslations("templates")
  const pageImages = useEditorStore((s) => s.pageImages)
  const textBlocks = useEditorStore((s) => s.textBlocks)
  const fields = useEditorStore((s) => s.fields)
  const selectedFieldId = useEditorStore((s) => s.selectedFieldId)
  const selectedTextBlockId = useEditorStore((s) => s.selectedTextBlockId)

  const [zoom, setZoom] = useState(
    externalScale ? Math.round(externalScale * 100) : ZOOM_DEFAULT
  )
  const scrollRef = useRef<HTMLDivElement>(null)

  // 편집 중인 텍스트 블록 ID (로컬 상태)
  const [editingTextBlockId, setEditingTextBlockId] = useState<string | null>(
    null
  )

  const handleStartEditTextBlock = useCallback((id: string) => {
    setEditingTextBlockId(id)
  }, [])

  const handleEndEditTextBlock = useCallback(() => {
    setEditingTextBlockId(null)
  }, [])

  const pageCount = pageImages.length
  const hasPages = pageCount > 0

  // Zoom handlers
  const clampZoom = useCallback(
    (v: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v)),
    []
  )
  const handleZoomIn = useCallback(
    () => setZoom((z) => clampZoom(z + ZOOM_STEP)),
    [clampZoom]
  )
  const handleZoomOut = useCallback(
    () => setZoom((z) => clampZoom(z - ZOOM_STEP)),
    [clampZoom]
  )
  const handleZoomReset = useCallback(() => setZoom(ZOOM_DEFAULT), [])
  const handleFitToWidth = useCallback(() => {
    const container = scrollRef.current
    if (!container || !hasPages) return
    const available = container.clientWidth - 64
    // 첫 페이지 너비 기준으로 맞춤
    const pageWidth = pageImages[0].width
    const fit = Math.round((available / pageWidth) * 100)
    setZoom(clampZoom(fit))
  }, [clampZoom, hasPages, pageImages])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (e.key === "=" || e.key === "+") {
        e.preventDefault()
        handleZoomIn()
      } else if (e.key === "-") {
        e.preventDefault()
        handleZoomOut()
      } else if (e.key === "0") {
        e.preventDefault()
        handleZoomReset()
      }
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [handleZoomIn, handleZoomOut, handleZoomReset])

  const effectiveScale = externalScale ?? zoom / 100

  return (
    <div className="flex flex-1 flex-col bg-muted/30">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b bg-background px-4 py-2">
        <span className="text-sm font-medium">{t("documentEditor")}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t("editorStats", {
              pages: pageCount,
              fields: fields.length,
              texts: textBlocks.length,
            })}
          </span>

          {/* Zoom controls (only when no external scale) */}
          {!externalScale && (
            <>
              <Separator orientation="vertical" className="mx-1 h-5" />
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleZoomOut}
                title={t("zoomOutTitle")}
              >
                <ZoomOut className="size-4" />
              </Button>
              <button
                type="button"
                onClick={handleZoomReset}
                title={t("zoomResetTitle")}
                className="h-7 min-w-[3rem] rounded-md px-3 text-center text-xs font-medium text-muted-foreground tabular-nums hover:bg-muted hover:text-foreground"
              >
                {zoom}%
              </button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleZoomIn}
                title={t("zoomInTitle")}
              >
                <ZoomIn className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleFitToWidth}
                title={t("fitToWidth")}
              >
                <Maximize2 className="size-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Scrollable canvas area */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        {hasPages ? (
          <div className="flex flex-col items-center gap-6 p-8">
            {pageImages.map((page, i) => (
              <div key={page.pageIndex} className="flex flex-col items-center gap-1">
                <PageImageCanvas
                  pageIndex={page.pageIndex}
                  pageImage={page}
                  textBlocks={textBlocks}
                  fields={fields}
                  selectedFieldId={selectedFieldId}
                  selectedTextBlockId={selectedTextBlockId}
                  editingTextBlockId={editingTextBlockId}
                  scale={effectiveScale}
                  onStartEditTextBlock={handleStartEditTextBlock}
                  onEndEditTextBlock={handleEndEditTextBlock}
                />
                <span className="text-xs text-muted-foreground">
                  {t("pageProgress", { current: page.pageIndex + 1, total: pageCount })}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
            <FileText className="size-16 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground/60">
              {t("loadingDocument")}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export { PAGE_WIDTH, PAGE_HEIGHT }
