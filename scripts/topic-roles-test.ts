// 주제 모듈 역할 테스트 (T3-G1) — 위임의 에이전트·주제 해석, 주제 맥락 블록, 모듈 역할 자동 등록,
// 루프 직접 위임의 topic 전달, QA 외부 발신 목록.
//   npx tsx scripts/topic-roles-test.ts
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";

// 임시 history — 실제 agents.json·topics를 읽지 않는다. 모듈은 리포의 modules/를 그대로 쓴다.
const home = mkdtempSync(join(tmpdir(), "sf-roles-"));
process.env.MYCREW_HOME = home;
mkdirSync(join(home, "history"), { recursive: true });
writeFileSync(join(home, "history", "agents.json"), JSON.stringify({ agents: [] }));

const { parseTopicConfig } = await import("../src/shared/topic-config.js");
const { renderTopicContext } = await import("../src/server/modules/topic-render.js");
const registryMod = await import("../src/server/modules/registry.js");
const { loadModules, MODULES_DIR, resolveTopicDelegation } = registryMod;
const { getWorkerAgent } = await import("../src/agent-registry.js");
const { externalSendSuspected } = await import("../src/server/qa-trigger-policy.js");
const { buildStepPrompt, dispatchDirectDelegate } = await import("../src/server/loops/runner.js");

let n = 0;
const test = async (name: string, fn: () => void | Promise<void>): Promise<void> => { await fn(); n++; console.log(`PASS ${name}`); };

const base = {
  version: 1, name: "에이크미 부품", summary: "부품 수출", knowledgeFile: "topics/acme/knowledge.md",
  sinks: { leads: { kind: "notion", label: "영업 리드", dataSource: "11111111-2222-3333-4444-555555555555" } },
  updatedAt: "2026-10-13",
};
const mk = (o: Record<string, unknown>) => {
  const r = parseTopicConfig(stringify({ ...base, ...o }));
  assert.ok(r.ok, JSON.stringify(r));
  return (r as { ok: true; data: Parameters<typeof renderTopicContext>[0] }).data;
};
const acme = mk({ id: "acme", legacyAgents: { "acme-sales": "topic-sales" }, inputs: { mail: { query: "label:acme" } } });
const beta = mk({ id: "beta", name: "베타", summary: "베타 사업", knowledgeFile: "topics/beta/k.md" });
const roleIds = new Set(["topic-sales", "topic-comms", "topic-logistics", "topic-scout"]);
const registered = new Set(["topic-sales", "lead-keeper"]);
const deps = (topics: typeof acme[], reg = registered) => ({ isRegistered: (id: string) => reg.has(id), topics, roleIds });

await test("예전 전용 id는 «역할 + 주제»로 풀린다", () => {
  const r = resolveTopicDelegation({ agent: "acme-sales" }, deps([acme, beta]));
  assert.equal(r.error, undefined);
  assert.equal(r.agent, "topic-sales");
  assert.equal(r.topic, "acme");
  assert.match(r.context!, /^\[주제: 에이크미 부품 \(acme\)\]/);
});
await test("예전 id가 아직 등록돼 있으면 그쪽이 받는다(전환 중 동작 불변)", () => {
  const r = resolveTopicDelegation({ agent: "acme-sales" }, deps([acme], new Set(["acme-sales"])));
  assert.deepEqual(r, { agent: "acme-sales" });
});
await test("역할 + 명시 주제 → 그 주제 맥락", () => {
  const r = resolveTopicDelegation({ agent: "topic-sales", topic: "beta" }, deps([acme, beta]));
  assert.equal(r.topic, "beta");
  assert.match(r.context!, /정본 지식: history\/topics\/beta\/k\.md/);
});
await test("역할인데 주제 미지정 — 주제가 하나면 그것, 둘 이상이면 거부", () => {
  assert.equal(resolveTopicDelegation({ agent: "topic-sales" }, deps([acme])).topic, "acme");
  assert.match(resolveTopicDelegation({ agent: "topic-sales" }, deps([acme, beta])).error!, /^topic-required/);
  assert.match(resolveTopicDelegation({ agent: "topic-sales" }, deps([])).error!, /주제 설정 없음/);
});
await test("모르는 주제·충돌하는 주제는 거부(기본 주제로 흘리지 않음)", () => {
  assert.match(resolveTopicDelegation({ agent: "topic-sales", topic: "nope" }, deps([acme])).error!, /^unknown-topic/);
  assert.match(resolveTopicDelegation({ agent: "acme-sales", topic: "beta" }, deps([acme, beta])).error!, /^topic-conflict/);
});
await test("주제와 무관한 위임은 그대로(맥락 없음)", () => {
  assert.deepEqual(resolveTopicDelegation({ agent: "lead-keeper" }, deps([acme, beta])), { agent: "lead-keeper" });
  assert.deepEqual(resolveTopicDelegation({}, deps([acme])), { agent: undefined });
});
await test("주제 맥락 블록 — 있는 값만, 없는 값은 줄도 없다", () => {
  const c = renderTopicContext(acme);
  assert.match(c, /리드 기록: Notion "영업 리드" DB\(data_source 11111111-2222-3333-4444-555555555555\)/);
  assert.match(c, /메일 범위: "label:acme" 최근 2일/);
  assert.match(c, /지어내지 말고/);
  assert.doesNotMatch(c, /물류 경고|배송 기록|카톡 수신함|없음\b(?! — 아난)/);
});

await test("리포 모듈 topic-business — 역할 4개 모두 meta.json·role-directive.md, id = 폴더명", () => {
  const { modules, errors } = loadModules(MODULES_DIR);
  assert.deepEqual(errors, []);
  const mod = modules.find((m) => m.id === "topic-business");
  assert.ok(mod, "topic-business 모듈 없음");
  assert.deepEqual([...mod.roles].sort(), [...roleIds].sort());
  for (const role of mod.roles) {
    const dir = join(mod.dir, "agents", role);
    const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf-8"));
    assert.equal(meta.id, role);
    assert.ok(existsSync(join(dir, "role-directive.md")), `${role} role-directive.md 없음`);
    // 역할 지시서는 범용이어야 한다 — 특정 주제의 값이 박혀 있으면 안 된다.
    // 예외: 내용이 주제와 무관한 기존 스킬 2개의 이름(이름 변경은 T4에서 — findings 참고).
    const rd = readFileSync(join(dir, "role-directive.md"), "utf-8").replace(/spf-(comms-classify|next-action)/g, "");
    assert.doesNotMatch(rd, /SPF|HPAI|notion\.com|[0-9a-f]{8}-[0-9a-f]{4}-/i, `${role} 지시서에 주제 고유 값`);
  }
});

await test("에이전트 레지스트리가 모듈 역할을 자동 등록 — meta 권한이 그대로 적용", () => {
  const sales = getWorkerAgent("topic-sales");
  assert.ok(sales, "topic-sales 미등록");
  assert.ok(sales.writePaths?.includes("/history/topics/**"));
  const comms = getWorkerAgent("topic-comms")!;
  assert.deepEqual(comms.bashCommands, ["py", "mv", "mkdir"]);
  assert.deepEqual(comms.bashPaths, ["/history/topics/**"]);
  assert.ok(!comms.allowedTools?.includes("Bash"), "Bash는 bashCommands로만");
  assert.equal(getWorkerAgent("topic-scout")?.adapter, "antigravity-cli");
});

await test("라우트가 쓰는 실제 조합 — history/topics + 모듈 역할 + 레지스트리", () => {
  const { resolveTopicDelegationLive } = registryMod;
  const isReg = (id: string) => !!getWorkerAgent(id);
  assert.match(resolveTopicDelegationLive({ agent: "topic-sales" }, isReg).error!, /주제 설정 없음/, "주제 파일 없으면 거부");
  mkdirSync(join(home, "history", "topics"), { recursive: true });
  writeFileSync(join(home, "history", "topics", "acme.yaml"),
    stringify({ ...base, id: "acme", legacyAgents: { "acme-sales": "topic-sales" } }));
  const viaAlias = resolveTopicDelegationLive({ agent: "acme-sales" }, isReg);
  assert.equal(viaAlias.agent, "topic-sales");
  assert.equal(viaAlias.topic, "acme");
  assert.equal(resolveTopicDelegationLive({ agent: "topic-sales" }, isReg).topic, "acme", "주제 하나면 자동");
  assert.equal(resolveTopicDelegationLive({ agent: "lead-keeper" }, isReg).context, undefined);
});

await test("QA 외부 발신 목록에 주제 역할 포함", () => {
  for (const id of ["topic-sales", "topic-comms", "topic-logistics"]) assert.equal(externalSendSuspected(id, ""), true, id);
});

await test("루프 직접 위임 — 주제 루프는 body에 topic, 지니 경유 스텝은 프롬프트로", async () => {
  const def = { id: "acme-daily-brief", topic: "acme", steps: [] } as unknown as Parameters<typeof buildStepPrompt>[0];
  const sent: Array<Record<string, unknown>> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ jobId: "j1" }), { status: 200 });
  }) as typeof fetch;
  try {
    await dispatchDirectDelegate(def, { id: "s1", agent: "topic-sales", prompt: "브리핑" } as never, "topic-sales", "inst-1");
    await dispatchDirectDelegate({ ...def, topic: undefined } as never, { id: "s1", prompt: "x" } as never, "lead-keeper", "inst-2");
  } finally { globalThis.fetch = realFetch; }
  assert.equal(sent[0].topic, "acme");
  assert.ok(!("topic" in sent[1]), "주제 없는 루프는 topic 필드 없음");
  assert.doesNotMatch(String(sent[0].request), /\[주제\]/, "직접 위임엔 프롬프트 안내 불필요");
  assert.match(buildStepPrompt(def, { id: "s2", prompt: "y" } as never), /DelegateTask에 topic: "acme"/);
});

console.log(`topic-roles: ${n} passed, 0 failed`);
process.exit(0);
