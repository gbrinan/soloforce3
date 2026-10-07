import { useEffect, useState } from "react";
import { ActionIcon, Popover, useMantineColorScheme } from "@mantine/core";
import { IconApps } from "@tabler/icons-react";
import { startAppRegistryPoll, type AppManifestClient } from "../../utils/appRegistry";
import AppLauncherModal from "./AppLauncherModal";
import { useI18n } from "../../i18n/I18nProvider";

interface Props {
  onEnterApp: (manifest: AppManifestClient) => void;
}

export default function AppLauncherButton({ onEnterApp }: Props) {
  const { t } = useI18n();
  const { colorScheme } = useMantineColorScheme();
  const [opened, setOpened] = useState(false);

  // 레지스트리 폴링 부트스트랩 — 드로어(AppLauncherModal)가 변경 이벤트를 구독한다.
  useEffect(() => {
    startAppRegistryPoll(30_000);
  }, []);

  // 앱 0개(신품 패키지)여도 런처는 항상 노출 — AppLauncherModal이 스토어 소개
  // 빈 상태(아트워크 + "스토어에서 앱을 설치해보세요" + 이동 버튼)를 보여준다.
  // (기존엔 0개일 때 버튼을 숨겨 신규 고객이 빈 상태 안내를 영영 못 보는 문제가 있었음)

  const label = t("appLauncher.aria");
  const isDark = colorScheme === "dark";

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-end"
      offset={8}
      withArrow={false}
      shadow="xl"
      radius="xl"
      closeOnClickOutside
      closeOnEscape
    >
      <Popover.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="lg"
          aria-label={label}
          title={label}
          onClick={() => setOpened((o) => !o)}
          style={{ marginRight: 4 }}
        >
          <IconApps size={20} stroke={1.5} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown
        style={{
          background: isDark ? "var(--mantine-color-dark-8)" : "var(--mantine-color-gray-0)",
          border: isDark ? "1px solid var(--mantine-color-dark-5)" : "1px solid var(--mantine-color-gray-3)",
          padding: "20px",
          minWidth: 420,
          backdropFilter: "blur(8px)",
        }}
      >
        <AppLauncherModal
          opened={opened}
          onClose={() => setOpened(false)}
          onEnterApp={onEnterApp}
        />
      </Popover.Dropdown>
    </Popover>
  );
}
