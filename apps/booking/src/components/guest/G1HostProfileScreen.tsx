"use client";

import { Stack, Button, Badge, Group, Text } from "@mantine/core";
import { IconClock, IconArrowRight } from "@tabler/icons-react";
import HostProfileCard from "@/components/shared/HostProfileCard";
import { useI18n } from "@/lib/i18n";

interface Props {
  hostName: string;
  hostTitle?: string;
  meetingDurationMin: number;
  onNext: () => void;
}

export default function G1HostProfileScreen({
  hostName,
  hostTitle,
  meetingDurationMin,
  onNext,
}: Props) {
  const { t } = useI18n();
  return (
    <Stack align="center" gap="lg" p="xl" style={{ flex: 1 }}>
      <HostProfileCard hostName={hostName} hostTitle={hostTitle} variant="main" />

      <Group gap={8} align="center">
        <IconClock size={15} color="var(--mantine-color-jarvis-4)" />
        <Badge color="jarvis" variant="light" radius="xl" size="md">
          {t("g1.durationBadge", { n: meetingDurationMin })}
        </Badge>
      </Group>

      <Text size="sm" c="dimmed" ta="center" maw={300}>
        {t("g1.hint")}
      </Text>

      <Button variant="filled"
        color="jarvis"
        radius="xl"
        size="md"
        rightSection={<IconArrowRight size={16} />}
        onClick={onNext}
        mt="md"
      >
        {t("g1.book")}
      </Button>
    </Stack>
  );
}
