"use client"

import { useTranslations } from "next-intl"
import { Plus, Send } from "lucide-react"

import { Link } from "@/i18n/navigation"

export function DashboardQuickActions() {
  const t = useTranslations("dashboard")

  return (
    <div className="flex flex-col gap-3">
      <Link
        href="/templates/new"
        className="inline-flex items-center justify-start gap-2 rounded-lg border border-input bg-background px-3 py-2 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <Plus className="size-4" />
        {t("newTemplate")}
      </Link>
      <Link
        href="/submissions"
        className="inline-flex items-center justify-start gap-2 rounded-lg border border-input bg-background px-3 py-2 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <Send className="size-4" />
        {t("newSignRequest")}
      </Link>
    </div>
  )
}
