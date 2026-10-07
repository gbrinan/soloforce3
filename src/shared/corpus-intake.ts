/** One-host intake budgets. The interactive parser keeps its separate 20 MiB limit. */
export const INTAKE_LIMITS = {
  originalBytes: 512 * 1024 * 1024,
  partBytes: 4 * 1024 * 1024,
  reservedBytes: 8 * 1024 * 1024 * 1024,
  jobs: 100,
  expandedBytes: 256 * 1024 * 1024,
  extractedCharacters: 8_000_000,
  units: 50_000,
  chunks: 100_000,
  unitsPerRun: 250,
  workerTimeoutMs: 120_000,
} as const;

export interface CorpusIntake {
  schemaVersion: 1; id: string; name: string; mime: string; bytes: number; labels: string[];
  provider: 'local' | 'google-drive'; externalId: string; connectionId?: string; providerRevision?: string; sourceUrl?: string; backup?: 'original' | 'export';
  createdAt: string; uploadedBytes: number; parts: { offset: number; bytes: number; sha256: string }[];
  state: 'uploading' | 'queued' | 'running' | 'paused' | 'complete' | 'needs_review';
  contentHash?: string; parserVersion: string; cursor: number; reason?: string;
  baseRevision: string | null;
  pauseRequested?: boolean;
  source?: { sourceId: string; revision: string };
}
