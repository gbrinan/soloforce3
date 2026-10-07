"use client"

import { useState, useCallback, useEffect } from "react"
import { useRouter } from "@/i18n/navigation"
import { useTranslations } from "next-intl"
import { Upload, FileUp, Check, Loader2, FolderPlus, FolderOpen, Lock } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { TemplateEditor } from "@/components/templates/template-editor"
import { useEditorStore } from "@/lib/template-editor-store"
import { BASE_PATH } from "@/lib/api"
import type { DocumentPage, TextBlock } from "@/lib/text-block"

// BASE_PATH prefix for img src (storage.getUrl returns relative path without basePath)
const prefixImageUrl = (url: string) => `${BASE_PATH}${url}`

const ACCEPTED_EXTENSIONS = ".pdf"
const ACCEPTED_MIME_TYPES = ["application/pdf"]

function isAcceptedFile(file: File): boolean {
  if (ACCEPTED_MIME_TYPES.includes(file.type)) return true
  const ext = file.name.split(".").pop()?.toLowerCase()
  return ext === "pdf"
}

function stripExtension(filename: string): string {
  return filename.replace(/\.pdf$/i, "")
}

// --- Step indicator ---

interface StepIndicatorProps {
  currentStep: number
  labels: string[]
}

function StepIndicator({ currentStep, labels }: StepIndicatorProps) {
  return (
    <div className="flex items-center justify-center gap-2">
      {labels.map((label, i) => {
        const stepNum = i + 1
        const isActive = stepNum === currentStep
        const isCompleted = stepNum < currentStep
        return (
          <div key={stepNum} className="flex items-center gap-2">
            {i > 0 && (
              <div
                className={`h-px w-8 ${
                  isCompleted ? "bg-primary" : "bg-muted-foreground/25"
                }`}
              />
            )}
            <div className="flex items-center gap-2">
              <div
                className={`flex size-8 items-center justify-center rounded-full text-sm font-medium ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : isCompleted
                      ? "bg-primary/20 text-primary"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {isCompleted ? <Check className="size-4" /> : stepNum}
              </div>
              <span
                className={`hidden text-sm sm:inline ${
                  isActive
                    ? "font-medium text-foreground"
                    : "text-muted-foreground"
                }`}
              >
                {label}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// --- Main page ---
// Upload(1) → Page Selection(2) → Field Editor(3)

export default function NewTemplatePage() {
  const router = useRouter()
  const t = useTranslations("templates")
  const tc = useTranslations("common")
  const te = useTranslations("errors")

  const [step, setStep] = useState(1)
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState("")
  const [folder, setFolder] = useState("")
  const [password, setPassword] = useState("")
  const [requiresPassword, setRequiresPassword] = useState(false)

  // 변환 결과 (페이지 이미지 + 텍스트 블록)
  const [apiPages, setApiPages] = useState<DocumentPage[]>([])
  const [apiTextBlocks, setApiTextBlocks] = useState<TextBlock[]>([])
  const [sourceType, setSourceType] = useState<string>("pdf")
  const [sourceFileName, setSourceFileName] = useState("")

  // 페이지 선택 모드
  const [selectionMode, setSelectionMode] = useState<"all" | "select">("all")
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set())

  const [isConverting, setIsConverting] = useState(false)
  const [convertError, setConvertError] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState("")
  const [isDragOver, setIsDragOver] = useState(false)
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([])
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState("")
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)

  const stepLabels = [t("uploadDocument"), t("selectPages"), t("editor")]

  // 폴더 목록 가져오기
  useEffect(() => {
    async function loadFolders() {
      try {
        const res = await fetch(`${BASE_PATH}/api/v1/folders`)
        const json = await res.json()
        if (res.ok && json.data) {
          setFolders(json.data)
        }
      } catch {
        // 폴더 로드 실패 시 무시 (선택 사항이므로)
      }
    }
    loadFolders()
  }, [])

  // 새 폴더 생성
  const handleCreateFolder = useCallback(async () => {
    if (!newFolderName.trim() || isCreatingFolder) return
    setIsCreatingFolder(true)
    try {
      const res = await fetch(`${BASE_PATH}/api/v1/folders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newFolderName.trim() }),
      })
      const json = await res.json()
      if (res.ok && json.data) {
        setFolders((prev) => [...prev, json.data])
        setFolder(json.data.id)
        setNewFolderName("")
        setShowNewFolder(false)
      }
    } catch {
      // 폴더 생성 실패
    } finally {
      setIsCreatingFolder(false)
    }
  }, [newFolderName, isCreatingFolder])

  // --- Drag & drop / file select ---

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)
      const droppedFile = e.dataTransfer.files[0]
      if (droppedFile && isAcceptedFile(droppedFile)) {
        setFile(droppedFile)
        if (!name) {
          setName(stripExtension(droppedFile.name))
        }
      }
    },
    [name],
  )

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFile = e.target.files?.[0]
      if (selectedFile && isAcceptedFile(selectedFile)) {
        setFile(selectedFile)
        if (!name) {
          setName(stripExtension(selectedFile.name))
        }
      }
    },
    [name],
  )

  // --- Upload PDF (Step 1 → Step 2) ---

  const handleUpload = useCallback(async () => {
    if (!file) return
    setIsConverting(true)
    setConvertError("")

    try {
      const formData = new FormData()
      formData.append("file", file)
      if (password) {
        formData.append("password", password)
      }
      const res = await fetch(`${BASE_PATH}/api/v1/documents/convert`, {
        method: "POST",
        body: formData,
      })
      const data = await res.json()
      if (res.ok) {
        setApiPages(data.pages || [])
        setApiTextBlocks(data.textBlocks || [])
        setSourceType(data.sourceType || "pdf")
        setSourceFileName(data.fileName || file.name)
        // 전체 페이지 선택 초기화
        const allIndices = new Set(
          (data.pages as DocumentPage[]).map((p: DocumentPage) => p.pageIndex),
        )
        setSelectedPages(allIndices)
        setSelectionMode("all")
        setRequiresPassword(false)
        setPassword("")
        setStep(2)
      } else {
        // PASSWORD_REQUIRED 체크
        if (data.code === "PASSWORD_REQUIRED") {
          setRequiresPassword(true)
          setConvertError(data.error || t("passwordRequired"))
        } else if (data.code === "INCORRECT_PASSWORD") {
          setRequiresPassword(true)
          setConvertError(t("incorrectPassword"))
        } else {
          setConvertError(data.error || t("pdfProcessFailed"))
        }
      }
    } catch (err) {
      console.error("업로드 실패:", err)
      setConvertError(te("networkError"))
    } finally {
      setIsConverting(false)
    }
  }, [file, password])

  // --- Page selection helpers ---

  const togglePage = useCallback((pageIndex: number) => {
    setSelectedPages((prev) => {
      const next = new Set(prev)
      if (next.has(pageIndex)) {
        next.delete(pageIndex)
      } else {
        next.add(pageIndex)
      }
      return next
    })
  }, [])

  const selectAllPages = useCallback(() => {
    setSelectedPages(new Set(apiPages.map((p) => p.pageIndex)))
  }, [apiPages])

  const deselectAllPages = useCallback(() => {
    setSelectedPages(new Set())
  }, [])

  // --- Page Selection → Field Editor (Step 2 → Step 3) ---

  const handleProceedToEditor = useCallback(() => {
    const pagesToUse =
      selectionMode === "all"
        ? apiPages
        : apiPages.filter((p) => selectedPages.has(p.pageIndex))

    const pageIndices = new Set(pagesToUse.map((p) => p.pageIndex))
    const textBlocksToUse = apiTextBlocks.filter((tb) =>
      pageIndices.has(tb.pageIndex),
    )

    // 선택된 페이지를 연속 인덱스로 다시 매핑
    const reindexedPages = pagesToUse.map((p, i) => ({
      ...p,
      pageIndex: i,
    }))

    const pageIndexMap = new Map<number, number>()
    pagesToUse.forEach((p, i) => {
      pageIndexMap.set(p.pageIndex, i)
    })

    const reindexedTextBlocks = textBlocksToUse.map((tb) => ({
      ...tb,
      pageIndex: pageIndexMap.get(tb.pageIndex) ?? tb.pageIndex,
    }))

    const store = useEditorStore.getState()
    store.setPageImages(reindexedPages)
    store.setTextBlocks(reindexedTextBlocks)
    store.setPageCount(reindexedPages.length)
    setStep(3)
  }, [apiPages, apiTextBlocks, selectionMode, selectedPages])

  // --- 저장 ---

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      setSaveError(t("nameRequired"))
      return
    }

    const store = useEditorStore.getState()
    if (store.pageImages.length === 0) {
      setSaveError(t("noPagesError"))
      return
    }

    setIsSaving(true)
    setSaveError("")
    try {
      const validFolderId = folder && folder !== "__none__" && folders.some((f) => f.id === folder) ? folder : undefined

      const fieldConfig = store.fields.map((f) => ({
        id: f.id,
        type: f.type,
        name: f.name,
        required: f.required,
        signerRole: f.signerRole,
        position: f.position,
        defaultValue: f.defaultValue,
      }))

      const payload = {
        name: name.trim(),
        folderId: validFolderId,
        source: "IMPORT" as const,
        preferences: {
          sourceType,
          originalFileName: sourceFileName,
        },
        documents: {
          version: 2,
          sourceFileName,
          sourceType,
          pages: store.pageImages,
          textBlocks: store.textBlocks,
        },
        schema: fieldConfig,
      }

      const res = await fetch(`${BASE_PATH}/api/v1/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      const data = await res.json()

      if (res.ok && data.data?.id) {
        router.push(`/templates/${data.data.id}/edit`)
      } else {
        setSaveError(data.error || t("saveFailedStatus", { status: res.status }))
      }
    } catch (err) {
      if (process.env.NODE_ENV === "development") console.error("저장 실패:", err)
      setSaveError(te("networkError"))
    } finally {
      setIsSaving(false)
    }
  }, [name, folder, folders, sourceType, sourceFileName, router])

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {t("newTemplate")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("newTemplateSubtitle")}
        </p>
      </div>

      {/* Step indicator */}
      <StepIndicator currentStep={step} labels={stepLabels} />

      {/* ====== Step 1: Upload ====== */}
      {step === 1 && (
        <Card className="mx-auto w-full max-w-2xl">
          <CardHeader>
            <CardTitle>{t("uploadDocument")}</CardTitle>
            <CardDescription>{t("uploadPdfMaxSize")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {/* File upload zone */}
            <label
                htmlFor="file-upload-input"
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`relative flex min-h-[200px] cursor-pointer flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed p-8 transition-colors ${
                  isDragOver
                    ? "border-primary bg-primary/5"
                    : file
                      ? "border-green-500 bg-green-50 dark:bg-green-950/20"
                      : "border-muted-foreground/25 hover:border-muted-foreground/50"
                }`}
              >
                <input
                  id="file-upload-input"
                  type="file"
                  accept={ACCEPTED_EXTENSIONS}
                  className="sr-only"
                  onChange={handleFileSelect}
                />
                {file ? (
                  <>
                    <FileUp className="size-10 text-green-600" />
                    <div className="text-center">
                      <p className="font-medium">{file.name}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.preventDefault()
                        setFile(null)
                        setPassword("")
                        setRequiresPassword(false)
                      }}
                    >
                      {t("differentFile")}
                    </Button>
                  </>
                ) : (
                  <>
                    <Upload className="size-10 text-muted-foreground" />
                    <div className="text-center">
                      <p className="font-medium">{t("dragDropText")}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t("selectPdfFile")}
                      </p>
                    </div>
                  </>
                )}
              </label>

            {/* Template name */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="template-name">{t("templateName")}</Label>
              <Input
                id="template-name"
                placeholder={t("templateNamePlaceholder")}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            {/* Folder select */}
            <div className="flex flex-col gap-2">
              <Label className="flex items-center gap-1.5">
                <FolderOpen className="size-3.5" />
                {t("folder")}
              </Label>
              <div className="flex gap-2">
                <Select
                  value={folder || undefined}
                  onValueChange={(val) => setFolder(val === "__none__" ? "" : (val ?? ""))}
                >
                  <SelectTrigger className="w-full">
                    <span className="flex flex-1 text-left truncate">
                      {folder && folder !== "__none__"
                        ? (folders.find((f) => f.id === folder)?.name === "Default" ? t("defaultFolderLabel") : folders.find((f) => f.id === folder)?.name) ?? t("selectFolder")
                        : <span className="text-muted-foreground">{t("selectFolderOptional")}</span>}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t("noFolder")}</SelectItem>
                    {folders.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name === "Default" ? t("defaultFolderLabel") : f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setShowNewFolder(!showNewFolder)}
                  title={t("createNewFolder")}
                >
                  <FolderPlus className="size-4" />
                </Button>
              </div>
              {showNewFolder && (
                <div className="flex gap-2">
                  <Input
                    placeholder={t("newFolderNamePlaceholder")}
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        handleCreateFolder()
                      }
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={!newFolderName.trim() || isCreatingFolder}
                    onClick={handleCreateFolder}
                  >
                    {isCreatingFolder ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      t("createButton")
                    )}
                  </Button>
                </div>
              )}
            </div>

            {/* Password input (shown when requiresPassword) */}
            {requiresPassword && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="pdf-password" className="flex items-center gap-1.5">
                  <Lock className="size-3.5" />
                  {t("pdfPassword")}
                </Label>
                <Input
                  id="pdf-password"
                  type="password"
                  placeholder={t("passwordPlaceholder")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      handleUpload()
                    }
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  {t("pdfPasswordHint")}
                </p>
              </div>
            )}

            {/* Convert error */}
            {convertError && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {convertError}
              </div>
            )}

            {/* Next button */}
            <div className="flex justify-end">
              <Button
                size="lg"
                disabled={!file || !name.trim() || isConverting || (requiresPassword && !password)}
                onClick={handleUpload}
              >
                {isConverting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t("converting")}
                  </>
                ) : requiresPassword ? (
                  tc("retry")
                ) : (
                  t("next")
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ====== Step 2: Page Selection ====== */}
      {step === 2 && (
        <Card className="mx-auto w-full max-w-5xl">
          <CardHeader>
            <CardTitle>{t("selectPages")}</CardTitle>
            <CardDescription>
              {t("selectPagesFullDesc", { count: apiPages.length })}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {/* Selection mode toggle */}
            <div className="flex gap-3">
              <Button
                variant={selectionMode === "all" ? "default" : "outline"}
                onClick={() => {
                  setSelectionMode("all")
                  selectAllPages()
                }}
              >
                {t("useEntireDocument")}
              </Button>
              <Button
                variant={selectionMode === "select" ? "default" : "outline"}
                onClick={() => setSelectionMode("select")}
              >
                {t("selectPages")}
              </Button>
            </div>

            {/* Selection controls (only in select mode) */}
            {selectionMode === "select" && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {t("nSelected", { count: selectedPages.size })}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={selectAllPages}
                  >
                    {t("selectAll")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={deselectAllPages}
                  >
                    {t("deselectAll")}
                  </Button>
                </div>
              </div>
            )}

            {/* Page thumbnails grid */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {apiPages.map((page) => {
                const isSelected = selectedPages.has(page.pageIndex)
                const isSelectable = selectionMode === "select"

                return (
                  <div
                    key={page.pageIndex}
                    className="flex flex-col items-center gap-2"
                  >
                    <button
                      type="button"
                      disabled={!isSelectable}
                      onClick={() => isSelectable && togglePage(page.pageIndex)}
                      className={`relative overflow-hidden rounded-lg border-2 bg-white shadow-sm transition-all ${
                        isSelectable
                          ? isSelected
                            ? "border-primary ring-2 ring-primary/30"
                            : "border-muted-foreground/20 opacity-50 hover:opacity-75"
                          : "border-muted-foreground/20"
                      }`}
                    >
                      <img
                        src={prefixImageUrl(page.imageUrl)}
                        alt={t("pageAlt", { number: page.pageIndex + 1 })}
                        className="h-auto w-[150px] object-contain"
                        style={{
                          aspectRatio: `${page.width} / ${page.height}`,
                        }}
                      />
                      {/* Selection overlay */}
                      {isSelectable && isSelected && (
                        <div className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                          <Check className="size-3.5" />
                        </div>
                      )}
                    </button>
                    <span className="text-xs text-muted-foreground">
                      {page.pageIndex + 1}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* Action buttons */}
            <div className="flex items-center justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>
                {t("back")}
              </Button>
              <Button
                onClick={handleProceedToEditor}
                disabled={
                  selectionMode === "select" && selectedPages.size === 0
                }
              >
                {t("proceedToFields")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ====== Step 3: Field Editor ====== */}
      {step === 3 && (
        <div className="flex flex-col gap-4">
          <TemplateEditor templateId="new" templateName={name} />

          {/* Error message */}
          {saveError && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {saveError}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={() => setStep(2)}>
              {t("back")}
            </Button>
            <Button
              disabled={isSaving}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                handleSave()
              }}
            >
              {isSaving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t("saving")}
                </>
              ) : (
                t("save")
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
