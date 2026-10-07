export function prettyModel(model?: string | null): string {
  const value = (model ?? '').trim();
  if (!value) return '';
  if (value === 'auto') return 'Auto';

  const claude = value.match(/^claude-(fable|opus|sonnet|haiku)-(\d+)(?:-(\d))?/);
  if (claude) {
    const name = `${claude[1].charAt(0).toUpperCase()}${claude[1].slice(1)}`;
    return claude[3] !== undefined ? `${name} ${claude[2]}.${claude[3]}` : `${name} ${claude[2]}`;
  }

  const openAi = value.match(/^gpt-(\d+(?:\.\d+)?)-(.+)$/);
  if (openAi) return `GPT-${openAi[1]} ${titleWords(openAi[2])}`;

  const gemini = value.match(/^gemini-(\d+(?:\.\d+)?)-(.+)$/);
  if (gemini) return `Gemini ${gemini[1]} ${titleWords(gemini[2])}`;

  return value;
}

function titleWords(value: string): string {
  return value
    .split('-')
    .map((part) => part ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part)
    .join(' ');
}

export function formatWorkerModel(
  configuredModel?: string | null,
  recentActualModel?: string | null,
  recentLabel = '최근',
): string {
  const configured = prettyModel(configuredModel);
  const recent = prettyModel(recentActualModel);
  if (!configured) return recent;
  if (!recent || configuredModel === recentActualModel) return configured;
  return `${configured} (${recentLabel}: ${recent})`;
}
