// 벤더 정산(지급일 산정) 규칙 — 회귀 테스트
// 검증: 엑스퍼트컨설팅 규칙 등록(실제 저장소 왕복) → 검산 예시 4건 end-to-end,
//       경계/연도 롤오버/말일 클램프/오류 케이스.
// 실행: tsx scripts/vendor-settlement-test.ts  (실제 HISTORY_DIR에 규칙을 등록한다 — 멱등)
import {
  registerExpertConsultingRule,
  registerSpartaRule,
  getPayoutDate,
  computePayoutDate,
  getVendorRule,
} from "../src/server/vendor-settlement.js";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`[PASS] ${name}`); pass++; }
  else { console.log(`[FAIL] ${name}${detail ? " — " + detail : ""}`); fail++; }
}

// ① 규칙 등록 (실제 저장소에 기록, 멱등)
const saved = registerExpertConsultingRule();
check("① 규칙 등록 완료 (엑스퍼트컨설팅)",
  saved.vendorName === "엑스퍼트컨설팅" && getVendorRule("expert-consulting") !== null);
check("① 등록 규칙 basis = lecture_end_date(강의 종료일)",
  getVendorRule("expert-consulting")?.basis === "lecture_end_date");

// ② 검산 예시 — 저장소에서 읽어 지급일 산정 (등록→조회→산정 end-to-end)
const cases: Array<[string, string, string]> = [
  ["2026-08-10", "2026-09-20", "규칙 A (1~15일 → 익월 20일)"],
  ["2026-08-25", "2026-10-05", "규칙 B (16~말일 → 익익월 5일)"],
  ["2026-08-15", "2026-09-20", "15일은 규칙 A 경계"],
  ["2026-08-16", "2026-10-05", "16일은 규칙 B 경계"],
];
for (const [end, expect, note] of cases) {
  const got = getPayoutDate("expert-consulting", end);
  check(`② 종료일 ${end} → 지급일 ${expect}  [${note}]`, got === expect, `got=${got}`);
}

// ③ 추가 검증 — 연도 롤오버 / 말일 / 윤년 (순수 함수)
const rule = getVendorRule("expert-consulting")!;
const extra: Array<[string, string, string]> = [
  ["2026-12-10", "2027-01-20", "규칙 A 익월 연도 롤오버"],
  ["2026-11-25", "2027-01-05", "규칙 B 익익월 연도 롤오버"],
  ["2026-12-20", "2027-02-05", "규칙 B 12월 → 익년 2월"],
  ["2026-01-01", "2026-02-20", "하한 경계(1일)"],
  ["2026-02-28", "2026-04-05", "2월 말일(28) → 익익월 5일"],
  ["2024-02-29", "2024-04-05", "윤년 말일(29) → 익익월 5일"],
  ["2026-01-31", "2026-03-05", "31일 종료 → 익익월 5일"],
];
for (const [end, expect, note] of extra) {
  const got = computePayoutDate(end, rule);
  check(`③ 종료일 ${end} → ${expect}  [${note}]`, got === expect, `got=${got}`);
}

// ④ 오류 케이스 — 잘못된 입력은 예외
let threw = false;
try { computePayoutDate("2026-13-01", rule); } catch { threw = true; }
check("④ 잘못된 월(13) → 예외 발생", threw);
threw = false;
try { computePayoutDate("2026-02-30", rule); } catch { threw = true; }
check("④ 2월 30일(존재하지 않는 일자) → 예외 발생", threw);
threw = false;
try { computePayoutDate("2026/08/10", rule); } catch { threw = true; }
check("④ 잘못된 형식(YYYY/MM/DD) → 예외 발생", threw);

// ⑤ 스파르타 규칙 — 등록 + 검산 (분기 없음, 무조건 익월 10일)
const spartaSaved = registerSpartaRule();
check("⑤ 스파르타 규칙 등록 완료",
  spartaSaved.vendorName === "스파르타" && getVendorRule("sparta") !== null);
check("⑤ 두 벤더(엑스퍼트컨설팅+스파르타) 저장소 공존",
  getVendorRule("expert-consulting") !== null && getVendorRule("sparta") !== null);

const spartaCases: Array<[string, string, string]> = [
  ["2026-08-03", "2026-09-10", "익월 10일"],
  ["2026-08-28", "2026-09-10", "며칠이든 동일 (16일+ 분기 없음)"],
  ["2026-12-20", "2027-01-10", "연도 롤오버"],
  ["2026-08-01", "2026-09-10", "하한 경계(1일)"],
  ["2026-08-31", "2026-09-10", "말일(31)도 동일 구간"],
  ["2026-12-31", "2027-01-10", "12월 말일 → 익년 1월 10일"],
];
for (const [end, expect, note] of spartaCases) {
  const got = getPayoutDate("sparta", end);
  check(`⑤ 종료일 ${end} → 지급일 ${expect}  [${note}]`, got === expect, `got=${got}`);
}

console.log(`\n=== ${pass}/${pass + fail} PASS, ${fail} FAIL ===`);
process.exit(fail === 0 ? 0 : 1);
