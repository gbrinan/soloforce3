// 주제 템플릿 렌더러 — 루프 템플릿·역할 지시서의 {{topic.<키>}} 자리를 주제 설정 값으로 채운다(순수 함수).
// 템플릿이 쓰는 키가 주제 설정에 없으면 조용히 빈칸으로 두지 않고 missing으로 돌려준다 —
// 빈칸으로 렌더된 프롬프트는 «없는 저장 위치에 기록하라» 같은 지시가 되어 조용히 실패한다.
import type { TopicConfig, TopicSink } from "../../shared/topic-config.js";

/** 저장 위치를 에이전트가 바로 쓸 수 있는 문장으로. */
export function describeSink(s: TopicSink): string {
  return s.kind === "notion"
    ? `Notion "${s.label}" DB(data_source ${s.dataSource})`
    : `apps/leads 파이프라인 "${s.pipelineId}"(${s.label}, lead-keeper API 경유)`;
}

const historyPath = (rel: string): string => `history/${rel}`;
const bullets = (items: string[]): string => items.map((x) => `- ${x}`).join("\n");

/** 템플릿에서 쓸 수 있는 키 → 값. 주제 설정에 없는 값은 키 자체를 넣지 않는다(missing으로 잡히게). */
export function topicVars(t: TopicConfig): Record<string, string> {
  const v: Record<string, string> = {
    "topic.id": t.id,
    "topic.name": t.name,
    "topic.summary": t.summary,
    "topic.knowledgeFile": historyPath(t.knowledgeFile),
    "topic.sinks.leads": describeSink(t.sinks.leads),
  };
  if (t.docStyleFile) v["topic.docStyleFile"] = historyPath(t.docStyleFile);
  if (t.sinks.shipments) v["topic.sinks.shipments"] = describeSink(t.sinks.shipments);
  if (t.sinks.news) {
    v["topic.sinks.news"] = describeSink(t.sinks.news);
    if (t.sinks.news.kind === "notion" && t.sinks.news.url) v["topic.sinks.news.url"] = t.sinks.news.url;
  }
  if (t.sectors?.length) v["topic.sectors"] = t.sectors.map((s) => s.id).join("/");
  if (t.news) {
    v["topic.news.categories"] = t.news.categories.map((c) => c.name).join(", ");
    v["topic.news.urgencyMap"] = t.news.categories
      .map((c) => `${c.name} → ${c.sectors?.length ? `${c.sectors.join("·")} ` : ""}${c.urgency}`).join(", ");
    if (t.news.competitors.length) v["topic.news.competitors"] = t.news.competitors.join("·");
    if (t.news.rules.length) v["topic.news.rules"] = bullets(t.news.rules);
  }
  if (t.inputs.mail) {
    v["topic.mail.query"] = t.inputs.mail.query;
    v["topic.mail.windowDays"] = String(t.inputs.mail.windowDays);
  }
  if (t.inputs.kakao) v["topic.kakao.inboxDir"] = historyPath(t.inputs.kakao.inboxDir);
  if (t.logistics) {
    v["topic.logistics.alertVerdicts"] = t.logistics.alertVerdicts.join("/");
    if (t.logistics.holdStages.length) v["topic.logistics.holdStages"] = t.logistics.holdStages.join("/");
    if (t.logistics.rules.length) v["topic.logistics.rules"] = bullets(t.logistics.rules);
  }
  if (t.consoleUrl) v["topic.consoleUrl"] = t.consoleUrl;
  return v;
}

const PLACEHOLDER = /\{\{\s*(topic\.[\w.]+)\s*\}\}/g;

/** {{topic.x}}를 채운다. 없는 키는 그대로 두고 missing에 모은다(호출자가 거부한다). */
export function renderTopicTemplate(text: string, vars: Record<string, string>): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const out = text.replace(PLACEHOLDER, (whole, key: string) => {
    if (key in vars) return vars[key];
    missing.add(key);
    return whole;
  });
  return { text: out, missing: [...missing] };
}
