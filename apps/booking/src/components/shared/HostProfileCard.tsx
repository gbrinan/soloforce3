"use client";

import { Avatar, Box, Text, Stack } from "@mantine/core";

interface Props {
  hostName: string;
  hostTitle?: string;
  description?: string;
  variant?: "main" | "compact";
}

export default function HostProfileCard({
  hostName,
  hostTitle,
  description,
  variant = "main",
}: Props) {
  const initial = hostName ? hostName[0].toUpperCase() : "H";

  if (variant === "compact") {
    return (
      <Box
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 16px",
          background: "#151F32",
          borderBottom: "1px solid var(--mantine-color-dark-4)",
        }}
      >
        <Avatar size="sm" color="jarvis" radius="xl">
          {initial}
        </Avatar>
        <Box>
          <Text size="sm" fw={600}>
            {hostName}
          </Text>
          {hostTitle && (
            <Text size="xs" c="dimmed">
              {hostTitle}
            </Text>
          )}
        </Box>
      </Box>
    );
  }

  return (
    <Stack align="center" gap="md" py="xl">
      <Avatar size={80} color="jarvis" radius="xl" style={{ fontSize: 36 }}>
        {initial}
      </Avatar>
      <Stack gap={4} align="center">
        <Text size="xl" fw={700}>
          {hostName}
        </Text>
        {hostTitle && (
          <Text size="sm" c="dimmed">
            {hostTitle}
          </Text>
        )}
        {description && (
          <Text size="sm" c="dimmed" ta="center" maw={320} mt="xs">
            {description}
          </Text>
        )}
      </Stack>
    </Stack>
  );
}
