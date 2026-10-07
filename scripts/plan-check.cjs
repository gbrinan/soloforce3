#!/usr/bin/env node
'use strict';
// 계획 파일 검사기 — docs/<기능명>/ 의 tasks·findings·progress 가 paperthin 규칙을 지키는지 검사한다.
// 규칙 정의(P1~P10)의 정본은 CLAUDE.md «계획 파일 검사». 여기는 그 강제 장치다.
//   node scripts/plan-check.cjs <폴더...>   지정 폴더 검사
//   node scripts/plan-check.cjs --all       docs/*/ 중 tasks.md 에 «## Gates» 가 있는 폴더 검사(나머지는 SKIP 사유 출력)
//   --run                                  hard 게이트 명령을 실제로 실행해 증거 표와 대조
// 종료 코드: 0 통과, 1 위반, 2 대상 없음(MISS).

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '');

/** «## 제목» 단위로 본문을 나눈다. 같은 제목이 두 번 나오면 뒤의 것을 이어 붙인다. */
function sections(md) {
  const out = {};
  let cur = null;
  for (const line of stripComments(md).split(/\r?\n/)) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m && !line.startsWith('###')) { cur = m[1]; out[cur] = out[cur] ?? []; continue; }
    if (cur) out[cur].push(line);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join('\n')]));
}

/** 마크다운 표의 데이터 행(머리·구분선 제외)을 셀 배열로 돌려준다. */
function tableRows(text) {
  const rows = (text ?? '').split(/\r?\n/).filter((l) => /^\s*\|/.test(l));
  return rows.slice(2).map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
}

const filled = (s) => (s ?? '').replace(/\s+/g, '').length > 0;
const gateRefs = (line) => {
  const m = /\(gate:\s*([^)]+)\)/i.exec(line);
  return m ? m[1].split(',').map((g) => g.trim()).filter(Boolean) : [];
};

/**
 * @param {{tasks: string, findings?: string, progress?: string}} files
 * @returns {{id: string, ok: boolean, msg: string}[]}
 */
function checkPlan(files) {
  const T = sections(files.tasks ?? '');
  const F = sections(files.findings ?? '');
  const P = sections(files.progress ?? '');
  const results = [];
  const add = (id, ok, msg) => results.push({ id, ok, msg });

  add('P1', filled(T['Goal']), 'tasks.md «## Goal»이 비어 있지 않다');
  add('P2', filled(T['Understood As']), 'tasks.md «## Understood As»에 재진술이 있다');

  const gates = new Map();
  const badGates = [];
  for (const [id, claim, check, kind] of tableRows(T['Gates'])) {
    if (!id) continue;
    gates.set(id, { claim, check, kind });
    const k = (kind ?? '').toLowerCase();
    if (k === 'hard' && !/`[^`]+`/.test(check ?? '')) badGates.push(`${id}: hard 게이트에 백틱 명령이 없다`);
    else if (!['hard', 'real-surface', 'manual'].includes(k)) badGates.push(`${id}: Kind '${kind}'는 hard|real-surface|manual 중 하나여야 한다`);
    else if (!filled(check) || check === '-') badGates.push(`${id}: 확인 수단이 비어 있다`);
  }
  add('P3', gates.size > 0 && badGates.length === 0,
    gates.size === 0 ? '«## Gates» 표에 게이트가 하나 이상 있다' : badGates.length ? badGates.join('; ') : `게이트 ${gates.size}개 모두 확인 수단이 있다`);

  const evidence = new Map();
  for (const [gate, result] of tableRows(P['Gate Evidence'])) {
    if (!gate) continue;
    if ((result ?? '').toUpperCase().includes('PASS')) evidence.set(gate, 'PASS');
    else if (!evidence.has(gate)) evidence.set(gate, result);
  }

  const unknownRefs = [];
  const unproven = [];
  const openInDone = [];
  let phase = null;
  for (const line of (T['Phases'] ?? '').split(/\r?\n/)) {
    const h = /^###\s+(.+)$/.exec(line);
    if (h) { phase = { title: h[1], done: h[1].includes('✅') }; continue; }
    const item = /^\s*-\s+\[( |x|X)\]\s+(.*)$/.exec(line);
    if (!item) continue;
    const checked = item[1] !== ' ';
    for (const g of gateRefs(item[2])) {
      if (!gates.has(g)) unknownRefs.push(g);
      else if (checked && evidence.get(g) !== 'PASS') unproven.push(`${g} («${item[2].slice(0, 40)}»)`);
    }
    if (phase && phase.done && !checked) openInDone.push(`${phase.title}: ${item[2].slice(0, 40)}`);
  }
  add('P4', unknownRefs.length === 0, unknownRefs.length ? `없는 게이트 참조: ${[...new Set(unknownRefs)].join(', ')}` : '단계 항목의 게이트 참조가 모두 존재한다');
  add('P5', unproven.length === 0 && openInDone.length === 0,
    [unproven.length ? `PASS 증거 없이 체크된 항목: ${unproven.join('; ')}` : '', openInDone.length ? `✅ 단계에 미완 항목: ${openInDone.join('; ')}` : '']
      .filter(Boolean).join(' / ') || '체크된 게이트 항목은 모두 PASS 증거가 있다');

  const orphan = [...evidence.keys()].filter((g) => !gates.has(g));
  add('P6', orphan.length === 0, orphan.length ? `«## Gates»에 없는 증거: ${orphan.join(', ')}` : '증거 표의 게이트가 모두 설계에 있다');
  add('P7', 'Descoped' in T && 'Error Log' in P, '«## Descoped»(tasks)와 «## Error Log»(progress)가 있다');

  const dates = Object.keys(P).map((k) => /^Session\s+(\d{4}-\d{2}-\d{2})/.exec(k)?.[1]).filter(Boolean);
  const ascending = dates.every((d, i) => i === 0 || dates[i - 1] <= d);
  add('P8', dates.length > 0 && ascending, dates.length === 0 ? '«## Session YYYY-MM-DD»가 하나 이상 있다' : ascending ? '세션 날짜가 오름차순이다' : `세션 날짜가 오름차순이 아니다: ${dates.join(' → ')}`);

  const reboot = tableRows(P['5-Question Reboot Check']).filter((r) => filled(r[1]));
  add('P9', reboot.length >= 5, `재진입 5문항 답이 ${reboot.length}개 있다`);
  add('P10', 'Negative Corpus' in F, 'findings.md «## Negative Corpus»가 있다');

  return results;
}

/** hard 게이트 명령을 실행한다. PASS 증거가 있는데 지금 실패하면 위반이다. */
function runGates(files, cwd) {
  const T = sections(files.tasks ?? '');
  const out = [];
  for (const [id, , check, kind] of tableRows(T['Gates'])) {
    if ((kind ?? '').toLowerCase() !== 'hard') continue;
    const cmd = /`([^`]+)`/.exec(check ?? '')?.[1];
    if (!cmd) continue;
    try {
      execSync(cmd, { cwd, stdio: 'pipe', timeout: 600_000 });
      out.push({ id: `RUN ${id}`, ok: true, msg: cmd });
    } catch (e) {
      out.push({ id: `RUN ${id}`, ok: false, msg: `${cmd} → 종료 코드 ${e.status ?? '?'}` });
    }
  }
  return out;
}

function readFolder(dir) {
  const read = (f) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf-8') : '');
  return { tasks: read('tasks.md'), findings: read('findings.md'), progress: read('progress.md') };
}

function main(argv) {
  const root = path.resolve(__dirname, '..');
  const run = argv.includes('--run');
  let dirs = argv.filter((a) => !a.startsWith('--'));
  if (argv.includes('--all')) {
    const docs = path.join(root, 'docs');
    dirs = fs.readdirSync(docs, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(docs, d.name));
  }
  if (dirs.length === 0) { console.error('MISS: 검사할 폴더가 없습니다 (폴더 경로 또는 --all)'); return 2; }

  let failed = 0;
  let checked = 0;
  for (const d of dirs) {
    const dir = path.resolve(root, d);
    const files = readFolder(dir);
    const rel = path.relative(root, dir);
    if (!files.tasks) { console.log(`SKIP ${rel}: tasks.md 없음`); continue; }
    if (!/^##\s+Gates\s*$/m.test(stripComments(files.tasks))) { console.log(`SKIP ${rel}: «## Gates» 이전 규약(검사 대상 아님)`); continue; }
    checked++;
    console.log(`\n${rel}`);
    const results = checkPlan(files).concat(run ? runGates(files, root) : []);
    for (const r of results) {
      console.log(`  [${r.ok ? 'PASS' : 'FAIL'}] ${r.id} ${r.msg}`);
      if (!r.ok) failed++;
    }
  }
  if (checked === 0) { console.error('MISS: 검사 규약을 따르는 폴더가 없습니다'); return 2; }
  return failed > 0 ? 1 : 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { checkPlan, sections, tableRows };
