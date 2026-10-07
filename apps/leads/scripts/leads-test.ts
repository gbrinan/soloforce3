// leads-db.ts 단위 테스트 — repo 관례(PASS/FAIL 라인 + 실패 시 exit 1)를 따르는 단순 스크립트.
// 실행: npx tsx scripts/leads-test.ts
// LEADS_DB_PATH 환경변수로 임시 DB를 사용한다 (import 전에 설정 필요).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpDir = mkdtempSync(join(tmpdir(), "leads-test-"));
process.env.LEADS_DB_PATH = join(tmpDir, "leads-test.sqlite");

import {
  getDb,
  closeDb,
  createPipeline,
  listPipelines,
  listStages,
  firstStageOf,
  createLead,
  getLead,
  listLeads,
  listRottingLeads,
  moveLeadStage,
  listEvents,
  captureInbound,
} from "../src/lib/leads-db";

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`PASS ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// --- seed: 기본 파이프라인 + 4 스테이지 ---
getDb();
const seeded = listPipelines();
check("seed: 기본 파이프라인 1개", seeded.length === 1 && seeded[0].name === "기본");
const seededStages = listStages(seeded[0].id);
check(
  "seed: 스테이지 4종 순서",
  seededStages.map((s) => s.name).join(",") === "문의,미팅,견적,계약완료",
  seededStages.map((s) => s.name).join(","),
);
check(
  "seed: rotting_days 7,7,7,null",
  seededStages.map((s) => s.rotting_days).join(",") === "7,7,7,",
  seededStages.map((s) => String(s.rotting_days)).join(","),
);

// --- 파이프라인 생성이 기본 스테이지 4종 시드 ---
const p2 = createPipeline("AI 교육", "커리큘럼 A");
const p2Stages = listStages(p2.id);
check("createPipeline: 스테이지 4개 자동 생성", p2Stages.length === 4);
check(
  "createPipeline: sort 1..4",
  p2Stages.map((s) => s.sort).join(",") === "1,2,3,4",
  p2Stages.map((s) => s.sort).join(","),
);
check(
  "createPipeline: 계약완료만 rotting_days null",
  p2Stages[3].rotting_days === null && p2Stages.slice(0, 3).every((s) => s.rotting_days === 7),
);

// --- 인바운드 웹훅: 첫 스테이지 착지 + inbound 이벤트 ---
const inboundDefault = captureInbound({ title: "웹폼 문의", source: "website" });
check(
  "inbound: 파이프라인 미지정 시 기본 파이프라인",
  inboundDefault.pipeline_id === seeded[0].id,
);
check(
  "inbound: 첫 스테이지(문의) 착지",
  inboundDefault.stage_id === firstStageOf(seeded[0].id)?.id,
);
const inboundEvents = listEvents(inboundDefault.id);
check(
  "inbound: inbound 이벤트 기록",
  inboundEvents.length === 1 && inboundEvents[0].type === "inbound",
);
const inboundP2 = captureInbound({ title: "SNS 문의", source: "sns", pipelineId: p2.id, contactName: "김담당" });
check("inbound: 지정 파이프라인의 첫 스테이지", inboundP2.stage_id === p2Stages[0].id);
check("inbound: contactName 저장", getLead(inboundP2.id)?.contact_name === "김담당");
let inboundError = "";
try {
  captureInbound({ title: "x", source: "manual", pipelineId: "no-such-id" });
} catch (e) {
  inboundError = (e as Error).message;
}
check("inbound: 없는 파이프라인은 에러", inboundError === "pipeline not found");

// --- 스테이지 이동: stage_changed_at 갱신 + stage_change 이벤트 ---
const before = getLead(inboundDefault.id)!;
// ISO 타임스탬프 변화 보장 (tsx CJS 변환에서 top-level await 미지원 → 동기 대기)
const waitUntil = Date.now() + 20;
while (Date.now() < waitUntil) { /* busy wait */ }
const moved = moveLeadStage(inboundDefault.id, seededStages[1].id);
check("move: stage_id 갱신", moved.stage_id === seededStages[1].id);
check(
  "move: stage_changed_at 갱신",
  new Date(moved.stage_changed_at).getTime() > new Date(before.stage_changed_at).getTime(),
  `${before.stage_changed_at} → ${moved.stage_changed_at}`,
);
const movedEvents = listEvents(inboundDefault.id);
const stageChange = movedEvents.find((e) => e.type === "stage_change");
check("move: stage_change 이벤트 기록", stageChange != null && stageChange.body.includes("미팅"));
let crossError = "";
try {
  moveLeadStage(inboundDefault.id, p2Stages[0].id);
} catch (e) {
  crossError = (e as Error).message;
}
check("move: 타 파이프라인 스테이지 거부", crossError === "stage belongs to another pipeline");

// --- rotting 계산: 오래된 stage_changed_at 직접 주입 ---
const rotLead = createLead({
  pipeline_id: seeded[0].id,
  stage_id: seededStages[0].id, // rotting_days = 7
  title: "정체 리드",
  source: "manual",
});
const oldTs = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(); // 8일 전
getDb().prepare("UPDATE leads SET stage_changed_at = ? WHERE id = ?").run(oldTs, rotLead.id);
const withRotting = listLeads(seeded[0].id);
const rot = withRotting.find((l) => l.id === rotLead.id);
check("rotting: 8일 정체 → rotting=true", rot?.rotting === true);
const fresh = withRotting.find((l) => l.id === inboundDefault.id);
check("rotting: 최근 이동 리드 → rotting=false", fresh?.rotting === false);
const doneLead = createLead({
  pipeline_id: seeded[0].id,
  stage_id: seededStages[3].id, // 계약완료: rotting_days null
  title: "계약완료 리드",
  source: "manual",
});
getDb().prepare("UPDATE leads SET stage_changed_at = ? WHERE id = ?").run(oldTs, doneLead.id);
const done = listLeads(seeded[0].id).find((l) => l.id === doneLead.id);
check("rotting: rotting_days null 스테이지는 항상 false", done?.rotting === false);
const rottingAll = listRottingLeads();
check(
  "rotting: /api/rotting 대상 목록",
  rottingAll.some((l) => l.id === rotLead.id) && !rottingAll.some((l) => l.id === doneLead.id),
);

// --- 파이프라인 격리: A의 리드가 B 조회에 안 섞임 ---
const aLeads = listLeads(seeded[0].id);
const bLeads = listLeads(p2.id);
check("isolation: A 필터에 A 리드만", aLeads.every((l) => l.pipeline_id === seeded[0].id) && aLeads.length >= 3);
check("isolation: B 필터에 B 리드만", bLeads.every((l) => l.pipeline_id === p2.id) && bLeads.length === 1);
check(
  "isolation: A 리드가 B에 미포함",
  !bLeads.some((l) => l.id === inboundDefault.id || l.id === rotLead.id),
);

console.log(`\n${pass} passed, ${fail} failed`);
closeDb();
try {
  rmSync(tmpDir, { recursive: true, force: true });
} catch {
  // Windows에서 WAL 파일 잠금이 남을 수 있음 — 임시 폴더라 무시.
}
if (fail > 0) process.exit(1);
