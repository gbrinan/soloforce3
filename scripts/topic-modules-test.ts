// 주제 모듈 로더 테스트 (T2-G1) — 템플릿 렌더, 모듈×주제 → 루프, 실제 loadLoops 통합(파일 루프 우선).
//   npx tsx scripts/topic-modules-test.ts
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";

// 임시 설치 — 모듈 폴더·history·loops를 모두 격리한다(실제 config/loops 미사용).
const home = mkdtempSync(join(tmpdir(), "sf-modules-"));
const modulesDir = join(home, "modules");
process.env.MYCREW_HOME = home;
process.env.MYCREW_MODULES_DIR = modulesDir;

const { describeSink, renderTopicTemplate, topicVars } = await import("../src/server/modules/topic-render.js");
const { buildTopicLoops, loadModules, loadTopics } = await import("../src/server/modules/registry.js");
const { loadLoops } = await import("../src/server/loops/loader.js");
const { parseTopicConfig } = await import("../src/shared/topic-config.js");

let n = 0;
const test = (name: string, fn: () => void): void => { fn(); n++; console.log(`PASS ${name}`); };

const topicYaml = {
  version: 1, id: "acme", name: "에이크미 부품", summary: "부품 수출", knowledgeFile: "topics/acme/knowledge.md",
  sectors: [{ id: "A" }, { id: "B" }],
  news: { categories: [{ name: "관세", urgency: "CRITICAL", sectors: ["A"] }, { name: "경쟁사 증설", urgency: "WATCH" }], competitors: ["X사", "Y사"] },
  sinks: {
    leads: { kind: "notion", label: "영업 리드", dataSource: "11111111-2222-3333-4444-555555555555" },
    news: { kind: "leads-app", label: "뉴스", pipelineId: "acme-news" },
  },
  inputs: { mail: { query: "label:acme", windowDays: 3 } },
  loops: {
    "daily-brief": { enabled: true, cron: "40 8 * * 1-5" },
    "mail-scan": { enabled: true, cron: "20 8 * * 1-5", maxCostUsdPerRun: 0.5, monthlyCapUsd: 5 },
    "weekly-news": { enabled: false },
  },
  updatedAt: "2026-10-13",
};
const parsed = parseTopicConfig(stringify(topicYaml));
assert.ok(parsed.ok, JSON.stringify(parsed));
const topic = (parsed as { ok: true; data: Parameters<typeof topicVars>[0] }).data;

test("저장 위치를 문장으로 — Notion은 data_source, 로컬 CRM은 파이프라인", () => {
  assert.equal(describeSink(topic.sinks.leads), 'Notion "영업 리드" DB(data_source 11111111-2222-3333-4444-555555555555)');
  assert.match(describeSink(topic.sinks.news!), /apps\/leads 파이프라인 "acme-news"/);
});
test("템플릿 값 — 경로는 history/ 기준, 목록은 이어 붙임", () => {
  const v = topicVars(topic);
  assert.equal(v["topic.knowledgeFile"], "history/topics/acme/knowledge.md");
  assert.equal(v["topic.news.competitors"], "X사·Y사");
  assert.equal(v["topic.news.urgencyMap"], "관세 → A CRITICAL, 경쟁사 증설 → WATCH");
  assert.equal(v["topic.sectors"], "A/B");
  assert.equal(v["topic.mail.windowDays"], "3");
  assert.ok(!("topic.logistics.alertVerdicts" in v), "설정에 없는 값은 키도 없다");
});
test("렌더 — 없는 키는 그대로 두고 missing으로", () => {
  const r = renderTopicTemplate("[{{topic.name}}] {{ topic.mail.query }} / {{topic.logistics.alertVerdicts}}", topicVars(topic));
  assert.equal(r.text, "[에이크미 부품] label:acme / {{topic.logistics.alertVerdicts}}");
  assert.deepEqual(r.missing, ["topic.logistics.alertVerdicts"]);
});

// 임시 모듈: daily-brief·mail-scan·weekly-news·logi-watch 템플릿
const mdir = join(modulesDir, "topic-business");
mkdirSync(join(mdir, "loops"), { recursive: true });
writeFileSync(join(mdir, "module.json"), JSON.stringify({
  id: "topic-business", name: "주제 영업", version: "0.0.1",
  roles: ["topic-sales"], loopTemplates: ["daily-brief", "mail-scan", "weekly-news", "logi-watch"],
}));
const tpl = (id: string, prompt: string) => stringify({ loop: {
  id, description: `{{topic.name}} ${id}`, trigger: { type: "cron", cron: "0 9 * * 1" },
  steps: [{ id: "s1", agent: "topic-sales", prompt }], budget: { max_cost_usd_per_run: 1, monthly_cap_usd: 10 },
} });
writeFileSync(join(mdir, "loops", "daily-brief.yaml"), tpl("daily-brief", "[{{topic.name}} 아침 브리핑] {{topic.sinks.leads}}"));
writeFileSync(join(mdir, "loops", "mail-scan.yaml"), tpl("mail-scan", '"{{topic.mail.query}} newer_than:{{topic.mail.windowDays}}d" 조회'));
writeFileSync(join(mdir, "loops", "weekly-news.yaml"), tpl("weekly-news", "{{topic.news.categories}}"));
writeFileSync(join(mdir, "loops", "logi-watch.yaml"), tpl("logi-watch", "{{topic.logistics.alertVerdicts}}"));

test("모듈 선언을 읽는다", () => {
  const { modules, errors } = loadModules(modulesDir);
  assert.deepEqual(errors, []);
  assert.deepEqual(modules.map((m) => m.id), ["topic-business"]);
});

test("모듈 × 주제 → 켜진 템플릿만 루프로, 일정·예산은 주제 설정이 덮는다", () => {
  const { modules } = loadModules(modulesDir);
  const { loops, errors } = buildTopicLoops(modules, [{ ...topic, file: "acme.yaml" }]);
  assert.deepEqual(errors, []);
  assert.deepEqual(loops.map((l) => l.raw.id).sort(), ["acme-daily-brief", "acme-mail-scan"]);
  const mail = loops.find((l) => l.raw.id === "acme-mail-scan")!.raw as any;
  assert.equal(mail.trigger.cron, "20 8 * * 1-5");
  assert.equal(mail.budget.max_cost_usd_per_run, 0.5);
  assert.equal(mail.budget.monthly_cap_usd, 5);
  assert.equal(mail.steps[0].prompt, '"label:acme newer_than:3d" 조회');
  assert.equal(mail.description, "에이크미 부품 mail-scan");
  assert.equal(mail.topic, "acme");
});

test("켠 템플릿이 주제에 없는 값을 쓰면 루프를 만들지 않고 오류", () => {
  const { modules } = loadModules(modulesDir);
  const withLogi = { ...topic, loops: { ...topic.loops, "logi-watch": { enabled: true } }, file: "acme.yaml" };
  const { loops, errors } = buildTopicLoops(modules, [withLogi]);
  assert.ok(!loops.some((l) => l.raw.id === "acme-logi-watch"));
  assert.match(errors.map((e) => e.message).join(), /acme-logi-watch: 주제 설정에 없는 값 topic\.logistics\.alertVerdicts/);
});

test("주제 파일 이름과 id가 다르면 거부", () => {
  const tdir = join(home, "history", "topics-mismatch");
  mkdirSync(tdir, { recursive: true });
  writeFileSync(join(tdir, "other.yaml"), stringify(topicYaml));
  const { topics, errors } = loadTopics(tdir);
  assert.equal(topics.length, 0);
  assert.match(errors[0].message, /파일 이름과 다름/);
});

test("실제 loadLoops 통합 — 주제 루프 등록, 같은 id 파일 루프가 있으면 파일 우선", () => {
  mkdirSync(join(home, "history", "topics"), { recursive: true });
  writeFileSync(join(home, "history", "topics", "acme.yaml"), stringify(topicYaml));
  mkdirSync(join(home, "loops"), { recursive: true });
  writeFileSync(join(home, "loops", "acme-daily-brief.yaml"), stringify({ loop: {
    id: "acme-daily-brief", description: "손으로 만든 기존 루프", trigger: { type: "cron", cron: "0 7 * * *" },
    steps: [{ id: "x", prompt: "기존" }],
  } }));
  const { loops, errors } = loadLoops();
  const brief = loops.find((l) => l.id === "acme-daily-brief")!;
  assert.equal(brief.description, "손으로 만든 기존 루프", "파일 루프가 이긴다");
  assert.equal(brief.topic, undefined);
  const mail = loops.find((l) => l.id === "acme-mail-scan")!;
  assert.equal(mail.topic, "acme");
  assert.equal(mail.module, "topic-business");
  assert.equal(mail.trigger.cron, "20 8 * * 1-5");
  assert.match(errors.map((e) => e.message).join(), /acme-daily-brief.*파일 루프 우선/);
});

console.log(`topic-modules: ${n} passed, 0 failed`);
process.exit(0);
