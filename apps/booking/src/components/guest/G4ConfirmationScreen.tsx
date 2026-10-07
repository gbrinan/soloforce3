"use client";

import { useState } from "react";
import { Stack, Box, Text, Button, Group, Badge } from "@mantine/core";
import { IconCircleCheck, IconCalendar, IconClock, IconUser, IconMailCheck } from "@tabler/icons-react";
import dayjs from "dayjs";
import { useI18n, weekdayShortLabels } from "@/lib/i18n";

interface Slot {
  date: string;
  start: string;
  end: string;
}

interface Props {
  bookingId: string;
  slot: Slot;
  hostName: string;
  meetingDurationMin: number;
  onReset: () => void;
}

type ResendStatus = "idle" | "sending" | "sent" | "error";

export default function G4ConfirmationScreen({
  bookingId,
  slot,
  hostName,
  meetingDurationMin,
  onReset,
}: Props) {
  const { t, locale } = useI18n();
  const [resendStatus, setResendStatus] = useState<ResendStatus>("idle");
  const d = dayjs(slot.date);
  const dateStr = `${d.format("YYYY.MM.DD")}(${weekdayShortLabels(locale)[d.day()]})`;

  async function handleResend() {
    setResendStatus("sending");
    try {
      const res = await fetch(`/api/bookings/${bookingId}/resend-email`, { method: "POST" });
      setResendStatus(res.ok ? "sent" : "error");
    } catch {
      setResendStatus("error");
    }
  }

  return (
    <Stack align="center" gap="xl" p="xl" style={{ flex: 1 }}>
      <IconCircleCheck size={72} color="var(--mantine-color-jarvis-4)" />

      <Text size="xl" fw={700} ta="center">
        {t("g4.confirmed")}
      </Text>

      <Group gap="xs" align="center">
        <Badge
          color={resendStatus === "error" ? "red" : "green"}
          variant="light"
          leftSection={<IconMailCheck size={14} />}
        >
          {resendStatus === "sent" ? t("g4.emailResent") : resendStatus === "error" ? t("g4.emailFail") : t("g4.emailSent")}
        </Badge>
        <Button
          size="compact-xs"
          variant="subtle"
          color="gray"
          loading={resendStatus === "sending"}
          onClick={handleResend}
        >
          {t("g4.resend")}
        </Button>
      </Group>

      <Box
        style={{
          background: "#151F32",
          borderRadius: 14,
          padding: "20px 24px",
          width: "100%",
          maxWidth: 380,
          border: "1px solid var(--mantine-color-dark-4)",
        }}
      >
        <Stack gap="sm">
          <Group gap={10} align="center">
            <IconUser size={15} color="var(--mantine-color-jarvis-4)" />
            <Text size="sm">{t("g4.meetingWith", { name: hostName })}</Text>
          </Group>
          <Group gap={10} align="center">
            <IconCalendar size={15} color="var(--mantine-color-jarvis-4)" />
            <Text size="sm">{dateStr}</Text>
          </Group>
          <Group gap={10} align="center">
            <IconClock size={15} color="var(--mantine-color-jarvis-4)" />
            <Text size="sm">
              {slot.start} – {slot.end} ({t("common.minutes", { n: meetingDurationMin })})
            </Text>
          </Group>
        </Stack>
      </Box>

      <Text size="xs" c="dimmed">
        {t("g4.bookingId", { id: bookingId })}
      </Text>

      <Button variant="outline" color="jarvis" radius="xl" onClick={onReset}>
        {t("g4.backToStart")}
      </Button>
    </Stack>
  );
}
