"use client";

import { Group, Box, Text } from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";

export default function StepIndicator({ current }: { current: number }) {
  const { t } = useI18n();
  const STEPS = [t("step.host"), t("step.datetime"), t("step.info"), t("step.confirm")];
  return (
    <Group justify="center" gap={0} py="sm" px="md" wrap="nowrap">
      {STEPS.map((label, i) => {
        const step = i + 1;
        const done = current > step;
        const active = current === step;
        return (
          <Group key={step} gap={0} align="center" wrap="nowrap">
            <Box
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background:
                  done || active
                    ? "var(--mantine-color-jarvis-6)"
                    : "var(--mantine-color-dark-5)",
                border: active ? "2px solid var(--mantine-color-jarvis-4)" : "2px solid transparent",
                flexShrink: 0,
                transition: "all .2s",
              }}
            >
              {done ? (
                <IconCheck size={13} color="#fff" />
              ) : (
                <Text size="xs" fw={700} c={active ? "#fff" : "dimmed"} lh={1}>
                  {step}
                </Text>
              )}
            </Box>
            <Text
              size="xs"
              c={active ? "jarvis.4" : "dimmed"}
              fw={active ? 600 : 400}
              mx={4}
              style={{ whiteSpace: "nowrap" }}
            >
              {label}
            </Text>
            {i < STEPS.length - 1 && (
              <Box
                style={{
                  width: 16,
                  height: 2,
                  background: done
                    ? "var(--mantine-color-jarvis-6)"
                    : "var(--mantine-color-dark-4)",
                  borderRadius: 1,
                  margin: "0 2px",
                  flexShrink: 0,
                }}
              />
            )}
          </Group>
        );
      })}
    </Group>
  );
}
