// Reproducible source release from a committed tree; no runtime data or Mac dependencies.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args[0] !== '--output' || !args[1]) throw new Error('Usage: npm run release:source -- --output <new.zip>');
const output = resolve(args[1]);
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
git('diff', '--exit-code', 'HEAD');
const commit = git('rev-parse', 'HEAD');
const names = git('ls-tree', '-r', '--name-only', commit).split('\n');
const forbidden = names.filter(name => name.split('/').some(part => ['history', 'node_modules', '.git', '.pii-guard.json'].includes(part)
  || (part.startsWith('.env') && part !== '.env.example') || /\.(pem|key|p12|pfx)$/.test(part)));
if (forbidden.length) throw new Error(`Forbidden release paths: ${forbidden.join(', ')}`);
mkdirSync(dirname(output), { recursive: true });
execFileSync('git', ['-C', root, 'archive', '--format=zip', '--prefix=soloforce2/', '-o', output, commit]);
const zip = new AdmZip(output);
// Compare every unpacked file with its Git blob. adm-zip's test() incorrectly
// indexes entries by entry objects in the installed version.
for (const row of git('ls-tree', '-r', commit).split('\n')) {
  const [metadata, name] = row.split('\t');
  const expected = metadata.split(' ')[2];
  const bytes = zip.getEntry(`soloforce2/${name}`)?.getData();
  if (!bytes) throw new Error(`Missing archive entry: ${name}`);
  const actual = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  // git archive applies .gitattributes, including Windows CRLF conversion.
  const normalized = actual === expected ? actual : execFileSync('git',
    ['-C', root, 'hash-object', `--path=${name}`, '--stdin'], { input: bytes, encoding: 'utf8' }).trim();
  if (normalized !== expected) throw new Error(`Git blob readback failed: ${name}`);
}
const manifest = JSON.parse(zip.readAsText('soloforce2/vendor/ingestiger/manifest.json'));
for (const file of manifest.files) {
  const bytes = zip.getEntry(`soloforce2/vendor/ingestiger/${manifest.commit}/${file.path}`)?.getData();
  if (!bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('IngesTiger bundle readback failed');
}
for (const name of ['scripts/ingestiger-bridge.py', 'scripts/wiki-product-test.ts', 'scripts/wiki-live-test.ts', 'scripts/ingestiger-check.ts',
  'config/agents/ingestiger/meta.json', 'src/server/wiki/knowledge.ts', 'src/server/wiki/execution.ts', 'packages/whisper-local/package.json', 'README-WINDOWS.md']) {
  if (!zip.getEntry(`soloforce2/${name}`)) throw new Error(`Missing runtime file: ${name}`);
}
const sha256 = createHash('sha256').update(readFileSync(output)).digest('hex');
const report = { commit, upstreamCommit: manifest.commit, version: manifest.version, trackedFiles: names.length,
  bundleFilesVerified: manifest.files.length, sha256, runtimeDataIncluded: false, windowsExecution: false };
writeFileSync(`${output}.json`, JSON.stringify(report, null, 2) + '\n');
writeFileSync(`${output}.sha256`, `${sha256}  ${output.split(/[\\/]/).at(-1)}\n`);
console.log(JSON.stringify(report, null, 2));
