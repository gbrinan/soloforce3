"use client";
import { Text } from "@mantine/core";
import { useI18n } from "@/lib/i18n";

interface Props {
  freedBytes: number;
  visible: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

// 헨젤 디자인 §4-5 Toast 명세 (그림자 없음, border 계층 원칙)
export default function CompleteToast({ freedBytes, visible }: Props) {
  const { t } = useI18n();
  if (!visible) return null;
  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-default)",
        borderRadius: 10,
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        boxShadow: "none",
      }}
    >
      <Text size="sm" c="var(--color-success-text)" fw={700}>
        {t("toast.freed", { size: formatBytes(freedBytes) })}
      </Text>
    </div>
  );
}
