"use client";

import { useEffect, useState } from "react";
import {
  Stack,
  TextInput,
  Textarea,
  Button,
  Group,
  Text,
  Switch,
  SimpleGrid,
  Box,
  SegmentedControl,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { apiUrl, pageUrl } from "@/lib/api-url";
import { useI18n } from "@/lib/i18n";
import type { EventType } from "@/types/event-type";

const DURATION_OPTIONS = ["15", "30", "45", "60", "90", "120"];
const COLOR_OPTIONS = ["jarvis", "blue", "teal", "green", "orange", "red", "pink"];

interface Props {
  existing?: EventType;
  onSaved: () => void;
  onCancel: () => void;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

export default function EventTypeForm({ existing, onSaved, onCancel }: Props) {
  const { t } = useI18n();
  const [title, setTitle] = useState(existing?.title ?? "");
  const [slug, setSlug] = useState(existing?.slug ?? "");
  const [slugManual, setSlugManual] = useState(!!existing);
  const [durationMin, setDurationMin] = useState(String(existing?.durationMin ?? 30));
  const [color, setColor] = useState(existing?.color ?? "jarvis");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [active, setActive] = useState(existing?.active ?? true);
  const [slugError, setSlugError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!slugManual && title) {
      setSlug(slugify(title));
    }
  }, [title, slugManual]);

  function handleSlugChange(val: string) {
    setSlugManual(true);
    setSlug(val);
    setSlugError(undefined);
  }

  function validateSlugFormat(val: string): boolean {
    return /^[a-z0-9-]+$/.test(val);
  }

  async function checkSlugUnique(val: string): Promise<boolean> {
    if (!val) return true;
    try {
      const res = await fetch(apiUrl(`/api/event-types/${val}`));
      if (res.status === 404) return true;
      if (res.ok) {
        const found = (await res.json()) as EventType;
        // allow same slug if editing the same item
        if (existing && found.id === existing.id) return true;
        return false;
      }
    } catch {
      // network error — assume ok
    }
    return true;
  }

  async function handleSubmit() {
    if (!title.trim()) {
      notifications.show({ color: "red", message: t("etf.titleRequired") });
      return;
    }
    if (!slug.trim() || !validateSlugFormat(slug)) {
      setSlugError(t("etf.slugFormat"));
      return;
    }
    const unique = await checkSlugUnique(slug);
    if (!unique) {
      setSlugError(t("etf.slugTaken"));
      return;
    }

    setSaving(true);
    try {
      const payload = {
        title,
        slug,
        durationMin: Number(durationMin),
        color,
        description: description || undefined,
        active,
      };

      const url = existing
        ? apiUrl(`/api/event-types/${existing.id}`)
        : apiUrl("/api/event-types");
      const method = existing ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.status === 409) {
        setSlugError(t("etf.slugTaken"));
        return;
      }
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        notifications.show({ color: "red", message: err.error ?? t("common.saveFail") });
        return;
      }

      notifications.show({ color: "jarvis", message: t("etf.saved") });
      onSaved();
    } catch {
      notifications.show({ color: "red", message: t("common.networkError") });
    } finally {
      setSaving(false);
    }
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <Stack gap="md">
      <TextInput
        label={t("etf.titleLabel")}
        placeholder={t("etf.titlePlaceholder")}
        required
        value={title}
        onChange={(e) => setTitle(e.currentTarget.value)}
      />

      <Stack gap={4}>
        <TextInput
          label="URL Slug"
          placeholder="30min-consult"
          required
          value={slug}
          onChange={(e) => handleSlugChange(e.currentTarget.value)}
          error={slugError}
          description={slug ? t("etf.bookingLink", { url: `${origin}${pageUrl(`/book/${slug}`)}` }) : undefined}
        />
      </Stack>

      <Stack gap={4}>
        <Text fz="sm" fw={500}>
          {t("etf.duration")}
        </Text>
        <SegmentedControl
          value={durationMin}
          onChange={setDurationMin}
          data={DURATION_OPTIONS.map((v) => ({ value: v, label: t("common.minutes", { n: v }) }))}
          color="jarvis"
        />
      </Stack>

      <Stack gap={4}>
        <Text fz="sm" fw={500}>
          {t("etf.color")}
        </Text>
        <SimpleGrid cols={7} spacing="xs">
          {COLOR_OPTIONS.map((c) => (
            <Box
              key={c}
              onClick={() => setColor(c)}
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: `var(--mantine-color-${c}-5)`,
                cursor: "pointer",
                outline:
                  color === c ? `3px solid var(--mantine-color-${c}-3)` : "none",
                outlineOffset: 2,
              }}
            />
          ))}
        </SimpleGrid>
      </Stack>

      <Textarea
        label={t("etf.description")}
        placeholder={t("etf.descriptionPlaceholder")}
        rows={3}
        maxLength={200}
        value={description}
        onChange={(e) => setDescription(e.currentTarget.value)}
      />

      <Group>
        <Switch
          label={t("etf.public")}
          color="jarvis"
          checked={active}
          onChange={(e) => setActive(e.currentTarget.checked)}
        />
      </Group>

      <Group justify="flex-end" gap="sm">
        <Button variant="subtle" color="gray" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button variant="filled" color="jarvis" loading={saving} onClick={() => void handleSubmit()}>
          {t("common.saveBtn")}
        </Button>
      </Group>
    </Stack>
  );
}
