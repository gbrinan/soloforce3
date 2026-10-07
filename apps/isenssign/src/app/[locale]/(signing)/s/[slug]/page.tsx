"use client"

import * as React from "react"
import { use } from "react"
import { useTranslations } from "next-intl"
import {
  FileText,
  User,
  Calendar,
  CheckCircle2,
  XCircle,
  Send,
  PenLine,
  Loader2,
  AlertTriangle,
  Type as TypeIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { BASE_PATH } from "@/lib/api"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import SignaturePad from "@/components/signing/signature-pad"
import ContractReviewCard from "@/components/signing/contract-review-card"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SigningField {
  id: string
  type: string
  name: string
  required: boolean
  signerRole?: string
  defaultValue?: string
  position: {
    x: number
    y: number
    width: number
    height: number
    page: number
  }
}

interface SigningData {
  submitter: {
    id: string
    name: string | null
    email: string | null
    role: string
    status: string
    verificationMethod: string | null
  }
  submission: {
    id: string
    status: string
    expiresAt: string | null
  }
  template: {
    name: string
    documents: unknown
  }
  sender: {
    name: string
  }
  fields: SigningField[]
  values: Record<string, unknown>
}

interface PageParams {
  params: Promise<{ slug: string; locale: string }>
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SigningPage({ params }: PageParams) {
  const { slug } = use(params)
  const t = useTranslations("signing")
  const tc = useTranslations("common")
  const te = useTranslations("errors")
  const tSub = useTranslations("submissions")

  const [data, setData] = React.useState<SigningData | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [errorStatus, setErrorStatus] = React.useState<number | null>(null)

  // Field values map: fieldId → value
  const [fieldValues, setFieldValues] = React.useState<Record<string, string>>({})

  const [signaturePadOpen, setSignaturePadOpen] = React.useState(false)
  const [activeFieldId, setActiveFieldId] = React.useState<string | null>(null)
  const [showDeclineDialog, setShowDeclineDialog] = React.useState(false)
  const [declineReason, setDeclineReason] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [submitted, setSubmitted] = React.useState(false)
  const [declined, setDeclined] = React.useState(false)

  // Fetch signing data
  React.useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`${BASE_PATH}/api/v1/signing/${slug}`)
        const json = await res.json()

        if (!res.ok) {
          setError(json.error || t("loadFailed"))
          setErrorStatus(res.status)
          return
        }

        setData(json.data)
        // Pre-fill values from existing submitter values
        if (json.data.values) {
          const existing: Record<string, string> = {}
          for (const [k, v] of Object.entries(json.data.values)) {
            existing[k] = String(v)
          }
          setFieldValues(existing)
        }
      } catch {
        setError(te("networkError"))
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [slug])

  // Field completion tracking
  const isFieldCompleted = (field: SigningField) => {
    return !!fieldValues[field.id]
  }

  const completedCount = data
    ? data.fields.filter((f) => f.required && isFieldCompleted(f)).length
    : 0
  const totalRequired = data
    ? data.fields.filter((f) => f.required).length
    : 0
  const progress = totalRequired > 0 ? (completedCount / totalRequired) * 100 : 0
  const allRequiredFilled = completedCount >= totalRequired

  // Handlers
  const handleFieldClick = (field: SigningField) => {
    if (field.type === "signature" || field.type === "initials" || field.type === "stamp") {
      setActiveFieldId(field.id)
      setSignaturePadOpen(true)
    } else if (field.type === "date") {
      setFieldValues((prev) => ({
        ...prev,
        [field.id]: new Date().toISOString().slice(0, 10),
      }))
    }
  }

  const handleSignatureConfirm = (dataUrl: string) => {
    if (activeFieldId) {
      setFieldValues((prev) => ({
        ...prev,
        [activeFieldId]: dataUrl,
      }))
    }
    setActiveFieldId(null)
  }

  const handleTextChange = (fieldId: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [fieldId]: value }))
  }

  const handleSubmit = async () => {
    if (!data || submitting) return
    setSubmitting(true)
    try {
      const res = await fetch(`${BASE_PATH}/api/v1/signing/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: fieldValues }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || t("submitFailed"))
        return
      }
      setSubmitted(true)
    } catch {
      setError(te("networkError"))
    } finally {
      setSubmitting(false)
    }
  }

  const handleDecline = async () => {
    if (!data || submitting) return
    setSubmitting(true)
    try {
      const res = await fetch(`${BASE_PATH}/api/v1/signing/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: declineReason }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || t("declineFailed"))
        return
      }
      setDeclined(true)
      setShowDeclineDialog(false)
    } catch {
      setError(te("networkError"))
    } finally {
      setSubmitting(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t("loadingDocument")}</p>
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Error state (expired, not found, already completed)
  // ---------------------------------------------------------------------------
  if (error && !data) {
    return (
      <div className="mx-auto max-w-md px-4 py-20">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-10">
            <AlertTriangle className="size-12 text-muted-foreground" />
            <h2 className="text-lg font-semibold">
              {errorStatus === 410
                ? t("errorExpiredTitle")
                : errorStatus === 409
                  ? t("errorProcessedTitle")
                  : t("errorNotFoundTitle")}
            </h2>
            <p className="text-center text-sm text-muted-foreground">
              {error}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Submitted / Declined success
  // ---------------------------------------------------------------------------
  if (submitted) {
    return (
      <div className="mx-auto max-w-md px-4 py-20">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-10">
            <CheckCircle2 className="size-12 text-green-600" />
            <h2 className="text-lg font-semibold">{t("signingCompleted")}</h2>
            <p className="text-center text-sm text-muted-foreground">
              {t("submittedDescription")}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (declined) {
    return (
      <div className="mx-auto max-w-md px-4 py-20">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-10">
            <XCircle className="size-12 text-destructive" />
            <h2 className="text-lg font-semibold">{t("signatureDeclined")}</h2>
            <p className="text-center text-sm text-muted-foreground">
              {t("declinedDescription")}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!data) return null

  // ---------------------------------------------------------------------------
  // Documents info
  // ---------------------------------------------------------------------------
  const docs = Array.isArray(data.template.documents)
    ? (data.template.documents as Array<{ imageUrl?: string; pageIndex?: number; width?: number; height?: number }>)
    : []
  const expiresFormatted = data.submission.expiresAt
    ? new Date(data.submission.expiresAt).toLocaleDateString("ko-KR")
    : null

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 space-y-6">
      {/* 문서 헤더 */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                {data.template.name}
              </CardTitle>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <User className="h-3.5 w-3.5" />
                  {data.sender.name}
                </span>
                {expiresFormatted && (
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    {t("expiresUntil", { date: expiresFormatted })}
                  </span>
                )}
              </div>
            </div>
            <Badge variant="warning">{tSub("status.awaiting")}</Badge>
          </div>
        </CardHeader>
      </Card>

      {/* 진행률 바 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t("progress")}</span>
          <span className="font-medium">
            {t("fieldsCompletedCount", {
              completed: completedCount,
              total: totalRequired,
            })}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* 서명 전 AI 검토 카드 */}
      <ContractReviewCard slug={slug} />

      {/* 문서 뷰어 영역 */}
      {docs.length > 0 ? (
        docs.map((doc, idx) => (
          <Card key={idx} className="overflow-hidden">
            <CardContent className="p-0">
              <div
                className="relative bg-zinc-100 dark:bg-zinc-800"
                style={{ minHeight: doc.height ?? 700 }}
              >
                {/* 배경 이미지 */}
                {doc.imageUrl && (
                  <img
                    src={`${BASE_PATH}${doc.imageUrl}`}
                    alt={t("pageAlt", { page: idx + 1 })}
                    className="w-full"
                    style={{ display: "block" }}
                  />
                )}

                {/* 이 페이지의 서명 필드 오버레이 */}
                {data.fields
                  .filter((f) => f.position.page === idx)
                  .map((field) => {
                    const completed = isFieldCompleted(field)
                    const isSignType =
                      field.type === "signature" ||
                      field.type === "initials" ||
                      field.type === "stamp"

                    return (
                      <div
                        key={field.id}
                        className="absolute"
                        style={{
                          left: field.position.x,
                          top: field.position.y,
                          width: field.position.width,
                          height: field.position.height,
                        }}
                      >
                        {/* 서명/도장 필드 */}
                        {isSignType && (
                          <button
                            type="button"
                            onClick={() => handleFieldClick(field)}
                            className={`size-full rounded border-2 border-dashed transition-all cursor-pointer hover:shadow-md ${
                              completed
                                ? "border-green-500 bg-green-50/80 dark:bg-green-950/30"
                                : "border-primary bg-primary/5 hover:bg-primary/10 animate-pulse"
                            }`}
                          >
                            {completed && fieldValues[field.id] ? (
                              <img
                                src={fieldValues[field.id]}
                                alt={field.name}
                                className="max-h-full max-w-full object-contain p-1"
                              />
                            ) : (
                              <div className="flex h-full flex-col items-center justify-center gap-0.5">
                                <PenLine className="h-4 w-4 text-primary" />
                                <span className="text-[10px] font-medium text-primary">
                                  {field.name}
                                  {field.required && " *"}
                                </span>
                              </div>
                            )}
                          </button>
                        )}

                        {/* 텍스트 필드 */}
                        {field.type === "text" && (
                          <Input
                            value={fieldValues[field.id] ?? field.defaultValue ?? ""}
                            onChange={(e) =>
                              handleTextChange(field.id, e.target.value)
                            }
                            placeholder={field.name}
                            className="h-full w-full rounded border-2 border-dashed border-primary bg-primary/5 text-xs focus:border-primary"
                          />
                        )}

                        {/* 날짜 필드 */}
                        {field.type === "date" && (
                          <button
                            type="button"
                            onClick={() => handleFieldClick(field)}
                            className={`size-full rounded border-2 border-dashed transition-all cursor-pointer ${
                              completed
                                ? "border-green-500 bg-green-50/80 dark:bg-green-950/30"
                                : "border-primary bg-primary/5 hover:bg-primary/10 animate-pulse"
                            }`}
                          >
                            {completed ? (
                              <span className="text-xs font-medium">
                                {fieldValues[field.id]}
                              </span>
                            ) : (
                              <div className="flex h-full flex-col items-center justify-center gap-0.5">
                                <Calendar className="h-3 w-3 text-primary" />
                                <span className="text-[10px] font-medium text-primary">
                                  {field.name}
                                  {field.required && " *"}
                                </span>
                              </div>
                            )}
                          </button>
                        )}

                        {/* 체크박스 */}
                        {field.type === "checkbox" && (
                          <button
                            type="button"
                            onClick={() =>
                              setFieldValues((prev) => ({
                                ...prev,
                                [field.id]: prev[field.id] ? "" : "checked",
                              }))
                            }
                            className={`size-full rounded border-2 border-dashed transition-all cursor-pointer ${
                              completed
                                ? "border-green-500 bg-green-50/80"
                                : "border-primary bg-primary/5 hover:bg-primary/10"
                            }`}
                          >
                            {completed ? (
                              <CheckCircle2 className="mx-auto h-4 w-4 text-green-600" />
                            ) : (
                              <span className="text-[10px] text-primary">✓</span>
                            )}
                          </button>
                        )}
                      </div>
                    )
                  })}
              </div>
            </CardContent>
          </Card>
        ))
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="relative bg-zinc-100 dark:bg-zinc-800" style={{ minHeight: 700 }}>
              <div className="flex h-full min-h-[700px] items-center justify-center">
                <div className="text-center text-muted-foreground">
                  <FileText className="mx-auto h-16 w-16 mb-3 opacity-30" />
                  <p className="text-sm">{t("documentUnavailable")}</p>
                </div>
              </div>

              {/* 문서 없이도 필드 표시 */}
              {data.fields.map((field) => {
                const completed = isFieldCompleted(field)
                const isSignType =
                  field.type === "signature" ||
                  field.type === "initials" ||
                  field.type === "stamp"

                return (
                  <button
                    key={field.id}
                    type="button"
                    onClick={() => handleFieldClick(field)}
                    className={`absolute rounded border-2 border-dashed transition-all cursor-pointer hover:shadow-md ${
                      completed
                        ? "border-green-500 bg-green-50/80 dark:bg-green-950/30"
                        : "border-primary bg-primary/5 hover:bg-primary/10 animate-pulse"
                    }`}
                    style={{
                      left: field.position.x,
                      top: field.position.y,
                      width: field.position.width,
                      height: field.position.height,
                    }}
                  >
                    {completed ? (
                      <div className="flex h-full items-center justify-center">
                        {isSignType && fieldValues[field.id] ? (
                          <img
                            src={fieldValues[field.id]}
                            alt={field.name}
                            className="max-h-full max-w-full object-contain p-1"
                          />
                        ) : (
                          <CheckCircle2 className="h-5 w-5 text-green-600" />
                        )}
                      </div>
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center gap-0.5">
                        {isSignType && (
                          <PenLine className="h-4 w-4 text-primary" />
                        )}
                        {field.type === "text" && (
                          <TypeIcon className="h-4 w-4 text-primary" />
                        )}
                        <span className="text-[10px] font-medium text-primary">
                          {field.name}
                          {field.required && " *"}
                        </span>
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Separator />

      {/* 하단 액션 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button
          variant="destructive"
          onClick={() => setShowDeclineDialog(true)}
          disabled={submitting}
        >
          <XCircle className="h-4 w-4" data-icon="inline-start" />
          {t("decline")}
        </Button>
        <Button
          size="lg"
          disabled={!allRequiredFilled || submitting}
          onClick={handleSubmit}
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" data-icon="inline-start" />
          ) : (
            <Send className="h-4 w-4" data-icon="inline-start" />
          )}
          {submitting ? t("submitting") : tc("submit")}
        </Button>
      </div>

      {!allRequiredFilled && (
        <p className="text-center text-sm text-muted-foreground">
          {t("fillAllFields")}
        </p>
      )}

      {error && data && (
        <p className="text-center text-sm text-destructive">{error}</p>
      )}

      {/* 서명 패드 */}
      <SignaturePad
        open={signaturePadOpen}
        onOpenChange={setSignaturePadOpen}
        onConfirm={handleSignatureConfirm}
      />

      {/* 거절 확인 다이얼로그 */}
      <Dialog open={showDeclineDialog} onOpenChange={setShowDeclineDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("declineToSign")}</DialogTitle>
            <DialogDescription>
              {t("declineDialogDescription")}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={declineReason}
            onChange={(e) => setDeclineReason(e.target.value)}
            placeholder={t("declineReasonPlaceholder")}
            rows={3}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeclineDialog(false)}
              disabled={submitting}
            >
              {tc("cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDecline}
              disabled={submitting}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              {t("confirmDeclineButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
