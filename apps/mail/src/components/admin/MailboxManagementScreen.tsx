"use client";

import { useState } from "react";
import {
  Box, Stack, Text, Group, Button, ActionIcon,
  Modal, TextInput, Radio, Menu, Divider,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconArrowLeft, IconPlus, IconEdit, IconDotsVertical, IconTrash, IconInbox,
} from "@tabler/icons-react";
import { apiUrl } from "@/lib/api-url";
import type { Mailbox } from "@/types/mail";
import { useI18n } from "@/lib/i18n";

interface Props {
  mailboxes: Mailbox[];
  onRefresh: () => void;
  onBack: () => void;
}

type ForwardType = "none" | "telegram" | "email";

export default function MailboxManagementScreen({ mailboxes, onRefresh, onBack }: Props) {
  const { t } = useI18n();
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Mailbox | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [emailPrefix, setEmailPrefix] = useState("");
  const [forwardType, setForwardType] = useState<ForwardType>("none");
  const [forwardValue, setForwardValue] = useState("");
  const [saving, setSaving] = useState(false);

  const DOMAIN = "mycrew.com";

  function openNew() {
    setEditTarget(null);
    setDisplayName("");
    setEmailPrefix("");
    setForwardType("none");
    setForwardValue("");
    setModalOpen(true);
  }

  function openEdit(mb: Mailbox) {
    setEditTarget(mb);
    setDisplayName(mb.displayName);
    setEmailPrefix(mb.email.split("@")[0]);
    setForwardType((mb.forwardTo?.type as ForwardType) ?? "none");
    setForwardValue(mb.forwardTo?.value ?? "");
    setModalOpen(true);
  }

  async function handleSave() {
    if (!displayName.trim() || !emailPrefix.trim()) return;
    setSaving(true);
    try {
      const payload = {
        email: `${emailPrefix.trim()}@${DOMAIN}`,
        displayName: displayName.trim(),
        ...(forwardType !== "none" && forwardValue.trim()
          ? { forwardTo: { type: forwardType, value: forwardValue.trim() } }
          : {}),
      };
      const url = editTarget
        ? apiUrl(`/api/mailboxes/${editTarget.id}`)
        : apiUrl("/api/mailboxes");
      const res = await fetch(url, {
        method: editTarget ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("save failed");
      notifications.show({ color: "green", message: editTarget ? t("admin.updated") : t("admin.added") });
      setModalOpen(false);
      onRefresh();
    } catch {
      notifications.show({ color: "red", message: t("common.saveFail") });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(mb: Mailbox) {
    if (!confirm(t("admin.deleteConfirm", { email: mb.email }))) return;
    try {
      await fetch(apiUrl(`/api/mailboxes/${mb.id}`), { method: "DELETE" });
      notifications.show({ color: "green", message: t("admin.deleted") });
      onRefresh();
    } catch {
      notifications.show({ color: "red", message: t("common.deleteFail") });
    }
  }

  return (
    <Box style={{ maxWidth: 600 }}>
      <Group justify="space-between" align="center" mb={24}>
        <Group gap={8}>
          <ActionIcon variant="subtle" color="gray" onClick={onBack} aria-label={t("common.back")}>
            <IconArrowLeft size={18} />
          </ActionIcon>
          <Text fz="md" fw={600} c="white">{t("admin.title")}</Text>
        </Group>
        <Button variant="filled"
          color="jarvis"
          size="sm"
          leftSection={<IconPlus size={14} />}
          onClick={openNew}
        >
          {t("admin.newMailbox")}
        </Button>
      </Group>

      <Stack gap={8}>
        {mailboxes.length === 0 && (
          <Text fz="sm" c="dimmed" ta="center" py={32}>
            {t("admin.empty")}
          </Text>
        )}
        {mailboxes.map((mb) => (
          <Box
            key={mb.id}
            style={{
              background: "#151F32",
              borderRadius: 10,
              padding: 16,
              border: "1px solid var(--mantine-color-dark-4)",
            }}
          >
            <Group justify="space-between" align="center" wrap="nowrap">
              <Group gap={12} wrap="nowrap">
                <IconInbox size={20} color="var(--mantine-color-jarvis-4)" />
                <Box>
                  <Text fz="sm" fw={600} c="white">{mb.email}</Text>
                  <Text fz="xs" c="dimmed">{mb.displayName}</Text>
                  {mb.forwardTo && (
                    <Text fz="xs" c="dimmed">
                      {t("admin.forwardPrefix")} {mb.forwardTo.type === "telegram" ? "Telegram" : t("admin.forwardEmail")}{" "}
                      {mb.forwardTo.value}
                    </Text>
                  )}
                </Box>
              </Group>
              <Group gap={4} wrap="nowrap">
                <Button
                  size="xs"
                  variant="subtle"
                  color="jarvis"
                  leftSection={<IconEdit size={12} />}
                  onClick={() => openEdit(mb)}
                >
                  {t("common.edit")}
                </Button>
                <Menu position="bottom-end" withinPortal>
                  <Menu.Target>
                    <ActionIcon variant="subtle" color="gray" size="sm" aria-label={t("common.more")}>
                      <IconDotsVertical size={14} />
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item
                      color="red"
                      leftSection={<IconTrash size={14} />}
                      onClick={() => void handleDelete(mb)}
                    >
                      {t("common.delete")}
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              </Group>
            </Group>
          </Box>
        ))}
      </Stack>

      <Modal
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editTarget ? t("admin.editMailbox") : t("admin.addMailbox")}
        styles={{ content: { background: "#151F32" }, header: { background: "#151F32" } }}
      >
        <Stack gap="sm">
          <TextInput
            label={t("admin.displayName")}
            placeholder={t("admin.displayNamePlaceholder")}
            value={displayName}
            onChange={(e) => setDisplayName(e.currentTarget.value)}
            styles={{ input: { background: "#070D1A" } }}
          />
          <Box>
            <Text fz="xs" fw={500} c="dimmed" mb={4}>{t("admin.emailAddress")}</Text>
            <Group gap={4} wrap="nowrap">
              <TextInput
                placeholder="hello"
                value={emailPrefix}
                onChange={(e) => setEmailPrefix(e.currentTarget.value)}
                style={{ flex: 1 }}
                styles={{ input: { background: "#070D1A" } }}
              />
              <Text fz="sm" c="dimmed">@{DOMAIN}</Text>
            </Group>
          </Box>

          <Divider color="dark" />

          <Text fz="xs" fw={600} c="dimmed" tt="uppercase">{t("admin.forwarding")}</Text>
          <Radio.Group value={forwardType} onChange={(v) => setForwardType(v as ForwardType)}>
            <Stack gap={4}>
              <Radio value="none" label={t("admin.forwardNone")} color="jarvis" />
              <Radio value="telegram" label="Telegram" color="jarvis" />
              <Radio value="email" label={t("admin.forwardExtEmail")} color="jarvis" />
            </Stack>
          </Radio.Group>

          {forwardType !== "none" && (
            <TextInput
              placeholder={forwardType === "telegram" ? "@username" : "ext@example.com"}
              value={forwardValue}
              onChange={(e) => setForwardValue(e.currentTarget.value)}
              styles={{ input: { background: "#070D1A" } }}
            />
          )}

          <Button variant="filled"
            color="jarvis"
            fullWidth
            loading={saving}
            disabled={!displayName.trim() || !emailPrefix.trim()}
            onClick={() => void handleSave()}
          >
            {t("common.save")}
          </Button>
        </Stack>
      </Modal>
    </Box>
  );
}
