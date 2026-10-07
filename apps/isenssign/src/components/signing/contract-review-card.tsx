"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { Loader2, ShieldAlert, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { BASE_PATH } from "@/lib/api"

interface KeyClause {
  title: string
  summary: string
}

interface Risk {
  level: "high" | "medium" | "low"
  description: string
}

interface ContractReview {
  keyClauses: KeyClause[]
  risks: Risk[]
  overall: string
}

const RISK_CLASS: Record<Risk["level"], string> = {
  high: "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400",
  medium:
    "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400",
  low: "border-green-300 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/40 dark:text-green-400",
}

/** Pre-signing AI contract review card (on-demand, Claude CLI backed). */
export default function ContractReviewCard({ slug }: { slug: string }) {
  const t = useTranslations("signing")
  const te = useTranslations("errors")
  const riskLabel: Record<Risk["level"], string> = {
    high: t("review.riskHigh"),
    medium: t("review.riskMedium"),
    low: t("review.riskLow"),
  }
  const [loading, setLoading] = React.useState(false)
  const [review, setReview] = React.useState<ContractReview | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const handleReview = async () => {
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${BASE_PATH}/api/ai/contract-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || t("review.failed"))
        return
      }
      setReview(json.data)
    } catch {
      setError(te("networkError"))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4" />
            {t("review.title")}
          </CardTitle>
          {!review && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleReview}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" data-icon="inline-start" />
              ) : (
                <ShieldAlert className="h-4 w-4" data-icon="inline-start" />
              )}
              {loading ? t("review.reviewing") : t("review.summarize")}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {!review && !loading && !error && (
          <p className="text-sm text-muted-foreground">
            {t("review.intro")}
          </p>
        )}

        {loading && (
          <p className="text-sm text-muted-foreground">
            {t("review.analyzing")}
          </p>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {review && (
          <>
            {review.overall && (
              <p className="text-sm font-medium">{review.overall}</p>
            )}

            {review.keyClauses.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold">{t("review.keyClauses")}</h4>
                <ul className="space-y-2">
                  {review.keyClauses.map((clause, idx) => (
                    <li key={idx} className="rounded-md border p-3">
                      <p className="text-sm font-medium">{clause.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {clause.summary}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {review.risks.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold">{t("review.risks")}</h4>
                <ul className="space-y-2">
                  {review.risks.map((risk, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <Badge
                        variant="outline"
                        className={`mt-0.5 shrink-0 ${RISK_CLASS[risk.level]}`}
                      >
                        {riskLabel[risk.level]}
                      </Badge>
                      <p className="text-sm text-muted-foreground">
                        {risk.description}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        <p className="text-xs text-muted-foreground">
          {t("review.disclaimer")}
        </p>
      </CardContent>
    </Card>
  )
}
