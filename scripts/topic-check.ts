// 주제 설정 검사 — 기본 대상은 실제 값 파일(<MYCREW_HOME>/history/topics/*.yaml) 전부.
//   npx tsx scripts/topic-check.ts [--file <yaml>]
// 종료 코드: 0 통과 · 1 형식 오류 · 2 MISS(대상 없음)
// 출력에는 필드 경로와 이유만 — 값(사업 정보)은 찍지 않는다.
// 업무 맥락(history/business-context.yaml)이 있으면 주제 id가 businessLines에 있는지도 본다(없으면 WARN).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HISTORY_DIR } from "../src/config.js";
import { parseTopicConfig } from "../src/shared/topic-config.js";
import { parseBusinessContext } from "../src/shared/business-context.js";

const i = process.argv.indexOf("--file");
const topicsDir = join(HISTORY_DIR, "topics");
const files = i >= 0
  ? [process.argv[i + 1]].filter(Boolean)
  : existsSync(topicsDir) ? readdirSync(topicsDir).filter((f) => f.endsWith(".yaml")).map((f) => join(topicsDir, f)) : [];
if (files.length === 0 || files.some((f) => !existsSync(f))) {
  console.error(`MISS: 주제 설정 없음 — config/topics/example.topic.yaml 을 복사해 history/topics/<id>.yaml 로 만드세요.`);
  process.exit(2);
}

const bcFile = join(HISTORY_DIR, "business-context.yaml");
const bc = existsSync(bcFile) ? parseBusinessContext(readFileSync(bcFile, "utf-8")) : null;
const lineIds = bc?.ok ? new Set(bc.data.businessLines.map((l) => l.id)) : null;

let fails = 0;
for (const f of files) {
  const r = parseTopicConfig(readFileSync(f, "utf-8"));
  if (!r.ok) {
    fails++;
    for (const e of r.errors) console.log(`FAIL ${f}: ${e}`);
    continue;
  }
  const on = Object.entries(r.data.loops).filter(([, v]) => v.enabled).map(([k]) => k);
  console.log(`PASS ${f} — 주제 ${r.data.id}, 켜진 루프 ${on.length}개`);
  if (i < 0 && lineIds && !lineIds.has(r.data.id)) console.log(`WARN ${f}: 업무 맥락 businessLines에 «${r.data.id}» 없음`);
}
console.log(`topic-check: ${files.length}개 · FAIL ${fails}`);
process.exit(fails > 0 ? 1 : 0);
