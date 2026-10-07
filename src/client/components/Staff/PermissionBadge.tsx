import { Badge } from '@mantine/core';
import { IconLock, IconUser, IconShieldCheck } from '@tabler/icons-react';
import type { PermissionLevel } from '../../utils/api';
import { useT } from '../../i18n/I18nProvider';

const PERMISSION_CONFIG: Record<
  PermissionLevel,
  { labelKey: string; color: string; Icon: React.ElementType; forceTextShade?: string }
> = {
  restricted: { labelKey: 'staff.badgeRestricted', color: 'red',    Icon: IconLock,        forceTextShade: 'red.9' },
  standard:   { labelKey: 'staff.badgeStandard',   color: 'blue',   Icon: IconUser },
  admin:      { labelKey: 'staff.badgeAdmin',      color: 'jarvis', Icon: IconShieldCheck },
  // 마이크루 파일접근 권한 레벨
  whitelist:  { labelKey: 'staff.badgeWhitelist',  color: 'orange', Icon: IconLock },
  workspace:  { labelKey: 'staff.badgeWorkspace',  color: 'blue',   Icon: IconUser },
  full:       { labelKey: 'staff.badgeFull',       color: 'jarvis', Icon: IconShieldCheck },
};

interface PermissionBadgeProps {
  level: PermissionLevel;
}

export function PermissionBadge({ level }: PermissionBadgeProps) {
  const t = useT();
  // 미지의 레벨이 와도 패널 전체가 크래시하지 않도록 가드.
  const cfg = PERMISSION_CONFIG[level];
  if (!cfg) return null;
  const { labelKey, color, Icon, forceTextShade } = cfg;
  const label = t(labelKey as Parameters<typeof t>[0]);
  return (
    <Badge
      color={color}
      variant="light"
      size="sm"
      c={forceTextShade}
      leftSection={<Icon size={12} aria-hidden />}
    >
      {label}
    </Badge>
  );
}
