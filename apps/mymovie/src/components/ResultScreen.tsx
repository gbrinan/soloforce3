"use client";

import { useEffect } from "react";
import { Button, Card, Group, Stack, Text, Title } from "@mantine/core";
import { IconArrowBackUp, IconDownload, IconMail } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { apiUrl } from "@/lib/api-url";

export interface ResultMeta {
  duration?: number; // ms 또는 seconds — 호출자 결정
  resolution?: string; // e.g. "1280x720"
  actionsApplied?: number;
}

interface Props {
  jobId: string;
  outputPath?: string;
  meta?: ResultMeta;
  onRestart?: () => void;
}

function fmtDuration(d?: number): string {
  if (d == null || !isFinite(d)) return "-";
  // 1000 이상이면 ms로 가정하고 초 변환, 아니면 그대로 초 단위.
  const sec = d >= 1000 ? Math.round(d / 1000) : Math.round(d);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function ResultScreen({ jobId, outputPath, meta, onRestart }: Props) {
  const { t } = useI18n();

  // host(부모 iframe)에 결과 준비 알림
  useEffect(() => {
    if (typeof window !== "undefined" && window.parent !== window) {
      window.parent.postMessage(
        { source: "mycrew-mymovie", type: "result.ready", jobId, outputPath },
        "*",
      );
    }
  }, [jobId, outputPath]);

  const videoSrc = apiUrl(`/api/render/${jobId}`);
  const downloadHref = apiUrl(`/api/render/${jobId}?download=1`);

  const downloadFcpXml = async () => {
    try {
      const res = await fetch(apiUrl(`/api/render/${jobId}`), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ injectActions: [], format: "fcpxml" }),
      });
      if (!res.ok) {
        alert(`FCP XML export failed: ${res.status}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mymovie-${jobId}.fcpxml`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(`FCP XML export error: ${(e as Error).message}`);
    }
  };

  return (
    <Stack gap="lg" align="center" style={{ padding: "var(--space-6)" }}>
      <Title order={2} ta="center" fz="var(--font-xl)" fw={700} mt="var(--space-4)">
        {t("result.preview")}
      </Title>

      <Card
        withBorder
        radius="md"
        padding="lg"
        w="100%"
        maw={720}
        style={{
          background: "var(--bg-card)",
          borderColor: "var(--border-default)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <Stack gap="md">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            controls
            preload="metadata"
            src={videoSrc}
            style={{ width: "100%", maxWidth: 720, borderRadius: 10, background: "#000" }}
            aria-label={t("result.preview")}
          />

          <Group gap="lg" wrap="wrap">
            <Text size="sm">
              <Text span fw={500}>{t("result.duration")}:</Text> {fmtDuration(meta?.duration)}
            </Text>
            <Text size="sm">
              <Text span fw={500}>{t("result.resolution")}:</Text> {meta?.resolution ?? "-"}
            </Text>
            <Text size="sm">
              <Text span fw={500}>{t("result.actions")}:</Text> {meta?.actionsApplied ?? 0}
            </Text>
          </Group>

          <Group>
            <Button variant="filled"
              component="a"
              href={downloadHref}
              download={`mymovie-${jobId}.mp4`}
              leftSection={<IconDownload size={16} />}
              aria-label={t("result.download")}
            >
              {t("result.download")} (MP4)
            </Button>
            <Button
              variant="default"
              leftSection={<IconDownload size={16} />}
              onClick={downloadFcpXml}
              aria-label="Download FCP XML"
            >
              FCP XML
            </Button>
            {window.parent !== window && (
              <Button
                variant="default"
                leftSection={<IconMail size={16} />}
                onClick={() => {
                  window.parent.postMessage(
                    { source: "mycrew-mymovie", type: "asset.handoff", payload: { targetAppId: "mail", kind: "video", dataUrl: videoSrc, name: `mymovie-${jobId}.mp4` } },
                    "*",
                  );
                }}
                aria-label={t("result.send-to-mail")}
              >
                {t("result.send-to-mail")}
              </Button>
            )}
            <Button
              variant="default"
              leftSection={<IconArrowBackUp size={16} />}
              onClick={onRestart}
              aria-label={t("result.restart")}
            >
              {t("result.restart")}
            </Button>
          </Group>
        </Stack>
      </Card>
    </Stack>
  );
}
