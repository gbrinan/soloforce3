// Apps-AI MCP 서버 — 설치된 앱의 AI 라우트를 에이전트가 "도구"로 호출한다.
// 호스트 앱 프록시(/api/apps/:id/proxy/<route>) 경유 POST — 앱 포트·기동은 app-registry가 관리.
// appdata-server(읽기 전용 GET)의 쓰기/AI 버전. 앱마다 AI 라우트를 named tool로 노출한다.
// 환경변수:
//   MCP_APPSAI_BASE_URL  호스트 서버 베이스 (예: http://127.0.0.1:3457)
//   MCP_APPSAI_APPS      설치된 앱 id 콤마 목록 — 목록에 없는 앱의 도구는 미등록

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = process.env.MCP_APPSAI_BASE_URL || "http://127.0.0.1:3457";
const APPS = new Set(
  (process.env.MCP_APPSAI_APPS || "mail,booking,pdf,approval,hd-cleaner,sign,ledger,mymaps")
    .split(",").map((s) => s.trim()).filter(Boolean),
);

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }] });
const fail = (e: unknown) => ({
  isError: true,
  content: [{ type: "text" as const, text: `AI 호출 실패: ${e instanceof Error ? e.message : String(e)}` }],
});

// 앱 프록시 경유 POST — 긴 AI 응답을 고려해 타임아웃 넉넉히(120s).
async function postJson<T>(appId: string, route: string, payload: unknown): Promise<T> {
  const url = `${BASE_URL}/api/apps/${appId}/proxy${route}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload ?? {}),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`POST ${url} → HTTP ${res.status}${body ? `: ${body}` : ""}`);
  }
  return res.json() as Promise<T>;
}

/** 앱 AI 라우트 디스크립터 — 앱별로 (도구명, 프록시 라우트, 설명, 입력 스키마). */
interface AiTool {
  app: string;
  name: string;
  route: string;
  description: string;
  input: z.ZodRawShape;
}

const AI_TOOLS: AiTool[] = [
  // mail
  { app: "mail", name: "mail_summarize_thread", route: "/api/mail/summarize-thread", description: "메일 스레드를 요약한다.", input: { threadId: z.string().optional(), text: z.string().optional().describe("스레드 원문(threadId 대신 직접 전달 가능)") } },
  { app: "mail", name: "mail_suggest_reply", route: "/api/mail/suggest-reply", description: "메일에 대한 답장 초안을 제안한다.", input: { text: z.string().describe("원본 메일 본문"), tone: z.string().optional() } },
  { app: "mail", name: "mail_classify", route: "/api/mail/classify", description: "메일을 카테고리로 분류한다.", input: { text: z.string().describe("메일 본문") } },
  { app: "mail", name: "mail_extract_events", route: "/api/mail/extract-events", description: "메일에서 일정/이벤트(날짜·시간·제목)를 추출한다.", input: { subject: z.string().describe("메일 제목"), body: z.string().describe("메일 본문") } },
  // booking
  { app: "booking", name: "booking_parse", route: "/api/ai/parse-booking", description: "자연어 예약 요청을 구조화(날짜/시간/이름 등)한다.", input: { text: z.string().describe("자연어 예약 문장") } },
  { app: "booking", name: "booking_briefing", route: "/api/ai/briefing", description: "예약/미팅 브리핑을 생성한다.", input: { date: z.string().optional().describe("YYYY-MM-DD") } },
  // pdf
  { app: "pdf", name: "pdf_ask", route: "/api/pdf/ask", description: "PDF 내용에 대해 질의응답한다.", input: { question: z.string(), documentId: z.string().optional(), text: z.string().optional().describe("문서 텍스트(documentId 대신 직접 전달)") } },
  { app: "pdf", name: "pdf_outline", route: "/api/pdf/outline", description: "문서 텍스트의 요약·목차를 생성한다.", input: { documentText: z.string().describe("문서 전체 텍스트") } },
  // mymaps
  { app: "mymaps", name: "mymaps_places", route: "/ai/places", description: "자연어 요청에 맞는 실제 장소(좌표 포함)를 제안한다.", input: { query: z.string().describe("장소 요청(예: '강남 조용한 카페 3곳')") } },
  { app: "mymaps", name: "mymaps_layer", route: "/ai/layer", description: "자연어 요청을 지도 레이어(이름/지역/색/검색어 목록)로 분해한다.", input: { query: z.string(), lang: z.string().optional().describe("ko|en|ja") } },
  // approval
  { app: "approval", name: "approval_draft", route: "/api/ai/draft", description: "결재 기안 초안을 작성한다.", input: { title: z.string().optional(), context: z.string().describe("기안 배경/요청 내용") } },
  { app: "approval", name: "approval_summarize", route: "/api/ai/summarize-request", description: "결재 요청을 요약한다.", input: { text: z.string().describe("결재 요청 원문") } },
  // hd-cleaner
  { app: "hd-cleaner", name: "hdcleaner_safety_rating", route: "/api/ai/safety-rating", description: "파일 삭제 안전도를 평가한다.", input: { paths: z.array(z.string()).describe("평가할 경로 목록") } },
  // isenssign (매니페스트 id는 "sign" — 디렉터리명과 다름. 프록시/게이팅은 id 기준)
  { app: "sign", name: "isenssign_contract_review", route: "/api/ai/contract-review", description: "계약서를 검토해 리스크/독소조항을 짚는다.", input: { text: z.string().describe("계약서 본문") } },
];

const server = new McpServer({ name: "apps-ai", version: "0.1.0" });

for (const t of AI_TOOLS) {
  if (!APPS.has(t.app)) continue;
  server.tool(
    t.name,
    `[${t.app}] ${t.description} (POST ${t.route})`,
    t.input,
    async (args: Record<string, unknown>) => {
      try {
        return ok(await postJson(t.app, t.route, args));
      } catch (e) {
        return fail(e);
      }
    },
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
