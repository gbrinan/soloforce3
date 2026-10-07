import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { WikiScopeSchema } from './service.js';
import { WikiKnowledgeStore } from './knowledge.js';
import { CorpusError, hash } from '../corpus/extract.js';
import type { WikiKnowledgeView, WikiScope } from '../../shared/wiki.js';
import { workerCanRead, type WikiWorkerAccess } from './worker-access.js';

export const WikiRefSchema = z.object({ scope: WikiScopeSchema, id: z.string().regex(/^K-[a-f0-9-]{36}$/), revision: z.number().int().positive() }).strict();
export type WikiRef = z.infer<typeof WikiRefSchema>;
export const WikiRefsSchema = z.array(WikiRefSchema).min(1).max(30).refine(refs => refs.every(r => r.scope.orgId === refs[0].scope.orgId && r.scope.projectId === refs[0].scope.projectId), 'One scope per handoff or output');
export function wikiCitation(ref: WikiRef): string { return `[[wiki:${ref.scope.orgId}/${ref.scope.projectId}/${ref.id}@${ref.revision}]]`; }

export class WikiWorkerService {
  constructor(readonly knowledge: WikiKnowledgeStore) {}
  private check(access: WikiWorkerAccess, scope: WikiScope): void {
    if (!workerCanRead(access, this.knowledge.project(scope))) throw new CorpusError('wiki_worker_scope_denied', 403);
  }
  private checkView(access: WikiWorkerAccess, scope: WikiScope, view: WikiKnowledgeView): void {
    const file = join(this.knowledge.project(scope), 'snapshots', view.snapshot, 'knowledge', `${view.knowledge.id}.md`);
    const source = join(this.knowledge.wiki.corpus.root, view.knowledge.provenance.corpus_source_id,
      view.knowledge.provenance.corpus_revision, 'snapshot.json');
    if (![file, source].every(path => workerCanRead(access, path))) throw new CorpusError('wiki_worker_source_denied', 403);
  }
  search(access: WikiWorkerAccess, input: unknown) {
    const { scope, query, limit } = z.object({ scope: WikiScopeSchema, query: z.string().trim().max(500), limit: z.number().int().min(1).max(30).default(10) }).strict().parse(input);
    this.check(access, scope);
    const listing = this.knowledge.list(scope);
    // Fail closed if any scope constraint might be hidden by per-file access rules.
    for (const view of listing.items) this.checkView(access, scope, view);
    const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const mandatory = listing.items.filter(v => ['constraint', 'unknown', 'question'].includes(v.knowledge.kind));
    const matches = listing.items.map(view => {
      const k = view.knowledge;
      const haystack = [k.title, k.statement, ...k.details, ...k.departments, ...k.domains].join(' ').toLocaleLowerCase();
      return { view, score: terms.filter(t => haystack.includes(t)).length };
    }).filter(v => !terms.length || v.score > 0).sort((a,b) => b.score - a.score || a.view.knowledge.id.localeCompare(b.view.knowledge.id));
    const summarize = (view: typeof listing.items[number]) => ({ id: view.knowledge.id, revision: view.knowledge.revision,
      title: view.knowledge.title, kind: view.knowledge.kind, sourceState: view.sourceState,
      citation: wikiCitation({ scope, id: view.knowledge.id, revision: view.knowledge.revision }) });
    return { snapshot: listing.snapshot, items: matches.slice(0, limit).map(v => summarize(v.view)), totalMatches: matches.length,
      mandatory: mandatory.map(summarize), mandatoryPolicy: 'all_scope_constraints_and_unknowns', applicability: 'not_evaluated', ranking: 'lexical_overlap' };
  }
  read(access: WikiWorkerAccess, input: unknown) {
    const ref = WikiRefSchema.parse(input);
    this.check(access, ref.scope);
    const view = this.knowledge.read(ref.scope, ref.id);
    this.checkView(access, ref.scope, view);
    if (view.knowledge.revision !== ref.revision) throw new CorpusError('wiki_revision_changed', 409);
    return { ...view, citation: wikiCitation(ref), businessApproval: 'not_inferred' };
  }
  bundle(access: WikiWorkerAccess, input: unknown) {
    const refs = WikiRefsSchema.parse(input);
    return refs.map(ref => {
      const view = this.read(access, ref);
      if (view.sourceState !== 'unchanged') throw new CorpusError('wiki_source_changed', 409);
      return view;
    });
  }
  recordUsage(access: WikiWorkerAccess, input: unknown) {
    const { refs, outputPath } = z.object({ refs: WikiRefsSchema, outputPath: z.string().min(1).max(2000) }).strict().parse(input);
    const views = this.bundle(access, refs);
    const outputs = realpathSync(join(access.home, 'history/outputs', access.agent));
    const output = realpathSync(resolve(access.home, outputPath));
    const rel = relative(outputs, output);
    if (!rel || rel.startsWith('..') || resolve(outputs, rel) !== output || !workerCanRead(access, output)) throw new CorpusError('wiki_output_denied', 403);
    if (!/\.(md|txt)$/i.test(output) || statSync(output).size > 2 * 1024 * 1024) throw new CorpusError('wiki_output_format_or_size', 400);
    const bytes = readFileSync(output);
    const text = bytes.toString('utf8');
    if (views.some(v => !text.includes(v.citation))) throw new CorpusError('wiki_citation_missing', 422);
    const data = { agent: access.agent, jobId: access.jobId, refs, snapshots: views.map(v => v.snapshot), outputPath: output,
      locations: views.map(v => ({ citation: v.citation, lines: text.split('\n').flatMap((line, index) => line.includes(v.citation) ? [index + 1] : []) })),
      outputSha256: hash(bytes), verification: 'citation_present', semanticApplication: 'not_evaluated' };
    const id = hash(JSON.stringify(data));
    const directory = join(this.knowledge.wiki.root, 'usage');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = join(directory, `${id}.json`);
    if (!existsSync(file) && readdirSync(directory).length >= 10000) throw new CorpusError('wiki_usage_limit', 413);
    const receipt = { id, ...data, recordedAt: new Date().toISOString() };
    try { writeFileSync(file, JSON.stringify(receipt), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    return JSON.parse(readFileSync(file, 'utf8'));
  }
  usage(scope: WikiScope, id: string) {
    const view = this.knowledge.read(scope, id);
    const directory = join(this.knowledge.wiki.root, 'usage');
    if (!existsSync(directory)) return { items: [] };
    const items = readdirSync(directory).filter(n => /^[a-f0-9]{64}\.json$/.test(n)).flatMap(name => {
      const receipt = JSON.parse(readFileSync(join(directory, name), 'utf8'));
      const { id: receiptId, recordedAt, ...data } = receipt;
      if (hash(JSON.stringify(data)) !== receiptId || name !== `${receiptId}.json`) throw new CorpusError('wiki_usage_changed', 409);
      const ref = (receipt.refs as WikiRef[]).find(r => r.scope.orgId === scope.orgId && r.scope.projectId === scope.projectId && r.id === id);
      if (!ref) return [];
      let outputState = 'unavailable';
      try { outputState = hash(readFileSync(receipt.outputPath)) === receipt.outputSha256 ? 'unchanged' : 'changed'; } catch {}
      return [{ ...receipt, knowledgeState: ref.revision === view.knowledge.revision ? 'same_revision' : 'revised', sourceState: view.sourceState, outputState }];
    });
    return { items };
  }
}
