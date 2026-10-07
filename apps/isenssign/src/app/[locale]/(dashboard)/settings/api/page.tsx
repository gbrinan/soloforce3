"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import {
  Code2,
  Plus,
  Copy,
  Trash2,
  Eye,
  EyeOff,
  Check,
  ExternalLink,
  Key,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

interface ApiToken {
  id: string
  name: string
  token: string
  createdAt: string
  lastUsed: string | null
}

function makeInitialTokens(t: (key: string) => string): ApiToken[] {
  return [
    {
      id: "1",
      name: t("api.demoProdKey"),
      token: "demo_key_live_0000000000000000EXAMPLE",
      createdAt: "2024-01-10",
      lastUsed: "2024-01-15 14:30",
    },
    {
      id: "2",
      name: t("api.demoDevKey"),
      token: "demo_key_test_0000000000000000EXAMPLE",
      createdAt: "2024-01-05",
      lastUsed: "2024-01-12 09:00",
    },
  ]
}

export default function ApiPage() {
  const t = useTranslations("settings")
  const tc = useTranslations("common")
  const [tokens, setTokens] = React.useState<ApiToken[]>(() => makeInitialTokens(t))
  const [showCreateDialog, setShowCreateDialog] = React.useState(false)
  const [newTokenName, setNewTokenName] = React.useState("")
  const [newlyCreatedToken, setNewlyCreatedToken] = React.useState<string | null>(null)
  const [copiedId, setCopiedId] = React.useState<string | null>(null)
  const [visibleTokens, setVisibleTokens] = React.useState<Set<string>>(new Set())

  const handleCreate = () => {
    if (!newTokenName.trim()) return

    const token = `sk_live_${crypto.randomUUID().replace(/-/g, "")}`
    const newToken: ApiToken = {
      id: crypto.randomUUID(),
      name: newTokenName,
      token,
      createdAt: new Date().toISOString().split("T")[0],
      lastUsed: null,
    }
    setTokens((prev) => [...prev, newToken])
    setNewlyCreatedToken(token)
    setNewTokenName("")
  }

  const handleRevoke = (id: string) => {
    setTokens((prev) => prev.filter((t) => t.id !== id))
  }

  const handleCopy = (id: string, token: string) => {
    navigator.clipboard.writeText(token)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const toggleVisibility = (id: string) => {
    setVisibleTokens((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const maskToken = (token: string) => {
    return `${token.slice(0, 8)}${"*".repeat(24)}${token.slice(-4)}`
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Code2 className="h-5 w-5" />
                {t("api.manageTitle")}
              </CardTitle>
              <CardDescription className="mt-1.5">
                {t("api.description")}
              </CardDescription>
            </div>
            <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
              <DialogTrigger
                render={
                  <Button onClick={() => {
                    setNewlyCreatedToken(null)
                    setNewTokenName("")
                    setShowCreateDialog(true)
                  }}>
                    <Plus className="h-4 w-4" data-icon="inline-start" />
                    {t("api.createToken")}
                  </Button>
                }
              />
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("api.newTokenTitle")}</DialogTitle>
                  <DialogDescription>
                    {newlyCreatedToken
                      ? t("api.createdDescription")
                      : t("api.namePrompt")}
                  </DialogDescription>
                </DialogHeader>

                {newlyCreatedToken ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 rounded-lg border bg-muted p-3">
                      <code className="flex-1 text-sm font-mono break-all">
                        {newlyCreatedToken}
                      </code>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        onClick={() => {
                          navigator.clipboard.writeText(newlyCreatedToken)
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                    <p className="text-sm text-destructive font-medium">
                      {t("api.shownOnce")}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="token-name">{t("api.tokenName")}</Label>
                    <Input
                      id="token-name"
                      placeholder={t("api.tokenNamePlaceholder")}
                      value={newTokenName}
                      onChange={(e) => setNewTokenName(e.target.value)}
                    />
                  </div>
                )}

                <DialogFooter>
                  {newlyCreatedToken ? (
                    <Button onClick={() => setShowCreateDialog(false)}>
                      {tc("confirm")}
                    </Button>
                  ) : (
                    <Button onClick={handleCreate} disabled={!newTokenName.trim()}>
                      {t("api.create")}
                    </Button>
                  )}
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {tokens.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {t("api.noTokens")}
            </div>
          ) : (
            <div className="space-y-3">
              {tokens.map((token) => (
                <div
                  key={token.id}
                  className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <Key className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium text-sm">{token.name}</span>
                    </div>
                    <code className="text-xs font-mono text-muted-foreground block truncate">
                      {visibleTokens.has(token.id)
                        ? token.token
                        : maskToken(token.token)}
                    </code>
                    <div className="flex gap-3 text-xs text-muted-foreground">
                      <span>{t("api.createdAtLabel")}: {token.createdAt}</span>
                      <span>
                        {t("api.lastUsedLabel")}:{" "}
                        {token.lastUsed ?? t("api.neverUsed")}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => toggleVisibility(token.id)}
                    >
                      {visibleTokens.has(token.id) ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleCopy(token.id, token.token)}
                    >
                      {copiedId === token.id ? (
                        <Check className="h-4 w-4 text-green-600" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="destructive"
                      size="icon-sm"
                      onClick={() => handleRevoke(token.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>

        <CardFooter>
          <a
            href="#"
            className="flex items-center gap-1 text-sm text-primary hover:underline"
          >
            <ExternalLink className="h-4 w-4" />
            {t("api.viewDocs")}
          </a>
        </CardFooter>
      </Card>
    </div>
  )
}
