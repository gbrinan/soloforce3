"use client";

import { useState, useEffect } from "react";
import {
  Box, Text, Group, Stack, Avatar, ActionIcon,
  Button, Textarea, Menu, Divider, NumberInput, TextInput, Select, Modal,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconStar, IconStarFilled, IconCornerUpLeft, IconCornerUpRight,
  IconDotsVertical, IconTrash, IconMail, IconSend, IconSparkles,
  IconChevronLeft, IconListDetails, IconCalendarEvent, IconCalendarPlus,
  IconX, IconReceipt2, IconCheck, IconDownload, IconExternalLink,
  IconCopy, IconPrinter, IconFile,
} from "@tabler/icons-react";
import { apiUrl } from "@/lib/api-url";
import type { Mail, MailAttachment } from "@/types/mail";
import { useI18n, intlLocale, type Locale, type MessageKey } from "@/lib/i18n";

interface Props {
  mail: Mail | null;
  onReply: () => void;
  onForward: () => void;
  onDelete: () => void;
  onToggleStar: () => void;
  onQuickReply: (body: string) => Promise<void>;
  onBack?: () => void;
}

function formatFullDate(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleString(intlLocale(locale), {
    year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

interface ThreadSummary {
  summary: string[];
  actionItems: string[];
  messageCount?: number;
}

interface ExtractedEvent {
  title: string;
  date: string;
  time?: string;
  location?: string;
}

// extract-billing 라우트의 BillingDraft 와 동일 형태 (category = ledger categoryId)
interface BillingDraft {
  amount: number;
  merchant: string;
  date: string;
  category: string;
  memo: string;
}

// ledger DEFAULT_CATEGORIES(expense) 와 정합한 선택지 (label은 i18n 키 — 렌더 시 t()로 해석)
const CATEGORY_OPTIONS: { value: string; labelKey: MessageKey }[] = [
  { value: "food", labelKey: "ledgerCat.food" },
  { value: "cafe", labelKey: "ledgerCat.cafe" },
  { value: "alcohol", labelKey: "ledgerCat.alcohol" },
  { value: "transport", labelKey: "ledgerCat.transport" },
  { value: "shopping", labelKey: "ledgerCat.shopping" },
  { value: "housing", labelKey: "ledgerCat.housing" },
  { value: "health", labelKey: "ledgerCat.health" },
  { value: "leisure", labelKey: "ledgerCat.leisure" },
  { value: "subscription", labelKey: "ledgerCat.subscription" },
  { value: "education", labelKey: "ledgerCat.education" },
  { value: "gift", labelKey: "ledgerCat.gift" },
  { value: "utilities", labelKey: "ledgerCat.utilities" },
  { value: "etc-expense", labelKey: "ledgerCat.etc" },
];

export default function MailContentPanel({
  mail,
  onReply,
  onForward,
  onDelete,
  onToggleStar,
  onQuickReply,
  onBack,
}: Props) {
  const { t, locale } = useI18n();
  const [replyBody, setReplyBody] = useState("");
  const [sending, setSending] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [summary, setSummary] = useState<ThreadSummary | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [events, setEvents] = useState<ExtractedEvent[] | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingDraft, setBillingDraft] = useState<BillingDraft | null>(null);
  const [savingBilling, setSavingBilling] = useState(false);
  // 첨부 미리보기 모달 대상
  const [previewAtt, setPreviewAtt] = useState<MailAttachment | null>(null);

  // Reset AI panels when switching mails
  useEffect(() => {
    setSummary(null);
    setEvents(null);
    setBillingDraft(null);
    setPreviewAtt(null);
  }, [mail?.id]);

  // ── 첨부 액션 ─────────────────────────────────────────────────────────────
  const attUrl = (att: MailAttachment) => apiUrl(`/api/mail/attachments/${att.id}`);
  const isImageAtt = (att: MailAttachment) =>
    att.mimeType.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(att.name);

  const downloadAtt = (att: MailAttachment) => {
    const a = document.createElement("a");
    a.href = attUrl(att);
    a.download = att.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const openAttTab = (att: MailAttachment) => window.open(attUrl(att), "_blank", "noopener");
  const printAtt = (att: MailAttachment) => {
    const w = window.open("", "_blank");
    if (!w) return;
    const src = attUrl(att);
    const content = isImageAtt(att)
      ? `<img src="${src}" style="max-width:100%" onload="window.focus();window.print();">`
      : `<iframe src="${src}" style="border:0;width:100%;height:100vh" onload="window.focus();window.print();"></iframe>`;
    w.document.write(`<!DOCTYPE html><title>${att.name}</title><body style="margin:0">${content}</body>`);
    w.document.close();
  };
  const copyAtt = async (att: MailAttachment) => {
    if (!isImageAtt(att)) {
      notifications.show({ color: "yellow", message: t("att.copyUnsupported") });
      return;
    }
    try {
      const blob = await (await fetch(attUrl(att))).blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
      notifications.show({ color: "green", message: t("att.copied") });
    } catch {
      notifications.show({ color: "red", message: t("att.copyFail") });
    }
  };

  if (!mail) {
    return (
      <Box
        style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        <Stack align="center" gap="md">
          <IconMail size={64} style={{ opacity: 0.2 }} color="gray" />
          <Text fz="sm" c="dimmed">{t("reader.selectMail")}</Text>
        </Stack>
      </Box>
    );
  }

  async function handleSuggestReply() {
    if (!mail) return;
    setSuggesting(true);
    try {
      const res = await fetch(apiUrl("/api/mail/suggest-reply"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: mail.subject,
          from: mail.from.name ? `${mail.from.name} <${mail.from.email}>` : mail.from.email,
          body: mail.body,
        }),
      });
      if (!res.ok) throw new Error("suggest failed");
      const data = (await res.json()) as { reply: string };
      setReplyBody(data.reply);
    } catch {
      notifications.show({ color: "red", message: t("reader.suggestFail") });
    } finally {
      setSuggesting(false);
    }
  }

  async function handleSummarize() {
    if (!mail) return;
    setSummarizing(true);
    try {
      // 서버가 같은 대화(스레드) 메일을 모아 3~5문장 요약 + 액션 아이템 반환
      const res = await fetch(apiUrl("/api/mail/summarize-thread"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mailId: mail.id }),
      });
      if (!res.ok) throw new Error("summarize failed");
      const data = (await res.json()) as ThreadSummary;
      setSummary(data);
    } catch {
      notifications.show({ color: "red", message: t("reader.summarizeFail") });
    } finally {
      setSummarizing(false);
    }
  }

  async function handleExtractEvents() {
    if (!mail) return;
    setExtracting(true);
    try {
      const res = await fetch(apiUrl("/api/mail/extract-events"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: mail.subject, body: mail.body }),
      });
      if (!res.ok) throw new Error("extract failed");
      const data = (await res.json()) as { events: ExtractedEvent[] };
      if (data.events.length === 0) {
        notifications.show({ color: "gray", message: t("reader.noEvents") });
        setEvents(null);
      } else {
        setEvents(data.events);
      }
    } catch {
      notifications.show({ color: "red", message: t("reader.extractEventsFail") });
    } finally {
      setExtracting(false);
    }
  }

  function handleAddSchedule(event: ExtractedEvent) {
    if (!mail) return;
    // No booking/schedule bridge in host-bridge.ts — use minimal postMessage link.
    window.parent.postMessage(
      {
        source: "mycrew-mail",
        type: "mail:add-schedule",
        payload: { ...event, mailId: mail.id, subject: mail.subject },
      },
      "*",
    );
    notifications.show({ color: "green", message: t("reader.scheduleRequested") });
  }

  async function handleExtractBilling() {
    if (!mail) return;
    setBillingLoading(true);
    try {
      const res = await fetch(apiUrl("/api/mail/extract-billing"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: mail.subject, body: mail.body }),
      });
      if (!res.ok) throw new Error("extract failed");
      const data = (await res.json()) as { isBilling: boolean; draft?: BillingDraft };
      if (!data.isBilling || !data.draft) {
        notifications.show({ color: "gray", message: t("reader.notBilling") });
        setBillingDraft(null);
      } else {
        setBillingDraft(data.draft);
      }
    } catch {
      notifications.show({ color: "red", message: t("reader.extractBillingFail") });
    } finally {
      setBillingLoading(false);
    }
  }

  async function handleSaveBilling() {
    if (!billingDraft) return;
    setSavingBilling(true);
    try {
      const memo = billingDraft.merchant
        ? billingDraft.memo
          ? `${billingDraft.merchant} — ${billingDraft.memo}`
          : billingDraft.merchant
        : billingDraft.memo;
      // ledger 프록시로 직접 기입: 브라우저 세션 인증. 서버 크로스앱 호출 아님.
      const res = await fetch("/api/apps/ledger/proxy/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "expense",
          amount: billingDraft.amount,
          date: billingDraft.date,
          categoryId: billingDraft.category,
          memo,
        }),
      });
      if (!res.ok) throw new Error("ledger post failed");
      notifications.show({ color: "green", message: t("reader.ledgerSaved") });
      setBillingDraft(null);
    } catch {
      notifications.show({ color: "red", message: t("reader.ledgerSaveFail") });
    } finally {
      setSavingBilling(false);
    }
  }

  async function handleQuickReply() {
    const body = replyBody.trim();
    if (!body) return;
    setSending(true);
    try {
      await onQuickReply(body);
      setReplyBody("");
      notifications.show({ color: "green", message: t("reader.replySent") });
    } catch {
      notifications.show({ color: "red", message: t("reader.sendFail") });
    } finally {
      setSending(false);
    }
  }

  const initials = (mail.from.name ?? mail.from.email).slice(0, 2).toUpperCase();

  return (
    <Box
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "#070D1A",
      }}
    >
      {/* Toolbar */}
      <Box
        style={{
          height: 48,
          padding: "0 16px",
          borderBottom: "1px solid var(--mantine-color-dark-4)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexShrink: 0,
          background: "#070D1A",
        }}
      >
        {onBack && (
          <ActionIcon variant="subtle" color="gray" onClick={onBack} aria-label={t("reader.backToList")}>
            <IconChevronLeft size={16} />
          </ActionIcon>
        )}
        <ActionIcon variant="subtle" color="gray" onClick={onToggleStar} aria-label={t("reader.toggleStar")}>
          {mail.starred
            ? <IconStarFilled size={16} color="var(--mantine-color-yellow-5)" />
            : <IconStar size={16} />}
        </ActionIcon>
        <Button
          size="xs"
          color="jarvis"
          variant="light"
          leftSection={<IconCornerUpLeft size={13} />}
          onClick={onReply}
        >
          {t("reader.reply")}
        </Button>
        <ActionIcon variant="subtle" color="gray" onClick={onForward} aria-label={t("reader.forward")}>
          <IconCornerUpRight size={16} />
        </ActionIcon>
        <Button
          size="xs"
          variant="subtle"
          color="gray"
          leftSection={<IconListDetails size={13} />}
          loading={summarizing}
          onClick={() => void handleSummarize()}
        >
          {t("reader.summarize")}
        </Button>
        <Button
          size="xs"
          variant="subtle"
          color="gray"
          leftSection={<IconCalendarEvent size={13} />}
          loading={extracting}
          onClick={() => void handleExtractEvents()}
        >
          {t("reader.events")}
        </Button>
        <Button
          size="xs"
          variant="subtle"
          color="gray"
          leftSection={<IconReceipt2 size={13} />}
          loading={billingLoading}
          onClick={() => void handleExtractBilling()}
        >
          {t("reader.saveToLedger")}
        </Button>
        <Box style={{ flex: 1 }} />
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <ActionIcon variant="subtle" color="gray" aria-label={t("common.more")}>
              <IconDotsVertical size={16} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              color="red"
              leftSection={<IconTrash size={14} />}
              onClick={onDelete}
            >
              {t("common.delete")}
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Box>

      {/* Content */}
      <Box style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
        <Text fz="lg" fw={700} c="white" mb={16}>
          {mail.subject}
        </Text>

        {/* Sender bar */}
        <Box
          style={{
            background: "#151F32",
            borderRadius: 10,
            padding: "12px 16px",
            border: "1px solid var(--mantine-color-dark-4)",
            marginBottom: 24,
          }}
        >
          <Group justify="space-between" align="flex-start" wrap="nowrap">
            <Group gap={12} align="flex-start" wrap="nowrap">
              <Avatar size={36} color="jarvis" radius="xl">
                {initials}
              </Avatar>
              <Stack gap={2}>
                <Text fz="sm" fw={600} c="white">
                  {mail.from.name ?? mail.from.email}
                </Text>
                <Text fz="xs" c="dimmed">
                  {mail.from.email}
                </Text>
                <Text fz="xs" c="dimmed">
                  {t("reader.recipients", { emails: mail.to.map((r) => r.email).join(", ") })}
                </Text>
              </Stack>
            </Group>
            <Text fz="xs" c="dimmed" style={{ flexShrink: 0 }}>
              {formatFullDate(mail.date, locale)}
            </Text>
          </Group>
        </Box>

        {/* AI summary card */}
        {summary && (
          <Box
            style={{
              background: "#151F32",
              borderRadius: 10,
              padding: "12px 16px",
              border: "1px solid var(--mantine-color-dark-4)",
              marginBottom: 24,
            }}
          >
            <Group justify="space-between" mb={8}>
              <Text fz="xs" fw={600} c="dimmed" tt="uppercase">
                {t("reader.threadSummary")}{summary.messageCount && summary.messageCount > 1 ? t("reader.threadSummaryCount", { n: summary.messageCount }) : ""}
              </Text>
              <ActionIcon size="xs" variant="subtle" color="gray" onClick={() => setSummary(null)} aria-label={t("reader.closeSummary")}>
                <IconX size={12} />
              </ActionIcon>
            </Group>
            <Stack gap={4}>
              {summary.summary.map((line, i) => (
                <Text key={i} fz="sm" c="white">• {line}</Text>
              ))}
            </Stack>
            {summary.actionItems.length > 0 && (
              <>
                <Text fz="xs" fw={600} c="dimmed" tt="uppercase" mt={12} mb={4}>{t("reader.actionItems")}</Text>
                <Stack gap={4}>
                  {summary.actionItems.map((item, i) => (
                    <Text key={i} fz="sm" c="white">☐ {item}</Text>
                  ))}
                </Stack>
              </>
            )}
          </Box>
        )}

        {/* Extracted events card */}
        {events && events.length > 0 && (
          <Box
            style={{
              background: "#151F32",
              borderRadius: 10,
              padding: "12px 16px",
              border: "1px solid var(--mantine-color-dark-4)",
              marginBottom: 24,
            }}
          >
            <Group justify="space-between" mb={8}>
              <Text fz="xs" fw={600} c="dimmed" tt="uppercase">{t("reader.detectedEvents")}</Text>
              <ActionIcon size="xs" variant="subtle" color="gray" onClick={() => setEvents(null)} aria-label={t("reader.closeEvents")}>
                <IconX size={12} />
              </ActionIcon>
            </Group>
            <Stack gap={8}>
              {events.map((ev, i) => (
                <Group key={i} justify="space-between" wrap="nowrap" gap={8}>
                  <Box style={{ minWidth: 0 }}>
                    <Text fz="sm" fw={600} c="white" truncate>{ev.title}</Text>
                    <Text fz="xs" c="dimmed">
                      {ev.date}
                      {ev.time ? ` ${ev.time}` : ""}
                      {ev.location ? ` · ${ev.location}` : ""}
                    </Text>
                  </Box>
                  <Button
                    size="xs"
                    variant="light"
                    color="jarvis"
                    leftSection={<IconCalendarPlus size={13} />}
                    style={{ flexShrink: 0 }}
                    onClick={() => handleAddSchedule(ev)}
                  >
                    {t("reader.addSchedule")}
                  </Button>
                </Group>
              ))}
            </Stack>
          </Box>
        )}

        {/* Billing draft card */}
        {billingDraft && (
          <Box
            style={{
              background: "#151F32",
              borderRadius: 10,
              padding: "12px 16px",
              border: "1px solid var(--mantine-color-dark-4)",
              marginBottom: 24,
            }}
          >
            <Group justify="space-between" mb={8}>
              <Text fz="xs" fw={600} c="dimmed" tt="uppercase">{t("reader.billingDraft")}</Text>
              <ActionIcon size="xs" variant="subtle" color="gray" onClick={() => setBillingDraft(null)} aria-label={t("reader.closeDraft")}>
                <IconX size={12} />
              </ActionIcon>
            </Group>
            <Stack gap={8}>
              <Group grow gap={8} wrap="nowrap">
                <NumberInput
                  label={t("reader.amount")}
                  size="xs"
                  thousandSeparator=","
                  min={0}
                  value={billingDraft.amount}
                  onChange={(v) =>
                    setBillingDraft({ ...billingDraft, amount: typeof v === "number" ? v : Number(v) || 0 })
                  }
                  styles={{ input: { background: "#0B1220" } }}
                />
                <TextInput
                  label={t("reader.date")}
                  size="xs"
                  placeholder="YYYY-MM-DD"
                  value={billingDraft.date}
                  onChange={(e) => setBillingDraft({ ...billingDraft, date: e.currentTarget.value })}
                  styles={{ input: { background: "#0B1220" } }}
                />
              </Group>
              <TextInput
                label={t("reader.merchant")}
                size="xs"
                value={billingDraft.merchant}
                onChange={(e) => setBillingDraft({ ...billingDraft, merchant: e.currentTarget.value })}
                styles={{ input: { background: "#0B1220" } }}
              />
              <Select
                label={t("reader.category")}
                size="xs"
                data={CATEGORY_OPTIONS.map((c) => ({ value: c.value, label: t(c.labelKey) }))}
                value={billingDraft.category}
                onChange={(v) => v && setBillingDraft({ ...billingDraft, category: v })}
                comboboxProps={{ withinPortal: true }}
                styles={{ input: { background: "#0B1220" } }}
              />
              <TextInput
                label={t("reader.memo")}
                size="xs"
                value={billingDraft.memo}
                onChange={(e) => setBillingDraft({ ...billingDraft, memo: e.currentTarget.value })}
                styles={{ input: { background: "#0B1220" } }}
              />
              <Group justify="flex-end">
                <Button
                  size="xs"
                  color="jarvis"
                  leftSection={<IconCheck size={13} />}
                  loading={savingBilling}
                  disabled={!billingDraft.amount || !/^\d{4}-\d{2}-\d{2}$/.test(billingDraft.date)}
                  onClick={() => void handleSaveBilling()}
                >
                  {t("reader.saveToLedger")}
                </Button>
              </Group>
            </Stack>
          </Box>
        )}

        {/* Body */}
        <Box style={{ marginBottom: 24 }}>
          {mail.bodyType === "html" ? (
            <iframe
              srcDoc={mail.body}
              sandbox="allow-same-origin"
              title={t("reader.mailBody")}
              style={{ width: "100%", border: "none", minHeight: 300, background: "#070D1A" }}
            />
          ) : (
            <Text
              fz="sm"
              c="white"
              style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}
            >
              {mail.body}
            </Text>
          )}
        </Box>

        {/* Attachments */}
        {mail.attachments && mail.attachments.length > 0 && (
          <>
            <Divider color="dark" mb={16} />
            <Text fz="xs" fw={600} c="dimmed" tt="uppercase" mb={8}>
              {t("reader.attachments", { n: mail.attachments.length })}
            </Text>
            <Group gap={10} wrap="wrap" mb={16}>
              {mail.attachments.map((att) => (
                <Box
                  key={att.id}
                  onClick={() => setPreviewAtt(att)}
                  title={att.name}
                  style={{
                    width: 132,
                    borderRadius: 8,
                    overflow: "hidden",
                    border: "1px solid var(--mantine-color-dark-4)",
                    background: "#151F32",
                    cursor: "pointer",
                  }}
                >
                  {/* 이미지 첨부는 썸네일, 그 외는 파일 아이콘 */}
                  <Box style={{ height: 88, display: "flex", alignItems: "center", justifyContent: "center", background: "#0B1220" }}>
                    {isImageAtt(att) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={attUrl(att)} alt={att.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <IconFile size={34} color="var(--mantine-color-dark-2)" />
                    )}
                  </Box>
                  <Box style={{ padding: "6px 8px" }}>
                    <Text fz="xs" fw={600} truncate>{att.name}</Text>
                    <Text fz="xs" c="dimmed">{(att.size / 1024).toFixed(0)} KB</Text>
                  </Box>
                </Box>
              ))}
            </Group>
          </>
        )}

        {/* Quick reply */}
        {mail.folder !== "trash" && mail.folder !== "spam" && (
          <>
            <Divider color="dark" mb={16} />
            <Textarea
              placeholder={t("reader.replyPlaceholder")}
              minRows={3}
              autosize
              maxRows={8}
              value={replyBody}
              onChange={(e) => setReplyBody(e.currentTarget.value)}
              styles={{
                input: { background: "#151F32", border: "1px solid var(--mantine-color-dark-4)" },
              }}
              mb={8}
            />
            <Group justify="space-between">
              <Button
                size="sm"
                variant="light"
                color="jarvis"
                leftSection={<IconSparkles size={14} />}
                loading={suggesting}
                disabled={sending}
                onClick={() => void handleSuggestReply()}
              >
                {t("reader.aiSuggestReply")}
              </Button>
              <Button variant="filled"
                size="sm"
                color="jarvis"
                leftSection={<IconSend size={14} />}
                disabled={!replyBody.trim()}
                loading={sending}
                onClick={() => void handleQuickReply()}
              >
                {t("common.send")}
              </Button>
            </Group>
          </>
        )}
      </Box>

      {/* 첨부 미리보기 모달 + 더보기 메뉴 */}
      <Modal
        opened={!!previewAtt}
        onClose={() => setPreviewAtt(null)}
        size="xl"
        centered
        withCloseButton={false}
        padding={0}
        styles={{ content: { background: "#0B1220" }, body: { padding: 0 } }}
      >
        {previewAtt && (
          <Stack gap={0}>
            <Group justify="space-between" wrap="nowrap" p="12px 16px" style={{ borderBottom: "1px solid var(--mantine-color-dark-4)" }}>
              <Box style={{ minWidth: 0 }}>
                <Text fz="sm" fw={600} truncate>{previewAtt.name}</Text>
                <Text fz="xs" c="dimmed">{(previewAtt.size / 1024).toFixed(0)} KB</Text>
              </Box>
              <Group gap={4} wrap="nowrap">
                <Menu position="bottom-end" withinPortal>
                  <Menu.Target>
                    <ActionIcon variant="subtle" color="gray" aria-label={t("att.more")}>
                      <IconDotsVertical size={18} />
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item leftSection={<IconCopy size={16} />} onClick={() => void copyAtt(previewAtt)}>
                      {t("att.copy")}
                    </Menu.Item>
                    <Menu.Item leftSection={<IconDownload size={16} />} onClick={() => downloadAtt(previewAtt)}>
                      {t("att.download")}
                    </Menu.Item>
                    <Menu.Item leftSection={<IconExternalLink size={16} />} onClick={() => openAttTab(previewAtt)}>
                      {t("att.openTab")}
                    </Menu.Item>
                    <Menu.Item leftSection={<IconPrinter size={16} />} onClick={() => printAtt(previewAtt)}>
                      {t("att.print")}
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
                <ActionIcon variant="subtle" color="gray" aria-label={t("att.close")} onClick={() => setPreviewAtt(null)}>
                  <IconX size={18} />
                </ActionIcon>
              </Group>
            </Group>
            <Box p={16} style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 200, maxHeight: "72vh", overflow: "auto" }}>
              {isImageAtt(previewAtt) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={attUrl(previewAtt)} alt={previewAtt.name} style={{ maxWidth: "100%", maxHeight: "68vh", objectFit: "contain", borderRadius: 6 }} />
              ) : (
                <Stack align="center" gap={12} py={32}>
                  <IconFile size={48} color="var(--mantine-color-dark-2)" />
                  <Text fz="sm" c="dimmed" ta="center">{t("att.unsupported")}</Text>
                  <Button variant="light" color="jarvis" leftSection={<IconDownload size={16} />} onClick={() => downloadAtt(previewAtt)}>
                    {t("att.download")}
                  </Button>
                </Stack>
              )}
            </Box>
          </Stack>
        )}
      </Modal>
    </Box>
  );
}
