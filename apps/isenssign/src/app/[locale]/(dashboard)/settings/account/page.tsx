"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import {
  User,
  Building2,
  Lock,
  Camera,
  Save,
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
import { Select, SelectItem, SelectTrigger, SelectContent, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"

const languages = [
  { value: "ko", label: "한국어" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
]

export default function AccountSettingsPage() {
  const t = useTranslations("settings.account")
  const tc = useTranslations("common")
  const ta = useTranslations("auth")

  const timezones = [
    { value: "Asia/Seoul", label: t("timezones.seoul") },
    { value: "Asia/Tokyo", label: t("timezones.tokyo") },
    { value: "America/New_York", label: t("timezones.newYork") },
    { value: "America/Los_Angeles", label: t("timezones.losAngeles") },
    { value: "Europe/London", label: t("timezones.london") },
  ]

  const [profileForm, setProfileForm] = React.useState({
    name: "",
    email: "",
  })

  const [companyForm, setCompanyForm] = React.useState({
    companyName: "",
    timezone: "Asia/Seoul",
    language: "ko",
  })

  const [passwordForm, setPasswordForm] = React.useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  })

  return (
    <div className="space-y-6">
      {/* 프로필 섹션 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            {t("profile")}
          </CardTitle>
          <CardDescription>
            {t("editProfileDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
                <User className="h-8 w-8 text-muted-foreground" />
              </div>
              <button
                type="button"
                className="absolute -bottom-1 -right-1 rounded-full bg-primary p-1.5 text-primary-foreground shadow-sm hover:bg-primary/90"
              >
                <Camera className="h-3 w-3" />
              </button>
            </div>
            <div className="text-sm text-muted-foreground">
              {t("avatarHint")}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">{tc("name")}</Label>
              <Input
                id="name"
                placeholder={t("namePlaceholder")}
                value={profileForm.name}
                onChange={(e) =>
                  setProfileForm((prev) => ({ ...prev, name: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">{t("email")}</Label>
              <Input
                id="email"
                type="email"
                placeholder="hong@example.com"
                value={profileForm.email}
                onChange={(e) =>
                  setProfileForm((prev) => ({ ...prev, email: e.target.value }))
                }
              />
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button>
            <Save className="h-4 w-4" data-icon="inline-start" />
            {tc("save")}
          </Button>
        </CardFooter>
      </Card>

      <Separator />

      {/* 계정 섹션 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            {t("account")}
          </CardTitle>
          <CardDescription>
            {t("accountDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="company">{t("companyName")}</Label>
            <Input
              id="company"
              placeholder={t("companyNamePlaceholder")}
              value={companyForm.companyName}
              onChange={(e) =>
                setCompanyForm((prev) => ({
                  ...prev,
                  companyName: e.target.value,
                }))
              }
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="timezone">{t("timezone")}</Label>
              <Select
                value={companyForm.timezone}
                onValueChange={(value) =>
                  setCompanyForm((prev) => ({ ...prev, timezone: value ?? prev.timezone }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("selectTimezone")} />
                </SelectTrigger>
                <SelectContent>
                  {timezones.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value}>
                      {tz.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="language">{t("language")}</Label>
              <Select
                value={companyForm.language}
                onValueChange={(value) =>
                  setCompanyForm((prev) => ({ ...prev, language: value ?? prev.language }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("selectLanguage")} />
                </SelectTrigger>
                <SelectContent>
                  {languages.map((lang) => (
                    <SelectItem key={lang.value} value={lang.value}>
                      {lang.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button>
            <Save className="h-4 w-4" data-icon="inline-start" />
            {tc("save")}
          </Button>
        </CardFooter>
      </Card>

      <Separator />

      {/* 보안 섹션 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            {t("security")}
          </CardTitle>
          <CardDescription>
            {t("securityDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="current-password">{ta("currentPassword")}</Label>
            <Input
              id="current-password"
              type="password"
              value={passwordForm.currentPassword}
              onChange={(e) =>
                setPasswordForm((prev) => ({
                  ...prev,
                  currentPassword: e.target.value,
                }))
              }
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="new-password">{ta("newPassword")}</Label>
              <Input
                id="new-password"
                type="password"
                value={passwordForm.newPassword}
                onChange={(e) =>
                  setPasswordForm((prev) => ({
                    ...prev,
                    newPassword: e.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">{ta("confirmPassword")}</Label>
              <Input
                id="confirm-password"
                type="password"
                value={passwordForm.confirmPassword}
                onChange={(e) =>
                  setPasswordForm((prev) => ({
                    ...prev,
                    confirmPassword: e.target.value,
                  }))
                }
              />
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button>
            <Lock className="h-4 w-4" data-icon="inline-start" />
            {ta("changePassword")}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
