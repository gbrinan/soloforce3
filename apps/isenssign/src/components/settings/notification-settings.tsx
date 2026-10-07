"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import {
  Mail,
  MessageSquare,
  Save,
  Send,
  Loader2,
  CheckCircle2,
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
import { Separator } from "@/components/ui/separator"

export default function NotificationSettings() {
  const t = useTranslations("settings.smtp")
  const tk = useTranslations("settings.kakao")
  const tn = useTranslations("settings.notifications")
  const tc = useTranslations("common")
  const [smtpForm, setSmtpForm] = React.useState({
    host: "",
    port: "587",
    username: "",
    password: "",
    fromEmail: "",
  })

  const [kakaoForm, setKakaoForm] = React.useState({
    senderKey: "",
    channelId: "",
  })

  const [testingEmail, setTestingEmail] = React.useState(false)
  const [testingKakao, setTestingKakao] = React.useState(false)
  const [emailTestResult, setEmailTestResult] = React.useState<"success" | "error" | null>(null)
  const [kakaoTestResult, setKakaoTestResult] = React.useState<"success" | "error" | null>(null)

  const handleSmtpChange = (field: keyof typeof smtpForm, value: string) => {
    setSmtpForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleKakaoChange = (field: keyof typeof kakaoForm, value: string) => {
    setKakaoForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleTestEmail = () => {
    setTestingEmail(true)
    setEmailTestResult(null)
    // 테스트 발송 시뮬레이션
    setTimeout(() => {
      setTestingEmail(false)
      setEmailTestResult("success")
    }, 2000)
  }

  const handleTestKakao = () => {
    setTestingKakao(true)
    setKakaoTestResult(null)
    setTimeout(() => {
      setTestingKakao(false)
      setKakaoTestResult("success")
    }, 2000)
  }

  return (
    <div className="space-y-6">
      {/* 이메일 (SMTP) 설정 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            {t("emailTitle")}
          </CardTitle>
          <CardDescription>
            {t("emailDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="smtp-host">{t("host")}</Label>
              <Input
                id="smtp-host"
                placeholder="smtp.example.com"
                value={smtpForm.host}
                onChange={(e) => handleSmtpChange("host", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-port">{t("port")}</Label>
              <Input
                id="smtp-port"
                placeholder="587"
                value={smtpForm.port}
                onChange={(e) => handleSmtpChange("port", e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="smtp-username">{t("username")}</Label>
              <Input
                id="smtp-username"
                placeholder="user@example.com"
                value={smtpForm.username}
                onChange={(e) => handleSmtpChange("username", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-password">{t("password")}</Label>
              <Input
                id="smtp-password"
                type="password"
                value={smtpForm.password}
                onChange={(e) => handleSmtpChange("password", e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="from-email">{t("fromEmail")}</Label>
            <Input
              id="from-email"
              type="email"
              placeholder="noreply@example.com"
              value={smtpForm.fromEmail}
              onChange={(e) => handleSmtpChange("fromEmail", e.target.value)}
            />
          </div>
        </CardContent>
        <CardFooter className="gap-2">
          <Button>
            <Save className="h-4 w-4" data-icon="inline-start" />
            {tc("save")}
          </Button>
          <Button variant="outline" onClick={handleTestEmail} disabled={testingEmail}>
            {testingEmail ? (
              <Loader2 className="h-4 w-4 animate-spin" data-icon="inline-start" />
            ) : (
              <Send className="h-4 w-4" data-icon="inline-start" />
            )}
            {tk("testSend")}
          </Button>
          {emailTestResult === "success" && (
            <span className="flex items-center gap-1 text-sm text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              {tn("sendSuccess")}
            </span>
          )}
        </CardFooter>
      </Card>

      <Separator />

      {/* 카카오 알림톡 설정 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            {tk("title")}
          </CardTitle>
          <CardDescription>
            {tk("description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sender-key">Sender Key</Label>
            <Input
              id="sender-key"
              placeholder={tk("senderKeyPlaceholder")}
              value={kakaoForm.senderKey}
              onChange={(e) => handleKakaoChange("senderKey", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="channel-id">Channel ID</Label>
            <Input
              id="channel-id"
              placeholder={tk("channelIdPlaceholder")}
              value={kakaoForm.channelId}
              onChange={(e) => handleKakaoChange("channelId", e.target.value)}
            />
          </div>
        </CardContent>
        <CardFooter className="gap-2">
          <Button>
            <Save className="h-4 w-4" data-icon="inline-start" />
            {tc("save")}
          </Button>
          <Button variant="outline" onClick={handleTestKakao} disabled={testingKakao}>
            {testingKakao ? (
              <Loader2 className="h-4 w-4 animate-spin" data-icon="inline-start" />
            ) : (
              <Send className="h-4 w-4" data-icon="inline-start" />
            )}
            {tk("testSend")}
          </Button>
          {kakaoTestResult === "success" && (
            <span className="flex items-center gap-1 text-sm text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              {tn("sendSuccess")}
            </span>
          )}
        </CardFooter>
      </Card>
    </div>
  )
}
