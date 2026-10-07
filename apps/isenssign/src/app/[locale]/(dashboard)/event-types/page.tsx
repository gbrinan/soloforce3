"use client"

import { useState, useCallback } from "react"
import { useTranslations } from "next-intl"
import {
  Plus,
  Clock,
  Loader2,
  RefreshCcw,
  Calendar,
  Pencil,
  Trash2,
  Copy,
  ExternalLink,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card"
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"
import { useApi } from "@/hooks/use-api"
import {
  fetchEventTypes,
  createEventType,
  deleteEventType,
  type EventTypeDTO,
} from "@/lib/api"

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s가-힣-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

const COLOR_OPTIONS = [
  "#3b82f6",
  "#ef4444",
  "#22c55e",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f97316",
]

export default function EventTypesPage() {
  const t = useTranslations("booking")
  const tc = useTranslations("common")
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<EventTypeDTO | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Form state
  const [formTitle, setFormTitle] = useState("")
  const [formSlug, setFormSlug] = useState("")
  const [formDuration, setFormDuration] = useState("30")
  const [formDescription, setFormDescription] = useState("")
  const [formColor, setFormColor] = useState(COLOR_OPTIONS[0])
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false)

  const { data, loading, error, refetch } = useApi(
    () => fetchEventTypes(),
    []
  )

  const eventTypes = data?.data ?? []

  const resetForm = useCallback(() => {
    setFormTitle("")
    setFormSlug("")
    setFormDuration("30")
    setFormDescription("")
    setFormColor(COLOR_OPTIONS[0])
    setSlugManuallyEdited(false)
  }, [])

  const handleTitleChange = useCallback(
    (value: string) => {
      setFormTitle(value)
      if (!slugManuallyEdited) {
        setFormSlug(slugify(value))
      }
    },
    [slugManuallyEdited]
  )

  const handleSlugChange = useCallback((value: string) => {
    setSlugManuallyEdited(true)
    setFormSlug(slugify(value))
  }, [])

  const handleCreate = useCallback(async () => {
    if (!formTitle.trim() || !formSlug.trim()) return
    setCreating(true)
    try {
      await createEventType({
        title: formTitle.trim(),
        slug: formSlug.trim(),
        duration: parseInt(formDuration, 10) || 30,
        description: formDescription.trim() || undefined,
        color: formColor,
      })
      setCreateOpen(false)
      resetForm()
      refetch()
    } catch (err) {
      if (process.env.NODE_ENV === "development") console.error("Failed to create event type:", err)
    } finally {
      setCreating(false)
    }
  }, [formTitle, formSlug, formDuration, formDescription, formColor, resetForm, refetch])

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteEventType(deleteTarget.id)
      setDeleteTarget(null)
      refetch()
    } catch (err) {
      if (process.env.NODE_ENV === "development") console.error("Failed to delete event type:", err)
    } finally {
      setDeleting(false)
    }
  }, [deleteTarget, refetch])

  const handleCopyLink = useCallback((slug: string) => {
    const url = `${window.location.origin}/book/${slug}`
    navigator.clipboard.writeText(url).catch(() => {
      // clipboard not available
    })
  }, [])

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{t("eventTypes")}</h1>
        <Dialog
          open={createOpen}
          onOpenChange={(open) => {
            setCreateOpen(open)
            if (!open) resetForm()
          }}
        >
          <DialogTrigger
            render={
              <Button>
                <Plus className="size-4" />
                {t("newEventType")}
              </Button>
            }
          />
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t("newEventType")}</DialogTitle>
              <DialogDescription>
                {t("eventDescription")}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="event-title">{t("eventTitle")}</Label>
                <Input
                  id="event-title"
                  value={formTitle}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  placeholder={t("eventTitle")}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="event-slug">{t("eventSlug")}</Label>
                <Input
                  id="event-slug"
                  value={formSlug}
                  onChange={(e) => handleSlugChange(e.target.value)}
                  placeholder="my-meeting"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="event-duration">{t("duration")}</Label>
                <Input
                  id="event-duration"
                  type="number"
                  min="5"
                  max="480"
                  value={formDuration}
                  onChange={(e) => setFormDuration(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="event-description">{t("eventDescription")}</Label>
                <Textarea
                  id="event-description"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder={t("eventDescription")}
                  rows={3}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t("color")}</Label>
                <div className="flex gap-2">
                  {COLOR_OPTIONS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setFormColor(color)}
                      className={`size-7 rounded-full border-2 transition-all ${
                        formColor === color
                          ? "border-foreground scale-110"
                          : "border-transparent hover:scale-105"
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <DialogClose
                render={<Button variant="outline" />}
              >
                {tc("cancel")}
              </DialogClose>
              <Button
                onClick={handleCreate}
                disabled={creating || !formTitle.trim() || !formSlug.trim()}
              >
                {creating && <Loader2 className="size-4 animate-spin" />}
                {t("newEventType")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Loading */}
      {loading && (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-20">
          <div className="text-center">
            <p className="font-medium text-destructive">
              {t("eventTypesLoadFailed")}
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

      {/* Event Type Cards */}
      {!loading && !error && eventTypes.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {eventTypes.map((et) => (
            <Card key={et.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    {et.color && (
                      <span
                        className="mt-0.5 size-3 shrink-0 rounded-full"
                        style={{ backgroundColor: et.color }}
                      />
                    )}
                    <CardTitle className="text-base">{et.title}</CardTitle>
                  </div>
                  {et.hidden && (
                    <Badge variant="outline">{t("hidden")}</Badge>
                  )}
                </div>
                {et.description && (
                  <CardDescription className="line-clamp-2">
                    {et.description}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="size-3.5" />
                    {t("durationMinutes", { minutes: et.duration })}
                  </span>
                  <span className="flex items-center gap-1">
                    <Calendar className="size-3.5" />
                    {t("bookingCount", { count: et._count.bookings })}
                  </span>
                </div>
                <div className="mt-2">
                  <Badge variant="secondary" className="font-mono text-xs">
                    /{et.slug}
                  </Badge>
                </div>
              </CardContent>
              <CardFooter className="gap-2">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => handleCopyLink(et.slug)}
                >
                  <Copy className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => {
                    window.open(`/book/${et.slug}`, "_blank")
                  }}
                >
                  <ExternalLink className="size-3.5" />
                </Button>
                <Button variant="ghost" size="icon-sm">
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setDeleteTarget(et)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && eventTypes.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-20">
          <div className="flex size-16 items-center justify-center rounded-full bg-muted">
            <Calendar className="size-8 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="font-medium">{t("noEventTypes")}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("noEventTypesDescription")}
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            {t("newEventType")}
          </Button>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteEventType")}</DialogTitle>
            <DialogDescription>
              {t("confirmDeleteEventType", { title: deleteTarget?.title ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              {tc("cancel")}
            </DialogClose>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              {tc("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
