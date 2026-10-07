"use client";

import { useEffect, useState } from "react";
import { Box, Stack, Text, Title, Center, Loader } from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import { apiUrl } from "@/lib/api-url";
import { useI18n } from "@/lib/i18n";
import type { Booking } from "@/app/api/bookings/route";
import BookingScreen from "@/components/BookingScreen";

interface Props {
  params: Promise<{ token: string }>;
}

export default function ReschedulePage({ params }: Props) {
  const { t } = useI18n();
  const [token, setToken] = useState<string>("");
  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
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

  if (loading) {
    return (
      <Box style={{ minHeight: "100vh", background: "#070D1A", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Loader color="jarvis" />
      </Box>
    );
  }

  if (notFound) {
    return (
      <Box style={{ minHeight: "100vh", background: "#070D1A", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Stack align="center" gap="sm">
          <IconX size={48} color="var(--mantine-color-red-4)" />
          <Title order={3} c="white">{t("cp.notFoundTitle")}</Title>
          <Text c="dimmed" fz="sm">{t("rp.notFoundDesc")}</Text>
        </Stack>
      </Box>
    );
  }

  return (
    <Box>
      {booking?.eventTypeSlug ? (
        <BookingScreen eventTypeSlug={booking.eventTypeSlug} />
      ) : (
        <BookingScreen />
      )}
    </Box>
  );
}
