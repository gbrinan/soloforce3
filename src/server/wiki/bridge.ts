import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_SELF_DIR } from '../../config.js';
import { CorpusError, hash } from '../corpus/extract.js';

export const UPSTREAM_COMMIT = '2c4a74b6c9a40cb747c8e24b2a535b4457cdf3f2';
export function verifyWikiBundle(): void {
  const root = join(PROJECT_SELF_DIR, 'vendor', 'ingestiger');
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  if (manifest.commit !== UPSTREAM_COMMIT || !Array.isArray(manifest.files)) throw new CorpusError('wiki_bundle_invalid', 503);
  for (const file of manifest.files) {
    if (!/^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(file.path) || file.path.split('/').includes('..')) throw new CorpusError('wiki_bundle_invalid', 503);
    if (hash(readFileSync(join(root, UPSTREAM_COMMIT, file.path))) !== file.sha256) throw new CorpusError('wiki_bundle_invalid', 503);
  }
  for (const name of ['pipeline.py', 'knowledge.py']) {
    if (!manifest.files.some((file: { path: string }) => file.path === `skills/ingestiger/scripts/${name}`)) throw new CorpusError('wiki_bundle_invalid', 503);
  }
}

/** No shell, model API, or caller-provided executable/path. Python stdout is UTF-8 on Windows too. */
export async function callWikiCore<T>(input: unknown): Promise<T> {
  verifyWikiBundle();
  const executable = process.env.INGESTIGER_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  return new Promise<T>((resolve, reject) => {
    const child = spawn(executable, ['-I', '-X', 'utf8', join(PROJECT_SELF_DIR, 'scripts', 'ingestiger-bridge.py')], {
      shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = ''; let limitExceeded = false; let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 30_000);
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (Buffer.byteLength(output) > 8 * 1024 * 1024) { limitExceeded = true; child.kill(); }
    });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.once('error', () => { clearTimeout(timer); reject(new CorpusError('wiki_python_unavailable', 503)); });
    child.once('close', code => {
      clearTimeout(timer);
      if (timedOut || limitExceeded) return reject(new CorpusError('wiki_core_limit', 503));
      try {
        const response = JSON.parse(output);
        if (code !== 0 || !response.ok) return reject(new CorpusError('wiki_response_or_units_invalid', 422));
        resolve(response.result as T);
      } catch { reject(new CorpusError('wiki_core_failed', 503)); }
    });
    child.stdin.end(JSON.stringify(input));
  });
}
