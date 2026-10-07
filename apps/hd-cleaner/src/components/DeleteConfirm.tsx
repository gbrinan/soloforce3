"use client";
import { Modal, Text, Group, Button, Stack, Divider } from "@mantine/core";
import { useI18n } from "@/lib/i18n";

interface Props {
  opened: boolean;
  totalSize: string;
  categoryCount: number;
  fileCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}

// 헨젤 디자인 3-4. 이 모달만 유일하게 그림자를 사용한다(디자인 §1-6 원칙).
export default function DeleteConfirm({ opened, totalSize, categoryCount, fileCount, onCancel, onConfirm }: Props) {
  const { t } = useI18n();
  return (
    <Modal
      opened={opened}
      onClose={onCancel}
      centered
      withCloseButton={false}
      radius="lg"
      styles={{ content: { boxShadow: "0 12px 32px rgba(0,0,0,0.18)" } }}
    >
      <Stack gap={12}>
        <Text fw={700} size="lg">
          ⚠ {t("confirm.title", { size: totalSize })}
        </Text>
        <Text size="sm" c="dimmed">
          {t("confirm.detail", { categories: categoryCount, files: fileCount })}
        </Text>
        <Divider />
        <Text fw={700} c="var(--color-danger)">
          {t("confirm.warning")}
        </Text>
        <Group justify="flex-end" mt={8}>
          <Button variant="outline" onClick={onCancel}>
            {t("confirm.cancel")}
          </Button>
          <Button variant="filled" color="red" onClick={onConfirm}>
            {t("confirm.ok")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
