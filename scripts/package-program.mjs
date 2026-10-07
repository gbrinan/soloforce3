// scripts/package-program.mjs
// 배포용 프로그램 코드 전용 zip 패키징 스크립트 (데이터/개인기록 제외)
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { ZipArchive } from 'archiver';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TIMESTAMP = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14).replace(/(\d{8})(\d{6})/, '$1_$2');
const HOME = process.env.HOME || '';
const OUT = path.join(HOME, 'Desktop', `mycrew-program_${TIMESTAMP}.zip`);
const PREFIX = 'mycrew-program';

// ── PII deny-list 외부 로드 (자기참조 누수 차단) ─────────────────────────
// 패키저 본체에 토큰 평문을 박으면 ZIP에 그대로 동봉돼 자기검사가 자기 자신을 못 거른다.
// 그래서 토큰은 root `.pii-guard.json`에서만 로드하고, 이 JSON은 ZIP EXCLUDE 대상이다.
const PII_GUARD_PATH = path.join(ROOT, '.pii-guard.json');
// v2 schema: each entry is either a plain string token or {value, allowedSubstrings?: string[]}.
// allowedSubstrings whitelists benign substring contexts so the gate can distinguish a real
// leak from an incidental substring match. Internally normalized to {value, allow}.
let PII_TOKENS = [];
try {
  const raw = fs.readFileSync(PII_GUARD_PATH, 'utf8');
  const data = JSON.parse(raw);
  const list = Array.isArray(data.tokens) ? data.tokens : [];
  for (const t of list) {
    if (typeof t === 'string' && t.length > 0) {
      PII_TOKENS.push({ value: t, allow: [] });
    } else if (t && typeof t === 'object' && typeof t.value === 'string' && t.value.length > 0) {
      const allow = Array.isArray(t.allowedSubstrings)
        ? t.allowedSubstrings.filter((s) => typeof s === 'string' && s.length > 0)
        : [];
      PII_TOKENS.push({ value: t.value, allow });
    }
  }
} catch (err) {
  console.error(`❌ .pii-guard.json 로드 실패: ${err.message}`);
  process.exit(1);
}
if (PII_TOKENS.length === 0) {
  console.error('❌ PII 토큰 deny-list가 비어 있음 (.pii-guard.json 확인).');
  process.exit(1);
}

// 토큰 hit 위치가 화이트리스트 컨텍스트(allowedSubstrings) 안의 부분문자열로 발생했는지 판정.
// hit이 컨텍스트의 substring 위치와 정확히 겹치면 false-positive로 간주하고 마스킹한다.
function isAllowedHit(text, hitPos, token, allow) {
  for (const ctx of allow) {
    const idxInCtx = ctx.indexOf(token);
    if (idxInCtx === -1) continue;
    const ctxStart = hitPos - idxInCtx;
    if (ctxStart < 0) continue;
    if (text.substr(ctxStart, ctx.length) === ctx) return true;
  }
  return false;
}
function findRealHits(text, token, allow) {
  const positions = [];
  let pos = 0;
  while ((pos = text.indexOf(token, pos)) !== -1) {
    if (!isAllowedHit(text, pos, token, allow)) positions.push(pos);
    pos += token.length;
  }
  return positions;
}

// ── CLI 플래그 ───────────────────────────────────────────────────────────
const cliArgs = process.argv.slice(2);
const withOptionalApps = !cliArgs.includes('--no-optional-apps');

const OPTIONAL_APPS = [
  { id: 'photos', source: path.join(HOME, 'mycrew-photos'), zipPath: 'apps/photos' },
];

console.log(`📦 패키징 시작: ${ROOT} → ${OUT}`);
console.log(`   PII deny-list: ${PII_TOKENS.length}종 로드 (.pii-guard.json)`);

// ── 포함 디렉토리 (화이트리스트) ─────────────────────────────────────────
const INCLUDE_DIRS = ['src', 'tests', 'prompts', 'config', 'tools', 'apps', 'assets'];

const SHIP_SCRIPTS = new Set([
  'store-preseed-installed.ts',
  'fix-pty-perms.cjs',
  'package-program.mjs',
  'verify.mjs',
  'health-process.mjs',
  'make-icons.sh',
  'encode-ico.mjs',
  'safefs-allowlist-test.ts',
  'approval-token-test.ts',
  'approval-genie-test.ts',
  'path-routing-test.ts',
  'genie-superuser-test.ts',
  'approval-cache-test.ts',
  'recovery-mtime-test.ts',
  'sigkill-test.ts',
  'jobtype-template-test.ts',
  'internal-notify-test.ts',
  'approval-jobid-test.ts',
  'approval-revoke-jobid-test.ts',
  'approval-persist-test.ts',
  'external-mock.ts',
  'two-instance-integration-test.ts',
  'two-instance-partner-request-test.ts',
]);

const EXCLUDE_CONFIG_FILES = new Set([
  'external-agents.json',
  'cloudflared.yml',
]);

// apps/* 내부에서 운영용 디버그/배포·테스트·마이그레이션 스크립트 차단.
//   deploy-*.sh           — LaunchAgent 배포 스크립트
//   _*.mjs                — 비공개 진단 스크립트 (예: _who.mjs, _kill2.mjs, _verify_db.mjs)
//   verify-*.(mjs|sh)     — 운영 검증 스크립트
//   check-*.(mjs|sh)      — 운영 점검 스크립트
//   test-*.(mjs|sh)       — 개발자 로컬 테스트 스크립트 (.sh 포함)
//   quick-*.mjs           — 일회성 디버깅 스크립트
//   phaseN*.(mjs|sh)      — 마이그레이션 잔재
const APPS_PRIVATE_BASENAME_RE =
  /^(deploy-.+\.sh|start-.+\.sh|_.+\.mjs|verify-.+\.(mjs|sh)|check-.+\.(mjs|sh)|test-.+\.(mjs|sh)|quick-.+\.mjs|phase\d+.+\.(mjs|sh))$/i;

const EXCLUDE_BASENAMES = new Set([
  'tsconfig.tsbuildinfo',
  '_smoke_sso.ts',
  'pkg-status.json',
  'inline-test.log',
  '_pat.txt',
  'NULL',
  '.pii-guard.json',         // root deny-list — 절대 동봉 금지
  '.qa-tmp',                 // QA 임시파일 — 테스터 개인정보 포함 가능
  'OPTIONAL_APPS.json',      // 메타파일도 제외 (절대경로 누수 위험)
]);

const EXCLUDE_BASENAME_PATTERNS = [
  /\.plist$/i,                     // LaunchAgent plist — 배포 산출물(절대경로 포함), 설치 시 재생성
  /\.bak(?:[._-].*)?$/i,            // .bak / .bak.cors-... / .bak-2026-...
  /\.backup(?:[._-].*)?$/i,
  /\.phase\d+(?:\..*)?$/i,          // *.phase1.bak / *.phase3.cors etc.
  /_debug\.log$/i,
  /\.test\.ts$/,
  /\.test\.tsx$/,
  /\.spec\.ts$/,
  /\.spec\.tsx$/,
  /\.log$/i,
  /\.err$/i,
  /^pkg-.*\.json$/,
  /^_[A-Za-z0-9_-]+\.(json|log|txt|err)$/i,   // _doc_diag.json / _restart_debug.log / _pat.txt 등
  /^perm[A-Za-z0-9_-]*\.txt$/i,                // perm-verify-paul.txt / permtest-marker.txt
];

function isExcludedBasename(name) {
  if (EXCLUDE_BASENAMES.has(name)) return true;
  return EXCLUDE_BASENAME_PATTERNS.some((re) => re.test(name));
}

const SHIP_AGENT_IDS = (() => {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'agents-default.json'), 'utf8'));
    return new Set([...(d.agents || []).map((a) => a.id), 'genie']);
  } catch {
    return new Set(['dev-pm', 'planner-researcher', 'qa', 'genie']);
  }
})();

function isNonBaselineAgentEntry(entryName) {
  const segs = entryName.split(path.sep);
  const ai = segs.indexOf('agents');
  if (ai !== -1 && segs.length > ai + 1) {
    const agentId = segs[ai + 1];
    return !SHIP_AGENT_IDS.has(agentId);
  }
  return false;
}

const INCLUDE_ROOT_FILES = [
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'README.md',
  'README-USER.md',
  'README-WINDOWS.md',
  'README-DISTRIBUTION.md',
  '.gitignore',
  '.env.example',
  'setup.sh',
  'setup.command',
  'setup-linux.sh',
  'setup-windows.ps1',
  'install-app.command',
  'mycrew-launch.cmd',
  'skills-lock.json',
];

// ── 빌드 중 PII 검사 (필터 콜백 안에서 통과 파일 내용 스캔) ───────────────
// archiver의 filter 콜백은 각 entry가 ZIP에 들어가기 직전에 호출되므로,
// 통과 entry의 source 파일을 즉시 fs로 읽어 PII 토큰을 검색한다.
// 한 건이라도 hit이면 위반 목록에 누적하고 finalize 후 ZIP을 삭제한다.
const PRE_VIOLATIONS = [];
// 바이너리 자산은 UTF-8 디코드 시 우연 일치가 발생하므로 텍스트 스캔 대상에서 제외한다.
// (예: tesseract kor.traineddata는 한국어 trained data 바이트열이 단일 문자 토큰과 우연 일치)
const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.icns', '.bmp', '.tiff',
  '.pdf', '.zip', '.gz', '.tgz', '.tar', '.7z', '.rar',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.mp4', '.wav', '.ogg', '.webm', '.mov',
  '.traineddata', '.onnx', '.pb', '.bin', '.dat', '.wasm',
  '.so', '.dylib', '.dll', '.exe',
]);
function isBinaryEntry(entryName) {
  const i = entryName.lastIndexOf('.');
  if (i === -1) return false;
  return BINARY_EXTS.has(entryName.slice(i).toLowerCase());
}
function scanFileForPii(absPath, entryName) {
  if (isBinaryEntry(entryName)) return;
  let txt;
  try {
    // UTF-8 디코드 (한국어 토큰 검사용). 텍스트 자산만 스캔.
    txt = fs.readFileSync(absPath, 'utf8');
  } catch {
    return;
  }
  for (const tok of PII_TOKENS) {
    const hits = findRealHits(txt, tok.value, tok.allow);
    if (hits.length > 0) {
      PRE_VIOLATIONS.push({ entry: entryName, token: tok.value, source: absPath, hits: hits.length });
    }
  }
}

if (fs.existsSync(OUT)) {
  fs.unlinkSync(OUT);
  console.log('  기존 zip 삭제');
}

const output = fs.createWriteStream(OUT);
const archive = new ZipArchive({ zlib: { level: 9 } });

let fileCount = 0;
archive.on('entry', () => { fileCount++; });
archive.on('warning', (err) => {
  if (err.code !== 'ENOENT') throw err;
  console.warn('  경고:', err.message);
});
archive.on('error', (err) => { throw err; });
archive.pipe(output);

// ── 디렉토리 추가 ────────────────────────────────────────────────────────
for (const dir of INCLUDE_DIRS) {
  const dirPath = path.join(ROOT, dir);
  if (!fs.existsSync(dirPath)) {
    console.log(`  건너뜀 (없음): ${dir}/`);
    continue;
  }
  console.log(`  추가: ${dir}/`);
  archive.directory(dirPath, `${PREFIX}/${dir}`, (entry) => {
    const parts = entry.name.split(path.sep);
    if (parts.some((p) => ['node_modules', 'dist', '.git', '.git.disabled', '.next', 'tmp', 'history', 'plans', 'uploads', 'history-backups', '.baseline', '.data', '.build-logs', 'docs', '.scratch', '_diag', '.tmp-qa'].includes(p))) {
      return false;
    }
    if (dir === 'apps' && parts[1] === 'scripts') {
      return false;
    }
    // 스토어 스캐폴드(mycrew-store-scaffold)는 Vercel에 별도 배포되는 스토어 프론트라
    // 마이크루 패키지에 동봉하지 않는다. travel-legacy도 제외(폐기 예정 레거시).
    if (dir === 'apps' && (parts[0] === 'mycrew-store-scaffold' || parts[0] === 'travel-legacy-nextjs')) {
      return false;
    }
    const base = path.basename(entry.name);
    if (isExcludedBasename(base)) {
      console.log(`    제외 (basename): ${entry.name}`);
      return false;
    }
    if (dir === 'config' && EXCLUDE_CONFIG_FILES.has(base)) {
      console.log(`    제외 (config): ${entry.name}`);
      return false;
    }
    if (dir === 'config' && isNonBaselineAgentEntry(entry.name)) {
      return false;
    }
    if (dir === 'apps' && APPS_PRIVATE_BASENAME_RE.test(base)) {
      console.log(`    제외 (apps private): ${entry.name}`);
      return false;
    }
    // mymovie의 개발자 빌드/E2E 도구는 패키지 불필요 + 절대경로(PII) 포함
    // (런타임 import 없음 — src/server 어느 곳도 samples/·scripts/를 참조 안 함)
    if (dir === 'apps' && parts[0] === 'mymovie' && (parts[1] === 'samples' || parts[1] === 'scripts')) {
      console.log(`    제외 (mymovie dev-tool): ${entry.name}`);
      return false;
    }
    // .env.example은 사용자 연동 안내서 역할 — 동봉 허용 (실 시크릿 .env/.env.local만 차단)
    if (/^\.env(\..+)?$/.test(base) && base !== '.env.example') {
      console.log(`    제외 (.env*): ${entry.name}`);
      return false;
    }
    // 통과 entry의 source 파일을 빌드 중 PII 검사
    if (entry.stats && entry.stats.isFile()) {
      scanFileForPii(path.join(dirPath, entry.name), `${dir}/${entry.name}`);
    }
    return entry;
  });
}

// ── scripts/ 화이트리스트 적용 (빌드 중 PII 검사 포함) ────────────────────
console.log('  추가: scripts/ (화이트리스트 ' + SHIP_SCRIPTS.size + '개)');
const scriptsMissing = [];
for (const fname of SHIP_SCRIPTS) {
  const fp = path.join(ROOT, 'scripts', fname);
  if (!fs.existsSync(fp)) {
    scriptsMissing.push(fname);
    continue;
  }
  scanFileForPii(fp, `scripts/${fname}`);
  archive.file(fp, { name: `${PREFIX}/scripts/${fname}` });
}
if (scriptsMissing.length > 0) {
  console.warn(`  ⚠️  scripts 화이트리스트 누락: ${scriptsMissing.join(', ')}`);
}

// ── 루트 파일 추가 (빌드 중 PII 검사 포함) ────────────────────────────────
for (const file of INCLUDE_ROOT_FILES) {
  const filePath = path.join(ROOT, file);
  if (fs.existsSync(filePath)) {
    console.log(`  추가: ${file}`);
    scanFileForPii(filePath, file);
    archive.file(filePath, { name: `${PREFIX}/${file}` });
  } else {
    console.log(`  건너뜀 (없음): ${file}`);
  }
}

// ── 선택 앱 (옵트인) ─────────────────────────────────────────────────────
// OPTIONAL_APPS.json 메타 파일은 더이상 ZIP에 동봉하지 않는다 (절대경로 누수 위험 + 런타임 불필요).
if (withOptionalApps) {
  for (const app of OPTIONAL_APPS) {
    if (!fs.existsSync(app.source)) {
      console.log(`  건너뜀 (소스 없음): ${app.zipPath}`);
      continue;
    }
    console.log(`  추가: ${app.zipPath}/`);
    archive.directory(app.source, `${PREFIX}/${app.zipPath}`, (entry) => {
      const parts = entry.name.split(path.sep);
      if (parts.some((p) => ['node_modules', 'dist', '.git', 'data', 'models', 'tmp', '.next', '.baseline'].includes(p))) {
        return false;
      }
      if (parts[0] === 'scripts') return false;
      const base = path.basename(entry.name);
      if (/^\.env(\..+)?$/.test(base) && base !== '.env.example') return false;
      if (isExcludedBasename(base)) return false;
      if (APPS_PRIVATE_BASENAME_RE.test(base)) return false;
      if (parts.some((p) => p === '.scratch' || p === '_diag')) return false;
      // 빌드 중 PII 검사 (외부 디렉토리에도 동일 적용)
      if (entry.stats && entry.stats.isFile()) {
        scanFileForPii(path.join(app.source, entry.name), `${app.zipPath}/${entry.name}`);
      }
      return entry;
    });
  }
} else {
  console.log('  (선택 앱 제외 — --no-optional-apps)');
}

// ── finalize ─────────────────────────────────────────────────────────────
await new Promise((resolve, reject) => {
  output.on('close', resolve);
  archive.on('error', reject);
  archive.finalize();
});

console.log(`\n✅ zip 생성 완료: ${OUT}`);
console.log(`   총 ${fileCount}개 항목`);

// ── 게이트 1: 빌드 중 PII 검사 결과 (필터 콜백에서 누적) ──────────────────
if (PRE_VIOLATIONS.length > 0) {
  console.error('\n❌ 빌드 중 PII 위반 — ZIP에 들어간 파일에서 토큰 검출:');
  for (const v of PRE_VIOLATIONS.slice(0, 20)) {
    console.error(`   ${v.entry}  ← "${v.token}"`);
  }
  if (PRE_VIOLATIONS.length > 20) console.error(`   …외 ${PRE_VIOLATIONS.length - 20}건`);
  fs.unlinkSync(OUT);
  console.error(`❌ ZIP 삭제됨. exit 1.`);
  process.exit(1);
}
console.log(`✅ 빌드 중 PII 검사 통과 — 위반 0건 (${PII_TOKENS.length}종 토큰 검사)`);

// ── 게이트 2: ZIP entry 메타데이터 검사 (금지 디렉토리·확장자) ────────────
console.log('\n🔍 ZIP entry 메타 검사 (Central Directory 스캔)...');
const zipBytes = fs.readFileSync(OUT);
const entryNames = [];
{
  const buf = zipBytes;
  for (let i = 0; i + 46 <= buf.length; i++) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x01 && buf[i + 3] === 0x02) {
      const nameLen = buf.readUInt16LE(i + 28);
      const extraLen = buf.readUInt16LE(i + 30);
      const commentLen = buf.readUInt16LE(i + 32);
      const name = buf.slice(i + 46, i + 46 + nameLen).toString('utf8');
      entryNames.push(name);
      i += 46 + nameLen + extraLen + commentLen - 1;
    }
  }
}

const BAD_PATH_PATTERNS = [
  { pattern: /\/history\//, label: 'history/' },
  { pattern: /\/history-backups\//, label: 'history-backups/' },
  { pattern: /\/node_modules\//, label: 'node_modules/' },
  { pattern: /\/dist\//, label: 'dist/' },
  { pattern: /\/plans\//, label: 'plans/' },
  { pattern: /\/\.git\//, label: '.git/' },
  { pattern: /\/tmp\//, label: 'tmp/' },
  { pattern: /\/\.env(?!\.example)/, label: '.env (비밀 환경변수)' },
  { pattern: /auth-session/, label: 'auth-session' },
  { pattern: /cost-log/, label: 'cost-log' },
  { pattern: /\.bak$/, label: '*.bak' },
  { pattern: /\.test\.tsx?$/, label: '*.test.ts(x)' },
  { pattern: /pkg-status\.json$/, label: 'pkg-status.json' },
  { pattern: /inline-test\.log$/, label: 'inline-test.log' },
  { pattern: /\.pii-guard\.json$/, label: '.pii-guard.json (deny-list 자기참조)' },
  { pattern: /OPTIONAL_APPS\.json$/, label: 'OPTIONAL_APPS.json' },
];

let foundBad = 0;
for (const { pattern, label } of BAD_PATH_PATTERNS) {
  const hit = entryNames.filter((n) => pattern.test(n));
  if (hit.length > 0) {
    console.error(`❌ 금지 항목 포함: ${label} (예: ${hit.slice(0, 3).join(', ')})`);
    foundBad++;
  }
}

const shippedAgentDirs = new Set();
for (const name of entryNames) {
  const m = name.match(/[/\\]config[/\\](?:\.baseline[/\\])?agents[/\\]([^/\\]+)[/\\]/);
  if (m) shippedAgentDirs.add(m[1]);
}
const leakedAgents = [...shippedAgentDirs].filter((id) => !SHIP_AGENT_IDS.has(id));
if (leakedAgents.length > 0) {
  console.error(`❌ baseline 외 개인 직원 포함: ${leakedAgents.join(', ')}`);
  foundBad++;
}

if (foundBad > 0) {
  fs.unlinkSync(OUT);
  console.error(`❌ ZIP entry 메타 검사 실패 — ${foundBad}건. zip 삭제됨.`);
  process.exit(1);
}
console.log('✅ ZIP entry 메타 검사 통과');

// ── 게이트 3: 빌드 후 ZIP 해제 + Node 재귀 스캐너 (압축 본문 실측) ────────
// `grep -F`는 substring 화이트리스트(컨텍스트 마스킹)를 못 한다.
// 그래서 unzip 후 Node로 재귀 walk + findRealHits 적용 — 빌드 중 스캔과 동일 알고리즘.
console.log('\n🔍 빌드 후 자기검사 (unzip + Node walker, allowedSubstrings 적용)...');
const verifyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mycrew-pii-'));
let postFoundBad = 0;
const postHitsByToken = new Map();
try {
  const ures = spawnSync('unzip', ['-q', OUT, '-d', verifyDir]);
  if (ures.status !== 0) {
    const stderrTxt = (ures.stderr || Buffer.alloc(0)).toString().slice(0, 300);
    console.error(`❌ unzip 실패: status=${ures.status} stderr=${stderrTxt}`);
    postFoundBad++;
  } else {
    const walk = (dir) => {
      const out = [];
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) out.push(...walk(p));
        else if (ent.isFile()) out.push(p);
      }
      return out;
    };
    const files = walk(verifyDir).filter((fp) => !isBinaryEntry(fp));
    for (const tok of PII_TOKENS) {
      let hitFiles = 0;
      const samples = [];
      for (const fp of files) {
        let txt;
        try { txt = fs.readFileSync(fp, 'utf8'); } catch { continue; }
        const positions = findRealHits(txt, tok.value, tok.allow);
        if (positions.length > 0) {
          hitFiles++;
          if (samples.length < 5) {
            const rel = fp.replace(verifyDir + '/', '');
            samples.push(`${rel} (×${positions.length})`);
          }
        }
      }
      postHitsByToken.set(tok.value, hitFiles);
      console.log(`   "${tok.value}" : ${hitFiles}개 파일에서 진성 hit`);
      if (hitFiles > 0) {
        samples.forEach((s) => console.error(`     ❌ ${s}`));
        postFoundBad++;
      }
    }
  }
} finally {
  fs.rmSync(verifyDir, { recursive: true, force: true });
}

if (postFoundBad > 0) {
  fs.unlinkSync(OUT);
  console.error(`❌ 빌드 후 자기검사 실패 — PII ${postFoundBad}종 위반. zip 삭제됨.`);
  process.exit(1);
}
console.log(`✅ 빌드 후 자기검사 통과 — PII ${PII_TOKENS.length}종 0건 (allowedSubstrings 마스킹 후).`);

// ── 최종 크기 확인 ────────────────────────────────────────────────────────
const stat = fs.statSync(OUT);
const sizeMB = (stat.size / 1024 / 1024).toFixed(2);
console.log(`\n📦 최종 결과:`);
console.log(`   경로: ${OUT}`);
console.log(`   크기: ${sizeMB} MB (${stat.size.toLocaleString()} bytes)`);
console.log(`   항목: ${fileCount}개`);
console.log(`\n✅ 3단 게이트 통과 — 배포 zip 준비 완료`);
