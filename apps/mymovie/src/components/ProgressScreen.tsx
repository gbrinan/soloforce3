"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Group, Progress, Stack, Text, Title } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { apiUrl } from "@/lib/api-url";

type Stage = "queued" | "downloading" | "transcoding" | "done" | "error";

interface JobView {
  id: string;
  stage: Stage;
  progress: number;
  message?: string;
  outputPath?: string;
  proxyPath?: string;
}

export interface RenderCompleteMeta {
  duration?: number;
  resolution?: string;
  actionsApplied?: number;
  outputPath?: string;
}

interface Props {
  jobId: string;
  onReset: () => void;
  onComplete?: (jobId: string, meta: RenderCompleteMeta) => void;
}

interface RenderResponse {
  ok: boolean;
  jobId?: string;
  finalPath?: string;
  sizeBytes?: number;
  appliedActionIds?: string[];
  failedActionIds?: string[];
  warnings?: { actionId: string; reason: string }[];
  llmProvider?: string | null;
  error?: string;
  director?: { signals?: { meta?: { durationMs?: number; width?: number; height?: number } } };
}

const POLL_MS = 1000;
type RenderState = "idle" | "running" | "done" | "error";

export default function ProgressScreen({ jobId, onReset, onComplete }: Props) {
  const { t } = useI18n();
  const [job, setJob] = useState<JobView | null>(null);
  const [renderState, setRenderState] = useState<RenderState>("idle");
  const [renderError, setRenderError] = useState<string | null>(null);
  const renderStartedRef = useRef(false);

  // 인제스트 잡 폴링
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(apiUrl(`/api/ingest/jobs/${jobId}`), { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { ok: boolean; job?: JobView };
        if (cancelled) return;
        if (data.ok && data.job) setJob(data.job);
      } catch {
        /* 네트워크 일시 오류는 무시 — 다음 폴링에서 회복 */
      }
    };
    void tick();
    const interval = setInterval(() => {
      if (!cancelled) void tick();
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [jobId]);

  // 인제스트 done 감지 → 렌더 자동 시작 (1회)
  useEffect(() => {
    if (renderStartedRef.current) return;
    if (job?.stage !== "done") return;
    renderStartedRef.current = true;
    setRenderState("running");
    (async () => {
      try {
        const res = await fetch(apiUrl(`/api/render/${jobId}`), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        });
        // Proxy/server errors may return plain text (e.g. "app 'movie' unreachable"),
        // so parse defensively instead of res.json() which throws on non-JSON.
        const raw = await res.text();
        let data: RenderResponse | null = null;
        try {
          data = raw ? (JSON.parse(raw) as RenderResponse) : null;
        } catch {
          data = null;
        }
        if (!res.ok || !data || !data.ok) {
          const detail = data?.error ?? (raw ? raw.slice(0, 200) : `HTTP ${res.status}`);
          setRenderError(detail || t("error.render"));
          setRenderState("error");
          return;
        }
        const sig = data.director?.signals?.meta;
        const meta: RenderCompleteMeta = {
          duration: sig?.durationMs,
          resolution:
            sig?.width && sig?.height ? `${sig.width}x${sig.height}` : undefined,
          actionsApplied: data.appliedActionIds?.length ?? 0,
          outputPath: data.finalPath,
        };
        setRenderState("done");
        onComplete?.(jobId, meta);
      } catch (err) {
        setRenderError((err as Error).message);
        setRenderState("error");
      }
    })();
  }, [job?.stage, jobId, onComplete, t]);

  const stageLabel = (s: Stage) => t(`progress.stage.${s}`);
  const isIngestError = job?.stage === "error";
  const isError = isIngestError || renderState === "error";

  // 통합 진행률 표시: 인제스트 50% + 렌더 50%
  // 렌더는 응답 받기 전까지 비결정적이라 "running"이면 65%, "done"이면 100%로 표기.
  let overallPct = 0;
  let overallLabel = stageLabel("queued");
  if (job) {
    if (job.stage === "done") {
      if (renderState === "idle" || renderState === "running") {
        overallPct = 50 + 35;
        overallLabel = t("progress.note");
      } else if (renderState === "done") {
        overallPct = 100;
        overallLabel = stageLabel("done");
      } else {
        overallPct = 50;
        overallLabel = t("error.render");
      }
    } else if (job.stage === "transcoding" || job.stage === "downloading") {
      overallPct = Math.round(job.progress * 0.5);
      overallLabel = stageLabel(job.stage);
    } else if (job.stage === "queued") {
      overallPct = 0;
      overallLabel = stageLabel("queued");
    } else if (job.stage === "error") {
      overallPct = job.progress * 0.5;
      overallLabel = stageLabel("error");
    }
  }

  return (
    <Stack gap="lg" align="center" style={{ padding: "var(--space-6)" }}>
      <Title order={1} ta="center" fz="var(--font-xl)" fw={700} mt="var(--space-6)">
        {t("progress.title")}
      </Title>

      <Card
        withBorder
        radius="md"
        padding="lg"
        w="100%"
        maw={600}
        style={{
          background: "var(--bg-card)",
          borderColor: "var(--border-default)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <Stack gap="md">
          <Group justify="space-between">
            <Text fw={500}>{overallLabel}</Text>
            <Text size="sm" c="var(--text-muted)">
              {Math.round(overallPct)}%
            </Text>
          </Group>
          <Progress
            value={overallPct}
            color={isError ? "red" : renderState === "done" ? "green" : "blue"}
            animated={!isError && renderState !== "done"}
            striped={!isError && renderState !== "done"}
            size="md"
            radius="sm"
            aria-valuenow={Math.round(overallPct)}
            aria-valuemin={0}
            aria-valuemax={100}
          />
          <Text size="xs" c="var(--text-muted)">{t("progress.note")}</Text>

          {isIngestError && (
            <Alert
              color="red"
              icon={<IconAlertTriangle size={16} />}
              title={t("progress.error.title")}
            >
              {job?.message ?? ""}
            </Alert>
          )}
          {renderState === "error" && (
            <Alert
              color="red"
              icon={<IconAlertTriangle size={16} />}
              title={t("error.render")}
            >
              {renderError ?? ""}
            </Alert>
          )}
        </Stack>
      </Card>

      <Group>
        <Button variant="subtle" onClick={onReset} aria-label={t("progress.back")}>
          {isError ? t("progress.back") : t("progress.cancel")}
        </Button>
      </Group>
    </Stack>
  );
}
