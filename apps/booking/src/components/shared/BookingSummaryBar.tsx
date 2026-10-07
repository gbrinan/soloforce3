"use client";

import { Box, Text, Group } from "@mantine/core";
import { IconCalendar, IconClock } from "@tabler/icons-react";
import dayjs from "dayjs";
import { useI18n, weekdayShortLabels } from "@/lib/i18n";

interface Props {
  date: string;
  start: string;
  end: string;
  visible: boolean;
}

export default function BookingSummaryBar({ date, start, end, visible }: Props) {
  const { locale } = useI18n();
  if (!visible) return null;
  const d = dayjs(date);
  const dateStr = `${d.format("YYYY.MM.DD")}(${weekdayShortLabels(locale)[d.day()]})`;

  return (
    <Box
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        background: "#151F32",
        borderTop: "1px solid var(--mantine-color-dark-4)",
        padding: "10px 24px",
        display: "flex",
        alignItems: "center",
        gap: 20,
        zIndex: 100,
      }}
    >
      <Group gap={6}>
        <IconCalendar size={14} color="var(--mantine-color-jarvis-4)" />
        <Text size="sm" c="dimmed">
          {dateStr}
        </Text>
      </Group>
      <Group gap={6}>
        <IconClock size={14} color="var(--mantine-color-jarvis-4)" />
        <Text size="sm" c="dimmed">
          {start} – {end}
        </Text>
      </Group>
    </Box>
  );
}
