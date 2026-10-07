import { existsSync, mkdirSync, readFileSync, readdirSync, openSync, closeSync, writeSync, fsyncSync, truncateSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { CorpusIntake } from '../../shared/corpus-intake.js';
import { INTAKE_LIMITS } from '../../shared/corpus-intake.js';
import type { CorpusProfile, CorpusSnapshot, SourceUnit } from '../../shared/corpus.js';
import { CorpusError, chunkText, hash, PIPELINE_VERSION } from './extract.js';
import type { CorpusStore } from './store.js';
import { atomicJson, fileHash } from './files.js';

const identifier = /^[a-f0-9]{32}$/;
export const IntakeInputSchema = z.object({ name: z.string().min(1).max(250), mime: z.string().max(200).default('application/octet-stream'),
  bytes: z.number().int().min(1).max(INTAKE_LIMITS.originalBytes), labels: z.array(z.string().trim().min(1).max(80)).max(20).default([]) }).strict();
type Origin = Pick<CorpusIntake, 'provider' | 'externalId' | 'connectionId' | 'providerRevision' | 'sourceUrl' | 'backup'>;

export class CorpusIntakeService {
  readonly root: string;
  private uploading = new Set<string>();
  private active: string | null = null;
  private tasks = new Map<string, Promise<void>>();
  private children = new Map<string, ChildProcess>();
  constructor(readonly store: CorpusStore, readonly allowed: (job: CorpusIntake) => boolean = () => true) { this.root = join(dirname(store.root), 'corpus-intake'); }
  directory(id: string): string { if (!identifier.test(id)) throw new CorpusError('invalid_intake_id', 400); return join(this.root, id); }
  private save(job: CorpusIntake): void { atomicJson(join(this.directory(job.id), 'intake.json'), job); }
  read(id: string): CorpusIntake {
    const path = join(this.directory(id), 'intake.json');
    if (!existsSync(path)) throw new CorpusError('intake_not_found', 404);
    const job = JSON.parse(readFileSync(path, 'utf8')) as CorpusIntake;
    if (job.id !== id || job.schemaVersion !== 1) throw new CorpusError('intake_metadata_invalid', 409);
    if (!this.allowed(job)) throw new CorpusError('connection_inactive', 403);
    const checkpoint = join(this.directory(id), 'checkpoint.json');
    if (existsSync(checkpoint)) job.cursor = JSON.parse(readFileSync(checkpoint, 'utf8')).cursor;
    if (job.state === 'running' && this.active !== id) return { ...job, state: 'paused', reason: 'intake_restart_resume' };
    return job;
  }
  list(): CorpusIntake[] {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root).filter(id => identifier.test(id)).flatMap(id => {
      try { return [this.read(id)]; } catch (e) { if (e instanceof CorpusError && e.status === 403) return []; throw e; }
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  create(value: unknown, origin?: Origin): CorpusIntake {
    const input = IntakeInputSchema.parse(value);
    // Count all reservations, including revoked connections, without returning their metadata.
    const jobs = existsSync(this.root) ? readdirSync(this.root).filter(id => identifier.test(id)).map(id => JSON.parse(readFileSync(join(this.root, id, 'intake.json'), 'utf8')) as CorpusIntake) : [];
    if (jobs.length >= INTAKE_LIMITS.jobs || jobs.reduce((sum, job) => sum + job.bytes, 0) + input.bytes > INTAKE_LIMITS.reservedBytes) throw new CorpusError('intake_storage_budget', 413);
    const job: CorpusIntake = { ...input, labels: [...new Set(input.labels)].sort(), ...(origin ?? { provider: 'local', externalId: input.name }),
      schemaVersion: 1, id: randomUUID().replace(/-/g, ''), createdAt: new Date().toISOString(), uploadedBytes: 0, parts: [], state: 'uploading', parserVersion: PIPELINE_VERSION, cursor: 0, baseRevision: null };
    job.baseRevision = this.store.snapshot(hash(`${job.provider}\0${job.connectionId ?? ''}\0${job.externalId}`))?.revision ?? null;
    if (!this.allowed(job)) throw new CorpusError('connection_inactive', 403);
    mkdirSync(this.directory(job.id), { recursive: true, mode: 0o700 });
    closeSync(openSync(join(this.directory(job.id), 'original.bin'), 'wx', 0o600)); this.save(job); return job;
  }
  async append(id: string, offset: number, bytes: Buffer, expectedHash: string): Promise<CorpusIntake> {
    if (this.uploading.has(id)) throw new CorpusError('intake_busy', 409);
    this.uploading.add(id);
    try {
      const job = this.read(id);
      if (job.state !== 'uploading') throw new CorpusError('intake_upload_closed', 409);
      if (!bytes.length || bytes.length > INTAKE_LIMITS.partBytes || hash(bytes) !== expectedHash) throw new CorpusError('intake_part_invalid', 400);
      if (!Number.isSafeInteger(offset) || offset < 0) throw new CorpusError('intake_offset_invalid', 400);
      if (offset < job.uploadedBytes) {
        if (!job.parts.some(part => part.offset === offset && part.bytes === bytes.length && part.sha256 === expectedHash)) throw new CorpusError('intake_part_conflict', 409);
        return job;
      }
      if (offset !== job.uploadedBytes || offset + bytes.length > job.bytes) throw new CorpusError('intake_offset_conflict', 409);
      const path = join(this.directory(id), 'original.bin');
      if (statSync(path).size < offset) throw new CorpusError('intake_original_changed', 409);
      truncateSync(path, offset); // Discard only an unacknowledged tail left by an interrupted append.
      const fd = openSync(path, 'r+');
      try { let written = 0; while (written < bytes.length) written += writeSync(fd, bytes, written, bytes.length - written, offset + written); fsyncSync(fd); }
      finally { closeSync(fd); }
      if (!this.allowed(job)) throw new CorpusError('connection_inactive', 403);
      job.parts.push({ offset, bytes: bytes.length, sha256: expectedHash }); job.uploadedBytes += bytes.length; this.save(job); return job;
    } finally { this.uploading.delete(id); }
  }
  async finish(id: string): Promise<CorpusIntake> {
    if (this.uploading.has(id)) throw new CorpusError('intake_busy', 409);
    this.uploading.add(id);
    try {
      const job = this.read(id);
      if (job.state !== 'uploading') return job;
      if (job.uploadedBytes !== job.bytes) throw new CorpusError('intake_upload_incomplete', 409);
      const path = join(this.directory(id), 'original.bin');
      if (statSync(path).size !== job.bytes) throw new CorpusError('intake_original_changed', 409);
      const fd = openSync(path, 'r');
      try {
        const { readSync } = await import('node:fs'); let end = 0;
        for (const part of job.parts) {
          if (part.offset !== end) throw new CorpusError('intake_checkpoint_invalid', 409);
          const bytes = Buffer.alloc(part.bytes); let read = 0;
          while (read < bytes.length) { const count = readSync(fd, bytes, read, bytes.length - read, part.offset + read); if (!count) throw new CorpusError('intake_original_changed', 409); read += count; }
          if (hash(bytes) !== part.sha256) throw new CorpusError('intake_original_changed', 409);
          end += part.bytes;
        }
        if (end !== job.bytes) throw new CorpusError('intake_upload_incomplete', 409);
      } finally { closeSync(fd); }
      job.contentHash = await fileHash(path);
      if (!this.allowed(job)) throw new CorpusError('connection_inactive', 403);
      job.state = 'queued'; this.save(job); return job;
    } finally { this.uploading.delete(id); }
  }
  private acquire(id: string): string {
    const path = join(this.root, 'worker.lock');
    if (existsSync(path)) {
      const lock = JSON.parse(readFileSync(path, 'utf8')) as { parent: number; child?: number };
      const alive = (pid?: number) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code !== 'ESRCH'; } };
      if (alive(lock.parent) || alive(lock.child)) throw new CorpusError('intake_worker_busy', 409);
      unlinkSync(path);
    }
    const fd = openSync(path, 'wx', 0o600); writeSync(fd, JSON.stringify({ parent: process.pid, id })); closeSync(fd); return path;
  }
  start(id: string, unitLimit: number = INTAKE_LIMITS.unitsPerRun, continueBatches = false): CorpusIntake {
    let job = this.read(id);
    if (this.active) throw new CorpusError('intake_worker_busy', 409);
    if (!['queued', 'paused', 'needs_review'].includes(job.state)) throw new CorpusError('intake_not_ready', 409);
    if (job.parserVersion !== PIPELINE_VERSION) throw new CorpusError('parser_version_changed', 409);
    if (!Number.isInteger(unitLimit) || unitLimit < 1 || unitLimit > 1000) throw new CorpusError('intake_batch_invalid', 400);
    const lock = this.acquire(id);
    this.active = id; job.state = 'running'; delete job.reason; delete job.pauseRequested; this.save(job);
    const execute = async () => {
      do {
        job.state = 'running'; this.save(job);
        await this.process(job, unitLimit, lock); job = this.read(id);
      } while (continueBatches && job.state === 'paused' && job.reason === 'intake_batch_checkpoint' && !job.pauseRequested);
    };
    const task = execute().finally(() => { this.active = null; this.tasks.delete(id); this.children.delete(id); if (existsSync(lock)) unlinkSync(lock); });
    void task.catch(() => {}); // API callers observe the persisted failure; no unhandled background rejection.
    this.tasks.set(id, task); return job;
  }
  pause(id: string): CorpusIntake {
    const job = this.read(id);
    if (this.active !== id) return job;
    job.pauseRequested = true; this.save(job); this.children.get(id)?.kill(); return job;
  }
  async wait(id: string): Promise<CorpusIntake> { await this.tasks.get(id); return this.read(id); }
  private async process(job: CorpusIntake, unitLimit: number, lock: string): Promise<void> {
    try {
      const directory = this.directory(job.id);
      const original = join(directory, 'original.bin');
      if (await fileHash(original) !== job.contentHash) throw new CorpusError('intake_original_changed', 409);
      if (this.read(job.id).pauseRequested) throw new CorpusError('intake_user_paused', 409);
      const worker = fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? './intake-worker.ts' : './intake-worker.js', import.meta.url));
      const args = ['--max-old-space-size=512', ...(worker.endsWith('.ts') ? ['--import', import.meta.resolve('tsx')] : []), worker, directory, String(unitLimit)];
      await new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
        this.children.set(job.id, child);
        atomicJson(lock, { parent: process.pid, child: child.pid, id: job.id });
        let output = ''; let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; child.kill(); }, INTAKE_LIMITS.workerTimeoutMs);
        child.stdout.on('data', data => { output += data.toString(); if (output.length > 8192) child.kill(); });
        child.once('error', () => { clearTimeout(timer); reject(new CorpusError('intake_worker_unavailable', 503)); });
        child.once('close', code => {
          this.children.delete(job.id);
          clearTimeout(timer);
          if (timedOut) return reject(new CorpusError('intake_worker_timeout', 503));
          try { const result = JSON.parse(output.trim()); if (code !== 0 || !result.ok) return reject(new CorpusError(result.error || 'intake_worker_failed')); resolve(); }
          catch { reject(new CorpusError('intake_worker_failed')); }
        });
      });
      const result = JSON.parse(readFileSync(join(directory, 'result.json'), 'utf8')) as { profile: CorpusProfile; cursor: number; complete: boolean };
      job.cursor = result.cursor;
      if (!this.allowed(job)) throw new CorpusError('connection_inactive', 403);
      if (this.read(job.id).pauseRequested) throw new CorpusError('intake_user_paused', 409);
      if (!result.complete) { job.state = 'paused'; job.reason = 'intake_batch_checkpoint'; this.save(job); return; }
      const units: SourceUnit[] = [];
      for (let i = 1; i <= result.cursor; i++) {
        const saved = JSON.parse(readFileSync(join(directory, 'units', `${String(i).padStart(6, '0')}.json`), 'utf8')) as { unit: SourceUnit; sha256: string };
        if (hash(JSON.stringify(saved.unit)) !== saved.sha256) throw new CorpusError('intake_unit_changed', 409);
        units.push(saved.unit);
      }
      if (new Set(units.map(unit => unit.id)).size !== units.length) throw new CorpusError('intake_duplicate_units', 409);
      const chunks = units.flatMap(unit => chunkText(unit.text, unit.locator, unit.kind).map(chunk => ({ ...chunk, unitId: unit.id })));
      if (chunks.length > INTAKE_LIMITS.chunks) throw new CorpusError('intake_extraction_budget', 413);
      const sourceId = hash(`${job.provider}\0${job.connectionId ?? ''}\0${job.externalId}`);
      const revision = hash(JSON.stringify({ contentHash: job.contentHash, version: PIPELINE_VERSION, labels: job.labels, providerRevision: job.providerRevision, name: job.name, mime: job.mime }));
      const currentRevision = this.store.snapshot(sourceId)?.revision ?? null;
      if (currentRevision !== job.baseRevision && currentRevision !== revision) throw new CorpusError('intake_base_changed', 409);
      const snapshot: CorpusSnapshot = { schemaVersion: 1, pipelineVersion: PIPELINE_VERSION, sourceId, revision, contentHash: job.contentHash!,
        provider: job.provider, externalId: job.externalId, name: job.name, importedAt: new Date().toISOString(),
        labels: job.labels, bytes: job.bytes, profile: result.profile, units, chunks, backup: job.backup ?? 'original',
        connectionId: job.connectionId, providerRevision: job.providerRevision, sourceUrl: job.sourceUrl };
      if (!this.allowed(job)) throw new CorpusError('connection_inactive', 403);
      const source = this.store.commitFile(snapshot, original);
      job.source = { sourceId: source.sourceId, revision: source.revision }; job.state = 'complete'; delete job.reason; this.save(job);
    } catch (error) {
      const paused = JSON.parse(readFileSync(join(this.directory(job.id), 'intake.json'), 'utf8')).pauseRequested === true;
      job.state = paused ? 'paused' : 'needs_review'; job.reason = paused ? 'intake_user_paused' : error instanceof CorpusError ? error.code : 'intake_processing_failed';
      if (paused) job.pauseRequested = true;
      this.save(job);
    }
  }
}
