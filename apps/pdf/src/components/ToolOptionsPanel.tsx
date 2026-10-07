"use client";

import { useState } from "react";
import {
  Box,
  Button,
  FileButton,
  Group,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
  ActionIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconUpload,
  IconX,
  IconPlayerPlay,
  IconDownload,
  IconMail,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { type PdfTool } from "@/lib/stirling";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { postAssetHandoffToHost } from "@/lib/host-bridge";

// Cap dataURL size for handoff. postMessage tolerates large strings but the
// mail compose flow re-fetches the data URL, decodes base64, then uploads —
// huge results stall the UI. 25 MB matches typical SMTP attachment caps.
const HANDOFF_MAX_BYTES = 25 * 1024 * 1024;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

function kindFromMime(mime: string): "image" | "video" | "file" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "file";
}

interface ToolOptionsPanelProps {
  tool: PdfTool;
  files: File[];
  params: Record<string, string>;
  loading: boolean;
  resultUrl: string | null;
  onFilesChange: (files: File[]) => void;
  onParamChange: (name: string, value: string) => void;
  onReset: () => void;
  onRun: () => void;
}

export default function ToolOptionsPanel({
  tool,
  files,
  params,
  loading,
  resultUrl,
  onFilesChange,
  onParamChange,
  onReset,
  onRun,
}: ToolOptionsPanelProps) {
  const { t } = useI18n();
  const [sending, setSending] = useState(false);

  const clearFiles = () => onFilesChange([]);
  const onFilesPicked = (picked: File | File[] | null) => {
    if (!picked) { onFilesChange([]); return; }
    onFilesChange(Array.isArray(picked) ? picked : [picked]);
  };

  const sendResultToMail = async () => {
    if (!resultUrl || sending) return;
    setSending(true);
    try {
      const res = await fetch(resultUrl);
      if (!res.ok) throw new Error(`fetch result ${res.status}`);
      const blob = await res.blob();
      if (blob.size > HANDOFF_MAX_BYTES) {
        notifications.show({
          color: "yellow",
          message: t("mail.tooLarge").replace("{mb}", String(Math.round(blob.size / 1024 / 1024))),
        });
        return;
      }
      const dataUrl = await blobToDataUrl(blob);
      postAssetHandoffToHost({
        targetAppId: "mail",
        kind: kindFromMime(blob.type),
        dataUrl,
        name: tool.outName,
      });
    } catch (err) {
      notifications.show({ color: "red", message: t("mail.sendFailed").replace("{err}", String(err)) });
    } finally {
      setSending(false);
    }
  };

  const fileLabel =
    files.length === 0
      ? t("files.none")
      : files.length === 1
      ? files[0].name
      : t("files.count").replace("{n}", String(files.length));

  return (
    <Box
      style={{
        width: 280,
        flexShrink: 0,
        background: "#070D1A",
        borderLeft: "1px solid #1B2740",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <ScrollArea style={{ flex: "1 1 auto" }} type="auto">
        {/* pb=96: keep action buttons clear of the floating chat FAB (right:24, bottom:24, 56px) */}
        <Box p="md" pb={96}>
          <Stack gap="md">
            {/* Tool header */}
            <Box>
              <Title order={4} c="gray.0" mb={4}>
                {tool.icon} {t(tool.labelKey)}
              </Title>
              <Text size="xs" c="dimmed" lh={1.5}>
                {t(tool.descKey)}
              </Text>
            </Box>

            {/* File upload area */}
            <Paper p="sm" radius="md" bg="dark.7" withBorder style={{ borderColor: "#1B2740" }}>
              <Stack gap="sm">
                <FileButton
                  onChange={onFilesPicked}
                  accept={tool.accept}
                  multiple={tool.multiple}
                >
                  {(props) => (
                    <Button
                      {...props}
                      variant="light"
                      color="jarvis"
                      size="sm"
                      leftSection={<IconUpload size={14} />}
                      fullWidth
                    >
                      {tool.multiple ? t("files.selectMulti") : t("files.select")}
                    </Button>
                  )}
                </FileButton>

                {files.length > 0 && (
                  <Group gap={6} wrap="nowrap">
                    <Text size="xs" c="gray.3" truncate style={{ flex: 1, minWidth: 0 }}>
                      {fileLabel}
                    </Text>
                    <Tooltip label={t("action.clear")} openDelay={300}>
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        size="xs"
                        onClick={clearFiles}
                        aria-label={t("action.clear")}
                      >
                        <IconX size={12} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                )}
              </Stack>
            </Paper>

            {/* Params */}
            {tool.params.length > 0 && (
              <Paper p="sm" radius="md" bg="dark.7" withBorder style={{ borderColor: "#1B2740" }}>
                <Stack gap="sm">
                  {tool.params.map((p) =>
                    p.type === "select" ? (
                      <Select
                        key={p.name}
                        label={t(p.labelKey)}
                        data={(p.options ?? []).map((o) => ({
                          value: o.value,
                          label: t(o.labelKey),
                        }))}
                        value={params[p.name] ?? p.def}
                        onChange={(v) => onParamChange(p.name, v ?? p.def)}
                        allowDeselect={false}
                        size="sm"
                        styles={{
                          label: { color: "#9DB7EB", fontSize: 12 },
                        }}
                      />
                    ) : (
                      <TextInput
                        key={p.name}
                        label={t(p.labelKey)}
                        type={p.type === "number" ? "number" : "text"}
                        value={params[p.name] ?? p.def}
                        onChange={(e) => onParamChange(p.name, e.currentTarget.value)}
                        size="sm"
                        styles={{
                          label: { color: "#9DB7EB", fontSize: 12 },
                        }}
                      />
                    )
                  )}
                </Stack>
              </Paper>
            )}

            {/* Action buttons — below options in natural flow */}
            <Stack gap="sm">
              <Group gap="sm" grow wrap="nowrap">
                <Button
                  variant="subtle"
                  color="gray"
                  size="sm"
                  onClick={onReset}
                  px={4}
                >
                  {t("action.clear")}
                </Button>
                <Button variant="filled"
                  size="sm"
                  color="jarvis"
                  loading={loading}
                  disabled={files.length === 0}
                  leftSection={<IconPlayerPlay size={14} />}
                  onClick={onRun}
                >
                  {loading ? t("action.running") : t("action.run")}
                </Button>
              </Group>

              {resultUrl && (
                <>
                  <Button
                    component="a"
                    href={resultUrl}
                    download={tool.outName}
                    color="teal"
                    variant="filled"
                    size="sm"
                    leftSection={<IconDownload size={14} />}
                    fullWidth
                  >
                    {t("action.download")}
                  </Button>
                  <Button
                    variant="light"
                    color="jarvis"
                    size="sm"
                    leftSection={<IconMail size={14} />}
                    loading={sending}
                    onClick={() => void sendResultToMail()}
                    fullWidth
                  >
                    {t("mail.send")}
                  </Button>
                </>
              )}
            </Stack>
          </Stack>
        </Box>
      </ScrollArea>
    </Box>
  );
}
