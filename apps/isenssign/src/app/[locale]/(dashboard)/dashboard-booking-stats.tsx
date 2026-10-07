"use client";

import {
  CalendarRange,
  CalendarClock,
  CalendarCheck,
  CalendarDays,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useApi } from "@/hooks/use-api";
import { fetchBookingStats, type BookingStatsDTO } from "@/lib/api";

const statsConfig: Array<{
  key: keyof BookingStatsDTO;
  icon: LucideIcon;
}> = [
  { key: "totalBookings", icon: CalendarRange },
  { key: "upcomingBookings", icon: CalendarClock },
  { key: "completedBookings", icon: CalendarCheck },
  { key: "todayBookings", icon: CalendarDays },
];

export function DashboardBookingStats() {
  const t = useTranslations("dashboard");
  const { data, loading, error } = useApi(() => fetchBookingStats(), []);

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {statsConfig.map((stat) => {
        const Icon = stat.icon;
        return (
          <Card key={stat.key}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t(stat.key)}
              </CardTitle>
              <Icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="h-8 w-16 animate-pulse rounded bg-muted" />
              ) : error ? (
                <div className="text-2xl font-bold text-destructive">!</div>
              ) : (
                <div className="text-2xl font-bold">
                  {data?.[stat.key]?.toLocaleString() ?? "—"}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
