"use client";

import { useState, useCallback } from "react";
import {
  Box,
  Text,
  Button,
  Group,
  ActionIcon,
  Stack,
  Badge,
  Select,
} from "@mantine/core";
import { IconChevronLeft, IconChevronRight, IconArrowRight, IconWorld } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import dayjs, { type Dayjs } from "dayjs";
import { apiUrl } from "@/lib/api-url";
import { useI18n, weekdayShortLabels, formatYearMonth, formatMonthDay } from "@/lib/i18n";
import {
  timezoneOptions,
  getBrowserTimezone,
  convertSlotTz,
  formatTimeLabel,
} from "@/lib/timezone";

const DAY_KEY_MAP: Record<number, string> = {
  0: "sun", 1: "mon", 2: "tue", 3: "wed", 4: "thu", 5: "fri", 6: "sat",
};

interface DayAvailability {
  enabled: boolean;
  ranges: [string, string][];
}

interface Slot {
  start: string;
  end: string;
  available: boolean;
}

export interface SelectedSlot {
  date: string;
  start: string;   // host TZ HH:MM (stored value)
  end: string;     // host TZ HH:MM
  guestTimeZone: string;
}

interface Props {
  weeklyAvailability: Record<string, DayAvailability>;
  meetingDurationMin: number;
  hostTimeZone?: string;
  onSelect: (slot: SelectedSlot) => void;
}

export default function G2DateTimeScreen({
  weeklyAvailability,
  meetingDurationMin,
  hostTimeZone = "Asia/Seoul",
  onSelect,
}: Props) {
  const { t, locale } = useI18n();
  const dayHeaders = weekdayShortLabels(locale);
  const today = dayjs().startOf("day");
  const [viewMonth, setViewMonth] = useState(today.startOf("month"));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [pendingSlot, setPendingSlot] = useState<SelectedSlot | null>(null);
  const [guestTimeZone, setGuestTimeZone] = useState<string>(() => getBrowserTimezone());

  const isDayEnabled = (d: Dayjs): boolean => {
    if (d.isBefore(today)) return false;
    const key = DAY_KEY_MAP[d.day()];
    return weeklyAvailability[key]?.enabled ?? false;
  };

  const fetchSlots = useCallback(async (dateStr: string) => {
    setLoadingSlots(true);
    setSlots([]);
    setPendingSlot(null);
    try {
      const res = await fetch(apiUrl(`/api/slots?date=${dateStr}`));
      const data = (await res.json()) as { date: string; slots: Slot[] };
      setSlots(data.slots ?? []);
    } catch {
      notifications.show({ color: "red", message: t("g2.slotsFail") });
    } finally {
      setLoadingSlots(false);
    }
  }, []);

  const handleDayClick = (d: Dayjs) => {
    if (!isDayEnabled(d)) return;
    const dateStr = d.format("YYYY-MM-DD");
    setSelectedDate(dateStr);
    void fetchSlots(dateStr);
    setPendingSlot(null);
  };

  // Build calendar cells
  const firstDay = viewMonth.startOf("month");
  const daysInMonth = viewMonth.daysInMonth();
  const startOffset = firstDay.day();
  const cells: (Dayjs | null)[] = [
    ...Array<null>(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => viewMonth.date(i + 1)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const handleSlotClick = (slot: Slot) => {
    if (!slot.available || !selectedDate) return;
    setPendingSlot({ date: selectedDate, start: slot.start, end: slot.end, guestTimeZone });
  };

  // Display a slot time in guest timezone
  const displaySlotTime = (dateStr: string, hostTime: string): string => {
    if (hostTimeZone === guestTimeZone) return hostTime;
    return convertSlotTz(dateStr, hostTime, hostTimeZone, guestTimeZone);
  };

  return (
    <Stack gap="md" p="md" style={{ flex: 1 }}>
      {/* Timezone selector */}
      <Select
        label={t("g2.myTimezone")}
        leftSection={<IconWorld size={14} />}
        data={timezoneOptions(locale)}
        value={guestTimeZone}
        searchable
        size="xs"
        onChange={(val) => {
          const tz = val ?? "Asia/Seoul";
          setGuestTimeZone(tz);
          // re-derive pendingSlot with new tz if one exists
          if (pendingSlot) {
            setPendingSlot({ ...pendingSlot, guestTimeZone: tz });
          }
        }}
      />

      {/* Month navigation */}
      <Group justify="space-between" align="center">
        <ActionIcon
          variant="subtle"
          onClick={() => setViewMonth((m) => m.subtract(1, "month"))}
          aria-label={t("common.prevMonth")}
        >
          <IconChevronLeft size={16} />
        </ActionIcon>
        <Text fw={700}>{formatYearMonth(locale, viewMonth.year(), viewMonth.month())}</Text>
        <ActionIcon
          variant="subtle"
          onClick={() => setViewMonth((m) => m.add(1, "month"))}
          aria-label={t("common.nextMonth")}
        >
          <IconChevronRight size={16} />
        </ActionIcon>
      </Group>

      {/* Calendar grid */}
      <Box
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 2,
          textAlign: "center",
        }}
      >
        {dayHeaders.map((h, i) => (
          <Text key={i} size="xs" c="dimmed" py={4}>
            {h}
          </Text>
        ))}
        {cells.map((d, i) => {
          if (!d) return <Box key={`pad-${i}`} style={{ minHeight: 44 }} />;
          const enabled = isDayEnabled(d);
          const dateStr = d.format("YYYY-MM-DD");
          const isSelected = dateStr === selectedDate;
          return (
            <button
              key={dateStr}
              type="button"
              disabled={!enabled}
              aria-pressed={isSelected}
              aria-label={`${formatMonthDay(locale, d.year(), d.month(), d.date())}${isSelected ? t("g2.selectedSuffix") : ""}`}
              onClick={() => handleDayClick(d)}
              style={{
                minHeight: 44,
                minWidth: 44,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 6,
                border: "none",
                padding: 0,
                fontFamily: "inherit",
                background: isSelected ? "var(--mantine-color-jarvis-8)" : "transparent",
                opacity: enabled ? 1 : 0.25,
                transition: "background .15s",
                cursor: enabled ? "pointer" : "not-allowed",
              }}
            >
              <Text size="sm" fw={isSelected ? 700 : 400} c={isSelected ? "#fff" : "inherit"}>
                {d.date()}
              </Text>
            </button>
          );
        })}
      </Box>

      {/* Slots */}
      {selectedDate && (
        <Stack gap="xs">
          <Group gap={8} align="center">
            <Text fw={600} size="sm">
              {t("g2.slots")}
            </Text>
            <Badge color="jarvis" variant="light" size="sm">
              {t("common.minutes", { n: meetingDurationMin })}
            </Badge>
          </Group>

          {loadingSlots ? (
            <Text size="sm" c="dimmed">
              {t("common.loading")}
            </Text>
          ) : slots.length === 0 ? (
            <Text size="sm" c="dimmed" ta="center" py="md">
              {t("g2.noSlots")}
            </Text>
          ) : (
            <Box style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {slots.map((slot) => {
                const isChosen = pendingSlot?.start === slot.start;
                const displayTime = selectedDate
                  ? displaySlotTime(selectedDate, slot.start)
                  : slot.start;
                return (
                  <Button
                    key={slot.start}
                    size="xs"
                    variant={isChosen ? "filled" : "outline"}
                    color="jarvis"
                    disabled={!slot.available}
                    style={!slot.available ? { textDecoration: "line-through" } : {}}
                    onClick={() => handleSlotClick(slot)}
                  >
                    {formatTimeLabel(displayTime, guestTimeZone)}
                  </Button>
                );
              })}
            </Box>
          )}
        </Stack>
      )}

      {/* Next button */}
      <Button variant="filled"
        color="jarvis"
        radius="xl"
        size="md"
        disabled={!pendingSlot}
        rightSection={<IconArrowRight size={16} />}
        mt="auto"
        onClick={() => pendingSlot && onSelect(pendingSlot)}
      >
        {t("common.next")}
      </Button>
    </Stack>
  );
}
