import { useEffect, useRef, useState } from "react";
import { Modal, Stack, Group, Text, Badge, Button, Code, RingProgress, Center, Box, ThemeIcon } from "@mantine/core";
import { IconShieldCheck, IconShieldX, IconAlertTriangle } from "@tabler/icons-react";
import { respondToolApproval, type ToolApprovalEvent } from "../../utils/api";
import { useT } from "../../i18n/I18nProvider";

interface Props {
  event: ToolApprovalEvent | null;
  onClose: () => void;
}

const TIMEOUT_SEC = 30;

export function ToolApprovalModal({ event, onClose }: Props) {
  const t = useT();
  const [secondsLeft, setSecondsLeft] = useState(TIMEOUT_SEC);
  const [loading, setLoading] = useState<"approve" | "reject" | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!event || event.type !== "request") return;
    const startMs = event.requestedAt ?? Date.now();
    const timeoutMs = event.timeoutMs ?? TIMEOUT_SEC * 1000;

    const update = () => {
      const elapsed = Date.now() - startMs;
      const remaining = Math.max(0, Math.ceil((timeoutMs - elapsed) / 1000));
      setSecondsLeft(remaining);
      if (remaining <= 0) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        onClose();
      }
    };

    update();
    intervalRef.current = setInterval(update, 500);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [event, onClose]);

  const handleDecision = async (decision: "approve" | "reject") => {
    if (!event?.id && !event?.requestId) return;
    const requestId = (event.id ?? event.requestId) as string;
    setLoading(decision);
    await respondToolApproval(requestId, decision);
    setLoading(null);
    onClose();
  };

  const isOpen = !!event && event.type === "request";
  const progressPct = (secondsLeft / TIMEOUT_SEC) * 100;
  const ringColor = secondsLeft > 15 ? "green" : secondsLeft > 7 ? "yellow" : "red";

  return (
    <Modal
      opened={isOpen}
      onClose={onClose}
      title={
        <Group gap="xs">
          <ThemeIcon color="orange" size="sm" variant="light">
            <IconAlertTriangle size={14} />
          </ThemeIcon>
          <Text fw={600} size="sm">
            {t('services.approvalTitle')}
          </Text>
        </Group>
      }
      size="md"
      centered
      closeOnClickOutside={false}
      closeOnEscape={false}
    >
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <Stack gap={4} style={{ flex: 1 }}>
            <Group gap="xs">
              <Badge variant="light" color="blue" size="sm">
                {event?.serviceLabel ?? event?.serviceId ?? ""}
              </Badge>
              <Badge variant="outline" color="gray" size="sm">
                {event?.toolName ?? ""}
              </Badge>
            </Group>
            <Text size="sm" c="dimmed" mt={4}>
              {event?.humanReadableDesc ?? t('services.defaultDesc')}
            </Text>
          </Stack>

          <Center style={{ flexShrink: 0 }}>
            <RingProgress
              size={64}
              thickness={6}
              roundCaps
              sections={[{ value: progressPct, color: ringColor }]}
              label={
                <Text ta="center" size="xs" fw={700} c={ringColor}>
                  {secondsLeft}s
                </Text>
              }
            />
          </Center>
        </Group>

        {event?.toolInput && Object.keys(event.toolInput).length > 0 && (
          <Box>
            <Text size="xs" c="dimmed" mb={4} fw={500}>
              {t('services.inputArgs')}
            </Text>
            <Code block style={{ fontSize: "var(--font-s)", maxHeight: 120, overflow: "auto" }}>
              {JSON.stringify(event.toolInput, null, 2)}
            </Code>
          </Box>
        )}

        <Text size="xs" c="dimmed">
          {t('services.autoRejectWarning', { sec: secondsLeft })}
        </Text>

        <Group justify="flex-end" gap="sm">
          <Button
            variant="light"
            color="red"
            leftSection={<IconShieldX size={14} />}
            loading={loading === "reject"}
            disabled={!!loading}
            onClick={() => handleDecision("reject")}
          >
            {t('services.reject')}
          </Button>
          <Button
            color="green"
            leftSection={<IconShieldCheck size={14} />}
            loading={loading === "approve"}
            disabled={!!loading}
            onClick={() => handleDecision("approve")}
          >
            {t('services.approve')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
