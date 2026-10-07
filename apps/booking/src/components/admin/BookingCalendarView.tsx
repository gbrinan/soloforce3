"use client";

import { useState, useMemo } from "react";
import {
  Box,
  Group,
  Text,
  ActionIcon,
  Stack,
  Button,
  SegmentedControl,
  Menu,
  ScrollArea,
} from "@mantine/core";
import {
  IconChevronLeft,
  IconChevronRight,
  IconEdit,
  IconTrash,
} from "@tabler/icons-react";
import { formatTimeLabel } from "@/lib/timezone";
import { useI18n, weekdayShortLabels, formatYearMonth, formatDateRange } from "@/lib/i18n";
import type { Booking } from "@/app/api/bookings/route";

interface Props {
  bookings: Booking[];
  hostTimeZone: string;
  onCancel: (b: Booking) => void;
  onReschedule: (b: Booking) => void;
}

const HOUR_H = 48; // px per hour row
const GUTTER_W = 52; // px width of the time-label gutter
const DAY_MIN_W = 92; // px minimum width per day column

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
function todayInTz(tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return ymd(new Date());
  }
}
function nowMinutesInTz(tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    return (h === 24 ? 0 : h) * 60 + m;
  } catch {
    return 0;
  }
}

export default function BookingCalendarView({
  bookings,
  hostTimeZone,
  onCancel,
  onReschedule,
}: Props) {
  const { t } = useI18n();
  const todayStr = todayInTz(hostTimeZone);
  const [view, setView] = useState<"week" | "month">("week");

  const bookingsByDate = useMemo(() => {
    const map: Record<string, Booking[]> = {};
    for (const b of bookings) {
      (map[b.date] ??= []).push(b);
    }
    return map;
  }, [bookings]);

  return (
    <Stack gap="md">
      <Group justify="flex-end">
        <SegmentedControl
          size="xs"
          color="jarvis"
          value={view}
          onChange={(v) => setView(v as "week" | "month")}
          data={[
            { value: "week", label: t("cal.week") },
            { value: "month", label: t("cal.month") },
          ]}
        />
      </Group>
      {view === "week" ? (
        <WeekGrid
          bookingsByDate={bookingsByDate}
          todayStr={todayStr}
          hostTimeZone={hostTimeZone}
          onCancel={onCancel}
          onReschedule={onReschedule}
        />
      ) : (
        <MonthGrid
          bookingsByDate={bookingsByDate}
          todayStr={todayStr}
          hostTimeZone={hostTimeZone}
          onCancel={onCancel}
          onReschedule={onReschedule}
        />
      )}
    </Stack>
  );
}

/* ── Week time-grid (Cal.com style) ─────────────────────────────────────── */

interface GridProps {
  bookingsByDate: Record<string, Booking[]>;
  todayStr: string;
  hostTimeZone: string;
  onCancel: (b: Booking) => void;
  onReschedule: (b: Booking) => void;
}

function WeekGrid({
  bookingsByDate,
  todayStr,
  hostTimeZone,
  onCancel,
  onReschedule,
}: GridProps) {
  const { t, locale } = useI18n();
  const dayNames = weekdayShortLabels(locale);
  const [anchor, setAnchor] = useState(() => {
    const [y, m, d] = todayStr.split("-").map(Number);
    return new Date(y, m - 1, d);
  });

  const weekDays = useMemo(() => {
    const start = new Date(anchor);
    start.setDate(anchor.getDate() - anchor.getDay()); // back to Sunday
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [anchor]);

  // Visible hour range: default 8–20, expanded to cover any booking in the week.
  const { startHour, endHour } = useMemo(() => {
    let min = 8 * 60;
    let max = 20 * 60;
    for (const d of weekDays) {
      for (const b of bookingsByDate[ymd(d)] ?? []) {
        min = Math.min(min, toMinutes(b.start));
        max = Math.max(max, toMinutes(b.end));
      }
    }
    return {
      startHour: Math.floor(min / 60),
      endHour: Math.ceil(max / 60),
    };
  }, [weekDays, bookingsByDate]);

  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const totalH = (endHour - startHour) * HOUR_H;
  const gridMinW = GUTTER_W + 7 * DAY_MIN_W;

  const nowMin = nowMinutesInTz(hostTimeZone);
  const nowVisible =
    weekDays.some((d) => ymd(d) === todayStr) &&
    nowMin >= startHour * 60 &&
    nowMin <= endHour * 60;
  const nowTop = ((nowMin - startHour * 60) / 60) * HOUR_H;

  function shiftWeek(delta: number) {
    setAnchor((a) => {
      const next = new Date(a);
      next.setDate(a.getDate() + delta * 7);
      return next;
    });
  }
  function goToday() {
    const [y, m, d] = todayStr.split("-").map(Number);
    setAnchor(new Date(y, m - 1, d));
  }

  const rangeLabel = formatDateRange(locale, weekDays[0], weekDays[6]);

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center">
        <Button size="compact-xs" variant="subtle" color="gray" onClick={goToday}>
          {t("common.today")}
        </Button>
        <Group gap={4} align="center">
          <ActionIcon variant="subtle" color="gray" onClick={() => shiftWeek(-1)} aria-label={t("common.prevWeek")}>
            <IconChevronLeft size={16} />
          </ActionIcon>
          <Text fw={700} fz="sm" ta="center" style={{ minWidth: 200 }}>
            {rangeLabel}
          </Text>
          <ActionIcon variant="subtle" color="gray" onClick={() => shiftWeek(1)} aria-label={t("common.nextWeek")}>
            <IconChevronRight size={16} />
          </ActionIcon>
        </Group>
      </Group>

      <ScrollArea type="auto" scrollbarSize={8}>
        <Box style={{ minWidth: gridMinW }}>
          {/* Day header row */}
          <Box style={{ display: "flex", borderBottom: "1px solid var(--mantine-color-dark-4)" }}>
            <Box style={{ width: GUTTER_W, flexShrink: 0 }} />
            {weekDays.map((d) => {
              const isToday = ymd(d) === todayStr;
              return (
                <Box
                  key={ymd(d)}
                  style={{
                    flex: 1,
                    minWidth: DAY_MIN_W,
                    textAlign: "center",
                    padding: "4px 0 8px",
                  }}
                >
                  <Text fz="xs" c="dimmed" fw={600}>
                    {dayNames[d.getDay()]}
                  </Text>
                  <Text
                    fz="sm"
                    fw={700}
                    c={isToday ? "jarvis.4" : "white"}
                    style={
                      isToday
                        ? {
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 24,
                            height: 24,
                            borderRadius: "50%",
                            background: "rgba(99, 102, 241, 0.25)",
                          }
                        : undefined
                    }
                  >
                    {d.getDate()}
                  </Text>
                </Box>
              );
            })}
          </Box>

          {/* Time grid body */}
          <Box style={{ display: "flex", position: "relative", height: totalH }}>
            {/* Time gutter */}
            <Box style={{ width: GUTTER_W, flexShrink: 0, position: "relative" }}>
              {hours.map((h, i) => (
                <Text
                  key={h}
                  fz={12}
                  c="dimmed"
                  style={{
                    position: "absolute",
                    top: i * HOUR_H - 6,
                    right: 6,
                  }}
                >
                  {h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`}
                </Text>
              ))}
            </Box>

            {/* Day columns */}
            {weekDays.map((d) => {
              const dateStr = ymd(d);
              const dayBookings = bookingsByDate[dateStr] ?? [];
              const isPast = dateStr < todayStr;
              return (
                <Box
                  key={dateStr}
                  style={{
                    flex: 1,
                    minWidth: DAY_MIN_W,
                    position: "relative",
                    borderLeft: "1px solid var(--mantine-color-dark-5)",
                    backgroundImage: `repeating-linear-gradient(transparent, transparent ${HOUR_H - 1}px, var(--mantine-color-dark-5) ${HOUR_H - 1}px, var(--mantine-color-dark-5) ${HOUR_H}px)`,
                  }}
                >
                  {dayBookings.map((b) => {
                    const top = ((toMinutes(b.start) - startHour * 60) / 60) * HOUR_H;
                    const height = Math.max(
                      ((toMinutes(b.end) - toMinutes(b.start)) / 60) * HOUR_H,
                      20,
                    );
                    return (
                      <Menu key={b.id} position="bottom" withArrow shadow="md">
                        <Menu.Target>
                          <Box
                            style={{
                              position: "absolute",
                              top,
                              left: 2,
                              right: 2,
                              height,
                              borderRadius: 6,
                              padding: "2px 6px",
                              overflow: "hidden",
                              cursor: "pointer",
                              background: isPast
                                ? "var(--mantine-color-dark-5)"
                                : "rgba(99, 102, 241, 0.85)",
                              border: `1px solid ${isPast ? "var(--mantine-color-dark-4)" : "var(--mantine-color-jarvis-4)"}`,
                            }}
                          >
                            <Text fz={12} fw={700} c="white" lineClamp={1}>
                              {b.start}–{b.end}
                            </Text>
                            <Text fz={12} c={isPast ? "dimmed" : "white"} lineClamp={1}>
                              {b.name}
                            </Text>
                          </Box>
                        </Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Label>
                            {b.date} {formatTimeLabel(b.start, hostTimeZone)} ~{" "}
                            {formatTimeLabel(b.end, hostTimeZone)}
                          </Menu.Label>
                          <Menu.Label>
                            {b.name} · {b.email}
                          </Menu.Label>
                          <Menu.Divider />
                          <Menu.Item
                            leftSection={<IconEdit size={14} />}
                            onClick={() => onReschedule(b)}
                          >
                            {t("common.reschedule")}
                          </Menu.Item>
                          <Menu.Item
                            color="red"
                            leftSection={<IconTrash size={14} />}
                            onClick={() => onCancel(b)}
                          >
                            {t("common.cancelBooking")}
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    );
                  })}
                </Box>
              );
            })}

            {/* Now indicator */}
            {nowVisible && (
              <Box
                style={{
                  position: "absolute",
                  left: GUTTER_W,
                  right: 0,
                  top: nowTop,
                  height: 0,
                  borderTop: "1px solid var(--mantine-color-red-5)",
                  zIndex: 5,
                  pointerEvents: "none",
                }}
              >
                <Box
                  style={{
                    position: "absolute",
                    left: -4,
                    top: -4,
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "var(--mantine-color-red-5)",
                  }}
                />
              </Box>
            )}
          </Box>
        </Box>
      </ScrollArea>
    </Stack>
  );
}

/* ── Month grid (compact overview) ──────────────────────────────────────── */

function MonthGrid({
  bookingsByDate,
  todayStr,
  hostTimeZone,
  onCancel,
  onReschedule,
}: GridProps) {
  const { t, locale } = useI18n();
  const dayNames = weekdayShortLabels(locale);
  const [year, setYear] = useState(() => Number(todayStr.slice(0, 4)));
  const [month, setMonth] = useState(() => Number(todayStr.slice(5, 7)) - 1);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const { cells, startOffset } = useMemo(() => {
    const firstDow = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return {
      startOffset: firstDow,
      cells: Array.from({ length: daysInMonth }, (_, i) => {
        const d = i + 1;
        return {
          d,
          dateStr: `${year}-${pad(month + 1)}-${pad(d)}`,
        };
      }),
    };
  }, [year, month]);

  function prevMonth() {
    if (month === 0) { setYear((y) => y - 1); setMonth(11); }
    else setMonth((m) => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear((y) => y + 1); setMonth(0); }
    else setMonth((m) => m + 1);
  }

  const selectedBookings = selectedDate
    ? (bookingsByDate[selectedDate] ?? []).slice().sort((a, b) => a.start.localeCompare(b.start))
    : [];

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center">
        <ActionIcon variant="subtle" color="gray" onClick={prevMonth} aria-label={t("common.prevMonth")}>
          <IconChevronLeft size={16} />
        </ActionIcon>
        <Text fw={700} fz="sm">
          {formatYearMonth(locale, year, month)}
        </Text>
        <ActionIcon variant="subtle" color="gray" onClick={nextMonth} aria-label={t("common.nextMonth")}>
          <IconChevronRight size={16} />
        </ActionIcon>
      </Group>

      <Box style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
        {dayNames.map((d, i) => (
          <Text key={i} ta="center" fz="xs" c="dimmed" fw={600} py={4}>
            {d}
          </Text>
        ))}
        {Array.from({ length: startOffset }, (_, i) => (
          <Box key={`pad-${i}`} />
        ))}
        {cells.map(({ d, dateStr }) => {
          const bks = bookingsByDate[dateStr];
          const isToday = dateStr === todayStr;
          const isSelected = dateStr === selectedDate;
          return (
            <Box
              key={dateStr}
              onClick={() => setSelectedDate(isSelected ? null : dateStr)}
              style={{
                borderRadius: 6,
                padding: "6px 2px",
                textAlign: "center",
                cursor: "pointer",
                minHeight: 44,
                background: isSelected
                  ? "rgba(99, 102, 241, 0.25)"
                  : isToday
                  ? "rgba(99, 102, 241, 0.10)"
                  : undefined,
                border: `1px solid ${isSelected ? "var(--mantine-color-jarvis-5)" : "transparent"}`,
              }}
            >
              <Text fz="xs" c={isToday ? "jarvis.4" : "white"} fw={isToday ? 700 : 400}>
                {d}
              </Text>
              {bks && bks.length > 0 && (
                <Box
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    gap: 2,
                    marginTop: 2,
                    flexWrap: "wrap",
                  }}
                >
                  {bks.slice(0, 3).map((b) => (
                    <Box
                      key={b.id}
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: "50%",
                        background:
                          b.date >= todayStr
                            ? "var(--mantine-color-jarvis-4)"
                            : "var(--mantine-color-dark-3)",
                      }}
                    />
                  ))}
                  {bks.length > 3 && (
                    <Text style={{ fontSize: 12 }} c="jarvis.4">
                      +{bks.length - 3}
                    </Text>
                  )}
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      {selectedDate && (
        <Stack gap="xs">
          <Text fz="xs" c="dimmed" fw={600}>
            {selectedDate} · {t("cal.count", { n: selectedBookings.length })}
          </Text>
          {selectedBookings.length === 0 ? (
            <Text fz="sm" c="dimmed">
              {t("cal.noBookings")}
            </Text>
          ) : (
            selectedBookings.map((b) => (
              <Box
                key={b.id}
                style={{
                  background: "#151F32",
                  borderRadius: 10,
                  padding: "12px 14px",
                  border: "1px solid var(--mantine-color-dark-4)",
                }}
              >
                <Group justify="space-between" align="center" wrap="nowrap">
                  <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                    <Text fz="sm" fw={700} c="white">
                      {formatTimeLabel(b.start, hostTimeZone)} ~{" "}
                      {formatTimeLabel(b.end, hostTimeZone)}
                    </Text>
                    <Text fz="sm" c="white">
                      {b.name}
                    </Text>
                    <Text fz="xs" c="dimmed">
                      {b.email}
                    </Text>
                  </Stack>
                  <Group gap={4} wrap="nowrap">
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      color="jarvis"
                      leftSection={<IconEdit size={12} />}
                      onClick={() => onReschedule(b)}
                    >
                      {t("dash.change")}
                    </Button>
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      color="red"
                      leftSection={<IconTrash size={12} />}
                      onClick={() => onCancel(b)}
                    >
                      {t("common.cancel")}
                    </Button>
                  </Group>
                </Group>
              </Box>
            ))
          )}
        </Stack>
      )}
    </Stack>
  );
}
