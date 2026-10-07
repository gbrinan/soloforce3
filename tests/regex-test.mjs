// 11개 태그 정규식 공백·대소문자 관용 검증
// 각 케이스: [입력, 기대 매칭 여부, 기대 group1(있으면)]

const REGEXPS = {
  TASK_RE:        () => /<!--\s*TASK\s*:\s*(.*?)\s*-->/gsi,
  WIKI_RE:        () => /<!--\s*WIKI\s*:\s*(.*?)\s*-->/gsi,
  SCHEDULE_RE:    () => /<!--\s*SCHEDULE\s*:\s*(.*?)\s*-->/gsi,
  RESET_RE:       () => /^\s*<!--\s*RESET\s*:\s*(.*?)\s*-->\s*$/gim,
  RESTART_RE:     () => /^\s*<!--\s*RESTART\s*-->\s*$/gim,
  CHECKIN_RE:     () => /^\s*<!--\s*CHECKIN\s*:\s*\d+\s*-->\s*$/gim,
  AUTO_RE:        () => /^\s*<!--\s*AUTO\s*:\s*(on|off)\s*-->\s*$/gim,
  TODO_ADD_RE:    () => /<!--\s*TODO\s*:\s*add\s+(.*?)\s*-->/gsi,
  TODO_DONE_RE:   () => /<!--\s*TODO\s*:\s*done\s+(.*?)\s*-->/gsi,
  TODO_CANCEL_RE: () => /<!--\s*TODO\s*:\s*cancel\s+(.*?)\s*-->/gsi,
  APPROVAL_RE:    () => /<!--\s*APPROVAL\s*:\s*(.*?)\s*-->/gsi,
};

const CASES = [
  // TASK
  ["TASK_RE", '<!--TASK:{"x":1}-->', true, '{"x":1}'],
  ["TASK_RE", '<!-- TASK:{"x":1} -->', true, '{"x":1}'],
  ["TASK_RE", '<!-- TASK : {"x":1} -->', true, '{"x":1}'],
  ["TASK_RE", '<!--task:{"x":1}-->', true, '{"x":1}'],
  // WIKI
  ["WIKI_RE", '<!--WIKI:{"page":"a","content":"b"}-->', true, '{"page":"a","content":"b"}'],
  ["WIKI_RE", '<!-- WIKI: {"page":"a","content":"b"} -->', true, '{"page":"a","content":"b"}'],
  // SCHEDULE
  ["SCHEDULE_RE", '<!--SCHEDULE:2026-04-24 12:00: test-->', true, '2026-04-24 12:00: test'],
  ["SCHEDULE_RE", '<!-- SCHEDULE: 2026-04-24 12:00: test -->', true, '2026-04-24 12:00: test'],
  // RESET (line-solo)
  ["RESET_RE", '<!--RESET:all-->', true, 'all'],
  ["RESET_RE", '<!-- RESET : all -->', true, 'all'],
  ["RESET_RE", 'pre <!--RESET:all-->', false, null],
  // RESTART (line-solo)
  ["RESTART_RE", '<!--RESTART-->', true, null],
  ["RESTART_RE", '<!-- RESTART -->', true, null],
  ["RESTART_RE", '<!--restart-->', true, null],
  ["RESTART_RE", '작업 완료! <!--RESTART-->', false, null], // 같은 라인 텍스트 공존 → 미매칭
  ["RESTART_RE", '<!--RESTART--> 추가 텍스트', false, null],
  // CHECKIN
  ["CHECKIN_RE", '<!--CHECKIN:5-->', true, null],
  ["CHECKIN_RE", '<!-- CHECKIN : 5 -->', true, null],
  // AUTO
  ["AUTO_RE", '<!--AUTO:on-->', true, 'on'],
  ["AUTO_RE", '<!--AUTO:off-->', true, 'off'],
  ["AUTO_RE", '<!-- AUTO : ON -->', true, 'ON'],  // i flag, group1 보존
  ["AUTO_RE", '<!-- AUTO : Off -->', true, 'Off'],
  // TODO
  ["TODO_ADD_RE", '<!--TODO:add hello world-->', true, 'hello world'],
  ["TODO_ADD_RE", '<!-- TODO : add hello world -->', true, 'hello world'],
  ["TODO_DONE_RE", '<!--TODO:done abc123-->', true, 'abc123'],
  ["TODO_DONE_RE", '<!-- TODO : done abc123 -->', true, 'abc123'],
  ["TODO_CANCEL_RE", '<!--TODO:cancel xyz-->', true, 'xyz'],
  ["TODO_CANCEL_RE", '<!-- TODO : cancel xyz -->', true, 'xyz'],
  // APPROVAL
  ["APPROVAL_RE", '<!--APPROVAL:{"id":"1","decision":"allow"}-->', true, '{"id":"1","decision":"allow"}'],
  ["APPROVAL_RE", '<!-- APPROVAL: {"id":"1","decision":"allow"} -->', true, '{"id":"1","decision":"allow"}'],
];

let pass = 0, fail = 0;
for (const [name, input, shouldMatch, expectedGroup1] of CASES) {
  const re = REGEXPS[name]();
  // exec로 group1 확인
  const m = re.exec(input);
  const matched = !!m;
  const g1 = m && m[1] !== undefined ? m[1] : null;
  const ok = matched === shouldMatch && (expectedGroup1 === null || g1 === expectedGroup1);
  const status = ok ? "PASS" : "FAIL";
  if (ok) pass++; else fail++;
  console.log(`[${status}] ${name} | input=${JSON.stringify(input)} | matched=${matched}(expected ${shouldMatch}) | group1=${JSON.stringify(g1)}(expected ${JSON.stringify(expectedGroup1)})`);
}
console.log(`\n=== ${pass}/${pass + fail} PASS, ${fail} FAIL ===`);

// AUTO toLowerCase 분기 검증
console.log("\n--- AUTO 대소문자 분기 검증 ---");
for (const inp of ['<!--AUTO:on-->', '<!--AUTO:off-->', '<!-- AUTO : ON -->', '<!-- AUTO : Off -->']) {
  const m = REGEXPS.AUTO_RE().exec(inp);
  const g1 = m && m[1];
  const decision = g1 && g1.toLowerCase() === "on" ? "ON분기" : "OFF분기";
  console.log(`${JSON.stringify(inp)} → group1="${g1}" → ${decision}`);
}

process.exit(fail > 0 ? 1 : 0);
