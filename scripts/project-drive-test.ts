import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createProjectBundle, importProjectBundle, parseProjectBundle } from '../src/server/project-drive/bundle.js';

const root = mkdtempSync(join(tmpdir(), 'project-drive-test-'));
const project = { category: 'education', slug: 'source' };
const source = join(root, 'education', 'source');
mkdirSync(join(source, 'outputs'), { recursive: true });
writeFileSync(join(source, 'project.json'), JSON.stringify({ name: 'Portable project', status: 'active', anandaraClient: 'Training client', domain: { labels: [{ name: '교육' }] }, anandaraSessions: { total: 3, live: 2, cancelled: 1, firstDate: '2026-09-01', lastDate: '2026-09-03' } }));
writeFileSync(join(source, 'outputs', 'report.md'), '# Report\nA real portable document.');
writeFileSync(join(source, '.env'), 'DO_NOT_UPLOAD=private');
mkdirSync(join(source, '.connections'), { recursive: true });
writeFileSync(join(source, '.connections', 'secret.json'), '{}');

try {
  // Given a project with documents and credentials, when packaged, then secrets are excluded.
  const bundle = createProjectBundle(root, project);
  assert.deepEqual(bundle.files.map(f => f.path).sort(), ['outputs/report.md', 'project.json']);
  assert.equal(bundle.excludedCount, 2);
  // Given a valid snapshot, when imported under a new name, then document bytes are preserved.
  const imported = importProjectBundle(root, { category: 'education', slug: 'imported' }, bundle);
  assert.equal(imported.slug, 'imported');
  assert.equal(readFileSync(join(root, 'education/imported/outputs/report.md'), 'utf8'), '# Report\nA real portable document.');
  const metadata = JSON.parse(readFileSync(join(root, 'education/imported/project.json'), 'utf8'));
  assert.equal(metadata.client, 'Training client');
  assert.deepEqual(metadata.domain, ['교육']);
  assert.equal(metadata.anandaraSessions.total, 3);
  assert.throws(() => importProjectBundle(root, project, bundle), /project_exists/);
  for (const path of ['../escape.md', '/absolute.md', 'outputs/../../escape.md', 'outputs\\escape.md', '.env', 'outputs/token.json', 'C:escape.md', 'outputs/CON.txt']) {
    // Given an untrusted file path, when parsed, then the complete snapshot is rejected.
    assert.throws(() => parseProjectBundle({ ...bundle, files: [{ ...bundle.files[0], path }] }));
  }
  assert.throws(() => parseProjectBundle({ ...bundle, files: [...bundle.files, bundle.files[0]] }));
  assert.throws(() => parseProjectBundle({ ...bundle, files: Array.from({ length: 1001 }, () => bundle.files[0]) }));
  const oversized = Buffer.alloc(5 * 1024 * 1024 + 1);
  assert.throws(() => parseProjectBundle({ ...bundle, files: [{ path: 'outputs/large.pdf', data: oversized.toString('base64'), sha256: createHash('sha256').update(oversized).digest('hex') }] }), /project_file_too_large/);
  assert.throws(() => parseProjectBundle({ ...bundle, files: bundle.files.map(f => ({ ...f, sha256: '0'.repeat(64) })) }));
  const secret = Buffer.from('-----BEGIN PRIVATE KEY-----\nprivate');
  assert.throws(() => parseProjectBundle({ ...bundle, files: [{ path: 'outputs/key.txt', data: secret.toString('base64'), sha256: createHash('sha256').update(secret).digest('hex') }] }));
  symlinkSync(join(root, 'education/imported'), join(source, 'linked'));
  assert.throws(() => createProjectBundle(root, project), /symlink_forbidden/);
  assert.equal(existsSync(join(root, 'escape.md')), false);
  console.log('Project bundle safety and round trip passed');
} finally { rmSync(root, { recursive: true, force: true }); }
