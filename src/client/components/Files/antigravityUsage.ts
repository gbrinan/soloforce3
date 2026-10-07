interface AntigravityHistory {
  recent24hTokens: number | null;
  recent7dTokens: number | null;
  recent7dCalls: number;
}

export function hasAntigravityUsageHistory(usage: AntigravityHistory): boolean {
  return (usage.recent24hTokens ?? 0) > 0
    || (usage.recent7dTokens ?? 0) > 0
    || usage.recent7dCalls > 0;
}

export function selectAntigravityDisplayModel(
  configuredModel: string | null,
  recentActualModel: string | null,
): string | null {
  return recentActualModel || configuredModel;
}
