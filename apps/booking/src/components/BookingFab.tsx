"use client";

import { useState } from "react";
import {
  ActionIcon,
  Drawer,
  Stack,
  Text,
  Textarea,
  Button,
  Group,
  Box,
} from "@mantine/core";
import { IconCalendarQuestion, IconSend } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useI18n } from "@/lib/i18n";

const BOOKING_QA: { q: "fab.q.how" | "fab.q.change" | "fab.q.cancel" | "fab.q.confirm" | "fab.q.email" | "fab.q.slot"; a: "fab.a.how" | "fab.a.change" | "fab.a.cancel" | "fab.a.confirm" | "fab.a.email" | "fab.a.slot" }[] = [
  { q: "fab.q.how", a: "fab.a.how" },
  { q: "fab.q.change", a: "fab.a.change" },
  { q: "fab.q.cancel", a: "fab.a.cancel" },
  { q: "fab.q.confirm", a: "fab.a.confirm" },
  { q: "fab.q.email", a: "fab.a.email" },
  { q: "fab.q.slot", a: "fab.a.slot" },
];

export default function BookingFab() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    setText("");
    setAnswer(null);
  };

  const matchAnswer = (input: string): string | null => {
    const q = input.toLowerCase();
    for (const { q: qKey, a: aKey } of BOOKING_QA) {
      if (q.includes(t(qKey).toLowerCase())) return t(aKey);
    }
    return null;
  };

  const submit = () => {
    const q = text.trim();
    if (!q) return;
    const a = matchAnswer(q);
    if (a) {
      setAnswer(a);
    } else {
      notifications.show({
        color: "jarvis",
        message: t("fab.noMatch"),
      });
    }
  };

  return (
    <>
      <ActionIcon
        variant="filled"
        color="jarvis"
        radius="xl"
        size={56}
        onClick={() => setOpen(true)}
        aria-label={t("fab.openAria")}
        style={{
          position: "fixed",
          bottom: 96,
          right: 24,
          zIndex: 200,
          boxShadow: "0 4px 20px rgba(99,102,241,0.4)",
        }}
      >
        <IconCalendarQuestion size={24} />
      </ActionIcon>

      <Drawer
        opened={open}
        onClose={close}
        position="right"
        size="md"
        title={t("fab.title")}
        styles={{
          content: { background: "#151F32" },
          header: { background: "#151F32" },
        }}
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            {t("fab.hint")}
          </Text>

          {answer && (
            <Box
              p="sm"
              style={{
                background: "#070D1A",
                borderRadius: 10,
                border: "1px solid var(--mantine-color-dark-4)",
              }}
            >
              <Text size="sm">{answer}</Text>
            </Box>
          )}

          <Textarea
            value={text}
            onChange={(e) => {
              setText(e.currentTarget.value);
              setAnswer(null);
            }}
            minRows={3}
            autosize
            placeholder={t("fab.placeholder")}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
            }}
          />
          <Group justify="flex-end">
            <Button variant="filled"
              disabled={text.trim().length === 0}
              leftSection={<IconSend size={14} />}
              color="jarvis"
              onClick={submit}
            >
              {t("fab.ask")}
            </Button>
          </Group>
        </Stack>
      </Drawer>
    </>
  );
}
