import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, existsSync, rmSync, copyFileSync, linkSync, constants, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import AdmZip from 'adm-zip';
import type { CorpusSnapshot, CorpusSource } from '../../shared/corpus.js';
import { CorpusError, hash } from './extract.js';
import { fileHashSync } from './files.js';

interface SourceState { revision: string; enabled: boolean }
const identifier = /^[a-f0-9]{64}$/;

/** 한 설치의 소유자용 소규모 자료 저장소. 원본/파생 스냅샷은 불변, current만 원자 교체한다. */
export class CorpusStore {
  constructor(readonly root: string) {}
  private directory(id: string): string {
    if (!identifier.test(id)) throw new CorpusError('invalid_source_id', 400);
    return join(this.root, id);
  }
  private state(id: string): SourceState | null {
    const file = join(this.directory(id), 'current.json');
    if (!existsSync(file)) return null;
    const value = JSON.parse(readFileSync(file, 'utf8')) as SourceState;
    if (!identifier.test(value.revision) || typeof value.enabled !== 'boolean') throw new CorpusError('corrupt_source_state', 409);
    return value;
  }
  snapshot(id: string, revision?: string): CorpusSnapshot | null {
    const state = this.state(id);
    if (!state) return null;
    const rev = revision ?? state.revision;
    if (!identifier.test(rev)) throw new CorpusError('invalid_revision', 400);
    const path = join(this.directory(id), rev, 'snapshot.json');
    if (!existsSync(path)) return null;
    const snapshot = JSON.parse(readFileSync(path, 'utf8')) as CorpusSnapshot;
    if (snapshot.schemaVersion !== 1 || snapshot.sourceId !== id || snapshot.revision !== rev) throw new CorpusError('corrupt_snapshot', 409);
    return snapshot;
  }
  list(): CorpusSource[] {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root).filter(id => identifier.test(id)).flatMap(id => {
      const snapshot = this.snapshot(id); const state = this.state(id);
      if (!snapshot || !state) return [];
      const { chunks, units, ...metadata } = snapshot;
      return [{ ...metadata, enabled: state.enabled, chunkCount: chunks.length, unitCount: units?.length, revisions: this.revisions(id).length }];
    }).sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  }
  revisions(id: string): string[] {
    const directory = this.directory(id);
    return existsSync(directory) ? readdirSync(directory).filter(name => identifier.test(name)) : [];
  }
  commit(snapshot: CorpusSnapshot, bytes: Buffer): CorpusSource {
    if (hash(bytes) !== snapshot.contentHash) throw new CorpusError('backup_hash_mismatch', 409);
    return this.persist(snapshot, destination => writeFileSync(destination, bytes, { mode: 0o600, flag: 'wx' }));
  }
  commitFile(snapshot: CorpusSnapshot, original: string): CorpusSource {
    if (fileHashSync(original) !== snapshot.contentHash) throw new CorpusError('backup_hash_mismatch', 409);
    return this.persist(snapshot, destination => {
      try { linkSync(original, destination); }
      catch (e) {
        if (!['EXDEV', 'EPERM', 'ENOTSUP', 'EACCES'].includes((e as NodeJS.ErrnoException).code ?? '')) throw e;
        copyFileSync(original, destination, constants.COPYFILE_EXCL);
      }
    });
  }
  verifyOriginal(snapshot: CorpusSnapshot): boolean {
    return fileHashSync(join(this.directory(snapshot.sourceId), snapshot.revision, 'original.bin')) === snapshot.contentHash;
  }
  private persist(snapshot: CorpusSnapshot, writeOriginal: (destination: string) => void): CorpusSource {
    if (!this.state(snapshot.sourceId) && this.list().length >= 500) throw new CorpusError('source_limit_500', 413);
    const directory = this.directory(snapshot.sourceId);
    if (!identifier.test(snapshot.revision)) throw new CorpusError('invalid_revision', 400);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const target = join(directory, snapshot.revision);
    if (!existsSync(target)) {
      const staging = join(directory, `.staging-${randomUUID()}`);
      mkdirSync(staging, { mode: 0o700 });
      try {
        writeOriginal(join(staging, 'original.bin'));
        writeFileSync(join(staging, 'snapshot.json'), JSON.stringify(snapshot, null, 2), { mode: 0o600, flag: 'wx' });
        renameSync(staging, target);
      } finally { rmSync(staging, { force: true, recursive: true }); }
    }
    if (!this.verifyOriginal(snapshot)) throw new CorpusError('backup_hash_mismatch', 409);
    // 비활성 자료를 재수집해도 사용자의 검색 제외 설정을 유지한다.
    this.writeState(snapshot.sourceId, { revision: snapshot.revision, enabled: this.state(snapshot.sourceId)?.enabled ?? true });
    return this.list().find(source => source.sourceId === snapshot.sourceId)!;
  }
  setEnabled(id: string, enabled: boolean): void {
    const state = this.state(id);
    if (!state) throw new CorpusError('source_not_found', 404);
    this.writeState(id, { ...state, enabled });
  }
  isEnabled(id: string): boolean { return this.state(id)?.enabled === true; }
  private writeState(id: string, state: SourceState): void {
    const path = join(this.directory(id), 'current.json'); const temporary = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 }); renameSync(temporary, path);
  }
  backup(id: string): Buffer {
    if (!this.state(id)) throw new CorpusError('source_not_found', 404);
    const zip = new AdmZip(); let size = 0;
    // 기존 설정 > 데이터 > 복원에서 그대로 복구할 수 있는 history 상대 경로.
    const prefix = `corpus/${id}`;
    zip.addFile(`${prefix}/current.json`, readFileSync(join(this.directory(id), 'current.json')));
    for (const revision of this.revisions(id)) {
      const snapshot = this.snapshot(id, revision)!;
      const original = join(this.directory(id), revision, 'original.bin');
      size += statSync(original).size;
      if (size > 100 * 1024 * 1024) throw new CorpusError('backup_too_large_use_history_backup', 413);
      const bytes = readFileSync(original);
      if (hash(bytes) !== snapshot.contentHash) throw new CorpusError('backup_hash_mismatch', 409);
      zip.addFile(`${prefix}/${revision}/original.bin`, bytes);
      zip.addFile(`${prefix}/${revision}/snapshot.json`, Buffer.from(JSON.stringify(snapshot, null, 2)));
    }
    return zip.toBuffer();
  }
  readVectors(id: string, revision: string, model: string): number[][] | null {
    if (!identifier.test(revision)) return null;
    const path = join(this.directory(id), revision, `vectors-${hash(model)}.json`);
    if (!existsSync(path)) return null;
    try { return JSON.parse(readFileSync(path, 'utf8')) as number[][]; } catch { return null; }
  }
  writeVectors(id: string, revision: string, model: string, vectors: number[][]): void {
    if (!this.snapshot(id, revision)) throw new CorpusError('source_not_found', 404);
    const path = join(this.directory(id), revision, `vectors-${hash(model)}.json`);
    const temporary = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(vectors), { mode: 0o600 }); renameSync(temporary, path);
  }
  readVectorProgress(id: string, revision: string, model: string): number[][] {
    if (!this.snapshot(id, revision)) throw new CorpusError('source_not_found', 404);
    const path = join(this.directory(id), revision, `vector-progress-${hash(model)}.json`);
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as number[][] : [];
  }
  writeVectorProgress(id: string, revision: string, model: string, vectors: number[][]): void {
    if (!this.snapshot(id, revision)) throw new CorpusError('source_not_found', 404);
    const path = join(this.directory(id), revision, `vector-progress-${hash(model)}.json`);
    const temporary = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(vectors), { mode: 0o600 }); renameSync(temporary, path);
  }
  clearVectorProgress(id: string, revision: string, model: string): void {
    if (!this.snapshot(id, revision)) throw new CorpusError('source_not_found', 404);
    rmSync(join(this.directory(id), revision, `vector-progress-${hash(model)}.json`), { force: true });
  }
}
