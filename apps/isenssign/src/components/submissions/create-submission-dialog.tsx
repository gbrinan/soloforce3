"use client"

import { useState, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import { format } from "date-fns"
import { ko } from "date-fns/locale"
import { CalendarIcon, Plus, Trash2, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import {
  createSubmission,
  sendNotification,
  ApiError,
  BASE_PATH,
  type CreateSubmissionRequest,
} from "@/lib/api"

interface Signer {
  id: string
  name: string
  email: string
  phone: string
}

interface CreateSubmissionDialogProps {
  templateId: string
  templateName: string
  trigger: React.ReactNode
  onSuccess?: () => void
}

const VERIFICATION_MAP: Record<string, CreateSubmissionRequest["submitters"][number]["verificationMethod"]> = {
  none: "NONE",
  kakao: "KAKAO_CERT",
  naver: "NAVER_CERT",
  toss: "TOSS_CERT",
}

function createEmptySigner(): Signer {
  return {
    id: crypto.randomUUID(),
    name: "",
    email: "",
    phone: "",
  }
}

function CreateSubmissionDialog({
  templateId,
  templateName,
  trigger,
  onSuccess,
}: CreateSubmissionDialogProps) {
  const { data: session } = useSession()
  const locale = useLocale()
  const t = useTranslations("submissions")
  const tc = useTranslations("common")
  const ta = useTranslations("auth")
  const tv = useTranslations("verification")
  const [open, setOpen] = useState(false)
  const [signers, setSigners] = useState<Signer[]>([createEmptySigner()])
  const [notificationMethod, setNotificationMethod] = useState("email")
  const [verificationMethod, setVerificationMethod] = useState("none")
  const [expiresAt, setExpiresAt] = useState<Date | undefined>(undefined)
  const [submitting, setSubmitting] = useState(false)

  const addSigner = useCallback(() => {
    setSigners((prev) => [...prev, createEmptySigner()])
  }, [])

  const removeSigner = useCallback((id: string) => {
    setSigners((prev) => {
      if (prev.length <= 1) return prev
      return prev.filter((s) => s.id !== id)
    })
  }, [])

  const updateSigner = useCallback(
    (id: string, field: keyof Omit<Signer, "id">, value: string) => {
      setSigners((prev) =>
        prev.map((s) => (s.id === id ? { ...s, [field]: value } : s))
      )
    },
    []
  )

  const handleReset = useCallback(() => {
    setSigners([createEmptySigner()])
    setNotificationMethod("email")
    setVerificationMethod("none")
    setExpiresAt(undefined)
    setSubmitting(false)
  }, [])

  const handleSubmit = useCallback(async () => {
    // Basic validation
    const validSigners = signers.filter((s) => s.name.trim())
    if (validSigners.length === 0) {
      toast.error(t("atLeastOneSigner"))
      return
    }

    setSubmitting(true)

    try {
      // 1. Create submission
      const channel = notificationMethod as "email" | "kakao" | "sms"
      const verMethod = VERIFICATION_MAP[verificationMethod] ?? "NONE"

      const result = await createSubmission({
        templateId,
        expiresAt: expiresAt?.toISOString(),
        submitters: validSigners.map((s) => ({
          name: s.name,
          email: s.email || undefined,
          phone: s.phone || undefined,
          notificationChannel: channel,
          verificationMethod: verMethod,
        })),
      })

      // 2. Send notifications for each submitter
      const submission = result.data
      const senderName = session?.user?.name?.trim() || "발송자"
      const origin = typeof window !== "undefined" ? window.location.origin : ""
      for (const submitter of submission.submitters) {
        try {
          // 서명 페이지는 localePrefix="always" + iframe 프록시(BASE_PATH) 하에 있으므로
          // 절대 URL로 구성한다(알림 API가 z.string().url()로 검증). slug 없으면 링크 생략.
          const signingUrl =
            origin && submitter.slug
              ? `${origin}${BASE_PATH}/${locale}/s/${submitter.slug}`
              : undefined
          await sendNotification({
            type: "signing_request",
            channel,
            recipient: {
              name: submitter.name ?? "",
              email: submitter.email ?? undefined,
              phone: submitter.phone ?? undefined,
            },
            data: {
              senderName,
              documentName: templateName,
              signingUrl,
              expiresAt: expiresAt?.toISOString(),
            },
          })
        } catch {
          // Notification failure is non-blocking; log in dev
          if (process.env.NODE_ENV === "development") {
            console.log("알림 발송 실패:", submitter.name)
          }
        }
      }

      toast.success(t("requestSent"))
      setOpen(false)
      onSuccess?.()
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.body.error
          : t("createFailed")
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }, [signers, notificationMethod, verificationMethod, expiresAt, templateId, templateName, onSuccess, session, locale])

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) handleReset()
      }}
    >
      <DialogTrigger render={<>{trigger}</>} />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("signatureRequest")}</DialogTitle>
          <DialogDescription>
            {t.rich("requestWithTemplate", {
              templateName,
              name: (chunks) => (
                <span className="font-medium text-foreground">{chunks}</span>
              ),
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          {/* Signers */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">{t("addSigner")}</Label>
              <Button variant="ghost" size="xs" onClick={addSigner}>
                <Plus className="size-3" />
                {tc("add")}
              </Button>
            </div>
            {signers.map((signer, index) => (
              <div
                key={signer.id}
                className="flex flex-col gap-2 rounded-lg border p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t("signerNumber", { number: index + 1 })}
                  </span>
                  {signers.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => removeSigner(signer.id)}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  )}
                </div>
                <Input
                  placeholder={tc("name")}
                  value={signer.name}
                  onChange={(e) =>
                    updateSigner(signer.id, "name", e.target.value)
                  }
                />
                <Input
                  type="email"
                  placeholder={ta("email")}
                  value={signer.email}
                  onChange={(e) =>
                    updateSigner(signer.id, "email", e.target.value)
                  }
                />
                <Input
                  type="tel"
                  placeholder={tv("phoneNumber")}
                  value={signer.phone}
                  onChange={(e) =>
                    updateSigner(signer.id, "phone", e.target.value)
                  }
                />
              </div>
            ))}
          </div>

          <Separator />

          {/* Notification Method */}
          <div className="flex flex-col gap-2">
            <Label>{t("notificationMethod")}</Label>
            <Select
              value={notificationMethod}
              onValueChange={(val) => setNotificationMethod(val ?? "email")}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="email">{ta("email")}</SelectItem>
                <SelectItem value="kakao">{t("kakaoNotification")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Verification Method */}
          <div className="flex flex-col gap-2">
            <Label>{tv("identityVerification")}</Label>
            <Select
              value={verificationMethod}
              onValueChange={(val) => setVerificationMethod(val ?? "none")}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{tc("none")}</SelectItem>
                <SelectItem value="kakao">{tv("kakaoVerification")}</SelectItem>
                <SelectItem value="naver">{tv("naverVerification")}</SelectItem>
                <SelectItem value="toss">{tv("tossVerification")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Expiration Date */}
          <div className="flex flex-col gap-2">
            <Label>{t("expiresAt")}</Label>
            <Popover>
              <PopoverTrigger
                render={
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !expiresAt && "text-muted-foreground"
                    )}
                  />
                }
              >
                <CalendarIcon className="size-4" />
                {expiresAt
                  ? format(expiresAt, "yyyy년 M월 d일", { locale: ko })
                  : t("selectExpiryDate")}
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={expiresAt}
                  onSelect={setExpiresAt}
                  disabled={(date) => date < new Date()}
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {submitting ? t("sending") : t("send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { CreateSubmissionDialog }
export type { CreateSubmissionDialogProps }
