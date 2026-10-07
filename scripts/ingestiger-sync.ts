/** Pin a clean local upstream commit; generate the host role without editing upstream files. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { relocateRoleLinks } from '../src/role-directive.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function writeGenerated(path: string, text: string): void {
  if (!existsSync(path) || readFileSync(path, 'utf8') !== text) writeFileSync(path, text);
}
const source = process.argv[2];
if (!source) throw new Error('Usage: npm run sync:ingestiger -- <clean upstream checkout>');
const git = (...args: string[]) => execFileSync('git', ['-C', resolve(source), ...args], { encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) throw new Error('Upstream must be clean before pinning');
const commit = git('rev-parse', 'HEAD');
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid commit');
const names = git('ls-tree', '-r', '--name-only', commit, '--', '.claude-plugin/plugin.json', 'agent', 'skills').split('\n');
const bundle = join(root, 'vendor', 'ingestiger', commit);
const files = names.map(path => {
  if (!/^(?:[\w.-]+\/)*[\w.-]+$/.test(path) || path.split('/').includes('..')) throw new Error('Invalid bundle path');
  const bytes = execFileSync('git', ['-C', resolve(source), 'show', `${commit}:${path}`]);
  const destination = join(bundle, path);
  if (existsSync(destination) && !readFileSync(destination).equals(bytes)) throw new Error('Immutable bundle differs');
  mkdirSync(dirname(destination), { recursive: true });
  if (!existsSync(destination)) writeFileSync(destination, bytes, { flag: 'wx' });
  return { path, sha256: createHash('sha256').update(bytes).digest('hex') };
});
const plugin = JSON.parse(readFileSync(join(bundle, '.claude-plugin/plugin.json'), 'utf8'));
const meta = JSON.parse(readFileSync(join(bundle, 'agent/meta.json'), 'utf8'));
if (plugin.version !== meta.version || meta.id !== 'ingestiger') throw new Error('Metadata differs');
const manifest = { repository: plugin.repository, commit, version: plugin.version, files };
writeGenerated(join(root, 'vendor/ingestiger/manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const seed = join(root, 'config/agents/ingestiger');
mkdirSync(seed, { recursive: true });
writeGenerated(join(seed, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
const origin = join(bundle, 'agent/role-directive.md');
writeGenerated(join(seed, 'role-directive.md'), relocateRoleLinks(readFileSync(origin, 'utf8'), origin, join(seed, 'role-directive.md')));
const bridge = join(root, 'src/server/wiki/bridge.ts');
const before = readFileSync(bridge, 'utf8');
if (!/export const UPSTREAM_COMMIT = '[a-f0-9]{40}';/.test(before)) throw new Error('Missing bridge pin');
writeGenerated(bridge, before.replace(/export const UPSTREAM_COMMIT = '[a-f0-9]{40}';/, `export const UPSTREAM_COMMIT = '${commit}';`));
console.log(JSON.stringify({ commit, version: plugin.version, files: files.length, role: 'generated', runtime: 'not_modified' }, null, 2));
