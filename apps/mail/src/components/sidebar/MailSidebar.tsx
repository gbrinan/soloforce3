"use client";

import { Box, Text, Stack, Button, Badge, Group, ActionIcon } from "@mantine/core";
import {
  IconInbox,
  IconSend,
  IconFilePencil,
  IconStar,
  IconShield,
  IconTrash,
  IconPencilPlus,
  IconPlus,
  IconMail,
  IconSettings,
} from "@tabler/icons-react";
import type { MailFolder, Mailbox } from "@/types/mail";
import { useI18n, type MessageKey } from "@/lib/i18n";

interface Props {
  mailboxes: Mailbox[];
  selectedFolder: MailFolder;
  selectedMailboxId: string | null;
  unreadCounts: Record<MailFolder, number>;
  onSelectFolder: (folder: MailFolder) => void;
  onSelectMailbox: (id: string | null) => void;
  onManageMailboxes: () => void;
  onCompose: () => void;
  onSettings: () => void;
}

const FOLDERS: { id: MailFolder; labelKey: MessageKey; Icon: React.ComponentType<{ size?: number }> }[] = [
  { id: "inbox", labelKey: "folder.inbox", Icon: IconInbox },
  { id: "sent", labelKey: "folder.sent", Icon: IconSend },
  { id: "draft", labelKey: "folder.draft", Icon: IconFilePencil },
  { id: "starred", labelKey: "folder.starred", Icon: IconStar },
  { id: "spam", labelKey: "folder.spam", Icon: IconShield },
  { id: "trash", labelKey: "folder.trash", Icon: IconTrash },
];

function SidebarItem({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
}) {
  return (
    <Box
      onClick={onClick}
      style={{
        height: 36,
        padding: "0 8px",
        borderRadius: 6,
        display: "flex",
        alignItems: "center",
        gap: 8,
        cursor: "pointer",
        background: active ? "var(--mantine-color-jarvis-9)" : "transparent",
        color: active ? "var(--mantine-color-jarvis-3)" : "var(--mantine-color-gray-3)",
      }}
      onMouseEnter={(e) => {
        if (!active) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)";
      }}
      onMouseLeave={(e) => {
        if (!active) (e.currentTarget as HTMLElement).style.background = "transparent";
      }}
    >
      {icon}
      <Text fz="sm" style={{ flex: 1 }}>
        {label}
      </Text>
      {count != null && count > 0 && (
        <Badge color="jarvis" variant="filled" size="xs">
          {count}
        </Badge>
      )}
    </Box>
  );
}

export default function MailSidebar({
  mailboxes,
  selectedFolder,
  selectedMailboxId,
  unreadCounts,
  onSelectFolder,
  onSelectMailbox,
  onManageMailboxes,
  onCompose,
  onSettings,
}: Props) {
  const { t } = useI18n();
  return (
    <Box
      style={{
        width: 220,
        background: "#151F32",
        borderRight: "1px solid var(--mantine-color-dark-4)",
        padding: "12px 8px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        flexShrink: 0,
        overflowY: "auto",
      }}
    >
      <Button variant="filled"
        color="jarvis"
        fullWidth
        size="sm"
        leftSection={<IconPencilPlus size={15} />}
        mb={8}
        onClick={onCompose}
      >
        {t("sidebar.compose")}
      </Button>

      <Text fz="xs" fw={600} c="dimmed" tt="uppercase" px={8} mb={2}>
        {t("sidebar.folders")}
      </Text>
      <Stack gap={2}>
        {FOLDERS.map(({ id, labelKey, Icon }) => (
          <SidebarItem
            key={id}
            active={selectedFolder === id}
            onClick={() => onSelectFolder(id)}
            icon={<Icon size={16} />}
            label={t(labelKey)}
            count={unreadCounts[id]}
          />
        ))}
      </Stack>

      {mailboxes.length > 0 && (
        <>
          <Text fz="xs" fw={600} c="dimmed" tt="uppercase" px={8} mt={8} mb={2}>
            {t("sidebar.mailboxes")}
          </Text>
          <Stack gap={2}>
            <SidebarItem
              active={selectedMailboxId === null}
              onClick={() => onSelectMailbox(null)}
              icon={<IconMail size={16} />}
              label={t("sidebar.allMailboxes")}
            />
            {mailboxes.map((mb) => (
              <SidebarItem
                key={mb.id}
                active={selectedMailboxId === mb.id}
                onClick={() => onSelectMailbox(mb.id)}
                icon={<IconInbox size={16} />}
                label={mb.email}
              />
            ))}
          </Stack>
        </>
      )}

      <Box mt="auto" pt={8}>
        <Group
          gap={4}
          justify="space-between"
          style={{ padding: "4px 8px", borderRadius: 6 }}
        >
          <Group
            gap={4}
            style={{ cursor: "pointer", flex: 1 }}
            onClick={onManageMailboxes}
          >
            <IconPlus size={14} color="var(--mantine-color-dimmed)" />
            <Text fz="xs" c="dimmed">
              {t("sidebar.manageMailboxes")}
            </Text>
          </Group>
          <ActionIcon
            variant="subtle"
            color="gray"
            size="xs"
            aria-label={t("sidebar.settings")}
            onClick={onSettings}
          >
            <IconSettings size={13} />
          </ActionIcon>
        </Group>
      </Box>
    </Box>
  );
}
