import { useEffect, useState } from "react";
import { Modal, Stack, Group, Switch, Text, Divider, Badge, Button } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  getManifests,
  getAppSettings,
  saveAppSettings,
  onAppRegistryChanged,
  type AppManifestClient,
} from "../../utils/appRegistry";
import { useI18n } from "../../i18n/I18nProvider";
import { useAppDisplayName } from "./useAppDisplayName";
import { fetchAppUpdateMap, updateApp, type AppUpdateStatus } from "../../utils/appUpdates";

interface Props {
  opened: boolean;
  onClose: () => void;
}

export default function AppManagerPopup({ opened, onClose }: Props) {
  const { t } = useI18n();
  const getDisplayName = useAppDisplayName();
  const [manifests, setManifests] = useState<AppManifestClient[]>(() => getManifests());
  const [, setTick] = useState(0);
  const [updates, setUpdates] = useState<Map<string, AppUpdateStatus>>(new Map());
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    const off = onAppRegistryChanged(() => setManifests(getManifests()));
    return () => off();
  }, []);

  useEffect(() => {
    if (!opened) return;
    fetchAppUpdateMap().then(setUpdates).catch(() => {});
  }, [opened]);

  const refresh = () => setTick((t) => t + 1);

  const runUpdate = async (id: string, name: string) => {
    setUpdating(id);
    try {
      const r = await updateApp(id);
      notifications.show({ color: "green", title: t('apps.updateCompleteTitle'), message: t('apps.updateCompleteMessagePast', { name, version: r.version }) });
      setUpdates(await fetchAppUpdateMap());
    } catch (err) {
      notifications.show({ color: "red", title: t('apps.updateFailedTitle'), message: (err as Error).message });
    } finally {
      setUpdating(null);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={t('apps.managerTitle')} centered size="sm">
      <Stack gap="md">
        {manifests.length === 0 && (
          <Text size="sm" c="dimmed">
            {t("appManager.empty.before")}<code>~/mycrew-photos/</code>{t("appManager.empty.after")}
          </Text>
        )}
        {manifests.map((m) => {
          const s = getAppSettings(m.id);
          return (
            <div key={m.id}>
              <Group justify="space-between" align="flex-start" wrap="nowrap">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Group gap={6}>
                    {m.icon && (m.icon.startsWith("data:") || m.icon.startsWith("http") || m.icon.startsWith("/"))
                      ? <img src={m.icon} alt="" width={22} height={22} style={{ objectFit: "contain", borderRadius: 4 }} />
                      : <span style={{ fontSize: 18 }}>{m.icon || "📦"}</span>
                    }
                    <Text fw={600} size="sm">{getDisplayName(m)}</Text>
                    <Badge size="xs" variant="light" color={m.category === "core" ? "blue" : "gray"}>
                      {m.category}
                    </Badge>
                  </Group>
                  {m.description && (
                    <Text size="xs" c="dimmed" style={{ marginTop: 4 }}>{m.description}</Text>
                  )}
                  {(() => {
                    const u = updates.get(m.id);
                    if (!u) return <Text size="xs" c="dimmed" style={{ marginTop: 2 }}>v{m.version}</Text>;
                    return (
                      <Group gap={6} style={{ marginTop: 2 }}>
                        <Text size="xs" c="dimmed">{t('apps.currentLatestVersion', { current: u.currentVersion, latest: u.latestVersion })}</Text>
                        {u.updatable ? (
                          <Button
                            size="compact-xs"
                            color="indigo"
                            loading={updating === m.id}
                            onClick={() => void runUpdate(m.id, getDisplayName(m))}
                          >
                            {t('apps.updateAction')}
                          </Button>
                        ) : (
                          <Badge size="xs" variant="light" color="green">{t('apps.upToDate')}</Badge>
                        )}
                      </Group>
                    );
                  })()}
                </div>
                <Switch
                  size="md"
                  checked={s.enabled}
                  onChange={(e) => { saveAppSettings(m.id, { enabled: e.currentTarget.checked }); refresh(); }}
                />
              </Group>
              <Stack gap={6} mt="xs" pl="md">
                <Switch
                  size="xs"
                  label={t('apps.headerShortcutLabel')}
                  checked={s.headerShortcut}
                  onChange={(e) => { saveAppSettings(m.id, { headerShortcut: e.currentTarget.checked }); refresh(); }}
                  disabled={!s.enabled}
                />
                <Switch
                  size="xs"
                  label={t('apps.autostartLabel')}
                  checked={s.autostart}
                  onChange={(e) => { saveAppSettings(m.id, { autostart: e.currentTarget.checked }); refresh(); }}
                  disabled={!s.enabled}
                />
              </Stack>
              <Divider mt="md" />
            </div>
          );
        })}
        <Text size="xs" c="dimmed">
          {t("appManager.removeHint.before")}<code>~/mycrew-photos/scripts/uninstall.sh</code>{t("appManager.removeHint.after")}
        </Text>
      </Stack>
    </Modal>
  );
}
