"use client";

import { Modal } from "@mantine/core";
import VideoImportPanel from "@/components/VideoImportPanel";
import { useI18n } from "@/lib/i18n/I18nProvider";

interface Props {
  opened: boolean;
  onClose: () => void;
  onJobCreated: (jobId: string, title: string) => void;
  defaultUrl?: string;
}

export default function AddVideoModal({ opened, onClose, onJobCreated, defaultUrl }: Props) {
  const { t } = useI18n();
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t("editor.addVideo.modalTitle")}
      size="lg"
      centered
    >
      <VideoImportPanel
        defaultUrl={defaultUrl}
        onJobCreated={(id, title) => {
          onJobCreated(id, title);
          onClose();
        }}
      />
    </Modal>
  );
}
