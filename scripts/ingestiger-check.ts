/** Read-only bundle/registration/runtime verification. Does not load accounts or run a model. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { relocateRoleLinks } from '../src/role-directive.js';
import { verifyWikiBundle, UPSTREAM_COMMIT } from '../src/server/wiki/bridge.js';
import { HISTORY_DIR } from '../src/config.js';
import { loadWorkerIdentity } from '../src/server/worker-identity.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checks: { name: string; passed: boolean }[] = [];
const check = (name: string, run: () => boolean) => {
  try { checks.push({ name, passed: run() }); } catch { checks.push({ name, passed: false }); }
};
const manifest = JSON.parse(readFileSync(join(root, 'vendor/ingestiger/manifest.json'), 'utf8'));
const bundle = join(root, 'vendor/ingestiger', UPSTREAM_COMMIT);
const source = join(bundle, 'agent/role-directive.md');
const seed = join(root, 'config/agents/ingestiger/role-directive.md');
check('번들 pin과 전체 파일 해시', () => { verifyWikiBundle(); return true; });
check('직원 메타데이터와 upstream 버전', () => {
  const upstream = JSON.parse(readFileSync(join(bundle, 'agent/meta.json'), 'utf8'));
  const installed = JSON.parse(readFileSync(join(root, 'config/agents/ingestiger/meta.json'), 'utf8'));
  return upstream.id === 'ingestiger' && upstream.version === manifest.version && JSON.stringify(upstream) === JSON.stringify(installed);
});
check('등록 역할이 원본에서 생성된 내용과 일치', () =>
  readFileSync(seed, 'utf8') === relocateRoleLinks(readFileSync(source, 'utf8'), source, seed));
function linksExist(text: string, path: string): boolean {
  const links = [...relocateRoleLinks(text, path).matchAll(/\]\(<([^>]+)>\)/g)];
  return links.length >= 4 && links.every(m => existsSync(m[1].split('#')[0]));
}
check('역할의 스킬·계약 링크', () => linksExist(readFileSync(seed, 'utf8'), seed));
check('실제 worker prompt가 검증한 identity loader 사용', () => {
  const jobs = readFileSync(join(root, 'src/server/jobs.ts'), 'utf8');
  return jobs.includes('loadWorkerIdentity(agentDef.id, HISTORY_DIR)') && jobs.includes('return `${identity}');
});
const runtime = process.argv.includes('--runtime');
if (runtime) {
  check('실행 역할 사본과 선택된 seed 일치', () => {
    const path = join(HISTORY_DIR, 'agents/ingestiger/wiki/role-directive.md');
    const expected = relocateRoleLinks(readFileSync(seed, 'utf8'), seed).replace(/\r\n/g, '\n');
    // Only user-configurable names may differ. No other body or path drift is accepted.
    const pattern = expected.split(/\{\{(?:NAME|GENIE)\}\}/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^\\r\\n]+');
    return new RegExp(`^${pattern}$`).test(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'));
  });
  check('실행 역할에서 스킬·계약 파일 열기', () => {
    const path = join(HISTORY_DIR, 'agents/ingestiger/wiki/role-directive.md');
    return linksExist(readFileSync(path, 'utf8'), path);
  });
  check('실행 identity에 역할 본문 포함', () => {
    const path = join(HISTORY_DIR, 'agents/ingestiger/wiki/role-directive.md');
    return loadWorkerIdentity('ingestiger', HISTORY_DIR).includes(`[역할 지시서]\n${readFileSync(path, 'utf8')}\n[역할 지시서 끝]`);
  });
}
const result = { passed: checks.every(c => c.passed), commit: manifest.commit, version: manifest.version,
  checks, runtimeRoot: runtime ? HISTORY_DIR : null, runtime: runtime ? 'checked' : 'not_checked', modelExecution: 'not_performed', windowsExecution: process.platform === 'win32' ? 'verification_only' : 'not_performed' };
console.log(JSON.stringify(result, null, 2));
const reportIndex = process.argv.indexOf('--report');
if (reportIndex >= 0) {
  const output = process.argv[reportIndex + 1];
  if (!output) throw new Error('--report requires a new Markdown file path');
  const report = `# IngesTiger 역할 반영 검사\n\n검사 시각: ${new Date().toISOString()}\n\n버전: ${manifest.version}\n\ncommit: ${manifest.commit}\n\n| 검사 | 결과 |\n|---|---|\n${checks.map(c => `| ${c.name} | ${c.passed ? 'PASS' : 'FAIL'} |`).join('\n')}\n\n실행 역할 검사: ${result.runtime}. 실행 데이터 위치: ${result.runtimeRoot ?? "검사하지 않음"}. OS: ${process.platform}. 이 보고서는 파일·등록·identity 전달 검사이며 실제 모델의 지시 준수, Windows 앱 운영, 정본 반영·Drive 전달 성공은 증명하지 않습니다.\n`;
  writeFileSync(resolve(output), report, { flag: 'wx' });
}
process.exitCode = result.passed ? 0 : 1;
