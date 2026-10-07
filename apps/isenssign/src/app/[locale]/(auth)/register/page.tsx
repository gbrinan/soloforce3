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
import { RegisterForm } from "./register-form"

interface RegisterPageProps {
  params: Promise<{ locale: string }>
}

export default async function RegisterPage({ params }: RegisterPageProps) {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations("auth")

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">{t("registerTitle")}</CardTitle>
        <CardDescription>{t("registerDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <RegisterForm />
      </CardContent>
      <CardFooter className="flex-col gap-3">
        <div className="relative w-full">
          <Separator />
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
            {t("or")}
          </span>
        </div>
        <p className="text-center text-sm text-muted-foreground">
          {t("hasAccount")}{" "}
          <a
            href={`/${locale === "ko" ? "" : locale + "/"}login`}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t("login")}
          </a>
        </p>
      </CardFooter>
    </Card>
  )
}
