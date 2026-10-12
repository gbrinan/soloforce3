// 모듈 레지스트리 — modules/<id>/module.json(리포) × history/topics/<id>.yaml(값) → 주제별 루프 원본.
// 모듈은 역할 에이전트·스킬·루프 템플릿을 묶는 단위다(docs/domain-pack/spec.md의 «도메인 팩»을 최소 구현).
// 여기서는 루프 «원본 객체»까지만 만든다. 루프 검증·등록은 loops/loader.ts가 한다(순환 import 방지).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { HISTORY_DIR, PROJECT_SELF_DIR } from "../../config.js";
import { parseTopicConfig, type TopicConfig } from "../../shared/topic-config.js";
import { renderTopicContext, renderTopicTemplate, topicVars } from "./topic-render.js";

/** 리포에 실린 모듈. MYCREW_MODULES_DIR로 다른 위치를 줄 수 있다(시험·별도 설치). */
export const MODULES_DIR = process.env.MYCREW_MODULES_DIR || join(PROJECT_SELF_DIR, "modules");
export const TOPICS_DIR = join(HISTORY_DIR, "topics");

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const ModuleManifestSchema = z.object({
  id: z.string().regex(SLUG),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
  /** modules/<id>/agents/<role>/ — 에이전트 레지스트리가 config/agents처럼 읽는다. */
  roles: z.array(z.string().regex(SLUG)).default([]),
  /** modules/<id>/loops/<template>.yaml — 주제마다 <topic>-<template> 루프가 된다. */
  loopTemplates: z.array(z.string().regex(SLUG)).default([]),
  /** modules/<id>/skills/<skill>.md — 스킬-알바 시드. */
  skills: z.array(z.string().regex(SLUG)).default([]),
}).strict();
export type ModuleManifest = z.infer<typeof ModuleManifestSchema> & { dir: string };

export interface LoadIssue { file: string; message: string }

export function loadModules(dir = MODULES_DIR): { modules: ModuleManifest[]; errors: LoadIssue[] } {
  const modules: ModuleManifest[] = [];
  const errors: LoadIssue[] = [];
  if (!existsSync(dir)) return { modules, errors };
  for (const id of readdirSync(dir).sort()) {
    const file = join(dir, id, "module.json");
    if (!existsSync(file)) continue;
    try {
      const m = ModuleManifestSchema.parse(JSON.parse(readFileSync(file, "utf-8")));
      if (m.id !== id) { errors.push({ file, message: `module.id «${m.id}»가 폴더 이름과 다름` }); continue; }
      modules.push({ ...m, dir: join(dir, id) });
    } catch (e) {
      errors.push({ file, message: e instanceof Error ? e.message.split("\n")[0] : String(e) });
    }
  }
  return { modules, errors };
}

export function loadTopics(dir = TOPICS_DIR): { topics: Array<TopicConfig & { file: string }>; errors: LoadIssue[] } {
  const topics: Array<TopicConfig & { file: string }> = [];
  const errors: LoadIssue[] = [];
  if (!existsSync(dir)) return { topics, errors };
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".yaml")).sort()) {
    const file = join(dir, f);
    const r = parseTopicConfig(readFileSync(file, "utf-8"));
    if (!r.ok) { errors.push({ file, message: r.errors.join("; ") }); continue; }
    if (`${r.data.id}.yaml` !== f) { errors.push({ file, message: `주제 id «${r.data.id}»가 파일 이름과 다름` }); continue; }
    topics.push({ ...r.data, file });
  }
  return { topics, errors };
}

/** 문자열 필드만 재귀로 렌더한다. 숫자·불리언·키는 건드리지 않는다. */
function renderDeep(node: unknown, vars: Record<string, string>, missing: Set<string>): unknown {
  if (typeof node === "string") {
    const r = renderTopicTemplate(node, vars);
    r.missing.forEach((k) => missing.add(k));
    return r.text;
  }
  if (Array.isArray(node)) return node.map((x) => renderDeep(x, vars, missing));
  if (node && typeof node === "object") {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, renderDeep(v, vars, missing)]));
  }
  return node;
}

export interface TopicLoopRaw { raw: Record<string, unknown>; file: string; templateFile: string }

/**
 * 활성 주제 × 모듈 루프 템플릿 → 루프 원본. 켜진 템플릿만 만든다.
 * id는 <topic>-<template>, 일정·예산은 주제 설정이 템플릿 기본값을 덮는다.
 * 템플릿이 쓰는 값이 주제에 없으면 그 루프는 만들지 않고 errors에 남긴다.
 */
export function buildTopicLoops(
  modules: ModuleManifest[],
  topics: Array<TopicConfig & { file: string }>,
): { loops: TopicLoopRaw[]; errors: LoadIssue[] } {
  const loops: TopicLoopRaw[] = [];
  const errors: LoadIssue[] = [];
  for (const topic of topics) {
    const vars = topicVars(topic);
    for (const mod of modules) {
      for (const tpl of mod.loopTemplates) {
        const setting = topic.loops[tpl];
        if (!setting?.enabled) continue;
        const templateFile = join(mod.dir, "loops", `${tpl}.yaml`);
        if (!existsSync(templateFile)) { errors.push({ file: templateFile, message: `모듈 ${mod.id}의 루프 템플릿 없음` }); continue; }
        try {
          const parsed = parseYaml(readFileSync(templateFile, "utf-8")) as Record<string, unknown>;
          const base = (parsed.loop ?? parsed) as Record<string, unknown>;
          const missing = new Set<string>();
          const rendered = renderDeep(base, vars, missing) as Record<string, unknown>;
          if (missing.size) {
            errors.push({ file: topic.file, message: `${topic.id}-${tpl}: 주제 설정에 없는 값 ${[...missing].join(", ")}` });
            continue;
          }
          const trigger = { ...(rendered.trigger as Record<string, unknown> | undefined) };
          if (setting.cron) { trigger.type = "cron"; trigger.cron = setting.cron; }
          const budget = { ...(rendered.budget as Record<string, unknown> | undefined) };
          if (setting.maxCostUsdPerRun !== undefined) budget.max_cost_usd_per_run = setting.maxCostUsdPerRun;
          if (setting.monthlyCapUsd !== undefined) budget.monthly_cap_usd = setting.monthlyCapUsd;
          loops.push({
            raw: { ...rendered, id: `${topic.id}-${tpl}`, enabled: true, trigger, budget, topic: topic.id, module: mod.id },
            file: topic.file,
            templateFile,
          });
        } catch (e) {
          errors.push({ file: templateFile, message: e instanceof Error ? e.message.split("\n")[0] : String(e) });
        }
      }
    }
  }
  return { loops, errors };
}

/** 모듈 역할 에이전트 시드 폴더(modules/<id>/agents) — 에이전트 레지스트리가 config/agents 다음으로 스캔한다. */
export function moduleAgentDirs(dir = MODULES_DIR): string[] {
  return loadModules(dir).modules.map((m) => join(m.dir, "agents")).filter((d) => existsSync(d));
}

export interface TopicDelegation {
  agent?: string;
  topic?: string;
  /** 위임 요청 앞에 붙일 주제 맥락 */
  context?: string;
  error?: string;
}

/**
 * 위임의 에이전트·주제를 정한다(순수 — 조회 함수를 받는다).
 * 1) 등록되지 않은 예전 전용 id(예: spf-sales)는 주제 설정 legacyAgents로 «역할 + 주제»가 된다.
 * 2) 모듈 역할로 가는 위임은 주제가 필요하다. 명시가 없고 설정된 주제가 하나뿐이면 그것, 아니면 오류.
 * 3) 주제가 정해지면 맥락 블록을 만든다. 모르는 주제는 오류(기본 주제로 조용히 흘리지 않는다).
 */
export function resolveTopicDelegation(
  input: { agent?: string; topic?: string },
  deps: { isRegistered: (id: string) => boolean; topics: TopicConfig[]; roleIds: Set<string> },
): TopicDelegation {
  let agent = input.agent?.trim() || undefined;
  let topicId = input.topic?.trim() || undefined;
  if (agent && !deps.isRegistered(agent)) {
    const hit = deps.topics.find((t) => t.legacyAgents[agent!]);
    if (hit) {
      if (topicId && topicId !== hit.id) return { error: `topic-conflict: ${agent}는 주제 ${hit.id}의 예전 id인데 topic=${topicId}` };
      topicId = hit.id;
      agent = hit.legacyAgents[agent];
    }
  }
  if (agent && deps.roleIds.has(agent) && !topicId) {
    if (deps.topics.length === 1) topicId = deps.topics[0].id;
    else return { agent, error: `topic-required: ${agent}는 주제 모듈 역할이라 topic이 필요합니다 (가능: ${deps.topics.map((t) => t.id).join(", ") || "주제 설정 없음"})` };
  }
  if (!topicId) return { agent };
  const topic = deps.topics.find((t) => t.id === topicId);
  if (!topic) return { agent, error: `unknown-topic: "${topicId}" (history/topics/${topicId}.yaml 없음)` };
  return { agent, topic: topic.id, context: renderTopicContext(topic) };
}

/** 실제 설치 기준 resolveTopicDelegation. */
export function resolveTopicDelegationLive(input: { agent?: string; topic?: string }, isRegistered: (id: string) => boolean): TopicDelegation {
  const roleIds = new Set(loadModules().modules.flatMap((m) => m.roles));
  return resolveTopicDelegation(input, { isRegistered, topics: loadTopics().topics, roleIds });
}
