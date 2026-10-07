import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { z } from 'zod';

export const MAX_PROJECT_BYTES = 20 * 1024 * 1024;
export const MAX_BUNDLE_BYTES = 30 * 1024 * 1024;
export const ProjectCategorySchema = z.enum(['ax-consulting', 'education', 'ax-research', 'spf']);
const segmentSafe = (s: string) => s.length > 0 && s.length <= 160 && !s.startsWith('.')
  && !/[\\/:\x00-\x1f<>"|?*]/.test(s) && !/[. ]$/.test(s)
  && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s);
export const ProjectSlugSchema = z.string().min(1).max(160).refine(segmentSafe);
export const ProjectSelectionSchema = z.object({ category: ProjectCategorySchema, slug: ProjectSlugSchema }).strict();
export type ProjectSelection = z.infer<typeof ProjectSelectionSchema>;
const forbidden = /(?:^|[._-])(credentials?|secrets?|tokens?|passwords?|private[-_]?key|service[-_]?account)(?:$|[._-])/i;
const extensions = new Set(['.md', '.txt', '.json', '.csv', '.pdf', '.docx', '.xlsx', '.pptx', '.png', '.jpg', '.jpeg', '.webp']);
const blockedDirectories = new Set(['node_modules', 'history', 'credentials', 'secrets', 'vendor', 'dist']);
const fileSafe = (path: string) => path.length <= 500 && path.split('/').length <= 12 && path.split('/').every(s => segmentSafe(s) && !forbidden.test(s) && !blockedDirectories.has(s.toLowerCase())) && extensions.has(extname(path).toLowerCase());
const sessionSchema = z.object({ total: z.number().int().nonnegative(), live: z.number().int().nonnegative(), cancelled: z.number().int().nonnegative(), firstDate: z.string().max(50).nullable(), lastDate: z.string().max(50).nullable() });
const metadataSchema = z.object({ name: z.string().max(500), client: z.string().max(500).nullable().optional(), status: z.string().max(100).nullable().optional(), description: z.string().max(10_000).optional(), domain: z.array(z.string().max(100)).max(30).optional(), anandaraSessions: sessionSchema.optional() });
const fileSchema = z.object({ path: z.string().refine(fileSafe), data: z.string().max(8 * 1024 * 1024).regex(/^[A-Za-z0-9+/]*={0,2}$/), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const bundleSchema = z.object({ format: z.literal('mycrew-project'), version: z.literal(1), createdAt: z.string().datetime(), project: ProjectSelectionSchema, files: z.array(fileSchema).min(1).max(1000), excludedCount: z.number().int().nonnegative() }).strict();
export type ProjectBundle = z.infer<typeof bundleSchema>;
export class ProjectDriveError extends Error {
  constructor(readonly code: string, readonly status: 400 | 403 | 404 | 409 | 413 | 422 | 502 | 503 = 400) { super(code); }
}
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function checkContent(path: string, bytes: Buffer): void {
  if (bytes.length > 5 * 1024 * 1024) throw new ProjectDriveError('project_file_too_large', 413);
  if (/\.(?:md|txt|json|csv)$/i.test(path) && /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|\b(?:AIza[\w-]{30,}|sk-(?:ant-|proj-)?[\w-]{20,}|gh[pousr]_[\w]{20,})|(?:access_token|refresh_token|client_secret|api[_-]?key|password)\s*["']?\s*[:=]\s*["']?[^\s"']{8,}/i.test(bytes.toString('utf8'))) throw new ProjectDriveError('secret_content_forbidden', 422);
}
export function parseProjectBundle(value: unknown): ProjectBundle {
  const bundle = bundleSchema.parse(value);
  let size = 0;
  const paths = new Set<string>();
  for (const file of bundle.files) {
    const key = file.path.normalize('NFC').toLowerCase();
    if (paths.has(key)) throw new ProjectDriveError('duplicate_bundle_path');
    paths.add(key);
    const bytes = Buffer.from(file.data, 'base64');
    if (bytes.toString('base64') !== file.data || digest(bytes) !== file.sha256) throw new ProjectDriveError('bundle_checksum_mismatch');
    size += bytes.length;
    if (size > MAX_PROJECT_BYTES) throw new ProjectDriveError('project_too_large', 413);
    checkContent(file.path, bytes);
  }
  for (const path of paths) for (const other of paths) if (other.startsWith(`${path}/`)) throw new ProjectDriveError('bundle_path_conflict');
  const metadata = bundle.files.find(file => file.path === 'project.json');
  if (!metadata) throw new ProjectDriveError('project_metadata_required');
  metadataSchema.strict().parse(JSON.parse(Buffer.from(metadata.data, 'base64').toString('utf8')));
  return bundle;
}
function checkedDirectory(root: string, segments: readonly string[]): string {
  let current = realpathSync(root);
  for (const segment of segments) {
    current = join(current, segment);
    const st = lstatSync(current);
    if (st.isSymbolicLink()) throw new ProjectDriveError('symlink_forbidden');
    if (!st.isDirectory()) throw new ProjectDriveError('project_directory_required');
  }
  return current;
}
export function createProjectBundle(root: string, raw: ProjectSelection): ProjectBundle {
  const project = ProjectSelectionSchema.parse(raw);
  const directory = checkedDirectory(root, [project.category, project.slug]);
  const files: ProjectBundle['files'] = [];
  let excludedCount = 0, size = 0;
  const walk = (relative: string): void => {
    for (const entry of readdirSync(join(directory, relative), { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new ProjectDriveError('symlink_forbidden');
      if (!segmentSafe(entry.name) || forbidden.test(entry.name) || blockedDirectories.has(entry.name.toLowerCase())) { excludedCount++; continue; }
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { if (path.split('/').length > 12) throw new ProjectDriveError('project_too_deep'); walk(path); continue; }
      if (!entry.isFile() || !fileSafe(path)) { excludedCount++; continue; }
      const absolute = join(directory, path);
      const resolved = realpathSync(absolute);
      if (!resolved.startsWith(directory + sep)) throw new ProjectDriveError('path_escape');
      const fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
      let bytes: Buffer;
      try { const st = fstatSync(fd); if (!st.isFile() || st.size > 5 * 1024 * 1024) throw new ProjectDriveError('project_file_too_large', 413); bytes = readFileSync(fd); } finally { closeSync(fd); }
      if (path === 'project.json') {
        const parsed: unknown = JSON.parse(bytes.toString('utf8'));
        const record = z.record(z.string(), z.unknown()).parse(parsed);
        const labels = z.object({ labels: z.array(z.object({ name: z.string() })) }).safeParse(record.domain);
        bytes = Buffer.from(JSON.stringify(metadataSchema.parse({ ...record, name: record.name ?? project.slug, client: record.anandaraClient ?? record.client,
          domain: Array.isArray(record.domain) ? record.domain : labels.success ? labels.data.labels.map(label => label.name) : undefined }), null, 2));
      }
      checkContent(path, bytes);
      size += bytes.length;
      if (size > MAX_PROJECT_BYTES || files.length >= 1000) throw new ProjectDriveError('project_too_large', 413);
      files.push({ path, data: bytes.toString('base64'), sha256: digest(bytes) });
    }
  };
  walk('');
  return parseProjectBundle({ format: 'mycrew-project', version: 1, createdAt: new Date().toISOString(), project, files, excludedCount });
}
export function importProjectBundle(root: string, raw: ProjectSelection, untrusted: unknown): ProjectSelection {
  const target = ProjectSelectionSchema.parse(raw);
  const bundle = parseProjectBundle(untrusted);
  mkdirSync(root, { recursive: true });
  const category = join(realpathSync(root), target.category);
  try { mkdirSync(category); } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error; }
  const parent = checkedDirectory(root, [target.category]);
  const directory = join(parent, target.slug);
  if (readdirSync(parent).some(name => name.normalize('NFC').toLowerCase() === target.slug.normalize('NFC').toLowerCase())) throw new ProjectDriveError('project_exists', 409);
  try { mkdirSync(directory, { mode: 0o700 }); } catch (error) { if (error instanceof Error && 'code' in error && error.code === 'EEXIST') throw new ProjectDriveError('project_exists', 409); throw error; }
  try {
    for (const file of bundle.files) {
      const path = resolve(directory, file.path);
      if (!path.startsWith(directory + sep)) throw new ProjectDriveError('path_escape');
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path, Buffer.from(file.data, 'base64'), { flag: 'wx', mode: 0o600 });
    }
  } catch (error) { rmSync(directory, { recursive: true, force: true }); throw error; }
  return target;
}
