import { useEffect, useState } from "react";
import { Stack, Title, Text, Divider, LoadingOverlay, Alert } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { listServicePolicies, patchServicePolicy, type ServicePolicy, type PolicyMode } from "../../utils/api";
import { ServiceCardGrid } from "./ServiceCardGrid";
import { ServicePolicyMatrix } from "./ServicePolicyMatrix";
import { useI18n } from "../../i18n/I18nProvider";

export function ServicePolicyPanel() {
  const { t } = useI18n();
  const [services, setServices] = useState<ServicePolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [patching, setPatching] = useState(false);

  useEffect(() => {
    listServicePolicies().then((s) => {
      setServices(s);
      setLoading(false);
    });
  }, []);

  const handleToggle = async (id: string, enabled: boolean) => {
    setPatching(true);
    const result = await patchServicePolicy(id, { enabled });
    if (result.ok && result.service) {
      setServices((prev) => prev.map((s) => (s.id === id ? result.service! : s)));
    }
    setPatching(false);
  };

  const handlePolicyPatch = async (id: string, patch: { readPolicy?: PolicyMode; writePolicy?: PolicyMode }) => {
    setPatching(true);
    const result = await patchServicePolicy(id, patch);
    if (result.ok && result.service) {
      setServices((prev) => prev.map((s) => (s.id === id ? result.service! : s)));
    }
    setPatching(false);
  };

  return (
    <Stack gap="md" pos="relative" p="xs">
      <LoadingOverlay visible={loading} />

      <Alert icon={<IconInfoCircle size={14} />} variant="light" color="blue" p="xs">
        <Text size="xs">
          {t('settings.policyPanel.writeAlertPrefix')}<b>{t('settings.policy.approval')}</b>{t('settings.policyPanel.writeAlertSuffix')}
        </Text>
      </Alert>

      <div>
        <Title order={6} mb="xs" c="dimmed">
          {t('settings.policyPanel.activationTitle')}
        </Title>
        <ServiceCardGrid services={services} onToggle={handleToggle} loading={patching} />
      </div>

      <Divider />

      <div>
        <Title order={6} mb="xs" c="dimmed">
          {t('settings.policyPanel.matrixTitle')}
        </Title>
        <ServicePolicyMatrix services={services} onPatch={handlePolicyPatch} loading={patching} />
      </div>
    </Stack>
  );
}
