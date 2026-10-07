"use client";

import { useEffect, useState } from "react";
import { Box, SimpleGrid, Stack, Text, Title, Badge, Button, Center, Loader, Group } from "@mantine/core";
import { IconClock, IconCalendarPlus, IconSettings } from "@tabler/icons-react";
import { apiUrl, pageUrl } from "@/lib/api-url";
import { useI18n } from "@/lib/i18n";
import type { EventType } from "@/types/event-type";

function EventTypePickerCard({ et }: { et: EventType }) {
  const { t } = useI18n();
  return (
    <Box
      onClick={() => { window.location.href = pageUrl(`/book/${et.slug}`); }}
      style={{
        background: "#151F32",
        borderRadius: 10,
        padding: 20,
        border: `2px solid transparent`,
        cursor: "pointer",
        transition: "border-color 0.15s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = `var(--mantine-color-${et.color}-4)`;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = "transparent";
      }}
    >
      <Stack gap="sm">
        <Box
          style={{
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: `var(--mantine-color-${et.color}-5)`,
          }}
        />
        <Text fw={600} c={`${et.color}.4`} fz="md">
          {et.title}
        </Text>
        <Badge
          variant="light"
          color="gray"
          size="sm"
          leftSection={<IconClock size={12} />}
        >
          {t("common.minutes", { n: et.durationMin })}
        </Badge>
        {et.description && (
          <Text fz="xs" c="dimmed">
            {et.description}
          </Text>
        )}
        <Button variant="light" color={et.color} size="xs" radius="xl" mt="xs">
          {t("g1.book")}
        </Button>
      </Stack>
    </Box>
  );
}

export default function ETSelectScreen() {
  const { t } = useI18n();
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(apiUrl("/api/event-types") + "?active=true");
        if (res.ok) {
          setEventTypes((await res.json()) as EventType[]);
        }
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <Box
      style={{
        minHeight: "100vh",
        background: "#070D1A",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Box style={{ maxWidth: 600, margin: "0 auto", padding: "40px 16px", width: "100%" }}>
        <Stack gap="xl">
          <Group justify="space-between" align="flex-start">
            <Stack gap={4}>
              <Title order={2} c="white">
                {t("ets.title")}
              </Title>
              <Text c="dimmed" fz="sm">
                {t("ets.subtitle")}
              </Text>
            </Stack>
            <Button
              variant="subtle"
              color="gray"
              size="xs"
              leftSection={<IconSettings size={14} />}
              onClick={() => { window.location.href = pageUrl("/admin"); }}
            >
              {t("ets.admin")}
            </Button>
          </Group>

          {loading ? (
            <Center py="xl">
              <Loader color="jarvis" size="sm" />
            </Center>
          ) : eventTypes.length === 0 ? (
            <Center py="xl">
              <Stack align="center" gap="sm">
                <IconCalendarPlus size={48} color="var(--mantine-color-dimmed)" />
                <Text c="dimmed" fz="sm">
                  {t("ets.empty")}
                </Text>
              </Stack>
            </Center>
          ) : (
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              {eventTypes.map((et) => (
                <EventTypePickerCard key={et.id} et={et} />
              ))}
            </SimpleGrid>
          )}
        </Stack>
      </Box>
    </Box>
  );
}
