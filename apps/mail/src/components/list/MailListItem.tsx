"use client";

import { Box, Text, Group, Badge } from "@mantine/core";
import { IconStarFilled, IconStar, IconPaperclip } from "@tabler/icons-react";
import type { Mail, MailLabel, MailCategory, MailImportance } from "@/types/mail";
import { useI18n, intlLocale, type MessageKey, type Translator } from "@/lib/i18n";

const LABEL_BADGES: Partial<Record<MailLabel, { key: MessageKey; color: string }>> = {
  newsletter: { key: "badge.label.newsletter", color: "gray" },
  billing: { key: "badge.label.billing", color: "orange" },
  "reply-needed": { key: "badge.label.replyNeeded", color: "red" },
};

const CATEGORY_BADGES: Record<MailCategory, { key: MessageKey; color: string }> = {
  work: { key: "badge.category.work", color: "blue" },
  personal: { key: "badge.category.personal", color: "teal" },
  newsletter: { key: "badge.category.newsletter", color: "gray" },
  notification: { key: "badge.category.notification", color: "cyan" },
  spam: { key: "badge.category.spam", color: "red" },
};

// normal은 배지 미표시 (노이즈 방지)
const PRIORITY_BADGES: Partial<Record<MailImportance, { key: MessageKey; color: string }>> = {
  high: { key: "badge.priority.high", color: "red" },
  low: { key: "badge.priority.low", color: "gray" },
};

interface Props {
  mail: Mail;
  selected: boolean;
  onClick: () => void;
  onToggleStar: (e: React.MouseEvent) => void;
}

function formatDate(iso: string, locale: "ko" | "en" | "ja", t: Translator): string {
  const intl = intlLocale(locale);
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString(intl, { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return t("date.yesterday");
  return d.toLocaleDateString(intl, { month: "numeric", day: "numeric" });
}

export default function MailListItem({ mail, selected, onClick, onToggleStar }: Props) {
  const { t, locale } = useI18n();
  const isUnread = !mail.read;
  const labelBadge = mail.label ? LABEL_BADGES[mail.label] : undefined;
  const categoryBadge = mail.category ? CATEGORY_BADGES[mail.category] : undefined;
  const priorityBadge = mail.priority ? PRIORITY_BADGES[mail.priority] : undefined;

  function buildAttachment() {
    const from = mail.from.name
      ? `${mail.from.name} <${mail.from.email}>`
      : mail.from.email;
    const snippet = mail.body.slice(0, 1000);
    return {
      type: "mail" as const,
      name: mail.subject,
      content: t("list.dragContent", { from, subject: mail.subject, date: mail.date, snippet }),
    };
  }

  function handleDragStart(e: React.DragEvent<HTMLDivElement>) {
    const attachment = buildAttachment();
    e.dataTransfer.setData(
      "application/x-mycrew-attachment",
      JSON.stringify(attachment),
    );
    e.dataTransfer.effectAllowed = "copy";
    (e.currentTarget as HTMLElement).style.opacity = "0.6";
    window.parent.postMessage(
      { source: "mycrew-mail", type: "drag.start", payload: { attachment } },
      "*",
    );
  }

  function handleDragEnd(e: React.DragEvent<HTMLDivElement>) {
    (e.currentTarget as HTMLElement).style.opacity = "";
    window.parent.postMessage({ source: "mycrew-mail", type: "drag.end" }, "*");
  }

  return (
    <Box
      draggable
      onClick={onClick}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      style={{
        padding: "10px 16px",
        borderBottom: "1px solid var(--mantine-color-dark-5)",
        cursor: "grab",
        background: selected
          ? "var(--mantine-color-jarvis-9)"
          : isUnread
          ? "rgba(255,255,255,0.03)"
          : "transparent",
        borderLeft: selected ? "3px solid var(--mantine-color-jarvis-5)" : "3px solid transparent",
      }}
      onMouseEnter={(e) => {
        if (!selected) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)";
      }}
      onMouseLeave={(e) => {
        if (!selected)
          (e.currentTarget as HTMLElement).style.background = isUnread
            ? "rgba(255,255,255,0.03)"
            : "transparent";
      }}
    >
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap={8}>
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Group gap={6} mb={2} wrap="nowrap">
            {isUnread && (
              <Box
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "var(--mantine-color-jarvis-4)",
                  flexShrink: 0,
                  marginTop: 3,
                }}
              />
            )}
            <Text
              fz="sm"
              fw={isUnread ? 700 : 400}
              c={isUnread ? "white" : "dimmed"}
              style={{ flex: 1 }}
              truncate
            >
              {mail.from.name || mail.from.email}
            </Text>
          </Group>
          <Group gap={6} wrap="nowrap" mb={2}>
            <Text
              fz="sm"
              fw={isUnread ? 600 : 400}
              c={isUnread ? "white" : "dimmed"}
              truncate
              style={{ flex: 1, minWidth: 0 }}
            >
              {mail.subject}
            </Text>
            {priorityBadge && (
              <Badge
                size="xs"
                variant="filled"
                color={priorityBadge.color}
                title={mail.categoryReason}
                style={{ flexShrink: 0 }}
              >
                {t(priorityBadge.key)}
              </Badge>
            )}
            {categoryBadge && (
              <Badge
                size="xs"
                variant="light"
                color={categoryBadge.color}
                title={mail.categoryReason}
                style={{ flexShrink: 0 }}
              >
                {t(categoryBadge.key)}
              </Badge>
            )}
            {labelBadge && (
              <Badge
                size="xs"
                variant="light"
                color={labelBadge.color}
                style={{ flexShrink: 0 }}
              >
                {t(labelBadge.key)}
              </Badge>
            )}
          </Group>
          <Text fz="xs" c="dimmed" truncate>
            {mail.body.slice(0, 80)}
          </Text>
        </Box>
        <Box style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <Text fz="xs" c="dimmed">
            {formatDate(mail.date, locale, t)}
          </Text>
          <Group gap={4} wrap="nowrap">
            {mail.attachments && mail.attachments.length > 0 && (
              <IconPaperclip size={12} color="var(--mantine-color-dimmed)" />
            )}
            <Box
              onClick={onToggleStar}
              style={{ cursor: "pointer", lineHeight: 1 }}
            >
              {mail.starred ? (
                <IconStarFilled size={14} color="var(--mantine-color-yellow-5)" />
              ) : (
                <IconStar size={14} color="var(--mantine-color-dimmed)" />
              )}
            </Box>
          </Group>
        </Box>
      </Group>
    </Box>
  );
}
