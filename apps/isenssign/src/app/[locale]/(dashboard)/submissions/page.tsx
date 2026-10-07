"use client"

import { useState, useMemo } from "react"
import { useTranslations } from "next-intl"
import { useRouter } from "@/i18n/navigation"
import { format } from "date-fns"
import { ko } from "date-fns/locale"
import { Eye, MoreVertical, Bell, Link2, Download, Loader2, RefreshCcw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  StatusBadge,
  type SubmissionStatus,
} from "@/components/submissions/status-badge"
import { useApi } from "@/hooks/use-api"
import { fetchSubmissions, type SubmissionDTO } from "@/lib/api"

type TabValue = "all" | "pending" | "active" | "completed" | "expired"

const TAB_STATUS_MAP: Record<TabValue, string | undefined> = {
  all: undefined,
  pending: "PENDING",
  active: "ACTIVE",
  completed: "COMPLETED",
  expired: "EXPIRED",
}

interface FlatSubmission {
  id: string
  documentName: string
  signerName: string
  signerEmail: string
  status: SubmissionStatus
  createdAt: Date
  expiresAt: Date | null
}

function flattenSubmission(sub: SubmissionDTO): FlatSubmission {
  const firstSubmitter = sub.submitters[0]
  return {
    id: sub.id,
    documentName: sub.template?.name ?? "",
    signerName: firstSubmitter?.name ?? "",
    signerEmail: firstSubmitter?.email ?? "",
    status: (sub.status ?? "PENDING") as SubmissionStatus,
    createdAt: new Date(sub.createdAt),
    expiresAt: sub.expiresAt ? new Date(sub.expiresAt) : null,
  }
}

export default function SubmissionsPage() {
  const router = useRouter()
  const t = useTranslations("submissions")
  const tc = useTranslations("common")
  const tsign = useTranslations("signing")
  const [activeTab, setActiveTab] = useState<TabValue>("all")

  const statusFilter = TAB_STATUS_MAP[activeTab]

  const { data, loading, error, refetch } = useApi(
    () => fetchSubmissions({ status: statusFilter }),
    [statusFilter]
  )

  const submissions = useMemo(() => {
    if (!data?.data) return []
    return data.data.map(flattenSubmission)
  }, [data])

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold tracking-tight">{t("signatureRequest")}</h1>

      <Tabs
        defaultValue="all"
        onValueChange={(val) => setActiveTab(val as TabValue)}
      >
        <TabsList variant="line">
          <TabsTrigger value="all">{tc("all")}</TabsTrigger>
          <TabsTrigger value="pending">{t("status.pending")}</TabsTrigger>
          <TabsTrigger value="active">{t("status.inProgress")}</TabsTrigger>
          <TabsTrigger value="completed">{t("status.completed")}</TabsTrigger>
          <TabsTrigger value="expired">{t("status.expired")}</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-4">
          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Error */}
          {error && !loading && (
            <div className="flex flex-col items-center justify-center gap-4 py-20">
              <p className="font-medium text-destructive">
                {t("loadFailed")}
              </p>
              <p className="text-sm text-muted-foreground">{error.message}</p>
              <Button variant="outline" onClick={refetch}>
                <RefreshCcw className="size-4" />
                {tc("retry")}
              </Button>
            </div>
          )}

          {/* Table */}
          {!loading && !error && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("documentName")}</TableHead>
                  <TableHead>{t("signer")}</TableHead>
                  <TableHead>{tc("status")}</TableHead>
                  <TableHead>{tc("createdAt")}</TableHead>
                  <TableHead>{t("expiresAt")}</TableHead>
                  <TableHead className="w-[60px]">{tc("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {submissions.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="h-32 text-center text-muted-foreground"
                    >
                      {t("noSubmissionsForStatus")}
                    </TableCell>
                  </TableRow>
                ) : (
                  submissions.map((sub) => (
                    <TableRow
                      key={sub.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/submissions/${sub.id}`)}
                    >
                      <TableCell className="font-medium">
                        {sub.documentName || t("unknownDocument")}
                      </TableCell>
                      <TableCell>
                        <div>
                          <p>{sub.signerName || t("unknownSigner")}</p>
                          <p className="text-xs text-muted-foreground">
                            {sub.signerEmail}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={sub.status} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {format(sub.createdAt, "yyyy.MM.dd", { locale: ko })}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {sub.expiresAt
                          ? format(sub.expiresAt, "yyyy.MM.dd", { locale: ko })
                          : "-"}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={(e) => e.stopPropagation()}
                              />
                            }
                          >
                            <MoreVertical className="size-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation()
                                router.push(`/submissions/${sub.id}`)
                              }}
                            >
                              <Eye />
                              {t("viewDetails")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Bell />
                              {t("sendReminder")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Link2 />
                              {t("copyLink")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Download />
                              {tsign("downloadDocument")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
