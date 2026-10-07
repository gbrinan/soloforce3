import { join } from 'node:path';
import { HISTORY_DIR } from '../../config.js';
import type { CorpusSnapshot } from '../../shared/corpus.js';
import { CorpusStore } from './store.js';
import { CorpusService } from './service.js';
import { localEmbedder } from './search.js';

let instance: CorpusService | undefined;
let driveActive: (connectionId: string) => boolean = () => false;
export function registerCorpusDriveAccess(check: (connectionId: string) => boolean): void { driveActive = check; }
export function corpusSourceAllowed(source: CorpusSnapshot): boolean {
  return source.provider !== 'google-drive' || Boolean(source.connectionId && driveActive(source.connectionId));
}
export function getCorpusService(): CorpusService {
  return instance ??= new CorpusService(new CorpusStore(join(HISTORY_DIR, 'corpus')), localEmbedder(process.env));
}
