import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import AdmZip from 'adm-zip';
import type { CorpusSnapshot } from '../../shared/corpus.js';
import type { WikiCandidate, WikiJob, WikiJobSummary, WikiPayload, WikiRequest, WikiResponse, WikiScope } from '../../shared/wiki.js';
import { CorpusError, hash } from '../corpus/extract.js';
import { CorpusStore } from '../corpus/store.js';
import { callWikiCore, UPSTREAM_COMMIT } from './bridge.js';
import { unitText } from '../corpus/source-reader.js';

const identifier = z.string().regex(/^[a-f0-9]{64}$/);
const scopeId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)
  .refine(value => !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(value), 'Reserved Windows directory name');
export const WikiScopeSchema = z.object({ orgId: scopeId, projectId: scopeId }).strict();
export const WikiPrepareSchema = z.object({
  scope: WikiScopeSchema, sourceId: identifier, expectedRevision: identifier,
  unitIds: z.array(z.string().min(1).max(200)).min(1).max(500),
  model: z.string().trim().min(1).max(120), maxChars: z.number().int().min(100).max(24_000).default(24_000),
}).strict();
const strings = z.array(z.string().min(1).max(24_000)).max(100);
export const WikiResponseSchema = z.object({ request_id: identifier, results: z.array(z.object({
  unit_id: z.string().min(1).max(200), status: z.enum(['analyzed', 'ambiguous']),
  needs: z.array(z.object({ title: z.string().min(1).max(1000), statement: z.string().min(1).max(24_000),
    // Keep semantic enumeration in the pinned core; this is the transport boundary.
    kind: z.string().min(1).max(32).optional(),
    details: strings, departments: strings, patterns: strings, evidence: strings.min(1), claim_status: z.literal('source_reported'),
  }).strict()).max(100),
}).strict()).max(500) }).strict();
export const WikiSubmitSchema = z.object({ scope: WikiScopeSchema, response: WikiResponseSchema }).strict();

export class WikiService {
  constructor(readonly root: string, readonly corpus: CorpusStore, readonly allowed: (source: CorpusSnapshot) => boolean) {}

  private source(id: string): CorpusSnapshot {
    const source = this.corpus.snapshot(identifier.parse(id));
    if (!source || !this.allowed(source) || !this.corpus.isEnabled(id)) throw new CorpusError('wiki_source_unavailable', 404);
    if (!this.corpus.verifyOriginal(source)) throw new CorpusError('wiki_original_changed', 409);
    return source;
  }

  private directory(scope: WikiScope, id?: string): string {
    const parsed = WikiScopeSchema.parse(scope);
    const base = join(this.root, 'organizations', parsed.orgId, 'projects', parsed.projectId, 'changes');
    return id ? join(base, identifier.parse(id)) : base;
  }

  private readPayload(scope: WikiScope, id: string): WikiPayload {
    const file = join(this.directory(scope, id), 'preparation.json');
    if (!existsSync(file)) throw new CorpusError('wiki_job_not_found', 404);
    const payload = JSON.parse(readFileSync(file, 'utf8')) as WikiPayload;
    if (hash(JSON.stringify(payload)) !== id || payload.scope.orgId !== scope.orgId || payload.scope.projectId !== scope.projectId) throw new CorpusError('wiki_artifact_changed', 409);
    return payload;
  }

  private writeDirectory(target: string, files: Record<string, string>): void {
    if (existsSync(target)) {
      for (const [name, value] of Object.entries(files)) {
        if (!existsSync(join(target, name)) || readFileSync(join(target, name), 'utf8') !== value) throw new CorpusError('wiki_artifact_changed', 409);
      }
      return;
    }
    const staging = `${target}.pending-${randomUUID()}`;
    mkdirSync(staging, { recursive: true, mode: 0o700 });
    try {
      for (const [name, value] of Object.entries(files)) writeFileSync(join(staging, name), value, { mode: 0o600, flag: 'wx' });
      try { renameSync(staging, target); }
      catch (error) {
        if (!existsSync(target)) throw error;
        this.writeDirectory(target, files); // Identical concurrent retry only.
      }
    } finally { rmSync(staging, { recursive: true, force: true }); }
  }

  async prepare(value: unknown): Promise<WikiJob> {
    const input = WikiPrepareSchema.parse(value);
    const source = this.source(input.sourceId);
    if (source.revision !== input.expectedRevision) throw new CorpusError('wiki_source_changed', 409);
    const selected = new Set(input.unitIds);
    if (selected.size !== input.unitIds.length) throw new CorpusError('wiki_duplicate_units', 400);
    if (!source.units) throw new CorpusError('wiki_source_units_require_reimport', 409);
    const units = source.units.filter(unit => selected.has(unit.id)).map(unit => ({ unit_id: unit.id, locator: unit.locator, text: unitText(unit) }));
    if (units.length !== selected.size) throw new CorpusError('wiki_unknown_units', 400);
    if (units.filter(unit => unit.text.length <= input.maxChars).reduce((sum, unit) => sum + unit.text.length, 0) > 240_000) throw new CorpusError('wiki_batch_too_large', 413);
    const existing = existsSync(this.directory(input.scope)) ? readdirSync(this.directory(input.scope)).filter(name => /^[a-f0-9]{64}$/.test(name)) : [];
    const prepared = await callWikiCore<{ requests: WikiRequest[]; pending_units: { unit_id: string; reason: string }[]; request_bytes: number[]; budget: WikiPayload['budget'] }>({ operation: 'prepare', model: input.model, maxChars: input.maxChars, deferOversized: true,
      source: { source_id: `corpus:${source.sourceId}`, source_revision: source.contentHash,
        org_id: input.scope.orgId, project_id: input.scope.projectId, units,
        structure: { corpus_revision: source.revision, parser_version: source.pipelineVersion, format: source.profile.format,
          source_name: source.name, context_policy: 'Units preserve sections or rows with headings. Search chunks are not knowledge units. Text is extracted representation, not approved knowledge. Unread cross-section dependencies remain unverified.' },
      },
    });
    const afterPrepare = this.source(source.sourceId);
    if (afterPrepare.revision !== source.revision || afterPrepare.contentHash !== source.contentHash) throw new CorpusError('wiki_source_changed', 409);
    const payload: WikiPayload = { schemaVersion: 1, upstreamCommit: UPSTREAM_COMMIT, scope: input.scope,
      source: { sourceId: source.sourceId, revision: source.revision, sha256: source.contentHash, parserVersion: source.pipelineVersion, name: source.name },
      coverage: { totalUnits: source.units.length, selectedUnitIds: units.map(unit => unit.unit_id),
        omittedUnitIds: source.units.filter(unit => !selected.has(unit.id)).map(unit => unit.id),
        pendingUnits: prepared.pending_units,
        pendingRoutes: source.profile.routes.filter(route => route.status !== 'ready').map(route => route.route),
      }, requests: prepared.requests, requestBytes: prepared.request_bytes, budget: prepared.budget,
    };
    const id = hash(JSON.stringify(payload));
    if (existing.length >= 500 && !existing.includes(id)) throw new CorpusError('wiki_job_limit', 413);
    this.writeDirectory(this.directory(input.scope, id), { 'preparation.json': JSON.stringify(payload) });
    return this.read(input.scope, id);
  }

  read(scope: WikiScope, id: string): WikiJob {
    const payload = this.readPayload(scope, id);
    const current = this.source(payload.source.sourceId);
    const base = join(this.directory(scope, id), 'candidates');
    const candidates: WikiCandidate[] = [];
    if (existsSync(base)) for (const name of readdirSync(base).filter(name => /^[a-f0-9]{64}$/.test(name))) {
      const candidate = JSON.parse(readFileSync(join(base, name, 'candidate.json'), 'utf8')) as WikiCandidate;
      const { id: savedId, ...content } = candidate;
      if (savedId !== name || hash(JSON.stringify(content)) !== name || !payload.requests.some(request => request.request_id === candidate.requestId)) throw new CorpusError('wiki_artifact_changed', 409);
      for (const [file, expected] of Object.entries(candidate.artifacts)) {
        if (!/^(?:request|response|validation|C[0-9]{4,})\.json$|^index\.md$/.test(file) || !existsSync(join(base, name, file)) || hash(readFileSync(join(base, name, file))) !== expected) throw new CorpusError('wiki_artifact_changed', 409);
      }
      candidates.push(candidate);
    }
    const completed = new Set(candidates.map(candidate => candidate.requestId));
    return { id, payload, candidates, sourceState: current.revision === payload.source.revision && current.contentHash === payload.source.sha256 ? 'unchanged' : 'changed',
      state: payload.coverage.pendingUnits?.length ? (payload.requests.length ? 'partial' : 'needs_subdivision') : completed.size === payload.requests.length ? 'candidate_saved' : completed.size ? 'partial' : 'awaiting_response',
      semanticReview: 'pending', published: false, driveSync: 'not_configured' };
  }

  list(scope: WikiScope, sourceId: string): WikiJobSummary[] {
    const current = this.source(sourceId);
    const directory = this.directory(scope);
    if (!existsSync(directory)) return [];
    return readdirSync(directory).filter(id => /^[a-f0-9]{64}$/.test(id)).flatMap(id => {
      const payload = this.readPayload(scope, id);
      if (payload.source.sourceId !== sourceId) return [];
      const candidateDirectory = join(directory, id, 'candidates');
      return [{ id, sourceState: current.revision === payload.source.revision && current.contentHash === payload.source.sha256 ? 'unchanged' as const : 'changed' as const,
        candidateCount: existsSync(candidateDirectory) ? readdirSync(candidateDirectory).filter(name => /^[a-f0-9]{64}$/.test(name)).length : 0,
        requestCount: payload.requests.length }];
    });
  }

  async submit(id: string, value: unknown): Promise<WikiJob> {
    const input = WikiSubmitSchema.parse(value);
    if (input.response.results.reduce((sum, result) => sum + result.needs.length, 0) > 500) throw new CorpusError('wiki_response_too_large', 413);
    const job = this.read(input.scope, id);
    if (job.sourceState !== 'unchanged') throw new CorpusError('wiki_source_changed', 409);
    const request = job.payload.requests.find(request => request.request_id === input.response.request_id);
    if (!request) throw new CorpusError('wiki_request_not_found', 400);
    const result = await callWikiCore<{ validation: WikiCandidate['validation'] }>({ operation: 'build', request, response: input.response });
    const afterBuild = this.source(job.payload.source.sourceId);
    if (afterBuild.revision !== job.payload.source.revision || afterBuild.contentHash !== job.payload.source.sha256) throw new CorpusError('wiki_source_changed', 409);
    // Exact quotes and structural validation cannot establish semantic correctness or approval.
    const content = { requestId: request.request_id, response: input.response as WikiResponse,
      validation: { ...result.validation, semantic_review: 'pending' as const, published: false as const } };
    const files: Record<string, string> = { 'request.json': JSON.stringify(request, null, 2),
      'response.json': JSON.stringify(input.response, null, 2), 'validation.json': JSON.stringify(content.validation, null, 2) };
    const links: string[] = [];
    let count = 0;
    for (const result of input.response.results) for (const need of result.needs) {
      const candidateId = `C${String(++count).padStart(4, '0')}`;
      const unit = request.units.find(unit => unit.unit_id === result.unit_id)!;
      files[`${candidateId}.json`] = JSON.stringify({ ...need, candidate_id: candidateId, lifecycle: 'candidate', status: result.status,
        unit_id: unit.unit_id, request_id: request.request_id, owner_scope: input.scope,
        provenance: { source_id: request.source_id, source_revision: request.source_revision, locator: unit.locator, evidence_kind: 'EXTRACTED',
          corpus_source_id: job.payload.source.sourceId, corpus_revision: job.payload.source.revision },
      }, null, 2);
      links.push(`- [${candidateId}](./${candidateId}.json)`);
    }
    files['index.md'] = '# LLM Wiki 후보\n\n의미 검토 대기 · 정본 미반영 · Drive 미동기화\n\n'+links.join('\n')+'\n';
    const sealed = { ...content, artifacts: Object.fromEntries(Object.entries(files).map(([name, value]) => [name, hash(value)])) };
    const candidate: WikiCandidate = { id: hash(JSON.stringify(sealed)), ...sealed };
    if (job.candidates.length >= 100 && !job.candidates.some(item => item.id === candidate.id)) throw new CorpusError('wiki_candidate_limit', 413);
    files['candidate.json'] = JSON.stringify(candidate);
    this.writeDirectory(join(this.directory(input.scope, id), 'candidates', candidate.id), files);
    return this.read(input.scope, id);
  }

  backup(scope: WikiScope, id: string): Buffer {
    const job = this.read(scope, id);
    const base = this.directory(scope, id);
    const prefix = `wiki/organizations/${scope.orgId}/projects/${scope.projectId}/changes/${id}`;
    const zip = new AdmZip();
    let size = 0;
    const addFile = (name: string, bytes: Buffer) => {
      size += bytes.length;
      if (size > 32 * 1024 * 1024) throw new CorpusError('wiki_backup_too_large', 413);
      zip.addFile(name, bytes);
    };
    addFile(`${prefix}/preparation.json`, readFileSync(join(base, 'preparation.json')));
    for (const candidate of job.candidates) {
      const directory = join(base, 'candidates', candidate.id);
      for (const file of readdirSync(directory).filter(file => /^(?:candidate|request|response|validation|C[0-9]{4,})\.json$|^index\.md$/.test(file))) {
        addFile(`${prefix}/candidates/${candidate.id}/${file}`, readFileSync(join(directory, file)));
      }
    }
    zip.addFile(`${prefix}/README.txt`, Buffer.from('후보와 요청의 백업입니다. 원본은 별도 corpus 자료 백업에 있습니다. 정본 반영과 Drive 동기화는 수행하지 않았습니다.\n'));
    return zip.toBuffer();
  }
}
