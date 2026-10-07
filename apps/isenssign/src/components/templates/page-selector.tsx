"use client"

import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Check, FileText, Loader2 } from "lucide-react"
import DOMPurify from "dompurify"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"

// 문서 변환 결과 HTML은 신뢰할 수 없는 입력이므로 렌더 전 반드시 살균한다 (저장형 XSS 방지).
function sanitizeHtml(html: string): string {
  if (typeof window === "undefined") return ""
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
}

export interface PageData {
  index: number
  name: string
  html: string
}

export interface PageSelectorProps {
  pages?: PageData[]
  pdfDataUri?: string
  pdfTotalPages?: number
  sourceType: "docx" | "xlsx" | "gdoc" | "gsheet" | "pdf"
  onSelectionChange: (selectedPages: number[]) => void
  onConfirm: (combinedHtml: string) => void
}

export function PageSelector({
  pages,
  pdfDataUri,
  pdfTotalPages,
  sourceType,
  onSelectionChange,
  onConfirm,
}: PageSelectorProps) {
  const t = useTranslations("templates")
  const tc = useTranslations("common")
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [thumbnails, setThumbnails] = useState<Map<number, string>>(new Map())
  const [isLoadingPdf, setIsLoadingPdf] = useState(false)
  const [pdfDoc, setPdfDoc] = useState<any>(null)

  const isExcel = sourceType === "xlsx" || sourceType === "gsheet"
  const isPdf = sourceType === "pdf"
  const isWord = sourceType === "docx" || sourceType === "gdoc"
  const totalItems = isPdf ? (pdfTotalPages || 0) : (pages?.length || 0)

  // Auto-select all for Word (single page) or if only one page
  useEffect(() => {
    if (isWord && pages?.length === 1) {
      setSelected(new Set([0]))
    }
  }, [isWord, pages])

  // Load PDF thumbnails
  useEffect(() => {
    if (!isPdf || !pdfDataUri) return
    let cancelled = false

    async function loadPdf() {
      setIsLoadingPdf(true)
      try {
        const pdfjsLib = await import("pdfjs-dist")
        pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`

        const doc = await pdfjsLib.getDocument(pdfDataUri).promise
        if (cancelled) return
        setPdfDoc(doc)

        const thumbs = new Map<number, string>()
        for (let i = 0; i < doc.numPages; i++) {
          if (cancelled) break
          const page = await doc.getPage(i + 1)
          const viewport = page.getViewport({ scale: 0.4 })
          const canvas = document.createElement("canvas")
          canvas.width = viewport.width
          canvas.height = viewport.height
          const ctx = canvas.getContext("2d")!
          await page.render({ canvasContext: ctx, viewport } as any).promise
          thumbs.set(i, canvas.toDataURL("image/jpeg", 0.7))
        }
        if (!cancelled) setThumbnails(thumbs)
      } catch (err) {
        console.error("PDF 로드 실패:", err)
      } finally {
        if (!cancelled) setIsLoadingPdf(false)
      }
    }

    loadPdf()
    return () => { cancelled = true }
  }, [isPdf, pdfDataUri])

  const togglePage = useCallback((index: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      onSelectionChange(Array.from(next).sort())
      return next
    })
  }, [onSelectionChange])

  const selectAll = useCallback(() => {
    const all = new Set(Array.from({ length: totalItems }, (_, i) => i))
    setSelected(all)
    onSelectionChange(Array.from(all))
  }, [totalItems, onSelectionChange])

  const deselectAll = useCallback(() => {
    setSelected(new Set())
    onSelectionChange([])
  }, [onSelectionChange])

  const handleConfirm = useCallback(async () => {
    if (selected.size === 0) return

    if (isPdf && pdfDoc) {
      // Render selected PDF pages as images
      const htmlParts: string[] = []
      const sortedPages = Array.from(selected).sort()
      for (const pageIdx of sortedPages) {
        const page = await pdfDoc.getPage(pageIdx + 1)
        const viewport = page.getViewport({ scale: 2 })
        const canvas = document.createElement("canvas")
        canvas.width = viewport.width
        canvas.height = viewport.height
        const ctx = canvas.getContext("2d")!
        await page.render({ canvasContext: ctx, viewport } as any).promise
        const imgDataUrl = canvas.toDataURL("image/png")
        htmlParts.push(
          `<img src="${imgDataUrl}" alt="Page ${pageIdx + 1}" style="width:100%;max-width:794px;display:block;margin:0 auto 16px;" />`
        )
      }
      onConfirm(htmlParts.join("\n"))
    } else if (pages) {
      // Combine selected pages' HTML
      const sortedPages = Array.from(selected).sort()
      const combinedHtml = sortedPages
        .map(i => pages[i]?.html || "")
        .filter(Boolean)
        .join("\n<hr style='margin:24px 0;border:none;border-top:1px solid #DFE1E5;' />\n")
      onConfirm(combinedHtml)
    }
  }, [selected, isPdf, pdfDoc, pages, onConfirm])

  // Loading state for PDF
  if (isPdf && isLoadingPdf) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t("loadingPdf")}</p>
      </div>
    )
  }

  // Word single page - auto confirm
  if (isWord && pages?.length === 1) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {t("wordSinglePage")}
        </p>
        <div className="max-h-[400px] overflow-auto rounded-lg border bg-white p-6">
          <div className="text-black" style={{ colorScheme: "light" }} dangerouslySetInnerHTML={{ __html: sanitizeHtml(pages[0].html) }} />
        </div>
        <div className="flex justify-end">
          <Button onClick={() => onConfirm(pages[0].html)}>
            {tc("confirm")}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={selectAll}>
            {t("selectAll")}
          </Button>
          <Button variant="outline" size="sm" onClick={deselectAll}>
            {t("deselectAll")}
          </Button>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">
            {t("nSelected", { count: selected.size })}
          </span>
          <Button
            size="sm"
            disabled={selected.size === 0}
            onClick={handleConfirm}
          >
            {t("confirmSelection")}
          </Button>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {isPdf
          ? // PDF pages
            Array.from({ length: pdfTotalPages || 0 }, (_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => togglePage(i)}
                className={`group relative flex flex-col overflow-hidden rounded-lg border-2 transition-all ${
                  selected.has(i)
                    ? "border-primary ring-2 ring-primary/20 bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
              >
                {/* Checkbox overlay */}
                <div className="absolute left-2 top-2 z-10">
                  <div
                    className={`flex size-5 items-center justify-center rounded border ${
                      selected.has(i)
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-muted-foreground/30 bg-background"
                    }`}
                  >
                    {selected.has(i) && <Check className="size-3" />}
                  </div>
                </div>
                {/* Thumbnail */}
                <div className="flex aspect-[3/4] items-center justify-center bg-white">
                  {thumbnails.has(i) ? (
                    <img
                      src={thumbnails.get(i)}
                      alt={`Page ${i + 1}`}
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <FileText className="size-8 text-muted-foreground/30" />
                  )}
                </div>
                {/* Label */}
                <div className="border-t px-2 py-1.5 text-center text-xs font-medium">
                  {t("pageNumber", { page: i + 1 })}
                </div>
              </button>
            ))
          : // Excel/Office pages
            pages?.map((page) => (
              <button
                key={page.index}
                type="button"
                onClick={() => togglePage(page.index)}
                className={`group relative flex flex-col overflow-hidden rounded-lg border-2 transition-all ${
                  selected.has(page.index)
                    ? "border-primary ring-2 ring-primary/20 bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
              >
                {/* Checkbox overlay */}
                <div className="absolute left-2 top-2 z-10">
                  <div
                    className={`flex size-5 items-center justify-center rounded border ${
                      selected.has(page.index)
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-muted-foreground/30 bg-background"
                    }`}
                  >
                    {selected.has(page.index) && <Check className="size-3" />}
                  </div>
                </div>
                {/* HTML thumbnail */}
                <div className="relative aspect-[3/4] overflow-hidden bg-white">
                  <div
                    className="pointer-events-none origin-top-left scale-[0.25] p-3 text-black"
                    style={{ width: "400%", colorScheme: "light" }}
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(page.html) }}
                  />
                </div>
                {/* Label */}
                <div className="border-t px-2 py-1.5 text-center text-xs font-medium truncate">
                  {page.name}
                </div>
              </button>
            ))}
      </div>
    </div>
  )
}
