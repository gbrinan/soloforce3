import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

/** Resolve file links at their source, before moving a role into a different runtime root. */
export function relocateRoleLinks(text: string, sourceFile: string, destinationFile?: string): string {
  return text.replace(/\]\(([^)]+)\)/g, (whole, raw: string) => {
    const link = raw.replace(/^<|>$/g, '');
    if (link.startsWith('#') || (/^[a-z][a-z0-9+.-]*:/i.test(link) && !/^[a-z]:[\\/]/i.test(link))) return whole;
    const [file, ...fragment] = link.split('#');
    const target = isAbsolute(file) ? file : resolve(dirname(sourceFile), file);
    const relocated = destinationFile ? relative(dirname(destinationFile), target) : target;
    const url = relocated.replace(/\\/g, '/') + (fragment.length ? `#${fragment.join('#')}` : '');
    return `](<${url}>)`;
  });
}

/** Existing mtime policy: preserve newer local edits; back up an older copy before replacement. */
export function syncRoleDirective(seedPath: string, targetPath: string, render: (text: string) => string): 'created' | 'updated' | 'unchanged' {
  if (existsSync(targetPath) && statSync(seedPath).mtimeMs <= statSync(targetPath).mtimeMs) return 'unchanged';
  const expected = relocateRoleLinks(render(readFileSync(seedPath, 'utf8')), seedPath);
  if (existsSync(targetPath)) {
    const current = readFileSync(targetPath, 'utf8');
    if (current === expected) return 'unchanged';
    writeFileSync(`${targetPath}.bak`, current, 'utf8');
    writeFileSync(targetPath, expected, 'utf8');
    return 'updated';
  }
  writeFileSync(targetPath, expected, 'utf8');
  return 'created';
}
