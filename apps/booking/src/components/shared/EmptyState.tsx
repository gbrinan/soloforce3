"use client";

import type { ReactNode } from "react";
import { Button, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconCalendar } from "@tabler/icons-react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <Stack
      align="center"
      gap="sm"
      p="xl"
      style={{
        minHeight: 220,
        justifyContent: "center",
        textAlign: "center",
        borderRadius: "var(--mantine-radius-xl)",
        background: "#151F32",
      }}
    >
      <ThemeIcon size={48} radius="xl" variant="light" color="gray">
        {icon ?? <IconCalendar size={28} />}
      </ThemeIcon>
      <Text size="lg" fw={600}>
        {title}
      </Text>
      {description ? (
        <Text c="dimmed" maw={420}>
          {description}
        </Text>
      ) : null}
      {action ? (
        <Button variant="filled" color="jarvis" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </Stack>
  );
}

export default EmptyState;
