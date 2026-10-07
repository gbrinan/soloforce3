"use client"

import { useState, useMemo, useCallback } from "react"
import { useTranslations } from "next-intl"
import {
  Loader2,
  RefreshCcw,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  X,
  User,
  Mail,
  Clock,
  MapPin,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"
import { useApi } from "@/hooks/use-api"
import {
  fetchBookings,
  cancelBooking,
  type BookingDTO,
} from "@/lib/api"

type TabValue = "all" | "upcoming" | "past" | "cancelled"

const STATUS_BADGE_MAP: Record<
  string,
  "success" | "warning" | "destructive" | "default" | "secondary"
> = {
  ACCEPTED: "success",
  PENDING: "warning",
  CANCELLED: "destructive",
  REJECTED: "destructive",
  RESCHEDULED: "default",
  NO_SHOW: "secondary",
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatTimeRange(start: string, end: string): string {
  const s = new Date(start)
  const e = new Date(end)
  const dateStr = s.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  const startTime = s.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  })
  const endTime = e.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  })
  return `${dateStr} ${startTime} - ${endTime}`
}

export default function BookingsPage() {
  const t = useTranslations("booking")
  const tc = useTranslations("common")
  const [activeTab, setActiveTab] = useState<TabValue>("all")
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [cancelTarget, setCancelTarget] = useState<BookingDTO | null>(null)
  const [cancelReason, setCancelReason] = useState("")
  const [cancelling, setCancelling] = useState(false)

  const apiParams = useMemo(() => {
    const params: { page: number; limit: number; status?: string; period?: "upcoming" | "past" } = {
      page,
      limit: 10,
    }
    if (activeTab === "upcoming") {
      params.period = "upcoming"
    } else if (activeTab === "past") {
      params.period = "past"
    } else if (activeTab === "cancelled") {
      params.status = "CANCELLED"
    }
    return params
  }, [activeTab, page])

  const apiPage = apiParams.page
  const apiStatus = activeTab === "cancelled" ? "CANCELLED" : ""
  const apiPeriod = activeTab === "upcoming" ? "upcoming" : activeTab === "past" ? "past" : ""

  const { data, loading, error, refetch } = useApi(
    () => fetchBookings(apiParams),
    [apiPage, apiStatus, apiPeriod]
  )

  const bookings = data?.data ?? []
  const pagination = data?.pagination

  const handleTabChange = useCallback((value: TabValue | string) => {
    setActiveTab(value as TabValue)
    setPage(1)
    setExpandedId(null)
  }, [])

  const handleCancel = useCallback(async () => {
    if (!cancelTarget) return
    setCancelling(true)
    try {
      await cancelBooking(cancelTarget.id, cancelReason.trim() || undefined)
      setCancelTarget(null)
      setCancelReason("")
      refetch()
    } catch (err) {
      if (process.env.NODE_ENV === "development") console.error("Failed to cancel booking:", err)
    } finally {
      setCancelling(false)
    }
  }, [cancelTarget, cancelReason, refetch])

  const getStatusLabel = useCallback(
    (status: string) => {
      const key = status.toLowerCase() as
        | "pending"
        | "accepted"
        | "cancelled"
        | "rejected"
        | "rescheduled"
        | "noShow"
      return t(`status.${key}`) || status
    },
    [t]
  )

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{t("bookings")}</h1>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList variant="line">
          <TabsTrigger value="all">{tc("all")}</TabsTrigger>
          <TabsTrigger value="upcoming">{t("upcomingBookings")}</TabsTrigger>
          <TabsTrigger value="past">{t("pastBookings")}</TabsTrigger>
          <TabsTrigger value="cancelled">{t("status.cancelled")}</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab}>
          {/* Loading */}
          {loading && (
            <div className="space-y-3 pt-4">
              {[...Array(3)].map((_, i) => (
                <div
                  key={i}
                  className="h-20 animate-pulse rounded-lg bg-muted"
                />
              ))}
            </div>
          )}

          {/* Error */}
          {error && !loading && (
            <div className="flex flex-col items-center justify-center gap-4 py-20">
              <div className="text-center">
                <p className="font-medium text-destructive">
                  {t("bookingsLoadFailed")}
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

          {/* Booking List */}
          {!loading && !error && bookings.length > 0 && (
            <div className="flex flex-col gap-3 pt-4">
              {bookings.map((booking) => {
                const isExpanded = expandedId === booking.id
                const attendee = booking.attendees[0]
                const statusVariant =
                  STATUS_BADGE_MAP[booking.status] ?? "secondary"

                return (
                  <Card
                    key={booking.id}
                    className="cursor-pointer transition-shadow hover:shadow-md"
                    onClick={() =>
                      setExpandedId(isExpanded ? null : booking.id)
                    }
                  >
                    <CardContent className="p-4">
                      {/* Main Row */}
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-medium">
                              {booking.title}
                            </span>
                            <Badge variant={statusVariant}>
                              {getStatusLabel(booking.status)}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                            {attendee && (
                              <span className="flex items-center gap-1">
                                <User className="size-3.5" />
                                {attendee.name}
                              </span>
                            )}
                            {booking.eventType && (
                              <span className="flex items-center gap-1">
                                <CalendarCheck className="size-3.5" />
                                {booking.eventType.title}
                              </span>
                            )}
                            <span className="flex items-center gap-1">
                              <Clock className="size-3.5" />
                              {formatTimeRange(
                                booking.startTime,
                                booking.endTime
                              )}
                            </span>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {booking.status !== "CANCELLED" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation()
                                setCancelTarget(booking)
                              }}
                            >
                              <X className="size-3.5" />
                              {t("cancelBooking")}
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Expanded Details */}
                      {isExpanded && (
                        <div className="mt-4 border-t pt-4">
                          <div className="grid gap-3 sm:grid-cols-2">
                            {attendee && (
                              <>
                                <div className="flex items-center gap-2 text-sm">
                                  <User className="size-4 text-muted-foreground" />
                                  <span className="text-muted-foreground">
                                    {t("attendeeName")}:
                                  </span>
                                  <span>{attendee.name}</span>
                                </div>
                                <div className="flex items-center gap-2 text-sm">
                                  <Mail className="size-4 text-muted-foreground" />
                                  <span className="text-muted-foreground">
                                    {t("attendeeEmail")}:
                                  </span>
                                  <span>{attendee.email}</span>
                                </div>
                              </>
                            )}
                            {booking.location && (
                              <div className="flex items-center gap-2 text-sm">
                                <MapPin className="size-4 text-muted-foreground" />
                                <span className="text-muted-foreground">
                                  {t("location")}:
                                </span>
                                <span>{booking.location}</span>
                              </div>
                            )}
                            {booking.description && (
                              <div className="col-span-full text-sm">
                                <span className="text-muted-foreground">
                                  {t("notes")}:
                                </span>{" "}
                                {booking.description}
                              </div>
                            )}
                            {booking.cancellationReason && (
                              <div className="col-span-full text-sm">
                                <span className="text-muted-foreground">
                                  {t("cancellationReason")}:
                                </span>{" "}
                                {booking.cancellationReason}
                              </div>
                            )}
                            <div className="col-span-full text-xs text-muted-foreground">
                              {formatDateTime(booking.createdAt)}
                            </div>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )
              })}

              {/* Pagination */}
              {pagination && pagination.totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 pt-4">
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    {page} / {pagination.totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={() =>
                      setPage((p) => Math.min(pagination.totalPages, p + 1))
                    }
                    disabled={page >= pagination.totalPages}
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Empty State */}
          {!loading && !error && bookings.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-4 py-20">
              <div className="flex size-16 items-center justify-center rounded-full bg-muted">
                <CalendarCheck className="size-8 text-muted-foreground" />
              </div>
              <div className="text-center">
                <p className="font-medium">{t("noBookings")}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("noBookingsDescription")}
                </p>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Cancel Confirmation Dialog */}
      <Dialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCancelTarget(null)
            setCancelReason("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("cancelBooking")}</DialogTitle>
            <DialogDescription>
              {t("confirmCancel", { title: cancelTarget?.title ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label htmlFor="cancel-reason">{t("cancellationReason")}</Label>
            <Textarea
              id="cancel-reason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder={t("cancellationReason")}
              rows={3}
              className="mt-1.5"
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              {tc("cancel")}
            </DialogClose>
            <Button
              variant="destructive"
              onClick={handleCancel}
              disabled={cancelling}
            >
              {cancelling && <Loader2 className="size-4 animate-spin" />}
              {t("cancelBooking")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
