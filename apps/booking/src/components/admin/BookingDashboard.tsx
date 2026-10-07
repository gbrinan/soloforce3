"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Box,
  Stack,
  Group,
  Text,
  Badge,
  Button,
  Tabs,
  Modal,
  Loader,
  LoadingOverlay,
  Center,
  SegmentedControl,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCalendar, IconTrash, IconEdit, IconFileText, IconTag } from "@tabler/icons-react";
import { apiUrl } from "@/lib/api-url";
import { formatTimeLabel } from "@/lib/timezone";
import { useI18n } from "@/lib/i18n";
import type { Booking } from "@/app/api/bookings/route";
import type { ClassifiedNote } from "@/app/api/ai/classify-note/route";
import EmptyState from "@/components/shared/EmptyState";
import G2DateTimeScreen from "@/components/guest/G2DateTimeScreen";
import BookingCalendarView from "./BookingCalendarView";
import NaturalBookingInput from "./NaturalBookingInput";

interface DayAvailability {
  enabled: boolean;
  ranges: [string, string][];
}

interface HostInfo {
  meetingDurationMin: number;
  weeklyAvailability: Record<string, DayAvailability>;
  hostTimeZone: string;
}

interface SelectedSlot {
  date: string;
  start: string;
  end: string;
}

function BookingCard({
  b,
  hostTimeZone,
  onCancel,
  onReschedule,
  onBriefing,
  onClassify,
  classification,
  classifyLoading,
}: {
  b: Booking;
  hostTimeZone: string;
  onCancel: () => void;
  onReschedule: () => void;
  onBriefing: () => void;
  onClassify: () => void;
  classification?: ClassifiedNote;
  classifyLoading?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Box
      style={{
        background: "#151F32",
        borderRadius: 10,
        padding: 16,
        border: "1px solid var(--mantine-color-dark-4)",
      }}
    >
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
          <Text fw={700} c="white" fz="sm">
            {b.date} {formatTimeLabel(b.start, hostTimeZone)} ~ {formatTimeLabel(b.end, hostTimeZone)}
          </Text>
          <Text c="white" fz="sm">
            {b.name}
          </Text>
          <Text c="dimmed" fz="xs">
            {b.email}
            {b.phone ? ` · ${b.phone}` : ""}
          </Text>
          {b.eventTypeTitle && (
            <Badge color="jarvis" variant="light" size="xs">
              {b.eventTypeTitle}
              {b.durationMin ? ` (${t("common.minutes", { n: b.durationMin })})` : ""}
            </Badge>
          )}
          {b.note && (
            <Text c="dimmed" fz="xs">
              💬 {b.note}
            </Text>
          )}
          {classification && (
            <Stack gap={2}>
              <Badge color="grape" variant="light" size="xs">
                {classification.typeLabel}
              </Badge>
              {classification.prep.length > 0 && (
                <Text c="dimmed" fz="xs">
                  📋 {classification.prep.join(" · ")}
                </Text>
              )}
            </Stack>
          )}
        </Stack>
        <Group gap="xs" wrap="nowrap">
          {b.note && (
            <Button
              size="xs"
              variant="subtle"
              color="grape"
              leftSection={<IconTag size={13} />}
              loading={classifyLoading}
              onClick={onClassify}
            >
              {t("dash.classify")}
            </Button>
          )}
          <Button
            size="xs"
            variant="subtle"
            color="jarvis"
            leftSection={<IconFileText size={13} />}
            onClick={onBriefing}
          >
            {t("dash.briefing")}
          </Button>
          <Button
            size="xs"
            variant="subtle"
            color="jarvis"
            leftSection={<IconEdit size={13} />}
            onClick={onReschedule}
          >
            {t("dash.change")}
          </Button>
          <Button
            size="xs"
            variant="subtle"
            color="red"
            leftSection={<IconTrash size={13} />}
            onClick={onCancel}
          >
            {t("common.cancel")}
          </Button>
        </Group>
      </Group>
    </Box>
  );
}

export default function BookingDashboard() {
  const { t } = useI18n();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [rescheduleTarget, setRescheduleTarget] = useState<Booking | null>(null);
  const [rescheduling, setRescheduling] = useState(false);
  const [hostInfo, setHostInfo] = useState<HostInfo | null>(null);
  const [dashView, setDashView] = useState<"list" | "calendar">("list");
  const [briefingTarget, setBriefingTarget] = useState<Booking | null>(null);
  const [briefingText, setBriefingText] = useState("");
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [classifications, setClassifications] = useState<Record<string, ClassifiedNote>>({});
  const [classifyingId, setClassifyingId] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);

  const loadBookings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/api/bookings"));
      if (res.ok) setBookings((await res.json()) as Booking[]);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBookings();
  }, [loadBookings]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(apiUrl("/api/availability"));
        if (!res.ok) return;
        const raw = (await res.json()) as Record<string, unknown>;
        setHostInfo({
          meetingDurationMin:
            typeof raw.meetingDurationMin === "number" ? raw.meetingDurationMin : 30,
          weeklyAvailability:
            raw.weeklyAvailability != null && typeof raw.weeklyAvailability === "object"
              ? (raw.weeklyAvailability as Record<string, DayAvailability>)
              : {},
          hostTimeZone:
            typeof raw.hostTimeZone === "string" ? raw.hostTimeZone : "Asia/Seoul",
        });
      } catch {
        // silent
      }
    })();
  }, []);

  const upcoming = bookings
    .filter((b) => b.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));

  const past = bookings
    .filter((b) => b.date < today)
    .sort((a, b) => b.date.localeCompare(a.date) || b.start.localeCompare(a.start));

  async function handleCancel() {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      const res = await fetch(apiUrl(`/api/bookings/${cancelTarget.id}`), {
        method: "DELETE",
      });
      if (res.ok) {
        notifications.show({ color: "green", message: t("dash.cancelled") });
        setCancelTarget(null);
        void loadBookings();
      } else {
        notifications.show({ color: "red", message: t("dash.cancelFail") });
      }
    } catch {
      notifications.show({ color: "red", message: t("common.networkError") });
    } finally {
      setCancelling(false);
    }
  }

  async function handleBriefing(b: Booking) {
    setBriefingTarget(b);
    setBriefingText("");
    setBriefingLoading(true);
    try {
      const res = await fetch(apiUrl("/api/ai/briefing"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attendeeName: b.name,
          attendeeEmail: b.email,
          meetingTitle: b.eventTypeTitle ?? b.note ?? t("dash.meetingFallback"),
          ...(b.note ? { notes: b.note } : {}),
        }),
      });
      const data = (await res.json()) as { briefing?: string; error?: string };
      if (!res.ok || !data.briefing) {
        notifications.show({ color: "red", message: data.error ?? t("dash.briefingFail") });
        setBriefingTarget(null);
        return;
      }
      setBriefingText(data.briefing);
    } catch {
      notifications.show({ color: "red", message: t("common.networkError") });
      setBriefingTarget(null);
    } finally {
      setBriefingLoading(false);
    }
  }

  async function handleClassify(b: Booking) {
    if (!b.note) return;
    setClassifyingId(b.id);
    try {
      const res = await fetch(apiUrl("/api/ai/classify-note"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          note: b.note,
          ...(b.eventTypeTitle ? { title: b.eventTypeTitle } : {}),
        }),
      });
      const data = (await res.json()) as ClassifiedNote & { error?: string };
      if (!res.ok || !data.type) {
        notifications.show({ color: "red", message: data.error ?? t("dash.classifyFail") });
        return;
      }
      setClassifications((prev) => ({
        ...prev,
        [b.id]: { type: data.type, typeLabel: data.typeLabel, prep: data.prep },
      }));
    } catch {
      notifications.show({ color: "red", message: t("common.networkError") });
    } finally {
      setClassifyingId(null);
    }
  }

  async function handleReschedule(slot: SelectedSlot) {
    if (!rescheduleTarget || rescheduling) return;
    setRescheduling(true);
    try {
      const res = await fetch(apiUrl(`/api/bookings/${rescheduleTarget.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: slot.date, start: slot.start, end: slot.end }),
      });
      if (res.status === 409) {
        notifications.show({ color: "orange", message: t("dash.slotTaken") });
        return;
      }
      if (res.ok) {
        notifications.show({ color: "jarvis", message: t("dash.rescheduled") });
        setRescheduleTarget(null);
        void loadBookings();
      } else {
        notifications.show({ color: "red", message: t("dash.rescheduleFail") });
      }
    } catch {
      notifications.show({ color: "red", message: t("common.networkError") });
    } finally {
      setRescheduling(false);
    }
  }

  return (
    <>
      <Stack gap="sm">
        <NaturalBookingInput onCreated={() => void loadBookings()} />
        <Group justify="flex-end">
          <SegmentedControl
            size="xs"
            color="jarvis"
            value={dashView}
            onChange={(v) => setDashView(v as "list" | "calendar")}
            data={[
              { value: "list", label: t("dash.viewList") },
              { value: "calendar", label: t("dash.viewCalendar") },
            ]}
          />
        </Group>
        {dashView === "calendar" ? (
          <BookingCalendarView
            bookings={bookings}
            hostTimeZone={hostInfo?.hostTimeZone ?? "Asia/Seoul"}
            onCancel={(b) => setCancelTarget(b)}
            onReschedule={(b) => setRescheduleTarget(b)}
          />
        ) : (
      <Tabs defaultValue="upcoming" color="jarvis">
        <Tabs.List>
          <Tabs.Tab value="upcoming">{t("dash.tabUpcoming", { n: upcoming.length })}</Tabs.Tab>
          <Tabs.Tab value="past">{t("dash.tabPast", { n: past.length })}</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="upcoming" pt="md">
          {loading ? (
            <Center py="xl">
              <Loader color="jarvis" size="sm" />
            </Center>
          ) : upcoming.length === 0 ? (
            <EmptyState
              icon={<IconCalendar size={28} />}
              title={t("dash.emptyUpcomingTitle")}
              description={t("dash.emptyUpcomingDesc")}
            />
          ) : (
            <Stack gap="xs">
              {upcoming.map((b) => (
                <BookingCard
                  key={b.id}
                  b={b}
                  hostTimeZone={hostInfo?.hostTimeZone ?? "Asia/Seoul"}
                  onCancel={() => setCancelTarget(b)}
                  onReschedule={() => setRescheduleTarget(b)}
                  onBriefing={() => void handleBriefing(b)}
                  onClassify={() => void handleClassify(b)}
                  classification={classifications[b.id]}
                  classifyLoading={classifyingId === b.id}
                />
              ))}
            </Stack>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="past" pt="md">
          {loading ? (
            <Center py="xl">
              <Loader color="jarvis" size="sm" />
            </Center>
          ) : past.length === 0 ? (
            <EmptyState
              icon={<IconCalendar size={28} />}
              title={t("dash.emptyPastTitle")}
            />
          ) : (
            <Stack gap="xs">
              {past.map((b) => (
                <BookingCard
                  key={b.id}
                  b={b}
                  hostTimeZone={hostInfo?.hostTimeZone ?? "Asia/Seoul"}
                  onCancel={() => setCancelTarget(b)}
                  onReschedule={() => setRescheduleTarget(b)}
                  onBriefing={() => void handleBriefing(b)}
                  onClassify={() => void handleClassify(b)}
                  classification={classifications[b.id]}
                  classifyLoading={classifyingId === b.id}
                />
              ))}
            </Stack>
          )}
        </Tabs.Panel>
      </Tabs>
        )}
      </Stack>

      {/* Cancel confirm modal */}
      <Modal
        opened={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        title={t("dash.cancelModalTitle")}
        centered
      >
        {cancelTarget && (
          <Stack gap="md">
            <Text fz="sm">{t("dash.cancelConfirm")}</Text>
            <Box
              style={{ background: "#151F32", borderRadius: 10, padding: 12 }}
            >
              <Text fz="sm" fw={600}>
                {cancelTarget.date} {cancelTarget.start} ~ {cancelTarget.end}
              </Text>
              <Text fz="sm">
                {cancelTarget.name} ({cancelTarget.email})
              </Text>
            </Box>
            <Group justify="flex-end">
              <Button
                variant="subtle"
                color="gray"
                onClick={() => setCancelTarget(null)}
              >
                {t("dash.no")}
              </Button>
              <Button variant="filled"
                color="red"
                loading={cancelling}
                onClick={() => void handleCancel()}
              >
                {t("common.cancelBooking")}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      {/* AI briefing modal */}
      <Modal
        opened={!!briefingTarget}
        onClose={() => setBriefingTarget(null)}
        title={t("dash.briefingModalTitle")}
        centered
      >
        {briefingTarget && (
          <Stack gap="md">
            <Box style={{ background: "#151F32", borderRadius: 10, padding: 12 }}>
              <Text fz="sm" fw={600}>
                {briefingTarget.date} {briefingTarget.start} ~ {briefingTarget.end}
              </Text>
              <Text fz="sm">
                {briefingTarget.name} ({briefingTarget.email})
              </Text>
            </Box>
            {briefingLoading ? (
              <Center py="md">
                <Loader color="jarvis" size="sm" />
              </Center>
            ) : (
              <Text fz="sm" style={{ whiteSpace: "pre-wrap" }}>
                {briefingText}
              </Text>
            )}
          </Stack>
        )}
      </Modal>

      {/* Reschedule slot picker modal */}
      <Modal
        opened={!!rescheduleTarget}
        onClose={() => setRescheduleTarget(null)}
        title={t("common.reschedule")}
        size="lg"
        centered
      >
        {rescheduleTarget && hostInfo ? (
          <Box style={{ minHeight: 400, position: "relative" }}>
            <LoadingOverlay visible={rescheduling} loaderProps={{ color: "jarvis" }} />
            <Text fz="sm" c="dimmed" mb="sm">
              {t("dash.rescheduleHint")}
            </Text>
            <G2DateTimeScreen
              weeklyAvailability={hostInfo.weeklyAvailability}
              meetingDurationMin={
                rescheduleTarget.durationMin ?? hostInfo.meetingDurationMin
              }
              onSelect={(slot) => void handleReschedule(slot)}
            />
          </Box>
        ) : (
          <Center py="xl">
            <Loader color="jarvis" size="sm" />
          </Center>
        )}
      </Modal>
    </>
  );
}
