// rules.ts 단위 테스트 — repo 관례(PASS/FAIL 라인 + 실패 시 exit 1)를 따르는 단순 스크립트.
// 실행: npx tsx scripts/rules-test.ts

import { nextOccurrence, occurrencesInMonth, isValidRule, toDateString } from "../src/lib/rules";

let pass = 0;
let fail = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
    console.log(`PASS ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name} — expected ${e}, got ${a}`);
  }
}

function d(s: string): Date {
  const [y, m, day] = s.split("-").map(Number);
  return new Date(y, m - 1, day);
}

// --- monthly ---
check("monthly: same month, before day", toDateString(nextOccurrence("monthly:25", d("2026-07-10"))), "2026-07-25");
check("monthly: on the day → next month", toDateString(nextOccurrence("monthly:25", d("2026-07-25"))), "2026-08-25");
check("monthly: after day → next month", toDateString(nextOccurrence("monthly:25", d("2026-07-26"))), "2026-08-25");
check("monthly: year rollover", toDateString(nextOccurrence("monthly:5", d("2026-12-20"))), "2027-01-05");
check("monthly:31 clamps to Feb 28", toDateString(nextOccurrence("monthly:31", d("2026-02-01"))), "2026-02-28");
check("monthly:31 clamps to leap Feb 29", toDateString(nextOccurrence("monthly:31", d("2028-02-01"))), "2028-02-29");
check("monthly:1 from mid-month", toDateString(nextOccurrence("monthly:1", d("2026-07-12"))), "2026-08-01");

// --- yearly ---
check("yearly: before date this year", toDateString(nextOccurrence("yearly:03-15", d("2026-01-10"))), "2026-03-15");
check("yearly: on the date → next year", toDateString(nextOccurrence("yearly:03-15", d("2026-03-15"))), "2027-03-15");
check("yearly: after date → next year", toDateString(nextOccurrence("yearly:03-15", d("2026-07-12"))), "2027-03-15");
check("yearly: Feb 29 clamps in non-leap", toDateString(nextOccurrence("yearly:02-29", d("2026-01-01"))), "2026-02-28");

// --- weekly ---
// 2026-07-12 is a Sunday
check("weekly: sun → next mon", toDateString(nextOccurrence("weekly:mon", d("2026-07-12"))), "2026-07-13");
check("weekly: same weekday → +7", toDateString(nextOccurrence("weekly:sun", d("2026-07-12"))), "2026-07-19");
check("weekly: fri from sunday", toDateString(nextOccurrence("weekly:fri", d("2026-07-12"))), "2026-07-17");

// --- occurrencesInMonth ---
check(
  "occurrences: monthly in month",
  occurrencesInMonth("monthly:25", "2026-07").map(toDateString),
  ["2026-07-25"],
);
check("occurrences: yearly wrong month", occurrencesInMonth("yearly:03-15", "2026-07").map(toDateString), []);
check(
  "occurrences: yearly matching month",
  occurrencesInMonth("yearly:03-15", "2026-03").map(toDateString),
  ["2026-03-15"],
);
check(
  "occurrences: weekly count in 2026-07 (mondays)",
  occurrencesInMonth("weekly:mon", "2026-07").map(toDateString),
  ["2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27"],
);

// --- validation ---
check("isValidRule: good rules", [isValidRule("monthly:25"), isValidRule("yearly:03-15"), isValidRule("weekly:mon")], [true, true, true]);
check(
  "isValidRule: bad rules",
  [isValidRule("monthly:0"), isValidRule("monthly:32"), isValidRule("yearly:13-01"), isValidRule("weekly:xyz"), isValidRule("daily:1"), isValidRule("")],
  [false, false, false, false, false, false],
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
