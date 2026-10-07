// 수집 전용 에이전트 QA 표본 제외 회귀 시험 (2026-10-02)
import { decideQa } from "../src/server/qa-trigger-policy.ts";
let fail = 0;
const base = { request: "자료 정리", nowIso: "2026-10-02T00:00:00Z", lastSampleAtIso: undefined, jobScopedCodeChanges: 0 } as any;
const ok = (name: string, cond: boolean) => { console.log((cond ? "PASS " : "FAIL ") + name); if (!cond) fail++; };
for (const a of ["ingestiger", "spf-kakao-collect", "mail-secretary"]) ok(`${a} 표본 제외`, decideQa({ ...base, agentId: a }).run === false);
ok("repo-scout는 표본 유지", decideQa({ ...base, agentId: "repo-scout" }).run === true);
ok("ingestiger 코드 변경이면 QA", decideQa({ ...base, agentId: "ingestiger", jobScopedCodeChanges: 2 }).run === true);
ok("ingestiger forceQa면 QA", decideQa({ ...base, agentId: "ingestiger", forceQa: true }).run === true);
process.exit(fail ? 1 : 0);
