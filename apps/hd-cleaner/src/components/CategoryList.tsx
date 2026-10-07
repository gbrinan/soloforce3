"use client";
import { Checkbox, Group, Text, ActionIcon, Stack } from "@mantine/core";
import type { ScanCategory } from "@/lib/scanner/common";
import { useI18n } from "@/lib/i18n";

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

interface Props {
  categories: ScanCategory[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onOpenDetail: (id: string) => void;
}

// 헨젤 디자인 3-2 카테고리 리스트. Large Files는 별도 우측 패널(page.tsx)에서 렌더링하므로 제외.
export default function CategoryList({ categories, selected, onToggle, onOpenDetail }: Props) {
  const { t } = useI18n();
  const rows = categories.filter((c) => c.id !== "largeFiles");
  return (
    <Stack gap={10}>
      {rows.map((cat) => (
        <Group
          key={cat.id}
          justify="space-between"
          p={10}
          style={{ borderRadius: 10, background: "var(--bg-muted)" }}
        >
          <Group gap={10}>
            <Checkbox
              checked={selected.has(cat.id)}
              disabled={!cat.available}
              onChange={() => onToggle(cat.id)}
              radius={6}
            />
            <Text fw={600} size="sm" c="var(--text-primary)">
              {cat.label}
            </Text>
          </Group>
          <Group gap={8}>
            <Text fw={700} size="sm" c="var(--text-primary)" style={{ fontVariantNumeric: "tabular-nums" }}>
              {formatBytes(cat.totalSize)}
            </Text>
            <ActionIcon variant="subtle" size="sm" onClick={() => onOpenDetail(cat.id)} title={t("categoryList.detail")} aria-label={t("categoryList.detailAria", { label: cat.label })} disabled={!cat.available}>
              ⓘ
            </ActionIcon>
          </Group>
        </Group>
      ))}
    </Stack>
  );
}
