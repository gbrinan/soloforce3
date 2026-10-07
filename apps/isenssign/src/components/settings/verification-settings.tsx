"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import {
  ShieldCheck,
  Save,
  TestTube,
  Loader2,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
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
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"

type ConnectionStatus = "connected" | "disconnected" | "testing"

export default function VerificationSettings() {
  const t = useTranslations("settings.barocert")
  const tc = useTranslations("common")
  const [clientCode, setClientCode] = React.useState("")
  const [secretKey, setSecretKey] = React.useState("")
  const [showSecret, setShowSecret] = React.useState(false)
  const [connectionStatus, setConnectionStatus] = React.useState<ConnectionStatus>("disconnected")

  const [providers, setProviders] = React.useState({
    kakao: true,
    naver: false,
    toss: false,
  })

  const handleToggleProvider = (provider: keyof typeof providers, checked: boolean) => {
    setProviders((prev) => ({ ...prev, [provider]: checked }))
  }

  const handleTestConnection = () => {
    setConnectionStatus("testing")
    // 연결 테스트 시뮬레이션
    setTimeout(() => {
      setConnectionStatus(clientCode && secretKey ? "connected" : "disconnected")
    }, 2000)
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5" />
                {t("settingsTitle")}
              </CardTitle>
              <CardDescription className="mt-1.5">
                {t("settingsDescription")}
              </CardDescription>
            </div>
            {connectionStatus === "connected" ? (
              <Badge variant="success">{t("connected")}</Badge>
            ) : connectionStatus === "testing" ? (
              <Badge variant="warning">{t("testing")}</Badge>
            ) : (
              <Badge variant="secondary">{t("disconnected")}</Badge>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="client-code">Client Code</Label>
            <Input
              id="client-code"
              placeholder={t("clientCodePlaceholder")}
              value={clientCode}
              onChange={(e) => setClientCode(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="secret-key">Secret Key</Label>
            <div className="relative">
              <Input
                id="secret-key"
                type={showSecret ? "text" : "password"}
                placeholder={t("secretKeyPlaceholder")}
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                className="absolute right-1 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                onClick={() => setShowSecret(!showSecret)}
              >
                {showSecret ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <Label className="text-base">{t("authMethods")}</Label>

            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <div className="text-sm font-medium">{t("providers.kakao")}</div>
                  <div className="text-xs text-muted-foreground">
                    {t("providers.kakaoDescription")}
                  </div>
                </div>
                <Switch
                  checked={providers.kakao}
                  onCheckedChange={(checked) =>
                    handleToggleProvider("kakao", checked)
                  }
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <div className="text-sm font-medium">{t("providers.naver")}</div>
                  <div className="text-xs text-muted-foreground">
                    {t("providers.naverDescription")}
                  </div>
                </div>
                <Switch
                  checked={providers.naver}
                  onCheckedChange={(checked) =>
                    handleToggleProvider("naver", checked)
                  }
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <div className="text-sm font-medium">{t("providers.toss")}</div>
                  <div className="text-xs text-muted-foreground">
                    {t("providers.tossDescription")}
                  </div>
                </div>
                <Switch
                  checked={providers.toss}
                  onCheckedChange={(checked) =>
                    handleToggleProvider("toss", checked)
                  }
                />
              </div>
            </div>
          </div>
        </CardContent>

        <CardFooter className="gap-2">
          <Button>
            <Save className="h-4 w-4" data-icon="inline-start" />
            {tc("save")}
          </Button>
          <Button
            variant="outline"
            onClick={handleTestConnection}
            disabled={connectionStatus === "testing"}
          >
            {connectionStatus === "testing" ? (
              <Loader2 className="h-4 w-4 animate-spin" data-icon="inline-start" />
            ) : (
              <TestTube className="h-4 w-4" data-icon="inline-start" />
            )}
            {t("testConnection")}
          </Button>
          {connectionStatus === "connected" && (
            <span className="flex items-center gap-1 text-sm text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              {t("connectionSuccess")}
            </span>
          )}
        </CardFooter>
      </Card>
    </div>
  )
}
