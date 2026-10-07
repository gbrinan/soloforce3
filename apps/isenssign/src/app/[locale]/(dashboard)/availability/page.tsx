"use client"

import { useState, useCallback } from "react"
import { useTranslations } from "next-intl"
import {
  Plus,
  Clock,
  Loader2,
  RefreshCcw,
  Globe,
  Star,
  Trash2,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
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
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { useApi } from "@/hooks/use-api"
import {
  fetchSchedules,
  createSchedule,
  type ScheduleDTO,
} from "@/lib/api"

const TIMEZONE_OPTIONS = [
  "Asia/Seoul",
  "Asia/Tokyo",
  "America/New_York",
  "America/Los_Angeles",
  "America/Chicago",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Australia/Sydney",
  "Pacific/Auckland",
] as const

interface AvailabilityBlock {
  id: string
  days: number[]
  startTime: string
  endTime: string
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 9)
}

function formatDays(days: number[], dayNames: readonly string[]): string {
  const sorted = [...days].sort((a, b) => a - b)
  return sorted.map((d) => dayNames[d]).join(", ")
}

function formatAvailabilityRules(
  schedule: ScheduleDTO,
  dayNames: readonly string[]
): string[] {
  return schedule.availabilities.map((a) => {
    const dayStr = formatDays(a.days, dayNames)
    return `${dayStr} ${a.startTime} - ${a.endTime}`
  })
}

export default function AvailabilityPage() {
  const t = useTranslations("booking")
  const tc = useTranslations("common")
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)

  const dayNames = [
    t("weekdays.sun"),
    t("weekdays.mon"),
    t("weekdays.tue"),
    t("weekdays.wed"),
    t("weekdays.thu"),
    t("weekdays.fri"),
    t("weekdays.sat"),
  ] as const

  // Form state
  const [formName, setFormName] = useState("")
  const [formTimeZone, setFormTimeZone] = useState<string>("Asia/Seoul")
  const [formBlocks, setFormBlocks] = useState<AvailabilityBlock[]>([
    {
      id: generateId(),
      days: [1, 2, 3, 4, 5],
      startTime: "09:00",
      endTime: "18:00",
    },
  ])

  const { data, loading, error, refetch } = useApi(
    () => fetchSchedules(),
    []
  )

  const schedules = data?.data ?? []

  const resetForm = useCallback(() => {
    setFormName("")
    setFormTimeZone("Asia/Seoul")
    setFormBlocks([
      {
        id: generateId(),
        days: [1, 2, 3, 4, 5],
        startTime: "09:00",
        endTime: "18:00",
      },
    ])
  }, [])

  const handleAddBlock = useCallback(() => {
    setFormBlocks((prev) => [
      ...prev,
      {
        id: generateId(),
        days: [1, 2, 3, 4, 5],
        startTime: "09:00",
        endTime: "18:00",
      },
    ])
  }, [])

  const handleRemoveBlock = useCallback((blockId: string) => {
    setFormBlocks((prev) => prev.filter((b) => b.id !== blockId))
  }, [])

  const handleToggleDay = useCallback((blockId: string, day: number) => {
    setFormBlocks((prev) =>
      prev.map((b) => {
        if (b.id !== blockId) return b
        const days = b.days.includes(day)
          ? b.days.filter((d) => d !== day)
          : [...b.days, day]
        return { ...b, days }
      })
    )
  }, [])

  const handleBlockTimeChange = useCallback(
    (blockId: string, field: "startTime" | "endTime", value: string) => {
      setFormBlocks((prev) =>
        prev.map((b) => (b.id === blockId ? { ...b, [field]: value } : b))
      )
    },
    []
  )

  const handleCreate = useCallback(async () => {
    if (!formName.trim()) return
    const validBlocks = formBlocks.filter((b) => b.days.length > 0)
    if (validBlocks.length === 0) return

    setCreating(true)
    try {
      await createSchedule({
        name: formName.trim(),
        timeZone: formTimeZone,
        isDefault: schedules.length === 0,
        availabilities: validBlocks.map((b) => ({
          days: b.days,
          startTime: b.startTime,
          endTime: b.endTime,
        })),
      })
      setCreateOpen(false)
      resetForm()
      refetch()
    } catch (err) {
      if (process.env.NODE_ENV === "development") console.error("Failed to create schedule:", err)
    } finally {
      setCreating(false)
    }
  }, [formName, formTimeZone, formBlocks, schedules.length, resetForm, refetch])

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">
          {t("availability")}
        </h1>
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
                {t("newSchedule")}
              </Button>
            }
          />
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{t("newSchedule")}</DialogTitle>
              <DialogDescription>
                {t("workingHours")}
              </DialogDescription>
            </DialogHeader>
            <div className="flex max-h-96 flex-col gap-4 overflow-y-auto py-2">
              {/* Schedule Name */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="schedule-name">{tc("name")}</Label>
                <Input
                  id="schedule-name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder={t("scheduleNamePlaceholder")}
                />
              </div>

              {/* Timezone */}
              <div className="flex flex-col gap-1.5">
                <Label>{t("timeZone")}</Label>
                <Select
                  value={formTimeZone}
                  onValueChange={(val) => setFormTimeZone(val as string)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONE_OPTIONS.map((tz) => (
                      <SelectItem key={tz} value={tz}>
                        {tz}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Availability Blocks */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <Label>{t("workingHours")}</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleAddBlock}
                  >
                    <Plus className="size-3.5" />
                    {tc("add")}
                  </Button>
                </div>

                {formBlocks.map((block) => (
                  <div
                    key={block.id}
                    className="flex flex-col gap-2 rounded-lg border p-3"
                  >
                    {/* Day Toggles */}
                    <div className="flex gap-1">
                      {dayNames.map((name, index) => (
                        <button
                          key={index}
                          type="button"
                          onClick={() => handleToggleDay(block.id, index)}
                          className={`flex size-8 items-center justify-center rounded-full text-xs font-medium transition-colors ${
                            block.days.includes(index)
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground hover:bg-muted/80"
                          }`}
                        >
                          {name}
                        </button>
                      ))}
                    </div>

                    {/* Time Range */}
                    <div className="flex items-center gap-2">
                      <Input
                        type="time"
                        value={block.startTime}
                        onChange={(e) =>
                          handleBlockTimeChange(
                            block.id,
                            "startTime",
                            e.target.value
                          )
                        }
                        className="w-28"
                      />
                      <span className="text-sm text-muted-foreground">~</span>
                      <Input
                        type="time"
                        value={block.endTime}
                        onChange={(e) =>
                          handleBlockTimeChange(
                            block.id,
                            "endTime",
                            e.target.value
                          )
                        }
                        className="w-28"
                      />
                      {formBlocks.length > 1 && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handleRemoveBlock(block.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>
                {tc("cancel")}
              </DialogClose>
              <Button
                onClick={handleCreate}
                disabled={
                  creating ||
                  !formName.trim() ||
                  formBlocks.every((b) => b.days.length === 0)
                }
              >
                {creating && <Loader2 className="size-4 animate-spin" />}
                {t("newSchedule")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Loading */}
      {loading && (
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-20">
          <div className="text-center">
            <p className="font-medium text-destructive">
              {t("schedulesLoadFailed")}
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

      {/* Schedule List */}
      {!loading && !error && schedules.length > 0 && (
        <div className="flex flex-col gap-4">
          {schedules.map((schedule) => {
            const rules = formatAvailabilityRules(schedule, dayNames)
            return (
              <Card key={schedule.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base">
                        {schedule.name}
                      </CardTitle>
                      {schedule.isDefault && (
                        <Badge variant="success">
                          <Star className="size-3" />
                          {t("defaultSchedule")}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Globe className="size-3.5" />
                      {schedule.timeZone}
                    </div>
                  </div>
                  {rules.length === 0 && (
                    <CardDescription>{t("unavailable")}</CardDescription>
                  )}
                </CardHeader>
                {rules.length > 0 && (
                  <CardContent>
                    <div className="flex flex-col gap-2">
                      {rules.map((rule, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 text-sm"
                        >
                          <Clock className="size-3.5 text-muted-foreground" />
                          <span>{rule}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && schedules.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-20">
          <div className="flex size-16 items-center justify-center rounded-full bg-muted">
            <Clock className="size-8 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="font-medium">{t("noSchedules")}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("noSchedulesDescription")}
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            {t("newSchedule")}
          </Button>
        </div>
      )}
    </div>
  )
}
