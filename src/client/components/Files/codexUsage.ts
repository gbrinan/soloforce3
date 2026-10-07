type WindowLabelKey =
  | 'costs.windowUsage'
  | 'costs.windowMinutes'
  | 'costs.windowHours'
  | 'costs.windowDays'
  | 'costs.windowDaysHours';

type TranslateWindowLabel = (
  key: WindowLabelKey,
  vars?: Record<string, string | number>,
) => string;

export function formatCodexWindowLabel(
  windowMinutes: number,
  t: TranslateWindowLabel,
): string {
  if (!Number.isFinite(windowMinutes) || windowMinutes <= 0) {
    return t('costs.windowUsage');
  }

  const totalMinutes = Math.round(windowMinutes);
  const days = Math.floor(totalMinutes / 1440);
  const remainingMinutes = totalMinutes % 1440;
  const hours = Math.floor(remainingMinutes / 60);

  if (days > 0 && hours > 0) {
    return t('costs.windowDaysHours', { d: days, h: hours });
  }
  if (days > 0 && remainingMinutes === 0) {
    return t('costs.windowDays', { d: days });
  }
  if (totalMinutes >= 60 && totalMinutes % 60 === 0) {
    return t('costs.windowHours', { h: totalMinutes / 60 });
  }
  return t('costs.windowMinutes', { m: totalMinutes });
}
