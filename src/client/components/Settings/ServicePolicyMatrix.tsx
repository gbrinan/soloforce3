import { Table, Select, Text, Badge } from "@mantine/core";
import type { ServicePolicy, PolicyMode } from "../../utils/api";
import { useI18n } from "../../i18n/I18nProvider";

interface Props {
  services: ServicePolicy[];
  onPatch: (id: string, patch: { readPolicy?: PolicyMode; writePolicy?: PolicyMode }) => void;
  loading: boolean;
}

export function ServicePolicyMatrix({ services, onPatch, loading }: Props) {
  const { t } = useI18n();
  const POLICY_OPTIONS = [
    { value: "auto", label: t('settings.policy.auto') },
    { value: "approval", label: t('settings.policy.approval') },
  ];
  const connected = services.filter((s) => s.connected && s.enabled);

  if (connected.length === 0) {
    return (
      <Text size="sm" c="dimmed" ta="center" py="md">
        {t('settings.policy.noConnectedServices')}
      </Text>
    );
  }

  return (
    <Table striped withTableBorder withColumnBorders fz="sm">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>{t('settings.policy.serviceColumn')}</Table.Th>
          <Table.Th style={{ width: 160 }}>{t('settings.policy.readPolicyColumn')}</Table.Th>
          <Table.Th style={{ width: 160 }}>{t('settings.policy.writePolicyColumn')}</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {connected.map((svc) => (
          <Table.Tr key={svc.id}>
            <Table.Td>
              <Text size="sm" fw={500}>
                {svc.label}
              </Text>
            </Table.Td>
            <Table.Td>
              <Select
                size="xs"
                data={POLICY_OPTIONS}
                value={svc.readPolicy}
                disabled={loading}
                onChange={(v) => v && onPatch(svc.id, { readPolicy: v as PolicyMode })}
                styles={{ input: { minHeight: 28 } }}
              />
            </Table.Td>
            <Table.Td>
              <Select
                size="xs"
                data={POLICY_OPTIONS}
                value={svc.writePolicy}
                disabled={loading}
                onChange={(v) => v && onPatch(svc.id, { writePolicy: v as PolicyMode })}
                styles={{ input: { minHeight: 28 } }}
              />
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
