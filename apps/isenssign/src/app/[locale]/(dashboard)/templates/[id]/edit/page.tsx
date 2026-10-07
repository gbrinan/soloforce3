"use client"

import { use, useCallback, useEffect, useState } from "react"
import { useRouter } from "@/i18n/navigation"
import { useTranslations } from "next-intl"
import { ArrowLeft, Save, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { TemplateEditor } from "@/components/templates/template-editor"
import { useEditorStore } from "@/lib/template-editor-store"
import type { DocumentPage, TextBlock } from "@/lib/text-block"
import { BASE_PATH } from "@/lib/api"

interface EditPageParams {
  params: Promise<{ id: string; locale: string }>
}

interface TemplateDocuments {
  version?: number
  sourceFileName?: string
  sourceType?: string
  pages?: DocumentPage[]
  textBlocks?: TextBlock[]
}

interface TemplateData {
  id: string
  name: string
  source: string
  documents: TemplateDocuments
  schema: unknown[]
  preferences: Record<string, unknown>
}

export default function TemplateEditPage({ params }: EditPageParams) {
  const { id } = use(params)
  const t = useTranslations("templates")
  const tc = useTranslations("common")
  const te = useTranslations("errors")
  const router = useRouter()
  const fields = useEditorStore((s) => s.fields)

  const [template, setTemplate] = useState<TemplateData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saveError, setSaveError] = useState("")

  // 템플릿 데이터 로드
  useEffect(() => {
    async function fetchTemplate() {
      try {
        const res = await fetch(`${BASE_PATH}/api/v1/templates/${id}`)
        const data = await res.json()
        if (res.ok && data.data) {
          const tpl = data.data as TemplateData
          setTemplate(tpl)

          const docs = tpl.documents as TemplateDocuments | undefined

          // version 2 형식만 지원 (배경 이미지 + 텍스트 오버레이)
          if (docs?.version === 2) {
            const store = useEditorStore.getState()

            // 페이지 이미지 주입
            if (docs.pages && docs.pages.length > 0) {
              store.setPageImages(docs.pages)
            }

            // 텍스트 블록 주입
            if (docs.textBlocks) {
              store.setTextBlocks(docs.textBlocks)
            }
          } else {
            // 레거시 HTML 형식 — 미지원
            setLoadError(t("legacyFormatError"))
            setIsLoading(false)
            return
          }

          // 저장된 필드 복원
          if (Array.isArray(tpl.schema) && tpl.schema.length > 0) {
            const store = useEditorStore.getState()
            store.clearFields()
            tpl.schema.forEach((f: unknown) => store.addField(f as Parameters<typeof store.addField>[0]))
          }
        } else {
          setLoadError(data.error || t("cannotLoadTemplate"))
        }
      } catch (err) {
        if (process.env.NODE_ENV === "development") console.error("템플릿 로드 실패:", err)
        setLoadError(te("networkError"))
      } finally {
        setIsLoading(false)
      }
    }

    fetchTemplate()
  }, [id])

  // 저장 핸들러 — 필드 + 텍스트 블록 + 페이지 이미지 저장
  const handleSave = useCallback(async () => {
    if (!template) return
    setIsSaving(true)
    setSaveError("")
    setSaveSuccess(false)

    const fieldConfig = fields.map((f) => ({
      id: f.id,
      type: f.type,
      name: f.name,
      required: f.required,
      signerRole: f.signerRole,
      position: f.position,
      defaultValue: f.defaultValue,
    }))

    try {
      const store = useEditorStore.getState()
      const res = await fetch(`${BASE_PATH}/api/v1/templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schema: fieldConfig,
          documents: {
            ...template.documents,
            textBlocks: store.textBlocks,
            pages: store.pageImages,
          },
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setSaveSuccess(true)
        setTimeout(() => setSaveSuccess(false), 3000)
      } else {
        setSaveError(data.error || t("saveFailed"))
      }
    } catch (err) {
      if (process.env.NODE_ENV === "development") console.error("저장 실패:", err)
      setSaveError(te("networkError"))
    } finally {
      setIsSaving(false)
    }
  }, [id, template, fields])

  // 로딩 상태
  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // 에러 상태
  if (loadError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <p className="text-sm text-destructive">{loadError}</p>
        <Button variant="outline" onClick={() => router.back()}>
          {t("goBack")}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.back()}
          >
            <ArrowLeft className="size-4" />
            {tc("back")}
          </Button>
          <div className="h-5 w-px bg-border" />
          <div>
            <h1 className="text-lg font-semibold">{template?.name ?? t("title")}</h1>
            <p className="text-xs text-muted-foreground">
              {t("editTemplate")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {saveError && (
            <span className="text-sm text-destructive">{saveError}</span>
          )}
          {saveSuccess && (
            <span className="text-sm text-green-600">{t("saveComplete")}</span>
          )}
          <Button size="sm" disabled={isSaving} onClick={handleSave}>
            {isSaving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t("saving")}
              </>
            ) : (
              <>
                <Save className="size-4" />
                {t("save")}
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 p-4">
        <TemplateEditor
          templateId={id}
          templateName={template?.name ?? t("title")}
        />
      </div>
    </div>
  )
}
