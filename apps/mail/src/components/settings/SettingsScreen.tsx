"use client";

import { useState } from "react";
import {
  Box, Stack, Text, Group, Button, ActionIcon,
  TextInput, Select, Switch, Divider,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconArrowLeft } from "@tabler/icons-react";
import type { Mailbox } from "@/types/mail";
import { useI18n } from "@/lib/i18n";

interface Props {
  mailboxes: Mailbox[];
  onBack: () => void;
}

const SETTINGS_KEY = "mymail-settings";

interface Settings {
  appName: string;
  defaultMailboxId: string;
  notifyNewMail: boolean;
  notifySound: boolean;
  showPreview: boolean;
  pageSize: string;
}

function loadSettings(defaultMailboxId: string): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw) as Settings;
  } catch {}
  return {
    appName: "MyMail",
    defaultMailboxId,
    notifyNewMail: true,
    notifySound: false,
    showPreview: true,
    pageSize: "25",
  };
}

export default function SettingsScreen({ mailboxes, onBack }: Props) {
  const { t } = useI18n();
  const defaultMbId = mailboxes[0]?.id ?? "";
  const [settings, setSettings] = useState<Settings>(() => loadSettings(defaultMbId));

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((s) => ({ ...s, [key]: value }));
  }

  function handleSave() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      notifications.show({ color: "green", message: t("settings.saved") });
    } catch {
      notifications.show({ color: "red", message: t("common.saveFail") });
    }
  }

  const ROW = {
    height: 52,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottom: "1px solid var(--mantine-color-dark-4)",
  };

  return (
    <Box style={{ maxWidth: 560 }}>
      <Group gap={8} mb={24}>
        <ActionIcon variant="subtle" color="gray" onClick={onBack}>
          <IconArrowLeft size={18} />
        </ActionIcon>
        <Text fz="md" fw={600} c="white">{t("settings.title")}</Text>
      </Group>

      <Stack gap={0}>
        <Text fz="xs" fw={600} c="dimmed" tt="uppercase" mb={4}>{t("settings.general")}</Text>

        <Box style={ROW}>
          <Text fz="sm">{t("settings.appName")}</Text>
          <TextInput
            size="sm"
            value={settings.appName}
            onChange={(e) => update("appName", e.currentTarget.value)}
            style={{ width: 200 }}
            styles={{ input: { background: "#151F32" } }}
          />
        </Box>

        <Box style={ROW}>
          <Text fz="sm">{t("settings.defaultMailbox")}</Text>
          <Select
            size="sm"
            data={mailboxes.map((m) => ({ value: m.id, label: m.email }))}
            value={settings.defaultMailboxId}
            onChange={(v) => update("defaultMailboxId", v ?? defaultMbId)}
            style={{ width: 200 }}
            styles={{ input: { background: "#151F32" } }}
          />
        </Box>

        <Divider color="dark" my={16} />
        <Text fz="xs" fw={600} c="dimmed" tt="uppercase" mb={4}>{t("settings.notifications")}</Text>

        <Box style={ROW}>
          <Text fz="sm">{t("settings.notifyNewMail")}</Text>
          <Switch
            color="jarvis"
            checked={settings.notifyNewMail}
            onChange={(e) => update("notifyNewMail", e.currentTarget.checked)}
          />
        </Box>

        <Box style={ROW}>
          <Text fz="sm">{t("settings.notifySound")}</Text>
          <Switch
            color="jarvis"
            checked={settings.notifySound}
            onChange={(e) => update("notifySound", e.currentTarget.checked)}
          />
        </Box>

        <Divider color="dark" my={16} />
        <Text fz="xs" fw={600} c="dimmed" tt="uppercase" mb={4}>{t("settings.display")}</Text>

        <Box style={ROW}>
          <Text fz="sm">{t("settings.showPreview")}</Text>
          <Switch
            color="jarvis"
            checked={settings.showPreview}
            onChange={(e) => update("showPreview", e.currentTarget.checked)}
          />
        </Box>

        <Box style={ROW}>
          <Text fz="sm">{t("settings.pageSize")}</Text>
          <Select
            size="sm"
            data={["10", "25", "50", "100"]}
            value={settings.pageSize}
            onChange={(v) => update("pageSize", v ?? "25")}
            style={{ width: 100 }}
            styles={{ input: { background: "#151F32" } }}
          />
        </Box>

        <Divider color="dark" my={16} />

        <Group justify="space-between" align="center">
          <Text fz="xs" c="dimmed">{t("settings.version", { v: "0.1.0" })}</Text>
          <Button variant="filled" color="jarvis" size="sm" onClick={handleSave}>
            {t("common.save")}
          </Button>
        </Group>
      </Stack>
    </Box>
  );
}
