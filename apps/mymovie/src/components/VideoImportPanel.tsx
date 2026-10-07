"use client";

import { useState, useEffect } from "react";
import {
  Button, Card, Checkbox, Divider, Group, Stack, Text, TextInput,
} from "@mantine/core";
import { Dropzone, type FileWithPath } from "@mantine/dropzone";
import { notifications } from "@mantine/notifications";
import { IconLink, IconUpload, IconVideo, IconX } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { apiUrl } from "@/lib/api-url";

const YT_PATTERN = /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch|shorts)|youtu\.be\/)/i;

interface Props {
  onJobCreated: (jobId: string, title: string) => void;
  defaultUrl?: string;
}

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, "") || name;
}

function ytTitle(url: string): string {
  const u = url.trim();
  const m = u.match(/(?:youtu\.be\/|v=|shorts\/)([\w-]{6,})/);
  return m ? `YouTube ${m[1]}` : u.slice(0, 60);
}

// Reusable video import UI (YouTube URL + dropzone) to embed inside the editor
// preview area. No page-level title/header — just the card + divider + dropzone.
export default function VideoImportPanel({ onJobCreated, defaultUrl }: Props) {
  const { t } = useI18n();
  const [url, setUrl] = useState(defaultUrl ?? "");
  useEffect(() => { if (defaultUrl) setUrl(defaultUrl); }, [defaultUrl]);
  const [acknowledgeRights, setAcknowledgeRights] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);

  const urlValid = !url || YT_PATTERN.test(url.trim());
  const canSubmitUrl = !!url && urlValid && acknowledgeRights && !submitting;

  const submitYoutube = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(apiUrl("/api/ingest/youtube"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim(), acknowledgeRights }),
      });
      const data = (await res.json()) as { ok: boolean; jobId?: string; error?: string };
      if (!data.ok || !data.jobId) {
        notifications.show({ color: "red", title: t("input.error.network"), message: data.error ?? "" });
        return;
      }
      onJobCreated(data.jobId, ytTitle(url));
    } catch (err) {
      notifications.show({
        color: "red",
        title: t("input.error.network"),
        message: (err as Error).message,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const submitUpload = async (files: FileWithPath[]) => {
    const file = files[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(apiUrl("/api/ingest/upload"), { method: "POST", body: fd });
      const data = (await res.json()) as { ok: boolean; jobId?: string; error?: string };
      if (!data.ok || !data.jobId) {
        notifications.show({ color: "red", title: t("input.error.network"), message: data.error ?? "" });
        return;
      }
      onJobCreated(data.jobId, stripExt(file.name));
    } catch (err) {
      notifications.show({
        color: "red",
        title: t("input.error.network"),
        message: (err as Error).message,
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Stack gap="md">
      <Card
        withBorder
        radius="md"
        padding="lg"
        style={{
          background: "var(--bg-card)",
          borderColor: "var(--border-default)",
        }}
      >
        <Stack gap="md">
          <Text fw={500} size="sm" c="var(--text-muted)">
            {t("input.url.label")}
          </Text>
          <TextInput
            placeholder={t("input.url.placeholder")}
            leftSection={<IconLink size={16} />}
            value={url}
            onChange={(e) => setUrl(e.currentTarget.value)}
            error={urlValid ? undefined : t("input.url.invalid")}
            aria-label={t("input.url.label")}
          />
          <Checkbox
            label={t("input.rights.label")}
            description={t("input.rights.help")}
            checked={acknowledgeRights}
            onChange={(e) => setAcknowledgeRights(e.currentTarget.checked)}
            aria-label={t("input.rights.label")}
          />
          <Button variant="filled"
            fullWidth
            disabled={!canSubmitUrl}
            loading={submitting}
            onClick={submitYoutube}
            aria-label={t("input.analyze")}
          >
            {t("input.analyze")}
          </Button>
        </Stack>
      </Card>

      <Divider label={t("input.or")} labelPosition="center" />

      <Card
        withBorder
        radius="md"
        padding="md"
        style={{
          background: "var(--bg-card)",
          borderColor: "var(--border-default)",
        }}
      >
        <Dropzone
          onDrop={submitUpload}
          onReject={(rejects) => {
            const reason = rejects[0]?.errors[0]?.message ?? "rejected";
            notifications.show({ color: "red", title: t("input.error.format"), message: reason });
          }}
          maxSize={2 * 1024 * 1024 * 1024}
          accept={{
            "video/mp4": [".mp4"],
            "video/quicktime": [".mov"],
            "video/x-msvideo": [".avi"],
            "video/x-matroska": [".mkv"],
            "video/webm": [".webm"],
          }}
          loading={uploading}
          aria-label={t("input.drop.hint")}
          style={{
            border: "2px dashed var(--border-default)",
            borderRadius: "var(--radius-md)",
            background: "var(--bg-muted)",
            minHeight: 200,
          }}
        >
          <Group justify="center" gap="xl" mih={180} style={{ pointerEvents: "none" }}>
            <Dropzone.Accept>
              <IconUpload size={52} color="var(--ring)" />
            </Dropzone.Accept>
            <Dropzone.Reject>
              <IconX size={52} color="var(--accent-danger)" />
            </Dropzone.Reject>
            <Dropzone.Idle>
              <IconVideo size={52} color="var(--text-muted)" />
            </Dropzone.Idle>
            <Stack gap={4}>
              <Text size="md" fw={500}>{t("input.drop.hint")}</Text>
              <Text size="xs" c="var(--text-muted)">{t("input.drop.formats")}</Text>
            </Stack>
          </Group>
        </Dropzone>
      </Card>
    </Stack>
  );
}
