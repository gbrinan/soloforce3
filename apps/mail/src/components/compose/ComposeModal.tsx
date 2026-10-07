"use client";

import { useState, useEffect, useRef } from "react";
import {
  Modal, Stack, Select, TextInput, TagsInput,
  Group, Button, Text, Collapse, Box, ActionIcon,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconSend, IconDeviceFloppy, IconSparkles, IconPaperclip, IconX } from "@tabler/icons-react";
import { useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import { RichTextEditor } from "@mantine/tiptap";
import { apiUrl } from "@/lib/api-url";
import { uploadAttachment, formatBytes } from "@/lib/upload-attachment";
import type { Mail, Mailbox, MailAttachment } from "@/types/mail";
import { useI18n, type MessageKey } from "@/lib/i18n";

export interface ComposeContext {
  mode: "new" | "reply" | "forward";
  mail?: Mail;
  attachments?: MailAttachment[];
  to?: string[];
}

interface Props {
  opened: boolean;
  context: ComposeContext | null;
  mailboxes: Mailbox[];
  onClose: () => void;
  onSent: () => void;
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

type AssistMode = "lengthen" | "shorten" | "formal" | "casual";

const ASSIST_MODES: Array<{ mode: AssistMode; labelKey: MessageKey }> = [
  { mode: "lengthen", labelKey: "compose.assist.lengthen" },
  { mode: "shorten", labelKey: "compose.assist.shorten" },
  { mode: "formal", labelKey: "compose.assist.formal" },
  { mode: "casual", labelKey: "compose.assist.casual" },
];

export default function ComposeModal({ opened, context, mailboxes, onClose, onSent }: Props) {
  const { t } = useI18n();
  const [fromId, setFromId] = useState<string | null>(mailboxes[0]?.id ?? null);
  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [bcc, setBcc] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [sending, setSending] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [attachments, setAttachments] = useState<MailAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [assisting, setAssisting] = useState<AssistMode | null>(null);
  const [prechecking, setPrechecking] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false }),
    ],
    content: "",
  });

  useEffect(() => {
    if (!opened || !editor) return;
    setAttachments(context?.attachments ?? []);
    if (context?.mode === "reply" && context.mail) {
      setTo([context.mail.from.email]);
      setSubject(`RE: ${context.mail.subject}`);
      editor.commands.setContent(
        `<p></p><p></p><hr><p><em>${t("compose.originalMail")}</em></p><p>${context.mail.body.replace(/\n/g, "<br>")}</p>`
      );
    } else if (context?.mode === "forward" && context.mail) {
      setTo([]);
      setSubject(`FW: ${context.mail.subject}`);
      editor.commands.setContent(
        `<p></p><p></p><hr><p><em>${t("compose.forwardedMail")}</em></p><p>${context.mail.body.replace(/\n/g, "<br>")}</p>`
      );
    } else {
      setTo(context?.to ?? []);
      setCc([]);
      setBcc([]);
      setSubject("");
      editor.commands.setContent("");
      setShowCc(false);
      setShowBcc(false);
    }
    if (mailboxes.length > 0) setFromId(mailboxes[0].id);
  }, [opened, context, mailboxes, editor]);

  const fromMailbox = mailboxes.find((m) => m.id === fromId);
  const canSend = to.length > 0 && subject.trim().length > 0 && !!fromMailbox;

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    try {
      for (const f of list) {
        const att = await uploadAttachment(f);
        setAttachments((prev) => [...prev, att]);
      }
    } catch {
      notifications.show({ color: "red", message: t("compose.attachUploadFail") });
    } finally {
      setUploading(false);
    }
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  async function handleSave() {
    if (!fromMailbox || !editor) return;
    setSavingDraft(true);
    try {
      const res = await fetch(apiUrl("/api/mails"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mailboxId: fromMailbox.id,
          folder: "draft",
          from: { email: fromMailbox.email, name: fromMailbox.displayName },
          to: to.map((e) => ({ email: e })),
          subject: subject || t("compose.noSubject"),
          body: editor.getHTML(),
          bodyType: "html",
          attachments: attachments.length ? attachments : undefined,
        }),
      });
      if (!res.ok) throw new Error("save failed");
      notifications.show({ color: "gray", message: t("compose.draftSaved") });
    } catch {
      notifications.show({ color: "red", message: t("compose.draftSaveFail") });
    } finally {
      setSavingDraft(false);
    }
  }

  async function handleSend() {
    if (!canSend || !fromMailbox || !editor) return;
    setSending(true);
    try {
      const res = await fetch(apiUrl("/api/mail/send"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mailboxId: fromMailbox.id,
          from: { email: fromMailbox.email, name: fromMailbox.displayName },
          to,
          cc: cc.length > 0 ? cc : undefined,
          bcc: bcc.length > 0 ? bcc : undefined,
          subject,
          body: editor.getHTML(),
          bodyType: "html",
          attachments: attachments.length ? attachments : undefined,
        }),
      });
      if (!res.ok) throw new Error("send failed");
      notifications.show({ color: "green", message: t("compose.sent") });
      onSent();
      onClose();
    } catch {
      notifications.show({ color: "red", title: t("compose.sendFailTitle"), message: t("compose.sendFailRetry") });
    } finally {
      setSending(false);
    }
  }

  async function handleSuggestReply() {
    if (!context?.mail || !editor) return;
    setSuggesting(true);
    try {
      const mail = context.mail;
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
      editor.commands.setContent(data.reply.replace(/\n/g, "<br>"));
    } catch {
      notifications.show({ color: "red", message: t("reader.suggestFail") });
    } finally {
      setSuggesting(false);
    }
  }

  async function handleAssist(mode: AssistMode) {
    if (!editor || assisting) return;
    const text = editor.getText().trim();
    if (!text) {
      notifications.show({ color: "gray", message: t("compose.enterBodyFirst") });
      return;
    }
    setAssisting(mode);
    try {
      const res = await fetch(apiUrl("/api/mail/assist"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, mode }),
      });
      if (!res.ok) throw new Error("assist failed");
      const data = (await res.json()) as { text: string };
      editor.commands.setContent(data.text.replace(/\n/g, "<br>"));
    } catch {
      notifications.show({ color: "red", message: t("compose.assistFail") });
    } finally {
      setAssisting(null);
    }
  }

  async function handlePrecheck() {
    if (!editor || prechecking) return;
    const bodyText = editor.getText().trim();
    if (!subject.trim() || !bodyText) {
      notifications.show({ color: "gray", message: t("compose.enterSubjectBodyFirst") });
      return;
    }
    setPrechecking(true);
    try {
      const res = await fetch(apiUrl("/api/mail/precheck"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          body: bodyText,
          to: to.join(", "),
          hasAttachment: attachments.length > 0,
        }),
      });
      if (!res.ok) throw new Error("precheck failed");
      const data = (await res.json()) as {
        warnings: Array<{ severity: "high" | "low"; message: string }>;
        ok: boolean;
      };
      if (data.ok || data.warnings.length === 0) {
        notifications.show({ color: "green", message: t("compose.precheckOk") });
        return;
      }
      const hasHigh = data.warnings.some((w) => w.severity === "high");
      notifications.show({
        color: hasHigh ? "red" : "yellow",
        title: t("compose.precheckWarnTitle", { n: data.warnings.length }),
        message: data.warnings.map((w) => `• ${w.message}`).join("\n"),
        autoClose: false,
        styles: { description: { whiteSpace: "pre-line" } },
      });
    } catch {
      notifications.show({ color: "red", message: t("compose.precheckFail") });
    } finally {
      setPrechecking(false);
    }
  }

  const title = context?.mode === "reply" ? t("reader.reply") : context?.mode === "forward" ? t("reader.forward") : t("compose.newMail");

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={title}
      styles={{
        inner: {
          overflow: "auto",
        },
        content: {
          background: "#151F32",
          resize: "both",
          overflow: "hidden",
          flex: "0 0 auto",
          width: "min(520px, 92vw)",
          height: "min(640px, 85vh)",
          minWidth: "min(480px, 92vw)",
          minHeight: 440,
          maxWidth: "95vw",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
        },
        header: { background: "#151F32", flexShrink: 0 },
        body: {
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        },
      }}
    >
      <Stack
        gap="xs"
        style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={(e) => {
          if (e.dataTransfer?.files?.length) {
            e.preventDefault();
            void uploadFiles(e.dataTransfer.files);
          }
        }}
      >
        <Select
          label={t("compose.from")}
          data={mailboxes.map((m) => ({ value: m.id, label: m.email }))}
          value={fromId}
          onChange={setFromId}
          size="sm"
          styles={{ input: { background: "#070D1A" } }}
        />

        <TagsInput
          label={t("compose.to")}
          placeholder={t("compose.emailEnterHint")}
          value={to}
          onChange={setTo}
          size="sm"
          styles={{ input: { background: "#070D1A" } }}
          splitChars={[",", " "]}
        />

        <Group gap={8}>
          {!showCc && (
            <Text
              fz="xs"
              c="dimmed"
              style={{ cursor: "pointer", textDecoration: "underline" }}
              onClick={() => setShowCc(true)}
            >
              {t("compose.addCc")}
            </Text>
          )}
          {!showBcc && (
            <Text
              fz="xs"
              c="dimmed"
              style={{ cursor: "pointer", textDecoration: "underline" }}
              onClick={() => setShowBcc(true)}
            >
              {t("compose.addBcc")}
            </Text>
          )}
        </Group>

        <Collapse expanded={showCc}>
          <TagsInput
            label={t("compose.cc")}
            placeholder={t("compose.emailEnterHint")}
            value={cc}
            onChange={setCc}
            size="sm"
            styles={{ input: { background: "#070D1A" } }}
            splitChars={[",", " "]}
          />
        </Collapse>

        <Collapse expanded={showBcc}>
          <TagsInput
            label={t("compose.bcc")}
            placeholder={t("compose.emailEnterHint")}
            value={bcc}
            onChange={setBcc}
            size="sm"
            styles={{ input: { background: "#070D1A" } }}
            splitChars={[",", " "]}
          />
        </Collapse>

        <TextInput
          label={t("compose.subject")}
          placeholder={t("compose.subjectPlaceholder")}
          value={subject}
          onChange={(e) => setSubject(e.currentTarget.value)}
          size="sm"
          styles={{ input: { background: "#070D1A" } }}
        />

        <Box style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <Group justify="space-between" align="center" mb={4}>
            <Text fz="sm" fw={500}>{t("compose.body")}</Text>
            <Group gap={4}>
              {ASSIST_MODES.map(({ mode, labelKey }) => (
                <Button
                  key={mode}
                  size="compact-xs"
                  variant="subtle"
                  color="gray"
                  loading={assisting === mode}
                  disabled={sending || (assisting !== null && assisting !== mode)}
                  onClick={() => void handleAssist(mode)}
                >
                  {t(labelKey)}
                </Button>
              ))}
            </Group>
          </Group>
          <RichTextEditor
            editor={editor}
            styles={{
              root: {
                border: "1px solid var(--mantine-color-dark-4)",
                borderRadius: 4,
                background: "#070D1A",
                flex: 1,
                minHeight: 0,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              },
              toolbar: {
                background: "#151F32",
                borderBottom: "1px solid var(--mantine-color-dark-4)",
                padding: "6px 8px",
                gap: 8,
                flexShrink: 0,
              },
              controlsGroup: {
                background: "transparent",
                border: "none",
                gap: 2,
              },
              control: {
                background: "transparent",
                border: "none",
                color: "var(--mantine-color-gray-4)",
                width: 28,
                height: 28,
              },
              Typography: {
                background: "#070D1A",
                flex: 1,
                minHeight: 0,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              },
              content: {
                background: "#070D1A",
                color: "white",
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
              },
            }}
          >
            <RichTextEditor.Toolbar>
              <RichTextEditor.ControlsGroup>
                <RichTextEditor.Bold />
                <RichTextEditor.Italic />
                <RichTextEditor.Underline />
              </RichTextEditor.ControlsGroup>
              <RichTextEditor.ControlsGroup>
                <RichTextEditor.BulletList />
                <RichTextEditor.OrderedList />
              </RichTextEditor.ControlsGroup>
              <RichTextEditor.ControlsGroup>
                <RichTextEditor.Link />
                <RichTextEditor.Unlink />
              </RichTextEditor.ControlsGroup>
            </RichTextEditor.Toolbar>
            <RichTextEditor.Content />
          </RichTextEditor>
        </Box>

        {attachments.length > 0 && (
          <Box style={{ display: "flex", flexWrap: "wrap", gap: 6, flexShrink: 0 }}>
            {attachments.map((a) => (
              <Group
                key={a.id}
                gap={6}
                wrap="nowrap"
                style={{
                  background: "#151F32",
                  border: "1px solid var(--mantine-color-dark-4)",
                  borderRadius: 4,
                  padding: "3px 6px 3px 8px",
                  maxWidth: 220,
                }}
              >
                <IconPaperclip size={13} style={{ flexShrink: 0, opacity: 0.7 }} />
                <Text fz="xs" truncate style={{ flex: 1 }}>{a.name}</Text>
                <Text fz="xs" c="dimmed" style={{ flexShrink: 0 }}>{formatBytes(a.size)}</Text>
                <ActionIcon size="xs" variant="subtle" color="gray" onClick={() => removeAttachment(a.id)} aria-label={t("compose.removeAttachment")}>
                  <IconX size={12} />
                </ActionIcon>
              </Group>
            ))}
          </Box>
        )}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.currentTarget.files) void uploadFiles(e.currentTarget.files);
            e.currentTarget.value = "";
          }}
        />

        <Box style={{ borderTop: "1px solid var(--mantine-color-dark-4)", paddingTop: 12, flexShrink: 0 }}>
          <Group justify="space-between">
            <Group gap={8}>
              <Button
                variant="subtle"
                color="gray"
                size="sm"
                leftSection={<IconPaperclip size={14} />}
                loading={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {t("compose.attach")}
              </Button>
              <Button
                variant="subtle"
                color="gray"
                size="sm"
                leftSection={<IconDeviceFloppy size={14} />}
                loading={savingDraft}
                disabled={sending}
                onClick={() => void handleSave()}
              >
                {t("compose.saveDraft")}
              </Button>
              <Button variant="subtle" color="gray" size="sm" onClick={onClose}>
                {t("common.cancel")}
              </Button>
              {context?.mode === "reply" && (
                <Button
                  variant="light"
                  color="jarvis"
                  size="sm"
                  leftSection={<IconSparkles size={14} />}
                  loading={suggesting}
                  disabled={sending}
                  onClick={() => void handleSuggestReply()}
                >
                  {t("reader.aiSuggestReply")}
                </Button>
              )}
            </Group>
            <Group gap={8}>
              <Button
                variant="light"
                color="gray"
                size="sm"
                leftSection={<IconSparkles size={14} />}
                loading={prechecking}
                disabled={sending}
                onClick={() => void handlePrecheck()}
              >
                {t("compose.precheck")}
              </Button>
              <Button variant="filled"
                color="jarvis"
                size="sm"
                leftSection={<IconSend size={14} />}
                disabled={!canSend || !to.every(validateEmail)}
                loading={sending}
                onClick={() => void handleSend()}
              >
                {t("common.send")}
              </Button>
            </Group>
          </Group>
        </Box>
      </Stack>
    </Modal>
  );
}
