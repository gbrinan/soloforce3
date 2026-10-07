"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import {
  Webhook,
  Plus,
  Trash2,
  TestTube,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"

interface WebhookEntry {
  id: string
  url: string
  events: string[]
  active: boolean
  lastTriggered: string | null
}

const availableEvents = [
  { value: "submission.created", labelKey: "eventLabels.submissionCreated" },
  { value: "submission.completed", labelKey: "eventLabels.submissionCompleted" },
  { value: "submission.expired", labelKey: "eventLabels.submissionExpired" },
  { value: "submission.archived", labelKey: "eventLabels.submissionArchived" },
  { value: "submitter.signed", labelKey: "eventLabels.submitterSigned" },
  { value: "submitter.opened", labelKey: "eventLabels.submitterOpened" },
  { value: "submitter.declined", labelKey: "eventLabels.submitterDeclined" },
  { value: "template.created", labelKey: "eventLabels.templateCreated" },
  { value: "template.updated", labelKey: "eventLabels.templateUpdated" },
]

const initialWebhooks: WebhookEntry[] = [
  {
    id: "1",
    url: "https://example.com/webhooks/mysign",
    events: ["submission.completed", "submitter.signed"],
    active: true,
    lastTriggered: "2024-01-15 14:30",
  },
  {
    id: "2",
    url: "https://api.myapp.com/hooks/sign-complete",
    events: ["submission.completed"],
    active: false,
    lastTriggered: "2024-01-10 09:15",
  },
]

export default function WebhooksPage() {
  const t = useTranslations("settings.webhook")
  const tc = useTranslations("common")
  const [webhooks, setWebhooks] = React.useState<WebhookEntry[]>(initialWebhooks)
  const [showAddForm, setShowAddForm] = React.useState(false)
  const [newUrl, setNewUrl] = React.useState("")
  const [selectedEvents, setSelectedEvents] = React.useState<string[]>([])
  const [testingId, setTestingId] = React.useState<string | null>(null)

  const toggleEvent = (eventValue: string) => {
    setSelectedEvents((prev) =>
      prev.includes(eventValue)
        ? prev.filter((e) => e !== eventValue)
        : [...prev, eventValue]
    )
  }

  const handleAdd = () => {
    if (!newUrl || selectedEvents.length === 0) return

    const newWebhook: WebhookEntry = {
      id: crypto.randomUUID(),
      url: newUrl,
      events: selectedEvents,
      active: true,
      lastTriggered: null,
    }
    setWebhooks((prev) => [...prev, newWebhook])
    setNewUrl("")
    setSelectedEvents([])
    setShowAddForm(false)
  }

  const handleDelete = (id: string) => {
    setWebhooks((prev) => prev.filter((w) => w.id !== id))
  }

  const handleToggle = (id: string, active: boolean) => {
    setWebhooks((prev) =>
      prev.map((w) => (w.id === id ? { ...w, active } : w))
    )
  }

  const handleTest = (id: string) => {
    setTestingId(id)
    // 테스트 요청 시뮬레이션
    setTimeout(() => setTestingId(null), 2000)
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Webhook className="h-5 w-5" />
                {t("manage")}
              </CardTitle>
              <CardDescription className="mt-1.5">
                {t("manageDescription")}
              </CardDescription>
            </div>
            <Button onClick={() => setShowAddForm(true)}>
              <Plus className="h-4 w-4" data-icon="inline-start" />
              {t("addWebhook")}
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* 추가 폼 */}
          {showAddForm && (
            <Card className="border-dashed">
              <CardHeader>
                <CardTitle className="text-base">{t("addNewWebhook")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="webhook-url">{t("url")}</Label>
                  <Input
                    id="webhook-url"
                    type="url"
                    placeholder="https://example.com/webhooks"
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("selectEvents")}</Label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {availableEvents.map((event) => (
                      <label
                        key={event.value}
                        className="flex items-center gap-2 rounded-lg border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={selectedEvents.includes(event.value)}
                          onChange={() => toggleEvent(event.value)}
                          className="rounded border-input"
                        />
                        <div>
                          <div className="text-sm font-medium">{t(event.labelKey)}</div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {event.value}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              </CardContent>
              <CardFooter className="gap-2">
                <Button onClick={handleAdd} disabled={!newUrl || selectedEvents.length === 0}>
                  {tc("add")}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowAddForm(false)
                    setNewUrl("")
                    setSelectedEvents([])
                  }}
                >
                  {tc("cancel")}
                </Button>
              </CardFooter>
            </Card>
          )}

          {/* 웹훅 목록 */}
          {webhooks.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {t("noWebhooks")}
            </div>
          ) : (
            <div className="space-y-3">
              {webhooks.map((webhook) => (
                <div
                  key={webhook.id}
                  className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-mono truncate">
                        {webhook.url}
                      </code>
                      {webhook.active ? (
                        <Badge variant="success">{t("active")}</Badge>
                      ) : (
                        <Badge variant="secondary">{t("inactive")}</Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {webhook.events.map((event) => (
                        <Badge key={event} variant="outline" className="text-xs font-mono">
                          {event}
                        </Badge>
                      ))}
                    </div>
                    {webhook.lastTriggered && (
                      <p className="text-xs text-muted-foreground">
                        {t("lastTriggered", { time: webhook.lastTriggered })}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Switch
                      checked={webhook.active}
                      onCheckedChange={(checked) =>
                        handleToggle(webhook.id, checked)
                      }
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleTest(webhook.id)}
                      disabled={testingId === webhook.id}
                    >
                      {testingId === webhook.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <TestTube className="h-4 w-4" data-icon="inline-start" />
                      )}
                      {t("test")}
                    </Button>
                    <Button
                      variant="destructive"
                      size="icon-sm"
                      onClick={() => handleDelete(webhook.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
