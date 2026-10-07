"use client";

import { useEffect, useState } from "react";
import { Box, Stack, Text, Button, Center, Loader, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCheck, IconX } from "@tabler/icons-react";
import { apiUrl } from "@/lib/api-url";
import { useI18n } from "@/lib/i18n";
import type { Booking } from "@/app/api/bookings/route";

interface Props {
  params: Promise<{ token: string }>;
}

export default function CancelPage({ params }: Props) {
  const { t } = useI18n();
  const [token, setToken] = useState<string>("");
  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [done, setDone] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    void params.then(({ token: t }) => setToken(t));
  }, [params]);

  useEffect(() => {
    if (!token) return;
    void (async () => {
      try {
        const res = await fetch(apiUrl("/api/bookings"));
        if (!res.ok) { setNotFound(true); return; }
        const all = (await res.json()) as Booking[];
        const found = all.find((b) => b.cancelToken === token);
        if (!found) { setNotFound(true); return; }
        setBooking(found);
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  async function handleCancel() {
    if (!booking) return;
    setCancelling(true);
    try {
      const res = await fetch(apiUrl(`/api/bookings/${booking.id}`), { method: "DELETE" });
      if (res.ok) {
        setDone(true);
      } else {
        notifications.show({ color: "red", message: t("cp.cancelFail") });
      }
    } catch {
      notifications.show({ color: "red", message: t("common.networkError") });
    } finally {
      setCancelling(false);
    }
  }

  return (
    <Box style={{ minHeight: "100vh", background: "#070D1A", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {loading ? (
        <Loader color="jarvis" />
      ) : notFound ? (
        <Stack align="center" gap="sm">
          <IconX size={48} color="var(--mantine-color-red-4)" />
          <Title order={3} c="white">{t("cp.notFoundTitle")}</Title>
          <Text c="dimmed" fz="sm">{t("cp.notFoundDesc")}</Text>
        </Stack>
      ) : done ? (
        <Stack align="center" gap="sm">
          <IconCheck size={48} color="var(--mantine-color-green-4)" />
          <Title order={3} c="white">{t("cp.doneTitle")}</Title>
          <Text c="dimmed" fz="sm">{t("cp.doneDesc", { name: booking?.name ?? "" })}</Text>
        </Stack>
      ) : (
        <Center>
          <Stack align="center" gap="md" style={{ maxWidth: 400, padding: 24 }}>
            <Title order={3} c="white">{t("cp.title")}</Title>
            {booking && (
              <Stack gap="xs" style={{ background: "#151F32", padding: 16, borderRadius: 10, width: "100%" }}>
                <Text c="white" fz="sm">📅 {booking.date} {booking.start} ~ {booking.end}</Text>
                <Text c="white" fz="sm">👤 {booking.name}</Text>
                {booking.eventTypeTitle && <Text c="dimmed" fz="sm">📋 {booking.eventTypeTitle}</Text>}
              </Stack>
            )}
            <Text c="dimmed" fz="sm" ta="center">{t("cp.confirmQ")}</Text>
            <Button variant="filled" color="red" loading={cancelling} onClick={() => void handleCancel()} fullWidth>
              {t("cp.cancelBtn")}
            </Button>
          </Stack>
        </Center>
      )}
    </Box>
  );
}
