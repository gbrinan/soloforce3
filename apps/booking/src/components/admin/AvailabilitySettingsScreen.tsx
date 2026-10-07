"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Button,
  Container,
  Group,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { TimeInput } from "@mantine/dates";
import { notifications } from "@mantine/notifications";
import { IconPlus, IconX } from "@tabler/icons-react";
import { apiUrl } from "../../lib/api-url";
import { useI18n } from "../../lib/i18n";
import { timezoneOptions } from "../../lib/timezone";
import type { DayOfWeek, WeeklyAvailability } from "../../lib/availability";

interface AvailabilitySettings {
  weeklyAvailability: WeeklyAvailability;
  meetingDurationMin: number;
  bufferMin: number;
  hostName: string;
  hostTitle: string;
  hostTimeZone: string;
}

const DAY_LABELS: { key: DayOfWeek }[] = [
  { key: "mon" },
  { key: "tue" },
  { key: "wed" },
  { key: "thu" },
  { key: "fri" },
  { key: "sat" },
  { key: "sun" },
];

const DEFAULT_WEEKLY_AVAILABILITY: WeeklyAvailability = {
  mon: { enabled: true, ranges: [["09:00", "18:00"] as [string, string]] },
  tue: { enabled: true, ranges: [["09:00", "18:00"] as [string, string]] },
  wed: { enabled: true, ranges: [["09:00", "18:00"] as [string, string]] },
  thu: { enabled: true, ranges: [["09:00", "18:00"] as [string, string]] },
  fri: { enabled: true, ranges: [["09:00", "18:00"] as [string, string]] },
  sat: { enabled: false, ranges: [] },
  sun: { enabled: false, ranges: [] },
};

const DEFAULT_SETTINGS: AvailabilitySettings = {
  weeklyAvailability: DEFAULT_WEEKLY_AVAILABILITY,
  meetingDurationMin: 30,
  bufferMin: 0,
  hostName: "호스트",
  hostTitle: "",
  hostTimeZone: "Asia/Seoul",
};

function normalizeWeeklyAvailability(data?: Partial<WeeklyAvailability>): WeeklyAvailability {
  return DAY_LABELS.reduce((weekly, { key }) => {
    const day = data?.[key] ?? DEFAULT_WEEKLY_AVAILABILITY[key];
    weekly[key] = {
      enabled: day.enabled,
      ranges: day.enabled && day.ranges.length === 0 ? [["09:00", "18:00"] as [string, string]] : day.ranges,
    };
    return weekly;
  }, {} as WeeklyAvailability);
}

function normalizeSettings(data: Partial<AvailabilitySettings> | null): AvailabilitySettings {
  return {
    ...DEFAULT_SETTINGS,
    ...data,
    weeklyAvailability: normalizeWeeklyAvailability(data?.weeklyAvailability),
    meetingDurationMin: data?.meetingDurationMin ?? DEFAULT_SETTINGS.meetingDurationMin,
    bufferMin: data?.bufferMin ?? DEFAULT_SETTINGS.bufferMin,
    hostName: data?.hostName ?? DEFAULT_SETTINGS.hostName,
    hostTitle: data?.hostTitle ?? DEFAULT_SETTINGS.hostTitle,
    hostTimeZone: data?.hostTimeZone ?? DEFAULT_SETTINGS.hostTimeZone,
  };
}

export function AvailabilitySettingsScreen() {
  const { t, locale } = useI18n();
  const [settings, setSettings] = useState<AvailabilitySettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      try {
        const response = await fetch(apiUrl("/api/availability"));
        if (response.status === 404) return;
        if (!response.ok) throw new Error(t("avail.loadFail"));

        const data = (await response.json()) as Partial<AvailabilitySettings>;
        if (!cancelled) setSettings(normalizeSettings(data));
      } catch (error) {
        notifications.show({
          color: "red",
          title: t("avail.loadFailTitle"),
          message: error instanceof Error ? error.message : t("avail.loadFail"),
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadSettings();

    return () => {
      cancelled = true;
    };
  }, []);

  const disabled = useMemo(() => loading || saving, [loading, saving]);

  function updateDay(dayKey: DayOfWeek, next: WeeklyAvailability[DayOfWeek]) {
    setSettings((current) => ({
      ...current,
      weeklyAvailability: {
        ...current.weeklyAvailability,
        [dayKey]: next,
      },
    }));
  }

  function updateRange(dayKey: DayOfWeek, index: number, side: 0 | 1, value: string) {
    const day = settings.weeklyAvailability[dayKey];
    const ranges = day.ranges.map((range, rangeIndex) => {
      if (rangeIndex !== index) return range;
      const nextRange: [string, string] = [range[0], range[1]];
      nextRange[side] = value;
      return nextRange;
    });
    updateDay(dayKey, { ...day, ranges });
  }

  function addRange(dayKey: DayOfWeek) {
    const day = settings.weeklyAvailability[dayKey];
    updateDay(dayKey, { ...day, ranges: [...day.ranges, ["09:00", "18:00"] as [string, string]] });
  }

  function removeRange(dayKey: DayOfWeek, index: number) {
    const day = settings.weeklyAvailability[dayKey];
    updateDay(dayKey, { ...day, ranges: day.ranges.filter((_, rangeIndex) => rangeIndex !== index) });
  }

  async function saveSettings() {
    setSaving(true);
    try {
      const response = await fetch(apiUrl("/api/availability"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });

      if (!response.ok) throw new Error(t("avail.saveReqFail"));

      notifications.show({
        color: "jarvis",
        title: t("avail.savedTitle"),
        message: t("avail.savedMsg"),
      });
    } catch (error) {
      notifications.show({
        color: "red",
        title: t("avail.saveFailTitle"),
        message: error instanceof Error ? error.message : t("avail.saveFailMsg"),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Stack
      gap="xl"
      style={{
        minHeight: "100vh",
        background: "#070D1A",
        color: "var(--mantine-color-white)",
      }}
    >
      <Container size="lg" w="100%" py={{ base: "lg", md: "xl" }}>
        <Stack gap="xl">
          <Title order={1} size="h2">
            {t("avail.title")}
          </Title>

          <Paper radius="xl" p={{ base: "md", md: "xl" }} bg="#151F32">
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <TextInput
                label={t("avail.hostName")}
                value={settings.hostName}
                disabled={disabled}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, hostName: event.currentTarget.value }))
                }
              />
              <TextInput
                label={t("avail.hostTitle")}
                value={settings.hostTitle}
                disabled={disabled}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, hostTitle: event.currentTarget.value }))
                }
              />
              <NumberInput
                label={t("avail.meetingDuration")}
                min={15}
                step={15}
                suffix={t("common.minSuffix")}
                value={settings.meetingDurationMin}
                disabled={disabled}
                onChange={(value) =>
                  setSettings((current) => ({
                    ...current,
                    meetingDurationMin: typeof value === "number" ? value : 30,
                  }))
                }
              />
              <NumberInput
                label={t("avail.buffer")}
                min={0}
                step={5}
                suffix={t("common.minSuffix")}
                value={settings.bufferMin}
                disabled={disabled}
                onChange={(value) =>
                  setSettings((current) => ({
                    ...current,
                    bufferMin: typeof value === "number" ? value : 0,
                  }))
                }
              />
              <Select
                label={t("avail.hostTimezone")}
                data={timezoneOptions(locale)}
                value={settings.hostTimeZone}
                disabled={disabled}
                searchable
                onChange={(value) =>
                  setSettings((current) => ({
                    ...current,
                    hostTimeZone: value ?? "Asia/Seoul",
                  }))
                }
              />
            </SimpleGrid>
          </Paper>

          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            {DAY_LABELS.map(({ key }) => {
              const day = settings.weeklyAvailability[key];

              return (
                <Paper key={key} radius="xl" p={{ base: "md", md: "lg" }} bg="#151F32">
                  <Stack gap="md">
                    <Group justify="space-between" wrap="nowrap">
                      <Text fw={700}>{t(`avail.day.${key}`)}</Text>
                      <Switch
                        color="jarvis"
                        checked={day.enabled}
                        disabled={disabled}
                        onChange={(event) =>
                          updateDay(key, {
                            enabled: event.currentTarget.checked,
                            ranges: day.ranges.length > 0 ? day.ranges : [["09:00", "18:00"] as [string, string]],
                          })
                        }
                      />
                    </Group>

                    {day.enabled ? (
                      <Stack gap="sm">
                        {day.ranges.map((range, index) => (
                          <Group key={`${key}-${index}`} align="end" gap="xs" wrap="nowrap">
                            <TimeInput
                              label={t("avail.start")}
                              value={range[0]}
                              disabled={disabled}
                              onChange={(event) => updateRange(key, index, 0, event.currentTarget.value)}
                              style={{ flex: 1 }}
                            />
                            <TimeInput
                              label={t("avail.end")}
                              value={range[1]}
                              disabled={disabled}
                              onChange={(event) => updateRange(key, index, 1, event.currentTarget.value)}
                              style={{ flex: 1 }}
                            />
                            <ActionIcon
                              aria-label={t("avail.removeRangeAria", { day: t(`avail.day.${key}`) })}
                              variant="subtle"
                              color="gray"
                              size="lg"
                              disabled={disabled || day.ranges.length <= 1}
                              onClick={() => removeRange(key, index)}
                            >
                              <IconX size={18} />
                            </ActionIcon>
                          </Group>
                        ))}
                        <Button
                          variant="light"
                          color="jarvis"
                          leftSection={<IconPlus size={16} />}
                          disabled={disabled}
                          onClick={() => addRange(key)}
                        >
                          {t("avail.addRange")}
                        </Button>
                      </Stack>
                    ) : null}
                  </Stack>
                </Paper>
              );
            })}
          </SimpleGrid>

          <Group justify="flex-end">
            <Button variant="filled" color="jarvis" size="lg" loading={saving} disabled={loading} onClick={saveSettings}>
              {t("common.save")}
            </Button>
          </Group>
        </Stack>
      </Container>
    </Stack>
  );
}

export default AvailabilitySettingsScreen;
