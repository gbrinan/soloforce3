// 업무 맥락 블록 검사 — 기본 대상은 실제 값 파일(<MYCREW_HOME>/history/business-context.yaml).
//   npx tsx scripts/business-context-check.ts [--file <yaml>]
// 종료 코드: 0 통과 · 1 형식 오류 · 2 MISS(파일 없음 — «맥락 없음»은 «맥락이 비었음»과 다르다)
// 출력에는 필드 경로와 이유만 — 값(사업 정보)은 찍지 않는다.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HISTORY_DIR } from "../src/config.js";
import { parseBusinessContext } from "../src/shared/business-context.js";

const i = process.argv.indexOf("--file");
const file = i >= 0 ? process.argv[i + 1] : join(HISTORY_DIR, "business-context.yaml");
if (!file || !existsSync(file)) {
  console.error(`MISS: ${file ?? "--file"} 없음 — config/business-context.example.yaml 을 복사해 history/business-context.yaml 로 만드세요.`);
  process.exit(2);
}
const r = parseBusinessContext(readFileSync(file, "utf-8"));
if (!r.ok) {
  for (const e of r.errors) console.log(`FAIL ${e}`);
  console.log(`business-context: FAIL ${r.errors.length}건 (${file})`);
  process.exit(1);
}
console.log(`business-context: PASS — 사업 단위 ${r.data.businessLines.length}개, 연결 범주 ${Object.keys(r.data.connectedTools ?? {}).length}개 (${file})`);
process.exit(0);
