'use strict';
// plan-check.cjs 회귀 테스트 — 규칙마다 «지켜진 계획»은 통과하고 «어긴 계획»은 그 규칙만 실패하는지 본다.
const { checkPlan } = require('./plan-check.cjs');

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`[PASS] ${name}`); pass++; }
  else { console.log(`[FAIL] ${name}${detail ? ' — ' + detail : ''}`); fail++; }
}

const GOOD = {
  tasks: `# Tasks: 예시
## Goal
원장 비용을 믿을 수 있게 한다.
## Understood As
과거 행은 고치지 않고 읽을 때 등급을 붙인다.
## Phases
### Phase 1: 계량기 ✅
- [x] 단가 보정 (gate: G1)
### Phase 2: 다음 🔄
- [ ] 리포트 연결 (gate: G2)
## Gates
| ID | Claim | Check | Kind |
| --- | --- | --- | --- |
| G1 | 단가가 CLI와 맞는다 | \`node -e "process.exit(0)"\` | hard |
| G2 | 라이브 리포트 | 라이브 원장에 실행해 표 확인 | real-surface |
## Descoped
| Item | Reason | Where |
| --- | --- | --- |
`,
  findings: `# Findings
## Negative Corpus
- 없음
`,
  progress: `# Progress
## Session 2026-10-06
작업
## Session 2026-10-07
작업
## Gate Evidence
| Gate | Result | Evidence | Date |
| --- | --- | --- | --- |
| G1 | PASS | 6 passed | 2026-10-07 |
## Error Log
| Timestamp | Error | Attempt | Resolution |
| --- | --- | --- | --- |
## 5-Question Reboot Check
| Question | Answer |
| --- | --- |
| 1 | Phase 2 |
| 2 | G2 |
| 3 | 원장 신뢰 |
| 4 | findings |
| 5 | Phase 1 |
`,
};

const failing = (files) => checkPlan(files).filter((r) => !r.ok).map((r) => r.id);
const only = (files, id) => {
  const f = failing(files);
  return f.length === 1 && f[0] === id ? true : `실패 규칙: ${f.join(',') || '(없음)'}`;
};
const t = (name, files, id) => { const r = only(files, id); check(name, r === true, r === true ? '' : r); };

check('지켜진 계획은 전부 통과', failing(GOOD).length === 0, failing(GOOD).join(','));
t('P1 목표 없음', { ...GOOD, tasks: GOOD.tasks.replace('원장 비용을 믿을 수 있게 한다.', '<!-- 목표 -->') }, 'P1');
t('P2 재진술 없음', { ...GOOD, tasks: GOOD.tasks.replace('과거 행은 고치지 않고 읽을 때 등급을 붙인다.', '') }, 'P2');
t('P3 hard 게이트에 명령 없음', { ...GOOD, tasks: GOOD.tasks.replace('`node -e "process.exit(0)"`', '테스트를 돌린다') }, 'P3');
t('P4 없는 게이트 참조', { ...GOOD, tasks: GOOD.tasks.replace('(gate: G2)', '(gate: G9)') }, 'P4');
t('P5 증거 없이 체크', { ...GOOD, progress: GOOD.progress.replace('| G1 | PASS | 6 passed | 2026-10-07 |', '| G1 | FAIL | 2 failed | 2026-10-07 |') }, 'P5');
t('P5 ✅ 단계에 미완 항목', { ...GOOD, tasks: GOOD.tasks.replace('### Phase 2: 다음 🔄', '### Phase 2: 다음 ✅') }, 'P5');
t('P6 설계에 없는 증거', { ...GOOD, progress: GOOD.progress.replace('| G1 | PASS | 6 passed | 2026-10-07 |', '| G1 | PASS | 6 passed | 2026-10-07 |\n| G7 | PASS | x | 2026-10-07 |') }, 'P6');
t('P7 Descoped 없음', { ...GOOD, tasks: GOOD.tasks.replace('## Descoped', '## Notes') }, 'P7');
t('P8 세션 역순', { ...GOOD, progress: GOOD.progress.replace('## Session 2026-10-06', '## Session 2026-10-09') }, 'P8');
t('P9 재진입 답 부족', { ...GOOD, progress: GOOD.progress.replace('| 5 | Phase 1 |', '') }, 'P9');
t('P10 Negative Corpus 없음', { ...GOOD, findings: '# Findings\n' }, 'P10');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
