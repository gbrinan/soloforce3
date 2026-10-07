export interface AdapterCapabilities {
  terminal: boolean;
  persistent: boolean;
  resumable: boolean;
}

const LEGACY_IDS = new Set(["claude-code", "codex"]);

export function normalizeAdapterId(
  id: string | undefined,
  interactive?: boolean,
  legacyMode?: string,
): string {
  const persistent = legacyMode ? legacyMode === "persistent" : interactive === true;
  if (!id || id === "claude-code") return persistent ? "claude-cli" : "claude-print";
  if (id === "codex") return persistent ? "codex-cli" : "codex-exec";
  return id;
}

export function isLegacyAdapterId(id: string): boolean {
  return LEGACY_IDS.has(id);
}
