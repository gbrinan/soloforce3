import { SimpleGrid, Card, Stack, Group, Text, Badge, Switch, ActionIcon, Tooltip } from "@mantine/core";
import {
  IconBrandGoogleDrive,
  IconBrandGmail,
  IconCalendar,
  IconBrandSlack,
  IconNote,
  IconBriefcase,
  IconPlugConnectedX,
} from "@tabler/icons-react";
import type { ServicePolicy, PolicyMode } from "../../utils/api";
import { useI18n } from "../../i18n/I18nProvider";

interface Props {
  services: ServicePolicy[];
  onToggle: (id: string, enabled: boolean) => void;
  loading: boolean;
}

const SERVICE_ICONS: Record<string, React.ReactNode> = {
  "google-drive": <IconBrandGoogleDrive size={20} />,
  "google-calendar": <IconCalendar size={20} />,
  gmail: <IconBrandGmail size={20} />,
  slack: <IconBrandSlack size={20} />,
  notion: <IconNote size={20} />,
  asana: <IconBriefcase size={20} />,
};

const SERVICE_COLORS: Record<string, string> = {
  "google-drive": "blue",
  "google-calendar": "teal",
  gmail: "red",
  slack: "violet",
  notion: "dark",
  asana: "orange",
};

function policyLabel(p: PolicyMode, t: (key: any) => string): string {
  return p === "auto" ? t('settings.policy.auto') : t('settings.policy.approvalShort');
}

export function ServiceCardGrid({ services, onToggle, loading }: Props) {
  const { t } = useI18n();
  return (
    <SimpleGrid cols={2} spacing="sm">
      {services.map((svc) => {
        const color = SERVICE_COLORS[svc.id] ?? "gray";
        const icon = SERVICE_ICONS[svc.id] ?? <IconBriefcase size={20} />;

        return (
          <Card key={svc.id} withBorder radius="md" p="sm" opacity={svc.connected ? 1 : 0.6}>
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Group gap="xs" style={{ flex: 1, minWidth: 0 }}>
                <ActionIcon variant="light" color={color} size="lg" radius="md" style={{ flexShrink: 0 }}>
                  {icon}
                </ActionIcon>
                <Stack gap={2} style={{ minWidth: 0 }}>
                  <Group gap={4} align="center">
                    <Text size="sm" fw={600} truncate>
                      {svc.label}
                    </Text>
                    {!svc.connected && (
                      <Tooltip label={t('settings.policy.notConnected')}>
                        <IconPlugConnectedX size={13} color="gray" />
                      </Tooltip>
                    )}
                  </Group>
                  {svc.connected ? (
                    <Group gap={4}>
                      <Badge size="xs" variant="dot" color="teal">
                        {t('settings.policy.readLabel', { value: policyLabel(svc.readPolicy, t) })}
                      </Badge>
                      <Badge size="xs" variant="dot" color="orange">
                        {t('settings.policy.writeLabel', { value: policyLabel(svc.writePolicy, t) })}
                      </Badge>
                    </Group>
                  ) : (
                    <Text size="xs" c="dimmed">
                      {t('settings.policy.notConnectedShort')}
                    </Text>
                  )}
                </Stack>
              </Group>

              {svc.connected && (
                <Switch
                  size="sm"
                  checked={svc.enabled}
                  disabled={loading}
                  onChange={(e) => onToggle(svc.id, e.currentTarget.checked)}
                  style={{ flexShrink: 0 }}
                />
              )}
            </Group>
          </Card>
        );
      })}
    </SimpleGrid>
  );
}
