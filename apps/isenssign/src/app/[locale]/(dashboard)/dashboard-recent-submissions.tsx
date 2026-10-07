"use client"

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { useRouter } from "@/i18n/navigation"
import { Loader2, RefreshCcw } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useApi } from "@/hooks/use-api"
import { fetchSubmissions, type SubmissionDTO } from "@/lib/api"

interface RecentRow {
  id: string
  recipient: string
  template: string
  status: "completed" | "pending" | "expired" | "active"
  date: string
}

const statusVariant: Record<string, "success" | "warning" | "destructive" | "default"> = {
  completed: "success",
  pending: "warning",
  expired: "destructive",
  active: "default",
}

const statusLabelKey: Record<string, string> = {
  completed: "status.completed",
  pending: "status.pending",
  expired: "status.expired",
  active: "status.inProgress",
}

function mapStatus(apiStatus: string): RecentRow["status"] {
  const s = apiStatus.toUpperCase()
  if (s === "COMPLETED") return "completed"
  if (s === "EXPIRED" || s === "DECLINED") return "expired"
  if (s === "ACTIVE" || s === "SENT" || s === "OPENED") return "active"
  return "pending"
}

function toRow(sub: SubmissionDTO): RecentRow {
  const firstSubmitter = sub.submitters[0]
  return {
    id: sub.id,
    recipient: firstSubmitter?.name ?? "",
    template: sub.template?.name ?? "",
    status: mapStatus(sub.status),
    date: sub.createdAt.slice(0, 10),
  }
}

interface DashboardRecentSubmissionsProps {
  labels: {
    recipient: string
    template: string
    status: string
    date: string
  }
}

export function DashboardRecentSubmissions({
  labels,
}: DashboardRecentSubmissionsProps) {
  const router = useRouter()
  const t = useTranslations("submissions")
  const tc = useTranslations("common")

  const { data, loading, error, refetch } = useApi(
    () => fetchSubmissions({ limit: 5 }),
    []
  )

  const rows = useMemo(() => {
    if (!data?.data) return []
    return data.data.map(toRow)
  }, [data])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-10">
        <p className="text-sm text-destructive">{t("loadError")}</p>
        <Button variant="outline" size="sm" onClick={refetch}>
          <RefreshCcw className="size-3" />
          {tc("retry")}
        </Button>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        {t("noSubmissionsYet")}
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{labels.recipient}</TableHead>
          <TableHead>{labels.template}</TableHead>
          <TableHead>{labels.status}</TableHead>
          <TableHead>{labels.date}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((sub) => (
          <TableRow
            key={sub.id}
            className="cursor-pointer"
            onClick={() => router.push(`/submissions/${sub.id}`)}
          >
            <TableCell className="font-medium">{sub.recipient || t("unknownSigner")}</TableCell>
            <TableCell>{sub.template || t("unknownDocument")}</TableCell>
            <TableCell>
              <Badge variant={statusVariant[sub.status]}>
                {t(statusLabelKey[sub.status])}
              </Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">{sub.date}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
