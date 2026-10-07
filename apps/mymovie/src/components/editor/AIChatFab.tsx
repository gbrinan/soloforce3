"use client";

import { useState } from "react";
import {
  ActionIcon,
  Button,
  Drawer,
  Group,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { IconMessageChatbot, IconSend } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n/I18nProvider";

interface Props {
  // 사용자의 자연어 input → AI 디렉터 호출 트리거. 부모가 실제 fetch 수행.
  onSend: (intent: string) => Promise<void> | void;
  loading: boolean;
  // 영상이 준비되기 전에는 비활성 — render/AI fire 방지.
  disabled?: boolean;
}

export default function AIChatFab({ onSend, loading, disabled }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  const submit = async () => {
    const v = text.trim();
    if (!v) return;
    await onSend(v);
    setText("");
  };

  return (
    <>
      <ActionIcon
        size={56}
        radius="xl"
        variant="filled"
        color="jarvis"
        aria-label={t("editor.fab.title")}
        onClick={() => setOpen(true)}
        style={{
          position: "fixed",
          right: 24,
          bottom: 96,
          boxShadow: "var(--shadow-md, 0 4px 16px rgba(0,0,0,0.2))",
          zIndex: 1000,
        }}
      >
        <IconMessageChatbot size={28} />
      </ActionIcon>

      <Drawer
        opened={open}
        onClose={() => setOpen(false)}
        position="right"
        size="md"
        title={t("editor.fab.title")}
      >
        <Stack>
          <Text size="sm" c="var(--text-muted)">
            {disabled ? t("editor.fab.notReady") : t("editor.fab.hint")}
          </Text>
          <Textarea
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            minRows={4}
            autosize
            disabled={disabled}
            placeholder={t("editor.aiIntent")}
          />
          <Group justify="flex-end">
            <Button variant="filled"
              loading={loading}
              disabled={text.trim().length === 0 || disabled}
              leftSection={<IconSend size={14} />}
              onClick={() => void submit()}
            >
              {t("editor.fab.send")}
            </Button>
          </Group>
        </Stack>
      </Drawer>
    </>
  );
}
