"use client";

import { useState } from "react";
import {
  Box,
  Stack,
  Group,
  Text,
  TextInput,
  Button,
  Badge,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconSparkles } from "@tabler/icons-react";
import { apiUrl } from "@/lib/api-url";
import { useI18n } from "@/lib/i18n";

interface ParsedBooking {
  title: string;
  date: string;
  startTime: string;
  durationMin: number;
  attendee?: { name?: string; email?: string };
}

// "HH:mm" + minutes → "HH:mm"
function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export default function NaturalBookingInput({
  onCreated,
}: {
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedBooking | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleParse() {
    if (!text.trim()) return;
    setParsing(true);
    try {
      const res = await fetch(apiUrl("/api/ai/parse-booking"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim() }),
      });
      const data = (await res.json()) as ParsedBooking & { error?: string };
      if (!res.ok) {
        notifications.show({ color: "red", message: data.error ?? t("nb.parseFail") });
        return;
      }
      setParsed(data);
      setName(data.attendee?.name ?? "");
      setEmail(data.attendee?.email ?? "");
    } catch {
      notifications.show({ color: "red", message: t("common.networkError") });
    } finally {
      setParsing(false);
    }
  }

  async function handleCreate() {
    if (!parsed) return;
    if (!name.trim() || !email.trim()) {
      notifications.show({ color: "orange", message: t("nb.attendeeRequired") });
      return;
    }
    setCreating(true);
    try {
      const res = await fetch(apiUrl("/api/bookings"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: parsed.date,
          start: parsed.startTime,
          end: addMinutes(parsed.startTime, parsed.durationMin),
          name: name.trim(),
          email: email.trim(),
          note: parsed.title,
        }),
      });
      if (res.status === 409) {
        notifications.show({ color: "orange", message: t("dash.slotTaken") });
        return;
      }
      if (!res.ok) {
        notifications.show({ color: "red", message: t("nb.createFail") });
        return;
      }
      notifications.show({ color: "green", message: t("nb.created") });
      setParsed(null);
      setText("");
      onCreated();
    } catch {
      notifications.show({ color: "red", message: t("common.networkError") });
    } finally {
      setCreating(false);
    }
  }

  return (
    <Box
      style={{
        background: "#151F32",
        borderRadius: 10,
        padding: 16,
        border: "1px solid var(--mantine-color-dark-4)",
      }}
    >
      <Stack gap="sm">
        <Group gap={6}>
          <IconSparkles size={16} />
          <Text fw={700} c="white" fz="sm">
            {t("nb.title")}
          </Text>
        </Group>
        <Group gap="xs" align="flex-end" wrap="nowrap">
          <TextInput
            style={{ flex: 1 }}
            size="sm"
            placeholder={t("nb.placeholder")}
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleParse();
            }}
          />
          <Button
            size="sm"
            color="jarvis"
            loading={parsing}
            disabled={!text.trim()}
            onClick={() => void handleParse()}
          >
            {t("nb.parse")}
          </Button>
        </Group>

        {parsed && (
          <Box
            style={{
              background: "#0D1626",
              borderRadius: 8,
              padding: 12,
              border: "1px solid var(--mantine-color-dark-4)",
            }}
          >
            <Stack gap="xs">
              <Group gap="xs">
                <Badge color="jarvis" variant="light" size="sm">
                  {parsed.title}
                </Badge>
                <Text c="white" fz="sm" fw={600}>
                  {parsed.date} {parsed.startTime} ~{" "}
                  {addMinutes(parsed.startTime, parsed.durationMin)} ({t("common.minutes", { n: parsed.durationMin })})
                </Text>
              </Group>
              <Group gap="xs" grow>
                <TextInput
                  size="xs"
                  label={t("nb.attendeeName")}
                  value={name}
                  onChange={(e) => setName(e.currentTarget.value)}
                />
                <TextInput
                  size="xs"
                  label={t("nb.attendeeEmail")}
                  value={email}
                  onChange={(e) => setEmail(e.currentTarget.value)}
                />
              </Group>
              <Group justify="flex-end" gap="xs">
                <Button
                  size="xs"
                  variant="subtle"
                  color="gray"
                  onClick={() => setParsed(null)}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  size="xs"
                  color="jarvis"
                  loading={creating}
                  onClick={() => void handleCreate()}
                >
                  {t("nb.create")}
                </Button>
              </Group>
            </Stack>
          </Box>
        )}
      </Stack>
    </Box>
  );
}
