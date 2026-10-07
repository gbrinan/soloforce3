"use client"

import { useTranslations } from "next-intl"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

type SubmissionStatus =
  | "PENDING"
  | "SENT"
  | "ACTIVE"
  | "OPENED"
  | "COMPLETED"
  | "DECLINED"
  | "EXPIRED"
  | "ARCHIVED"

interface StatusBadgeProps {
  status: SubmissionStatus
  className?: string
}

const statusConfig: Record<
  SubmissionStatus,
  { labelKey: string; variant: "default" | "secondary" | "destructive" | "outline"; className?: string }
> = {
  PENDING: { labelKey: "pending", variant: "secondary" },
  SENT: { labelKey: "inProgress", variant: "default", className: "bg-blue-600 text-white" },
  ACTIVE: { labelKey: "inProgress", variant: "default", className: "bg-blue-600 text-white" },
  OPENED: { labelKey: "opened", variant: "outline" },
  COMPLETED: { labelKey: "completed", variant: "default", className: "bg-green-600 text-white" },
  DECLINED: { labelKey: "declined", variant: "destructive" },
  EXPIRED: { labelKey: "expired", variant: "outline", className: "text-muted-foreground" },
  ARCHIVED: { labelKey: "archived", variant: "outline", className: "text-muted-foreground" },
}

function StatusBadge({ status, className }: StatusBadgeProps) {
  const t = useTranslations("submissions.status")
  const config = statusConfig[status]

  return (
    <Badge
      variant={config.variant}
      className={cn(config.className, className)}
    >
      {t(config.labelKey)}
    </Badge>
  )
}

export { StatusBadge }
export type { SubmissionStatus, StatusBadgeProps }
