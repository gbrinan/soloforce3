"use client";
// Natural-language scan filter input: parse via /api/ai/parse-filter,
// fill the editable form below, then the user confirms and starts the scan.
import { useState } from "react";
import { Button, Group, NumberInput, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { ScanFilter } from "@/lib/scanner/common";
import { useI18n } from "@/lib/i18n";

interface Props {
  basePath: string;
  filter: ScanFilter;
  onFilterChange: (filter: ScanFilter) => void;
  disabled?: boolean;
}

function parseCsv(value: string): string[] | undefined {
  const arr = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return arr.length ? arr : undefined;
}

export default function FilterBar({ basePath, filter, onFilterChange, disabled }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [parsing, setParsing] = useState(false);
  // Whether the form is shown (after a successful parse or manual open).
  const [formOpen, setFormOpen] = useState(false);

  const runParse = async () => {
    if (!query.trim()) return;
    setParsing(true);
    try {
      const res = await fetch(`${basePath}/api/ai/parse-filter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || t("filter.convertFail"));
      onFilterChange(data.filter as ScanFilter);
      setFormOpen(true);
      notifications.show({ color: "teal", message: t("filter.converted") });
    } catch (err) {
      notifications.show({
        color: "red",
        message: t("filter.convertFailMsg", { msg: err instanceof Error ? err.message : String(err) }),
      });
    } finally {
      setParsing(false);
    }
  };

  const set = (patch: Partial<ScanFilter>) => onFilterChange({ ...filter, ...patch });
  const hasFilter = Object.values(filter).some((v) => v !== undefined);

  return (
    <Stack gap={16} w="100%">
      <Group gap={10} wrap="nowrap" align="flex-end">
        <TextInput
          style={{ flex: 1 }}
          size="md"
          label={t("filter.label")}
          description={t("filter.description")}
          placeholder={t("filter.placeholder")}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !parsing) void runParse();
          }}
          disabled={disabled || parsing}
          styles={{
            label: { fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 },
            description: { marginBottom: 8 },
          }}
        />
        <Button size="md" variant="default" onClick={() => void runParse()} loading={parsing} disabled={disabled || !query.trim()}>
          {t("filter.convert")}
        </Button>
      </Group>

      {(formOpen || hasFilter) && (
        <Stack gap={8}>
          <Text size="xs" c="var(--text-muted)">
            {t("filter.confirmHint")}
          </Text>
          <Group gap={8} align="flex-end" wrap="wrap">
            <NumberInput
              label={t("filter.minSize")}
              min={1}
              w={130}
              value={filter.minSizeMB ?? ""}
              onChange={(v) => set({ minSizeMB: typeof v === "number" ? v : undefined })}
              disabled={disabled}
            />
            <NumberInput
              label={t("filter.unusedDays")}
              min={1}
              w={130}
              value={filter.olderThanDays ?? ""}
              onChange={(v) => set({ olderThanDays: typeof v === "number" ? v : undefined })}
              disabled={disabled}
            />
            <TextInput
              label={t("filter.extensions")}
              placeholder="mp4, mov, mkv"
              w={180}
              value={filter.extensions?.join(", ") ?? ""}
              onChange={(e) => set({ extensions: parseCsv(e.currentTarget.value) })}
              disabled={disabled}
            />
            <TextInput
              label={t("filter.pathIncludes")}
              placeholder="Downloads"
              w={180}
              value={filter.pathIncludes?.join(", ") ?? ""}
              onChange={(e) => set({ pathIncludes: parseCsv(e.currentTarget.value) })}
              disabled={disabled}
            />
            {hasFilter && (
              <Button
                variant="subtle"
                color="gray"
                onClick={() => {
                  onFilterChange({});
                  setFormOpen(false);
                }}
                disabled={disabled}
              >
                {t("filter.reset")}
              </Button>
            )}
          </Group>
        </Stack>
      )}
    </Stack>
  );
}
