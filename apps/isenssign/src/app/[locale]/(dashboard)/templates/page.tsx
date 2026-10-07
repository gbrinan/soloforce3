"use client"

import { useState, useMemo, useEffect } from "react"
import { useRouter } from "@/i18n/navigation"
import { useTranslations } from "next-intl"
import { Plus, Search, FileText, RefreshCcw, Loader2, FolderOpen, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { TemplateCard } from "@/components/templates/template-card"
import { useApi } from "@/hooks/use-api"
import { fetchTemplates, fetchFolders, type TemplateDTO, type FolderDTO } from "@/lib/api"

function templateToCard(t: TemplateDTO, unknownAuthor: string) {
  const authorName = t.author?.firstName ?? t.author?.email ?? unknownAuthor
  const authorInitials = authorName.charAt(0)
  return {
    id: t.id,
    name: t.name,
    authorName,
    authorInitials,
    createdAt: new Date(t.createdAt),
    submissionCount: t._count.submissions,
  }
}

export default function TemplatesPage() {
  const router = useRouter()
  const t = useTranslations("templates")
  const tc = useTranslations("common")
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [folders, setFolders] = useState<FolderDTO[]>([])

  // 300ms debounce로 검색 API 호출 최적화
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  // 폴더 목록 가져오기
  useEffect(() => {
    async function loadFolders() {
      try {
        const res = await fetchFolders()
        if (res.data) {
          setFolders(res.data)
        }
      } catch {
        // 폴더 로드 실패 시 무시
      }
    }
    loadFolders()
  }, [])

  const { data, loading, error, refetch } = useApi(
    () =>
      fetchTemplates({
        search: debouncedSearch.trim() || undefined,
        folderId: selectedFolderId ?? undefined,
      }),
    [debouncedSearch, selectedFolderId]
  )

  const templates = useMemo(() => {
    if (!data?.data) return []
    return data.data.map((tpl) => templateToCard(tpl, t("unknownAuthor")))
  }, [data, t])

  const displayFolderName = (name: string) => (name === "Default" ? t("defaultFolderLabel") : name)

  const selectedFolderName = selectedFolderId
    ? (() => {
        const name = folders.find((f) => f.id === selectedFolderId)?.name
        return name ? displayFolderName(name) : null
      })()
    : null

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <Button onClick={() => router.push("/templates/new")}>
          <Plus className="size-4" />
          {t("newTemplate")}
        </Button>
      </div>

      {/* Search + Folder Filter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("searchTemplates")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>

        {/* Folder filter chips */}
        {folders.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <FolderOpen className="size-4 text-muted-foreground" />
            <button
              type="button"
              onClick={() => setSelectedFolderId(null)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                !selectedFolderId
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {tc("all")}
            </button>
            {folders.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() =>
                  setSelectedFolderId(
                    selectedFolderId === f.id ? null : f.id
                  )
                }
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  selectedFolderId === f.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {displayFolderName(f.name)}
                {f._count.templates > 0 && (
                  <span className="ml-1 opacity-70">
                    {f._count.templates}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Active folder filter indicator */}
      {selectedFolderName && (
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1.5 pr-1">
            <FolderOpen className="size-3" />
            {selectedFolderName}
            <button
              type="button"
              onClick={() => setSelectedFolderId(null)}
              className="ml-1 rounded-full p-0.5 hover:bg-muted"
            >
              <X className="size-3" />
            </button>
          </Badge>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex flex-1 items-center justify-center py-20">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-20">
          <div className="text-center">
            <p className="font-medium text-destructive">
              {t("loadFailed")}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {error.message}
            </p>
          </div>
          <Button variant="outline" onClick={refetch}>
            <RefreshCcw className="size-4" />
            {tc("retry")}
          </Button>
        </div>
      )}

      {/* Grid or Empty State */}
      {!loading && !error && templates.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {templates.map((template) => (
            <TemplateCard
              key={template.id}
              {...template}
              onClick={(id) => router.push(`/templates/${id}`)}
              onEdit={(id) => router.push(`/templates/${id}/edit`)}
              onDuplicate={(id) => {
                if (process.env.NODE_ENV === "development") console.log("duplicate", id)
              }}
              onArchive={(id) => {
                if (process.env.NODE_ENV === "development") console.log("archive", id)
              }}
              onRequestSign={(id) => {
                if (process.env.NODE_ENV === "development") console.log("request sign", id)
              }}
            />
          ))}
        </div>
      )}

      {!loading && !error && templates.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-20">
          <div className="flex size-16 items-center justify-center rounded-full bg-muted">
            <FileText className="size-8 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="font-medium">
              {selectedFolderName
                ? t("noTemplatesInFolder", { folder: selectedFolderName })
                : t("noTemplates")}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("noTemplatesDesc")}
            </p>
          </div>
          <Button onClick={() => router.push("/templates/new")}>
            <Plus className="size-4" />
            {t("createNewTemplate")}
          </Button>
        </div>
      )}
    </div>
  )
}
