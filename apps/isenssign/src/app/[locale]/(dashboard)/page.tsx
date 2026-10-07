import { getTranslations, setRequestLocale } from "next-intl/server"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DashboardQuickActions } from "./dashboard-quick-actions"
import { DashboardRecentSubmissions } from "./dashboard-recent-submissions"
import { DashboardStats } from "./dashboard-stats"

interface DashboardPageProps {
  params: Promise<{ locale: string }>
}

export default async function DashboardPage({ params }: DashboardPageProps) {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations("dashboard")
  const ts = await getTranslations("submissions")

  return (
    <div className="space-y-6 p-4 md:p-6">
        {/* Contract stats */}
        <section>
          <h2 className="text-lg font-semibold mb-3">{t("contractStats")}</h2>
          <DashboardStats />
        </section>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Recent submissions */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>{t("recentSubmissions")}</CardTitle>
            </CardHeader>
            <CardContent>
              <DashboardRecentSubmissions
                labels={{
                  recipient: ts("recipient"),
                  template: ts("template"),
                  status: ts("status.title"),
                  date: ts("date"),
                }}
              />
            </CardContent>
          </Card>

          {/* Quick actions */}
          <Card>
            <CardHeader>
              <CardTitle>{t("quickActions")}</CardTitle>
            </CardHeader>
            <CardContent>
              <DashboardQuickActions />
            </CardContent>
          </Card>
        </div>
    </div>
  )
}
