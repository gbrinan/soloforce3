"use client"

import { useRouter } from "@/i18n/navigation"
import { use, useState, useCallback } from "react"
import { useTranslations } from "next-intl"
import { format } from "date-fns"
import { ko } from "date-fns/locale"
import {
  Pencil,
  Copy,
  Archive,
  Link2,
  Send,
  FileText,
  Loader2,
  RefreshCcw,
  ExternalLink,
  Plus,
  Trash2,
  Check,
  ClipboardCopy,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { useApi } from "@/hooks/use-api"
import {
  fetchTemplate,
  fetchTemplateSharing,
  createSubmission,
  type TemplateDTO,
  type CreateSubmissionRequest,
} from "@/lib/api"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SubmitterForm {
  name: string
  email: string
  phone: string
  role: string
}

interface TemplateDetailParams {
  params: Promise<{ id: string; locale: string }>
}

// ---------------------------------------------------------------------------
// Signing Link Dialog
// ---------------------------------------------------------------------------

function SigningLinkDialog({ templateId }: { templateId: string }) {
  const t = useTranslations("templates")
  const tc = useTranslations("common")
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sharingUrl, setSharingUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const handleOpen = useCallback(
    async (isOpen: boolean) => {
      setOpen(isOpen)
      if (isOpen && !sharingUrl) {
        setLoading(true)
        try {
          const res = await fetchTemplateSharing(templateId)
          const origin = window.location.origin
          setSharingUrl(`${origin}/s/${res.data.slug}`)
        } catch (err) {
          console.error("서명 링크 생성 실패:", err)
        } finally {
          setLoading(false)
        }
      }
    },
    [templateId, sharingUrl]
  )

  const handleCopy = useCallback(async () => {
    if (!sharingUrl) return
    try {
      await navigator.clipboard.writeText(sharingUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback
      const input = document.createElement("input")
      input.value = sharingUrl
      document.body.appendChild(input)
      input.select()
      document.execCommand("copy")
      document.body.removeChild(input)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [sharingUrl])

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Link2 className="size-4" />
            {t("signingLink")}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("signingLink")}</DialogTitle>
          <DialogDescription>
            {t("signingLinkDesc")}
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : sharingUrl ? (
          <div className="flex items-center gap-2">
            <Input value={sharingUrl} readOnly className="flex-1 text-xs" />
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={handleCopy}
            >
              {copied ? (
                <Check className="size-4 text-green-600" />
              ) : (
                <ClipboardCopy className="size-4" />
              )}
              {copied ? t("copied") : tc("copy")}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-destructive">
            {t("linkCreateFailed")}
          </p>
        )}
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Signing Request Dialog
// ---------------------------------------------------------------------------

const emptySubmitter: SubmitterForm = {
  name: "",
  email: "",
  phone: "",
  role: "서명자",
}

function SigningRequestDialog({ templateId }: { templateId: string }) {
  const t = useTranslations("templates")
  const tc = useTranslations("common")
  const ts = useTranslations("submissions")
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [submitters, setSubmitters] = useState<SubmitterForm[]>([
    { ...emptySubmitter },
  ])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const updateSubmitter = (
    index: number,
    field: keyof SubmitterForm,
    value: string
  ) => {
    setSubmitters((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], [field]: value }
      return next
    })
  }

  const addSubmitter = () => {
    setSubmitters((prev) => [...prev, { ...emptySubmitter }])
  }

  const removeSubmitter = (index: number) => {
    setSubmitters((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSubmit = async () => {
    setError(null)

    // 유효성 검증
    const invalid = submitters.find((s) => !s.name.trim())
    if (invalid) {
      setError(t("allSignersNameRequired"))
      return
    }

    const noContact = submitters.find(
      (s) => !s.email.trim() && !s.phone.trim()
    )
    if (noContact) {
      setError(t("allSignersContactRequired"))
      return
    }

    setSubmitting(true)
    try {
      const payload: CreateSubmissionRequest = {
        templateId,
        submitters: submitters.map((s) => ({
          name: s.name.trim(),
          email: s.email.trim() || undefined,
          phone: s.phone.trim() || undefined,
          role: s.role.trim() || "서명자",
        })),
      }
      const res = await createSubmission(payload)
      setOpen(false)
      router.push(`/submissions/${res.data.id}`)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("signingRequestFailed")
      )
    } finally {
      setSubmitting(false)
    }
  }

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen)
    if (!isOpen) {
      // reset on close
      setSubmitters([{ ...emptySubmitter }])
      setError(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button size="sm">
            <Send className="size-4" />
            {ts("signatureRequest")}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("sendSigningRequest")}</DialogTitle>
          <DialogDescription>
            {t("signingRequestDesc")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {submitters.map((submitter, index) => (
            <div
              key={index}
              className="relative flex flex-col gap-3 rounded-lg border p-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("signerNumber", { number: index + 1 })}
                </span>
                {submitters.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeSubmitter(index)}
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">
                    {tc("name")} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    placeholder={t("namePlaceholderExample")}
                    value={submitter.name}
                    onChange={(e) =>
                      updateSubmitter(index, "name", e.target.value)
                    }
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">{t("role")}</Label>
                  <Input
                    placeholder={ts("signer")}
                    value={submitter.role}
                    onChange={(e) =>
                      updateSubmitter(index, "role", e.target.value)
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">{t("email")}</Label>
                  <Input
                    type="email"
                    placeholder="email@example.com"
                    value={submitter.email}
                    onChange={(e) =>
                      updateSubmitter(index, "email", e.target.value)
                    }
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">{t("phone")}</Label>
                  <Input
                    type="tel"
                    placeholder="010-0000-0000"
                    value={submitter.phone}
                    onChange={(e) =>
                      updateSubmitter(index, "phone", e.target.value)
                    }
                  />
                </div>
              </div>
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={addSubmitter}
          >
            <Plus className="size-4" />
            {ts("addSigner")}
          </Button>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {submitting ? t("creating") : t("sendSigningRequest")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function TemplateDetailPage({ params }: TemplateDetailParams) {
  const { id } = use(params)
  const t = useTranslations("templates")
  const tc = useTranslations("common")
  const router = useRouter()
  const { data, loading, error, refetch } = useApi(
    () => fetchTemplate(id),
    [id]
  )

  const template: TemplateDTO | undefined = data?.data

  // Loading State
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-20">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Error State
  if (error || !template) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-20">
        <div className="text-center">
          <p className="font-medium text-destructive">
            {t("loadFailed")}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {error?.message ?? t("notFoundTemplate")}
          </p>
        </div>
        <Button variant="outline" onClick={refetch}>
          <RefreshCcw className="size-4" />
          {tc("retry")}
        </Button>
      </div>
    )
  }

  const authorName =
    template.author?.firstName ?? template.author?.email ?? t("unknownAuthor")
  const authorInitials = authorName.charAt(0)
  const folderName = template.folder?.name
    ? template.folder.name === "Default"
      ? t("defaultFolderLabel")
      : template.folder.name
    : null
  const submissionCount = template._count.submissions

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-lg bg-muted">
              <FileText className="size-6 text-muted-foreground" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                {template.name}
              </h1>
              <p className="text-sm text-muted-foreground">ID: {id}</p>
            </div>
          </div>
        </div>

        {/* Info Row */}
        <div className="flex flex-wrap items-center gap-3">
          {folderName && (
            <Badge variant="outline">{folderName}</Badge>
          )}
          <div className="flex items-center gap-2">
            <Avatar size="sm">
              <AvatarFallback>{authorInitials}</AvatarFallback>
            </Avatar>
            <span className="text-sm text-muted-foreground">
              {authorName}
            </span>
          </div>
          <span className="text-sm text-muted-foreground">
            {format(new Date(template.createdAt), "yyyy년 M월 d일", {
              locale: ko,
            })}
          </span>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/templates/${id}/edit`)}
          >
            <Pencil className="size-4" />
            {tc("edit")}
          </Button>
          <Button variant="outline" size="sm">
            <Copy className="size-4" />
            {tc("duplicate")}
          </Button>
          <Button variant="outline" size="sm">
            <Archive className="size-4" />
            {tc("archive")}
          </Button>
          <SigningLinkDialog templateId={id} />
          <SigningRequestDialog templateId={id} />
        </div>
      </div>

      <Separator />

      {/* Submissions Summary */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("submissionStatus")}</h2>
          <Badge variant="secondary">{t("countCases", { count: submissionCount })}</Badge>
        </div>
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8">
          <p className="text-sm text-muted-foreground">
            {t("submissionCountDesc", { count: submissionCount })}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/submissions")}
          >
            <ExternalLink className="size-4" />
            {t("viewAll")}
          </Button>
        </div>
      </div>
    </div>
  )
}
