import { getTranslations, setRequestLocale } from "next-intl/server"

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { LoginForm } from "./login-form"

interface LoginPageProps {
  params: Promise<{ locale: string }>
}

export default async function LoginPage({ params }: LoginPageProps) {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations("auth")

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">{t("welcomeBack")}</CardTitle>
        <CardDescription>{t("loginDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm />
      </CardContent>
      <CardFooter className="flex-col gap-3">
        <div className="relative w-full">
          <Separator />
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
            {t("or")}
          </span>
        </div>
        <p className="text-center text-sm text-muted-foreground">
          {t("noAccount")}{" "}
          <a
            href={`/${locale === "ko" ? "" : locale + "/"}register`}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t("register")}
          </a>
        </p>
      </CardFooter>
    </Card>
  )
}
