"use client"

import { use } from "react"
import { useTranslations } from "next-intl"
import { format } from "date-fns"
import { ko } from "date-fns/locale"
import {
  Bell,
  Link2,
  Download,
  FileText,
  CheckCircle2,
  Clock,
  Eye,
  Send,
  XCircle,
  Loader2,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  StatusBadge,
  type SubmissionStatus,
} from "@/components/submissions/status-badge"
import { useApi } from "@/hooks/use-api"
import { fetchSubmission } from "@/lib/api"

interface SubmissionDetailParams {
  params: Promise<{ id: string; locale: string }>
}

const EVENT_TYPE_ICONS: Record<string, typeof Send> = {
  created: Send,
  sent: Send,
  opened: Eye,
  completed: CheckCircle2,
  expired: Clock,
  declined: XCircle,
  archived: Clock,
}

const EVENT_TYPE_LABEL_KEYS: Record<string, string> = {
  created: "eventTypes.created",
  sent: "eventTypes.sent",
  opened: "eventTypes.opened",
  completed: "eventTypes.completed",
  declined: "eventTypes.declined",
  expired: "eventTypes.expired",
  archived: "eventTypes.archived",
}

export default function SubmissionDetailPage({
  params,
}: SubmissionDetailParams) {
  const { id } = use(params)
  const t = useTranslations("submissions")
  const tc = useTranslations("common")
  const tsign = useTranslations("signing")

  const { data, loading, error, refetch } = useApi(
    () => fetchSubmission(id),
    [id],
  )

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-20">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-20">
        <p className="text-sm text-muted-foreground">
          {error?.message ?? t("loadError")}
        </p>
        <Button variant="outline" size="sm" onClick={refetch}>
          {tc("retry")}
        </Button>
      </div>
    )
  }

  const submission = data.data
  const submitters = submission.submitters ?? []
  const events = submission.submissionEvents ?? []
  const templateName = submission.template?.name ?? t("untitled")
  const firstSubmitterName = submitters[0]?.name ?? submitters[0]?.email ?? ""
  const headerTitle = firstSubmitterName
    ? `${templateName} - ${firstSubmitterName}`
    : templateName
  const completedCount = submitters.filter(
    (s) => s.status === "COMPLETED",
  ).length

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-lg bg-muted">
              <FileText className="size-6 text-muted-foreground" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                {headerTitle}
              </h1>
              {submission.template && (
                <p className="text-sm text-muted-foreground">
                  {t("template")}:{" "}
                  <span className="underline underline-offset-2 cursor-pointer hover:text-foreground">
                    {submission.template.name}
                  </span>
                </p>
              )}
            </div>
          </div>
          <StatusBadge
            status={submission.status as SubmissionStatus}
            className="h-7 px-3 text-sm"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm">
            <Bell className="size-4" />
            {t("sendReminder")}
          </Button>
          <Button variant="outline" size="sm">
            <Link2 className="size-4" />
            {t("copyLink")}
          </Button>
          <Button variant="outline" size="sm">
            <Download className="size-4" />
            {tsign("downloadDocument")}
          </Button>
        </div>
      </div>

      <Separator />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Signers Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              {t("signersList")}
              <Badge variant="secondary">
                {t("completedCount", { completed: completedCount, total: submitters.length })}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {submitters.map((submitter) => {
              const displayName =
                submitter.name ?? submitter.email ?? submitter.phone ?? t("unknownSigner")
              return (
                <div
                  key={submitter.id}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3">
                    <Avatar size="sm">
                      <AvatarFallback>
                        {displayName.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium">{displayName}</p>
                      {submitter.email && (
                        <p className="text-xs text-muted-foreground">
                          {submitter.email}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge
                      status={submitter.status as SubmissionStatus}
                    />
                    {submitter.completedAt && (
                      <span className="text-xs text-muted-foreground">
                        {format(
                          new Date(submitter.completedAt),
                          "MM.dd HH:mm",
                          { locale: ko },
                        )}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>

        {/* Timeline Card */}
        <Card>
          <CardHeader>
            <CardTitle>{t("timeline.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative flex flex-col gap-0">
              {events.map(
                (
                  event: {
                    id: string
                    eventType: string
                    data: any
                    createdAt: string
                  },
                  index: number,
                ) => {
                  const IconComponent =
                    EVENT_TYPE_ICONS[event.eventType] ?? Clock
                  const labelKey = EVENT_TYPE_LABEL_KEYS[event.eventType]
                  const label = labelKey ? t(labelKey) : event.eventType
                  const actor =
                    event.data?.actor ?? label
                  const isLast = index === events.length - 1

                  return (
                    <div
                      key={event.id}
                      className="flex gap-3 pb-6 last:pb-0"
                    >
                      {/* Line + Icon */}
                      <div className="relative flex flex-col items-center">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                          <IconComponent className="size-4 text-muted-foreground" />
                        </div>
                        {!isLast && (
                          <div className="absolute top-8 h-full w-px bg-border" />
                        )}
                      </div>
                      {/* Content */}
                      <div className="flex flex-col gap-0.5 pt-1">
                        <p className="text-sm font-medium">{label}</p>
                        <p className="text-xs text-muted-foreground">
                          {actor} &middot;{" "}
                          {format(
                            new Date(event.createdAt),
                            "yyyy.MM.dd HH:mm",
                            { locale: ko },
                          )}
                        </p>
                      </div>
                    </div>
                  )
                },
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
