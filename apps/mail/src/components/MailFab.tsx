"use client";

import { ActionIcon } from "@mantine/core";
import { IconPencilPlus } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";

interface Props {
  onClick: () => void;
}

export default function MailFab({ onClick }: Props) {
  const { t } = useI18n();
  return (
    <ActionIcon
      variant="filled"
      color="jarvis"
      radius="xl"
      size={56}
      onClick={onClick}
      aria-label={t("sidebar.compose")}
      style={{
        position: "fixed",
        bottom: 96,
        right: 24,
        zIndex: 200,
        boxShadow: "0 4px 20px rgba(99,102,241,0.4)",
      }}
    >
      <IconPencilPlus size={24} />
    </ActionIcon>
  );
}
