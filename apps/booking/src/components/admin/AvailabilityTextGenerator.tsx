"use client";

import { useState } from "react";
import {
  Box,
  Stack,
  Group,
  Text,
  Button,
  Textarea,
  CopyButton,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCopy, IconCheck, IconMessage2 } from "@tabler/icons-react";
import { apiUrl } from "@/lib/api-url";
import { useI18n } from "@/lib/i18n";

interface Slot {
  date: string;
  start: string;
  end: string;
}

interface SlotsResponse {
  date: string;
  slots: { start: string; end: string; available: boolean }[];
}

const LOOKAHEAD_DAYS = 14;
const MAX_SLOTS = 10;

function addDays(base: Date, days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function AvailabilityTextGenerator() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");

  // Collect available slots for the next 2 weeks, then ask AI for copy text
  async function handleGenerate() {
    setLoading(true);
    setText("");
    try {
      const base = new Date();
      const collected: Slot[] = [];
      for (let i = 1; i <= LOOKAHEAD_DAYS && collected.length < MAX_SLOTS; i++) {
        const date = addDays(base, i);
        const res = await fetch(apiUrl(`/api/slots?date=${date}`));
        if (!res.ok) continue;
        const data = (await res.json()) as SlotsResponse;
        for (const s of data.slots) {
          if (!s.available) continue;
          collected.push({ date, start: s.start, end: s.end });
          if (collected.length >= MAX_SLOTS) break;
        }
      }

      if (collected.length === 0) {
        notifications.show({ color: "orange", message: t("atg.noSlots") });
        return;
      }

      const res = await fetch(apiUrl("/api/ai/availability-text"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slots: collected }),
      });
      const data = (await res.json()) as { text?: string; error?: string };
      if (!res.ok || !data.text) {
        notifications.show({ color: "red", message: data.error ?? t("atg.genFail") });
        return;
      }
      setText(data.text);
    } catch {
      notifications.show({ color: "red", message: t("common.networkError") });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box
      mt="xl"
      style={{
        background: "#151F32",
        borderRadius: 10,
        padding: 16,
        border: "1px solid var(--mantine-color-dark-4)",
      }}
    >
      <Stack gap="sm">
        <Group justify="space-between">
          <Group gap={6}>
            <IconMessage2 size={16} />
            <Text fw={700} c="white" fz="sm">
              {t("atg.title")}
            </Text>
          </Group>
          <Button
            size="xs"
            color="jarvis"
            loading={loading}
            onClick={() => void handleGenerate()}
          >
            {t("atg.generate")}
          </Button>
        </Group>
        <Text c="dimmed" fz="xs">
          {t("atg.hint")}
        </Text>
        {text && (
          <Stack gap="xs">
            <Textarea value={text} readOnly autosize minRows={4} />
            <Group justify="flex-end">
              <CopyButton value={text}>
                {({ copied, copy }) => (
                  <Button
                    size="xs"
                    variant="light"
                    color={copied ? "green" : "jarvis"}
                    leftSection={copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
                    onClick={copy}
                  >
                    {copied ? t("atg.copied") : t("atg.copy")}
                  </Button>
                )}
              </CopyButton>
            </Group>
          </Stack>
        )}
      </Stack>
    </Box>
  );
}
