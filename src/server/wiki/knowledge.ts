import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { WikiKnowledge, WikiKnowledgeView, WikiReview, WikiScope } from '../../shared/wiki.js';
import { CorpusError, hash } from '../corpus/extract.js';
import { WikiScopeSchema, WikiService } from './service.js';
import { callWikiCore } from './bridge.js';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const knowledgeId = z.string().uuid().transform(id => `K-${id}`);
const stableId = z.string().regex(/^K-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
export const WikiReviewSchema = z.object({
  scope: WikiScopeSchema, jobId: digest, candidateId: digest, unitId: z.string().min(1).max(200), needIndex: z.number().int().min(0).max(499),
  verdict: z.enum(['accept', 'hold', 'reject']), reason: z.string().trim().min(1).max(4000), conditionsChecked: z.boolean(),
  baseSnapshot: digest.nullable(), knowledgeId: stableId.nullable(), expectedRevision: z.number().int().positive().nullable(),
}).strict();
interface Snapshot { snapshot: string; files: Record<string, string>; records: WikiKnowledge[]; manifest: Manifest }
interface Manifest { scope: WikiScope; baseSnapshot: string | null; reviewId: string; changed: { id: string; revision: number }; files: Record<string, string> }

function atomicFile(file: string, value: string): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.pending-${randomUUID()}`;
  try {
    const fd = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(fd, value, 'utf8'); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, file);
  } finally { rmSync(temporary, { force: true }); }
}
function metadata(text: string): WikiKnowledge {
  if (!text.startsWith('---\n') || !text.includes('\n---\n')) throw new CorpusError('wiki_snapshot_invalid', 409);
  return JSON.parse(text.slice(4).split('\n---\n')[0]) as WikiKnowledge;
}

/** Local owner workspace. Project names delimit data; they do not grant multi-tenant ACLs. */
export class WikiKnowledgeStore {
  constructor(readonly wiki: WikiService, private readonly replacePointer: (file: string, value: string) => void = atomicFile) {}
  project(scope: WikiScope): string {
    const parsed = WikiScopeSchema.parse(scope);
    return join(this.wiki.root, 'organizations', parsed.orgId, 'projects', parsed.projectId);
  }
  private lock<T>(scope: WikiScope, operation: () => T): T {
    const file = join(this.project(scope), 'writer.lock');
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    let fd: number;
    try { fd = openSync(file, 'wx', 0o600); } catch { throw new CorpusError('wiki_writer_locked', 409); }
    try { writeFileSync(fd, JSON.stringify({ pid: process.pid, recordedAt: new Date().toISOString() })); fsyncSync(fd); return operation(); }
    finally { closeSync(fd); rmSync(file); }
  }
  current(scope: WikiScope): string | null {
    const path = join(this.project(scope), 'current.json');
    return existsSync(path) ? digest.parse(JSON.parse(readFileSync(path, 'utf8')).snapshot) : null;
  }
  private snapshot(scope: WikiScope, id: string): Snapshot {
    const base = join(this.project(scope), 'snapshots', digest.parse(id));
    const raw = readFileSync(join(base, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(raw) as Manifest;
    if (hash(raw) !== id || manifest.scope.orgId !== scope.orgId || manifest.scope.projectId !== scope.projectId) throw new CorpusError('wiki_snapshot_invalid', 409);
    const files: Record<string, string> = {};
    for (const [name, expected] of Object.entries(manifest.files)) {
      if (!/^(knowledge\/K-[a-f0-9-]{36}\.md|reviews\/[a-f0-9]{64}\.json|relations\.json|index\.md)$/.test(name)) throw new CorpusError('wiki_snapshot_invalid', 409);
      const text = readFileSync(join(base, name), 'utf8');
      if (hash(text) !== expected) throw new CorpusError('wiki_snapshot_invalid', 409);
      files[name] = text;
    }
    const records = Object.entries(files).filter(([name]) => name.startsWith('knowledge/')).map(([name, text]) => {
      const item = metadata(text);
      if (name !== `knowledge/${stableId.parse(item.id)}.md` || item.owner_scope.orgId !== scope.orgId || item.owner_scope.projectId !== scope.projectId) throw new CorpusError('wiki_snapshot_invalid', 409);
      return item;
    });
    return { snapshot: id, files, records, manifest };
  }
  private available(item: WikiKnowledge): 'unchanged' | 'changed' {
    const source = this.wiki.corpus.snapshot(item.provenance.corpus_source_id);
    if (!source || !this.wiki.allowed(source) || !this.wiki.corpus.isEnabled(source.sourceId)) throw new CorpusError('wiki_source_unavailable', 404);
    if (!this.wiki.corpus.verifyOriginal(source)) throw new CorpusError('wiki_original_changed', 409);
    return source.revision === item.provenance.corpus_revision && source.contentHash === item.provenance.source_revision ? 'unchanged' : 'changed';
  }
  list(scope: WikiScope): { snapshot: string | null; items: WikiKnowledgeView[] } {
    const current = this.current(scope);
    if (!current) return { snapshot: null, items: [] };
    const items = this.snapshot(scope, current).records.flatMap(knowledge => {
      try { return [{ snapshot: current, knowledge, sourceState: this.available(knowledge) }]; }
      catch (error) { if (error instanceof CorpusError && error.status === 404) return []; throw error; }
    });
    return { snapshot: current, items };
  }
  read(scope: WikiScope, id: string): WikiKnowledgeView {
    stableId.parse(id);
    const current = this.current(scope);
    const knowledge = current && this.snapshot(scope, current).records.find(item => item.id === id);
    if (!current || !knowledge) throw new CorpusError('wiki_knowledge_not_found', 404);
    return { snapshot: current, knowledge, sourceState: this.available(knowledge) };
  }
  private candidate(review: Pick<WikiReview, 'scope' | 'jobId' | 'candidateId' | 'unitId' | 'needIndex'>) {
    const job = this.wiki.read(review.scope, review.jobId);
    if (job.sourceState !== 'unchanged') throw new CorpusError('wiki_source_changed', 409);
    const candidate = job.candidates.find(item => item.id === review.candidateId);
    const result = candidate?.response.results.find(item => item.unit_id === review.unitId);
    const need = result?.needs[review.needIndex];
    const request = job.payload.requests.find(item => item.request_id === candidate?.requestId);
    const unit = request?.units.find(item => item.unit_id === review.unitId);
    if (!need || !unit || !request || !result) throw new CorpusError('wiki_candidate_not_found', 404);
    return { job, value: { ...need, status: result.status, owner_scope: review.scope,
      provenance: { source_id: request.source_id, source_revision: request.source_revision, locator: unit.locator,
        evidence_kind: 'EXTRACTED', corpus_source_id: job.payload.source.sourceId, corpus_revision: job.payload.source.revision } } };
  }
  private headPath(review: Pick<WikiReview, 'scope' | 'jobId' | 'candidateId' | 'unitId' | 'needIndex'>): string {
    return join(this.project(review.scope), 'reviews', `head-${hash(JSON.stringify([review.jobId, review.candidateId, review.unitId, review.needIndex]))}.json`);
  }
  review(input: unknown, reviewer: string): WikiReview {
    const parsed = WikiReviewSchema.parse(input);
    return this.lock(parsed.scope, () => {
      const reviewDirectory = join(this.project(parsed.scope), 'reviews');
      if (existsSync(reviewDirectory) && readdirSync(reviewDirectory).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).length >= 2000) throw new CorpusError('wiki_review_limit', 413);
      const { job, value } = this.candidate(parsed);
      if (parsed.baseSnapshot !== this.current(parsed.scope)) throw new CorpusError('wiki_snapshot_conflict', 409);
      if (parsed.verdict === 'accept' && (!parsed.conditionsChecked || value.status !== 'analyzed')) throw new CorpusError('wiki_semantic_review_required', 409);
      if ((parsed.knowledgeId === null) !== (parsed.expectedRevision === null)) throw new CorpusError('wiki_snapshot_conflict', 409);
      if (parsed.knowledgeId && this.read(parsed.scope, parsed.knowledgeId).knowledge.revision !== parsed.expectedRevision) throw new CorpusError('wiki_snapshot_conflict', 409);
      const content = { ...parsed, knowledgeId: parsed.knowledgeId ?? knowledgeId.parse(randomUUID()), reviewer,
        recordedAt: new Date().toISOString(), coverage: job.payload.coverage };
      const review: WikiReview = { id: hash(JSON.stringify(content)), ...content };
      atomicFile(join(this.project(parsed.scope), 'reviews', `${review.id}.json`), JSON.stringify(review));
      atomicFile(this.headPath(review), JSON.stringify({ id: review.id }));
      return review;
    });
  }
  private loadReview(scope: WikiScope, id: string): WikiReview {
    const file = join(this.project(scope), 'reviews', `${digest.parse(id)}.json`);
    if (!existsSync(file)) throw new CorpusError('wiki_review_not_found', 404);
    const review = JSON.parse(readFileSync(file, 'utf8')) as WikiReview;
    const { id: savedId, ...content } = review;
    if (id !== savedId || hash(JSON.stringify(content)) !== id || review.scope.orgId !== scope.orgId || review.scope.projectId !== scope.projectId) throw new CorpusError('wiki_artifact_changed', 409);
    return review;
  }
  reviews(scope: WikiScope, jobId: string): (WikiReview & { isLatest: boolean })[] {
    this.wiki.read(scope, jobId);
    const directory = join(this.project(scope), 'reviews');
    if (!existsSync(directory)) return [];
    return readdirSync(directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name))
      .map(name => this.loadReview(scope, name.slice(0, -5))).filter(review => review.jobId === jobId)
      .map(review => ({ ...review, isLatest: existsSync(this.headPath(review)) && JSON.parse(readFileSync(this.headPath(review), 'utf8')).id === review.id }))
      .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  }
  async commit(scope: WikiScope, id: string): Promise<WikiKnowledgeView> {
    const review = this.loadReview(scope, id);
    if (review.verdict !== 'accept' || !review.conditionsChecked) throw new CorpusError('wiki_semantic_review_required', 409);
    // Idempotent retries include a crash after current changed but before acknowledgement.
    const current = this.current(scope);
    if (current) {
      const existing = this.snapshot(scope, current).records.find(item => item.id === review.knowledgeId);
      if (existing?.review_id === id) return this.lock(scope, () => {
        const view = this.read(scope, review.knowledgeId);
        atomicFile(join(this.project(scope), 'journals', `${id}.json`), JSON.stringify({ state: 'committed', reviewId: id, baseSnapshot: review.baseSnapshot, snapshot: view.snapshot }));
        return view;
      });
    }
    const { value } = this.candidate(review);
    if (current !== review.baseSnapshot) throw new CorpusError('wiki_snapshot_conflict', 409);
    const previous = current ? this.snapshot(scope, current).files : {};
    const composed = await callWikiCore<{ snapshot: string; files: Record<string, string>; knowledge: WikiKnowledge }>({
      operation: 'compose', previous, candidate: value, review,
    });
    return this.lock(scope, () => {
      if (this.current(scope) !== review.baseSnapshot) throw new CorpusError('wiki_snapshot_conflict', 409);
      this.candidate(review); // Recheck permissions, original hash and selected revision after Python returns.
      if (JSON.parse(readFileSync(this.headPath(review), 'utf8')).id !== id) throw new CorpusError('wiki_review_superseded', 409);
      const target = join(this.project(scope), 'snapshots', digest.parse(composed.snapshot));
      if (!existsSync(target)) {
        const staging = `${target}.pending-${randomUUID()}`;
        try {
          for (const [name, text] of Object.entries(composed.files)) {
            if (!/^(knowledge\/K-[a-f0-9-]{36}\.md|reviews\/[a-f0-9]{64}\.json|relations\.json|index\.md|manifest\.json)$/.test(name)) throw new CorpusError('wiki_snapshot_invalid', 409);
            atomicFile(join(staging, name), text);
          }
          renameSync(staging, target);
        } finally { rmSync(staging, { recursive: true, force: true }); }
      }
      this.snapshot(scope, composed.snapshot); // Read back all files before switching current.
      const journal = join(this.project(scope), 'journals', `${id}.json`);
      atomicFile(journal, JSON.stringify({ state: 'prepared', reviewId: id, baseSnapshot: review.baseSnapshot, snapshot: composed.snapshot }));
      this.replacePointer(join(this.project(scope), 'current.json'), JSON.stringify({ snapshot: composed.snapshot }));
      // The pointer is the commit point. A stale prepared journal is resolved by readback on retry.
      try { atomicFile(journal, JSON.stringify({ state: 'committed', reviewId: id, baseSnapshot: review.baseSnapshot, snapshot: composed.snapshot })); } catch { /* current remains valid */ }
      return this.read(scope, review.knowledgeId);
    });
  }
}
