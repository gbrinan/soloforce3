// 주제 설정 — 사업 주제 하나(예: SPF)의 영업·소통·물류·뉴스 정찰에 필요한 값을 한 파일에 모은다.
// 형식(이 스키마·예시·검사기)은 리포에, 실제 값은 `history/topics/<id>.yaml`(gitignore)에 둔다 —
// 거래처·경쟁사·Notion ID·메일 라벨은 사업 정보라 공개 리포에 올리지 않는다.
// 주제 id는 업무 맥락(business-context.ts)의 businessLines[].id와 같아야 한다.
// 모듈(modules/<id>/module.json)의 역할·루프 템플릿이 이 값을 읽어 주제별로 돈다(docs/topic-modules).
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** history/ 아래 상대 경로만 — 절대 경로·상위 이동 금지(주제 파일이 임의 파일을 가리키지 못하게). */
const HISTORY_REL = /^(?!\/)(?!.*\.\.)[\w./-]+$/;
/** 5필드 cron(분 시 일 월 요일). 세부 문법은 루프 로더가 다시 검사한다. */
const CRON5 = /^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/;

export const URGENCIES = ["CRITICAL", "HIGH", "WATCH"] as const;

const Sink = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("notion"),
    label: z.string().min(1),
    dataSource: z.string().regex(UUID, "Notion data_source UUID"),
    url: z.string().url().optional(),
  }).strict(),
  z.object({
    kind: z.literal("leads-app"),
    label: z.string().min(1),
    pipelineId: z.string().min(1),
  }).strict(),
]);

const LoopSetting = z.object({
  enabled: z.boolean(),
  cron: z.string().regex(CRON5, "cron 5필드(분 시 일 월 요일)").optional(),
  maxCostUsdPerRun: z.number().positive().optional(),
  monthlyCapUsd: z.number().positive().optional(),
}).strict();

export const TopicConfigSchema = z.object({
  version: z.literal(1),
  id: z.string().regex(SLUG, "소문자·숫자·하이픈"),
  /** 프롬프트에 들어가는 주제 이름(예: «SPF egg»). */
  name: z.string().min(1),
  /** 사업 한 줄 정의. */
  summary: z.string().min(1),
  /** 정본 지식 파일(회사 사실·셀링넘버·섹터·경쟁사·ICP·스코어 기준). history/ 아래 상대 경로. */
  knowledgeFile: z.string().regex(HISTORY_REL, "history/ 아래 상대 경로"),
  /** 문서 작법(제안서·회의록·양자 문서 등) 파일. 없으면 모듈 기본 양식. */
  docStyleFile: z.string().regex(HISTORY_REL, "history/ 아래 상대 경로").optional(),
  sectors: z.array(z.object({ id: z.string().min(1), label: z.string().optional() }).strict()).optional(),
  news: z.object({
    categories: z.array(z.object({
      name: z.string().min(1),
      urgency: z.enum(URGENCIES),
      sectors: z.array(z.string().min(1)).optional(),
    }).strict()).min(1),
    competitors: z.array(z.string().min(1)).default([]),
    /** 수치 인용 규칙 등 주제 고유 주의사항. */
    rules: z.array(z.string().min(1)).default([]),
  }).strict().optional(),
  sinks: z.object({
    leads: Sink,
    shipments: Sink.optional(),
    news: Sink.optional(),
  }).strict(),
  inputs: z.object({
    mail: z.object({
      /** 검색 범위를 좁히는 질의(예: label:…). 개인 메일 전체를 읽지 않게 필수. */
      query: z.string().min(1),
      windowDays: z.number().int().min(1).max(30).default(2),
    }).strict().optional(),
    kakao: z.object({
      inboxDir: z.string().regex(HISTORY_REL, "history/ 아래 상대 경로"),
    }).strict().optional(),
  }).strict().default({}),
  /** 물류 경고 판정 — 물류가 없는 주제는 생략. */
  logistics: z.object({
    alertVerdicts: z.array(z.string().min(1)).min(1),
    holdStages: z.array(z.string().min(1)).default([]),
    rules: z.array(z.string().min(1)).default([]),
  }).strict().optional(),
  /** 루프 템플릿 id → 켜기·일정·예산. 템플릿이 없거나 꺼진 루프는 만들지 않는다. */
  loops: z.record(z.string().regex(SLUG), LoopSetting).default({}),
  /** 이 주제로 지니가 라우팅할 추가 키워드. */
  routeKeywords: z.array(z.string().min(1)).default([]),
  consoleUrl: z.string().url().optional(),
  updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
}).strict().superRefine((t, ctx) => {
  // 물류 경고 루프를 켜려면 배송 저장 위치와 물류 판정 규칙이 있어야 한다.
  if (t.loops["logi-watch"]?.enabled && (!t.sinks.shipments || !t.logistics)) {
    ctx.addIssue({ code: "custom", path: ["loops", "logi-watch"], message: "sinks.shipments와 logistics가 필요" });
  }
  if (t.loops["mail-scan"]?.enabled && !t.inputs.mail) {
    ctx.addIssue({ code: "custom", path: ["loops", "mail-scan"], message: "inputs.mail이 필요" });
  }
  if (t.loops["kakao-brief"]?.enabled && !t.inputs.kakao) {
    ctx.addIssue({ code: "custom", path: ["loops", "kakao-brief"], message: "inputs.kakao가 필요" });
  }
  if (t.loops["weekly-news"]?.enabled && (!t.news || !t.sinks.news)) {
    ctx.addIssue({ code: "custom", path: ["loops", "weekly-news"], message: "news와 sinks.news가 필요" });
  }
});

export type TopicConfig = z.infer<typeof TopicConfigSchema>;
export type TopicSink = z.infer<typeof Sink>;

export type TopicConfigResult =
  | { ok: true; data: TopicConfig }
  | { ok: false; errors: string[] };

/** YAML 텍스트를 검사한다. 오류는 «필드 경로: 이유»로 — 값은 싣지 않는다(사업 정보가 로그에 남지 않게). */
export function parseTopicConfig(text: string): TopicConfigResult {
  let raw: unknown;
  try { raw = parseYaml(text); } catch (e) {
    return { ok: false, errors: [`YAML 파싱 실패: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`] };
  }
  const r = TopicConfigSchema.safeParse(raw);
  if (r.success) return { ok: true, data: r.data };
  return { ok: false, errors: r.error.issues.map((i) => `${i.path.join(".") || "(최상위)"}: ${i.message}`) };
}
