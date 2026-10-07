"use client";

import { useEffect, useState } from "react";
import {
  Box,
  Stack,
  Group,
  Text,
  Badge,
  ActionIcon,
  Button,
  Switch,
  Menu,
  Center,
  Loader,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconDots,
  IconEdit,
  IconTrash,
  IconLink,
  IconCalendarPlus,
} from "@tabler/icons-react";
import { apiUrl, pageUrl } from "@/lib/api-url";
import { useI18n } from "@/lib/i18n";
import type { EventType } from "@/types/event-type";

interface Props {
  onEdit: (et: EventType) => void;
  onNew: () => void;
  refreshKey?: number;
}

export default function EventTypeList({ onEdit, onNew, refreshKey }: Props) {
  const { t } = useI18n();
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/api/event-types"));
      if (res.ok) setEventTypes((await res.json()) as EventType[]);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [refreshKey]);

  async function toggleActive(et: EventType) {
    try {
      const res = await fetch(apiUrl(`/api/event-types/${et.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !et.active }),
      });
      if (res.ok) {
        setEventTypes((prev) =>
          prev.map((item) => (item.id === et.id ? { ...item, active: !item.active } : item))
        );
      }
    } catch {
      notifications.show({ color: "red", message: t("common.saveFail") });
    }
  }

  async function deleteET(et: EventType) {
    if (!confirm(t("etl.deleteConfirm", { title: et.title }))) return;
    try {
      const res = await fetch(apiUrl(`/api/event-types/${et.id}`), { method: "DELETE" });
      if (res.ok) {
        setEventTypes((prev) => prev.filter((item) => item.id !== et.id));
        notifications.show({ color: "jarvis", message: t("etl.deleted") });
      }
    } catch {
      notifications.show({ color: "red", message: t("etl.deleteFail") });
    }
  }

  function copyLink(et: EventType) {
    const url = `${window.location.origin}${pageUrl(`/book/${et.slug}`)}`;
    void navigator.clipboard.writeText(url).then(() => {
      notifications.show({ color: "green", message: t("etl.linkCopied") });
    });
  }

  if (loading) {
    return (
      <Center py="xl">
        <Loader color="jarvis" size="sm" />
      </Center>
    );
  }

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text fw={700} fz="lg" c="white">
          {t("etl.title")}
        </Text>
        <Button variant="filled"
          size="sm"
          color="jarvis"
          leftSection={<IconCalendarPlus size={16} />}
          onClick={onNew}
        >
          {t("etl.newType")}
        </Button>
      </Group>

      {eventTypes.length === 0 ? (
        <Center py="xl">
          <Stack align="center" gap="sm">
            <IconCalendarPlus size={48} color="var(--mantine-color-dimmed)" />
            <Text c="dimmed" fz="sm">
              {t("etl.empty")}
            </Text>
          </Stack>
        </Center>
      ) : (
        <Stack gap="xs">
          {eventTypes.map((et) => (
            <Box
              key={et.id}
              style={{
                background: "#151F32",
                borderRadius: 10,
                padding: 16,
                border: "1px solid var(--mantine-color-dark-4)",
              }}
            >
              <Group justify="space-between" wrap="nowrap">
                <Group gap="sm" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                  <Box
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      background: `var(--mantine-color-${et.color}-5)`,
                      flexShrink: 0,
                    }}
                  />
                  <Stack gap={2} style={{ minWidth: 0 }}>
                    <Text fw={600} c="white" fz="sm" truncate>
                      {et.title}
                    </Text>
                    <Text fz="xs" c="dimmed">
                      slug: {et.slug} · {et.durationMin}{t("common.minSuffix")}
                    </Text>
                  </Stack>
                </Group>

                <Group gap="xs" wrap="nowrap">
                  <Badge
                    size="sm"
                    color={et.active ? "green" : "gray"}
                    variant="light"
                  >
                    {et.active ? t("etl.public") : t("etl.private")}
                  </Badge>
                  <Switch
                    color="jarvis"
                    size="sm"
                    checked={et.active}
                    onChange={() => void toggleActive(et)}
                  />
                  <Button
                    variant="subtle"
                    size="xs"
                    leftSection={<IconLink size={12} />}
                    onClick={() => copyLink(et)}
                    c="dimmed"
                  >
                    {t("etl.copyLink")}
                  </Button>
                  <Menu position="bottom-end" withinPortal>
                    <Menu.Target>
                      <ActionIcon variant="subtle" color="gray" aria-label={t("etl.menuAria", { title: et.title })}>
                        <IconDots size={16} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item
                        leftSection={<IconEdit size={14} />}
                        onClick={() => onEdit(et)}
                      >
                        {t("common.edit")}
                      </Menu.Item>
                      <Menu.Item
                        leftSection={<IconTrash size={14} />}
                        color="red"
                        onClick={() => void deleteET(et)}
                      >
                        {t("common.delete")}
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                </Group>
              </Group>
            </Box>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
