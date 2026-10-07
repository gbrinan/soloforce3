"use client";

import { useEffect, useState } from "react";
import { Box } from "@mantine/core";
import { postReadyToHost, subscribeHost } from "@/lib/host-bridge";
import { apiUrl } from "@/lib/api-url";
import { useI18n } from "@/lib/i18n";
import StepIndicator from "@/components/shared/StepIndicator";
import HostProfileCard from "@/components/shared/HostProfileCard";
import BookingSummaryBar from "@/components/shared/BookingSummaryBar";
import G1HostProfileScreen from "@/components/guest/G1HostProfileScreen";
import G2DateTimeScreen from "@/components/guest/G2DateTimeScreen";
import G3FormScreen from "@/components/guest/G3FormScreen";
import G4ConfirmationScreen from "@/components/guest/G4ConfirmationScreen";
import BookingFab from "@/components/BookingFab";

interface DayAvailability {
  enabled: boolean;
  ranges: [string, string][];
}

interface HostInfo {
  hostName: string;
  hostTitle: string;
  meetingDurationMin: number;
  weeklyAvailability: Record<string, DayAvailability>;
  hostTimeZone: string;
}

interface SelectedSlot {
  date: string;
  start: string;
  end: string;
  guestTimeZone?: string;
}

interface FormData {
  name: string;
  email: string;
  phone: string;
  note: string;
}

const DEFAULT_FORM: FormData = { name: "", email: "", phone: "", note: "" };

interface BookingScreenProps {
  eventTypeSlug?: string;
}

export default function BookingScreen({ eventTypeSlug }: BookingScreenProps) {
  const { t } = useI18n();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [hostInfo, setHostInfo] = useState<HostInfo | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<SelectedSlot | null>(null);
  const [formData, setFormData] = useState<FormData>(DEFAULT_FORM);
  const [confirmedBookingId, setConfirmedBookingId] = useState<string | null>(null);
  const [resolvedEventTypeId, setResolvedEventTypeId] = useState<string | undefined>();

  useEffect(() => {
    postReadyToHost();
    return subscribeHost({});
  }, []);

  useEffect(() => {
    if (eventTypeSlug) {
      void (async () => {
        try {
          const res = await fetch(apiUrl(`/api/event-types/${eventTypeSlug}`));
          if (res.ok) {
            const et = (await res.json()) as { id: string };
            setResolvedEventTypeId(et.id);
          }
        } catch {
          // keep undefined
        }
      })();
    }
  }, [eventTypeSlug]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(apiUrl("/api/availability"));
        if (!res.ok) return;
        const raw = (await res.json()) as Record<string, unknown>;
        setHostInfo({
          hostName: typeof raw.hostName === "string" ? raw.hostName : t("common.host"),
          hostTitle: typeof raw.hostTitle === "string" ? raw.hostTitle : "",
          meetingDurationMin:
            typeof raw.meetingDurationMin === "number" ? raw.meetingDurationMin : 30,
          weeklyAvailability:
            raw.weeklyAvailability != null &&
            typeof raw.weeklyAvailability === "object"
              ? (raw.weeklyAvailability as Record<string, DayAvailability>)
              : {},
          hostTimeZone:
            typeof raw.hostTimeZone === "string" ? raw.hostTimeZone : "Asia/Seoul",
        });
      } catch {
        // keep null — screens render with safe defaults
      }
    })();
  }, []);

  const reset = () => {
    setStep(1);
    setSelectedSlot(null);
    setFormData(DEFAULT_FORM);
    setConfirmedBookingId(null);
  };

  const showCompactHost = step > 1 && step < 4 && hostInfo != null;
  const showSummaryBar = (step === 2 || step === 3) && selectedSlot != null;

  return (
    <Box
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#070D1A",
        overflow: "hidden",
      }}
    >
      {/* Compact host banner for steps 2-3 */}
      {showCompactHost && (
        <HostProfileCard
          hostName={hostInfo!.hostName}
          hostTitle={hostInfo!.hostTitle}
          variant="compact"
        />
      )}

      <StepIndicator current={step} />

      <Box style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {step === 1 && (
          <G1HostProfileScreen
            hostName={hostInfo?.hostName ?? t("common.host")}
            hostTitle={hostInfo?.hostTitle}
            meetingDurationMin={hostInfo?.meetingDurationMin ?? 30}
            onNext={() => setStep(2)}
          />
        )}

        {step === 2 && (
          <G2DateTimeScreen
            weeklyAvailability={hostInfo?.weeklyAvailability ?? {}}
            meetingDurationMin={hostInfo?.meetingDurationMin ?? 30}
            hostTimeZone={hostInfo?.hostTimeZone ?? "Asia/Seoul"}
            onSelect={(slot) => {
              setSelectedSlot(slot);
              setStep(3);
            }}
          />
        )}

        {step === 3 && selectedSlot && (
          <G3FormScreen
            slot={selectedSlot}
            initialData={formData}
            onChange={setFormData}
            eventTypeId={resolvedEventTypeId}
            guestTimeZone={selectedSlot.guestTimeZone}
            onConfirmed={(id) => {
              setConfirmedBookingId(id);
              setStep(4);
            }}
            onSlotConflict={() => {
              setSelectedSlot(null);
              setStep(2);
            }}
          />
        )}

        {step === 4 && confirmedBookingId && selectedSlot && hostInfo && (
          <G4ConfirmationScreen
            bookingId={confirmedBookingId}
            slot={selectedSlot}
            hostName={hostInfo.hostName}
            meetingDurationMin={hostInfo.meetingDurationMin}
            onReset={reset}
          />
        )}
      </Box>

      {showSummaryBar && selectedSlot && (
        <BookingSummaryBar
          date={selectedSlot.date}
          start={selectedSlot.start}
          end={selectedSlot.end}
          visible
        />
      )}

      <BookingFab />
    </Box>
  );
}
