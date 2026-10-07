"use client";

import { useState, type CSSProperties } from "react";
import { Box, Text, Skeleton, Stack, Group, Badge, ActionIcon, TextInput } from "@mantine/core";
import { IconInboxOff, IconMenu2, IconSearch, IconX } from "@tabler/icons-react";
import MailListItem from "./MailListItem";
import type { Mail, MailFolder } from "@/types/mail";
import { useI18n, intlLocale, type MessageKey, type Translator, type Locale } from "@/lib/i18n";

const FOLDER_LABEL_KEYS: Record<MailFolder, MessageKey> = {
  inbox: "folder.inbox",
  sent: "folder.sent",
  draft: "folder.draft",
  starred: "folder.starred",
  spam: "folder.spam",
  trash: "folder.trash",
};

interface Props {
  mails: Mail[];
  selectedMailId: string | null;
  loading: boolean;
  folder: MailFolder;
  searchQuery: string;
  onSelect: (id: string) => void;
  onToggleStar: (id: string) => void;
  onSearchChange: (q: string) => void;
  rootStyle?: CSSProperties;
  onOpenMenu?: () => void;
}

function groupByDate(mails: Mail[], locale: Locale, t: Translator): { label: string; mails: Mail[] }[] {
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  const intl = intlLocale(locale);
  const groups: Map<string, Mail[]> = new Map();

  for (const m of mails) {
    const d = new Date(m.date).toDateString();
    const label = d === today ? t("date.today") : d === yesterday ? t("date.yesterday") : new Date(m.date).toLocaleDateString(intl, { year: "numeric", month: "long", day: "numeric" });
    (groups.get(label) ?? groups.set(label, []).get(label)!).push(m);
  }

  return Array.from(groups.entries()).map(([label, mails]) => ({ label, mails }));
}

export default function MailListPanel({
  mails,
  selectedMailId,
  loading,
  folder,
  searchQuery,
  onSelect,
  onToggleStar,
  onSearchChange,
  rootStyle,
  onOpenMenu,
}: Props) {
  const { t, locale } = useI18n();
  const [searchOpen, setSearchOpen] = useState(false);
  const unreadCount = mails.filter((m) => !m.read).length;

  const filtered = searchQuery
    ? mails.filter(
        (m) =>
          m.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
          m.from.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (m.from.name ?? "").toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : mails;

  const groups = groupByDate(filtered, locale, t);

  return (
    <Box
      style={{
        width: "min(360px, 100%)",
        borderRight: "1px solid var(--mantine-color-dark-4)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        overflowY: "auto",
        ...rootStyle,
      }}
    >
      {/* Panel header */}
      <Box
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--mantine-color-dark-4)",
          flexShrink: 0,
          background: "#070D1A",
        }}
      >
        <Group gap={8} align="center">
          {onOpenMenu && (
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              aria-label={t("list.openMenu")}
              onClick={onOpenMenu}
            >
              <IconMenu2 size={16} />
            </ActionIcon>
          )}
          <Text fz="sm" fw={600} c="white">
            {t(FOLDER_LABEL_KEYS[folder])}
          </Text>
          {unreadCount > 0 && (
            <Badge color="jarvis" variant="filled" size="xs">
              {unreadCount}
            </Badge>
          )}
          <Box style={{ flex: 1 }} />
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            aria-label={t("list.search")}
            onClick={() => {
              if (searchOpen) onSearchChange("");
              setSearchOpen((o) => !o);
            }}
          >
            {searchOpen ? <IconX size={14} /> : <IconSearch size={14} />}
          </ActionIcon>
        </Group>
        {searchOpen && (
          <TextInput
            mt={8}
            placeholder={t("list.searchPlaceholder")}
            leftSection={<IconSearch size={13} />}
            size="xs"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.currentTarget.value)}
            autoFocus
            styles={{
              input: { background: "#070D1A", border: "1px solid var(--mantine-color-dark-4)", color: "white" },
            }}
          />
        )}
      </Box>

      {/* List */}
      <Box style={{ flex: 1, overflowY: "auto" }}>
        {loading ? (
          <Stack gap={0}>
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} height={72} mb={1} radius={0} />
            ))}
          </Stack>
        ) : filtered.length === 0 ? (
          <Stack align="center" justify="center" gap="md" py={48} px={24}>
            <IconInboxOff size={48} style={{ opacity: 0.3 }} color="gray" />
            <Text fz="sm" c="dimmed" ta="center">
              {searchQuery ? t("list.noSearchResults") : t("list.empty")}
            </Text>
          </Stack>
        ) : (
          groups.map(({ label, mails: groupMails }) => (
            <Box key={label}>
              <Box
                style={{
                  padding: "6px 16px",
                  position: "sticky",
                  top: 0,
                  background: "#070D1A",
                  borderBottom: "1px solid var(--mantine-color-dark-5)",
                  zIndex: 1,
                }}
              >
                <Text fz="xs" fw={600} c="dimmed" tt="uppercase">
                  {label}
                </Text>
              </Box>
              {groupMails.map((m) => (
                <MailListItem
                  key={m.id}
                  mail={m}
                  selected={m.id === selectedMailId}
                  onClick={() => onSelect(m.id)}
                  onToggleStar={(e) => {
                    e.stopPropagation();
                    onToggleStar(m.id);
                  }}
                />
              ))}
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}
