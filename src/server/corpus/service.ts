import type { CorpusSnapshot, CorpusSource } from '../../shared/corpus.js';
import { CorpusError, extract, hash, MAX_SOURCE_BYTES, PIPELINE_VERSION } from './extract.js';
import { type CorpusEmbedder, validateVectors } from './search.js';
import { CorpusStore } from './store.js';

export interface CorpusInput {
  provider: CorpusSnapshot['provider']; externalId: string; name: string; mime: string; bytes: Buffer;
  labels?: string[]; connectionId?: string; providerRevision?: string; sourceUrl?: string;
  backup?: CorpusSnapshot['backup']; extracted?: Pick<Awaited<ReturnType<typeof extract>>, 'profile' | 'chunks'> & Partial<Pick<Awaited<ReturnType<typeof extract>>, 'units'>>;
}
export class CorpusService {
  private queue: Promise<unknown> = Promise.resolve();
  private vectorIndexing = new Set<string>();
  constructor(readonly store: CorpusStore, readonly embedder?: CorpusEmbedder) {}
  import(input: CorpusInput, stillAuthorized: () => boolean = () => true): Promise<CorpusSource> {
    const run = this.queue.then(async () => {
      if (!input.bytes.length) throw new CorpusError('empty_file', 400);
      if (input.bytes.length > MAX_SOURCE_BYTES) throw new CorpusError('file_too_large', 413);
      const labels = [...new Set((input.labels ?? []).map(label => label.normalize('NFKC').trim()).filter(Boolean))].sort();
      if (labels.length > 20 || labels.some(label => label.length > 80)) throw new CorpusError('labels_limit', 400);
      if (!input.name || input.name.length > 250 || input.externalId.length > 1000) throw new CorpusError('invalid_source_name', 400);
      const sourceId = hash(`${input.provider}\0${input.connectionId ?? ''}\0${input.externalId}`);
      const contentHash = hash(input.bytes);
      const revision = hash(JSON.stringify({ contentHash, version: PIPELINE_VERSION, labels, providerRevision: input.providerRevision, name: input.name, mime: input.mime }));
      const parsed = input.extracted ?? await extract(input.name, input.mime, input.bytes, labels);
      if (!stillAuthorized()) throw new CorpusError('connection_inactive', 403);
      const snapshot: CorpusSnapshot = {
        schemaVersion: 1, pipelineVersion: PIPELINE_VERSION, sourceId, revision, contentHash,
        provider: input.provider, externalId: input.externalId, name: input.name, importedAt: new Date().toISOString(),
        connectionId: input.connectionId, providerRevision: input.providerRevision, sourceUrl: input.sourceUrl,
        labels, bytes: input.bytes.length, profile: parsed.profile, chunks: parsed.chunks, units: parsed.units, backup: input.backup ?? 'original',
      };
      return this.store.commit(snapshot, input.bytes);
    });
    this.queue = run.catch(() => {});
    return run;
  }
  async indexVectors(id: string, allowed: (snapshot: CorpusSnapshot) => boolean = () => true): Promise<{ chunks: number; total: number; model: string; complete: boolean }> {
    if (!this.embedder) throw new CorpusError('local_embedding_not_configured', 503);
    if (this.vectorIndexing.has(id)) throw new CorpusError('import_busy_retry', 409);
    this.vectorIndexing.add(id);
    try {
    const snapshot = this.store.snapshot(id);
    if (!snapshot) throw new CorpusError('source_not_found', 404);
    if (!allowed(snapshot) || !this.store.list().find(s => s.sourceId === id)?.enabled) throw new CorpusError('source_inactive', 403);
    if (!snapshot.chunks.length) throw new CorpusError('no_extracted_chunks', 409);
    const total = snapshot.chunks.length;
    const cached = this.store.readVectors(id, snapshot.revision, this.embedder.model);
    if (validateVectors(cached, total)) return { chunks: total, total, model: this.embedder.model, complete: true };
    const vectors = this.store.readVectorProgress(id, snapshot.revision, this.embedder.model);
    if (vectors.length > total || (vectors.length && !validateVectors(vectors, vectors.length))) throw new CorpusError('invalid_embedding_checkpoint', 409);
    const end = Math.min(total, vectors.length + 128);
    const units = new Map(snapshot.units?.map(unit => [unit.id, unit]) ?? []);
    while (vectors.length < end) {
      const batch = snapshot.chunks.slice(vectors.length, Math.min(end, vectors.length + 16));
      const result = await this.embedder.embed(batch.map(chunk => `${snapshot.name}\n${units.get(chunk.unitId ?? '')?.headingPath.join(' > ') ?? ''}\n${chunk.text}`));
      if (!validateVectors(result, batch.length, vectors[0]?.length)) throw new CorpusError('invalid_embedding', 502);
      const current = this.store.snapshot(id);
      if (!current || current.revision !== snapshot.revision || !allowed(current) || !this.store.isEnabled(id)) throw new CorpusError('source_inactive', 403);
      vectors.push(...result); this.store.writeVectorProgress(id, snapshot.revision, this.embedder.model, vectors);
    }
    const complete = vectors.length === total;
    if (complete) { this.store.writeVectors(id, snapshot.revision, this.embedder.model, vectors); this.store.clearVectorProgress(id, snapshot.revision, this.embedder.model); }
    return { chunks: vectors.length, total, model: this.embedder.model, complete };
    } finally { this.vectorIndexing.delete(id); }
  }
}
