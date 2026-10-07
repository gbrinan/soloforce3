"use client";

import { useState } from "react";
import { Stack, TextInput, Textarea, Checkbox, Button, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { apiUrl } from "@/lib/api-url";
import { useI18n } from "@/lib/i18n";

interface FormData {
  name: string;
  email: string;
  phone: string;
  note: string;
}

interface Slot {
  date: string;
  start: string;
  end: string;
}

interface Props {
  slot: Slot;
  initialData: FormData;
  onChange: (data: FormData) => void;
  onConfirmed: (bookingId: string) => void;
  onSlotConflict: () => void;
  eventTypeId?: string;
  guestTimeZone?: string;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function G3FormScreen({
  slot,
  initialData,
  onChange,
  onConfirmed,
  onSlotConflict,
  eventTypeId,
  guestTimeZone,
}: Props) {
  const { t } = useI18n();
  const [data, setData] = useState<FormData>(initialData);
  const [terms, setTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<
    Partial<Record<keyof FormData | "terms", string>>
  >({});

  const update = (field: keyof FormData, value: string) => {
    const next = { ...data, [field]: value };
    setData(next);
    onChange(next);
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
  };

  const validate = (): boolean => {
    const errs: Partial<Record<keyof FormData | "terms", string>> = {};
    if (!data.name.trim()) errs.name = t("g3.nameRequired");
    if (!data.email.trim()) errs.email = t("g3.emailRequired");
    else if (!isValidEmail(data.email)) errs.email = t("g3.emailInvalid");
    if (!terms) errs.terms = t("g3.termsRequired");
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const submit = async () => {
    if (!validate() || loading) return;
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/api/bookings"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: slot.date,
          start: slot.start,
          end: slot.end,
          name: data.name,
          email: data.email,
          ...(data.phone ? { phone: data.phone } : {}),
          ...(data.note ? { note: data.note } : {}),
          ...(eventTypeId ? { eventTypeId } : {}),
          ...(guestTimeZone ? { guestTimeZone } : {}),
        }),
      });

      if (res.status === 409) {
        notifications.show({
          color: "orange",
          title: t("g3.slotConflictTitle"),
          message: t("g3.slotConflictMsg"),
        });
        onSlotConflict();
        return;
      }

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        notifications.show({
          color: "red",
          message: err.error ?? t("g3.bookingFail"),
        });
        return;
      }

      const booking = (await res.json()) as { id: string };
      onConfirmed(booking.id);
    } catch {
      notifications.show({ color: "red", message: t("g3.networkErrorLong") });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Stack gap="md" p="md" style={{ flex: 1, overflowY: "auto", paddingBottom: 80 }}>
      <TextInput
        label={t("g3.name")}
        placeholder={t("g3.namePlaceholder")}
        required
        value={data.name}
        onChange={(e) => update("name", e.currentTarget.value)}
        error={errors.name}
      />
      <TextInput
        label={t("g3.email")}
        placeholder="example@email.com"
        required
        type="email"
        value={data.email}
        onChange={(e) => update("email", e.currentTarget.value)}
        error={errors.email}
      />
      <TextInput
        label={t("g3.phone")}
        placeholder="010-0000-0000"
        value={data.phone}
        onChange={(e) => update("phone", e.currentTarget.value)}
      />
      <Textarea
        label={t("g3.note")}
        placeholder={t("g3.notePlaceholder")}
        minRows={3}
        autosize
        value={data.note}
        onChange={(e) => update("note", e.currentTarget.value)}
      />
      <Checkbox
        label={
          <Text size="sm">
            {t("g3.terms")} <Text span c="red">*</Text>
          </Text>
        }
        checked={terms}
        onChange={(e) => {
          setTerms(e.currentTarget.checked);
          if (errors.terms) setErrors((er) => ({ ...er, terms: undefined }));
        }}
        color="jarvis"
        error={errors.terms}
      />
      <Button variant="filled"
        color="jarvis"
        radius="xl"
        size="md"
        loading={loading}
        onClick={() => void submit()}
        mt="sm"
      >
        {t("g3.confirm")}
      </Button>
    </Stack>
  );
}
