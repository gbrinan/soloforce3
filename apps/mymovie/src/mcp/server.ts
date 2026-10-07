// MyMovie MCP server — TypeScript source of truth.
// 실제 런타임 진입점은 bin/mcp-server.mjs (Node ESM, 의존성 동일).
// 이 파일은 타입 체크 + 프로그래밍 호출(예: 통합 테스트, 다른 노드 앱에서 재사용)을 위해 존재한다.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const BASE_URL = (process.env.MYMOVIE_BASE_URL || "http://localhost:13203").replace(/\/+$/, "");

type HttpResult =
  | { ok: true; status: number; body: unknown }
  | { ok: false; status: number; error: string; body?: unknown };

async function httpJson(path: string, init?: RequestInit): Promise<HttpResult> {
  const url = `${BASE_URL}${path}`;
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, error: `fetch failed: ${message}` };
  }
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  if (!res.ok) {
    const errMsg =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${res.status}`;
    return { ok: false, status: res.status, error: errMsg, body };
  }
  return { ok: true, status: res.status, body };
}

function ok(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

function fail(message: string, extra?: Record<string, unknown>) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ ok: false, error: message, ...extra }, null, 2),
      },
    ],
  };
}

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "mymovie", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "MyMovie AI 영상편집 앱 MCP 브리지. 모든 도구는 로컬 Next.js 서버(MYMOVIE_BASE_URL, 기본 http://localhost:13203)에 HTTP 요청한다.",
    },
  );

  server.registerTool(
    "mymovie_list_projects",
    {
      title: "List MyMovie projects",
      description: "워크스페이스에 저장된 프로젝트(=jobId) 요약 목록.",
      inputSchema: {},
    },
    async () => {
      const r = await httpJson("/api/projects");
      if (!r.ok) return fail(r.error, { status: r.status });
      return ok(r.body);
    },
  );

  server.registerTool(
    "mymovie_get_project",
    {
      title: "Get MyMovie project",
      description: "단일 프로젝트(jobId)의 job 메타 + actions + clips.",
      inputSchema: { jobId: z.string().min(1) },
    },
    async ({ jobId }) => {
      const r = await httpJson(`/api/projects?id=${encodeURIComponent(jobId)}`);
      if (!r.ok) return fail(r.error, { status: r.status });
      return ok(r.body);
    },
  );

  server.registerTool(
    "mymovie_validate_actions",
    {
      title: "Validate Action[]",
      description: "Action[] 스키마·범위만 검사(ffmpeg 미실행).",
      inputSchema: {
        jobId: z.string().min(1),
        actions: z.array(z.record(z.string(), z.unknown())),
      },
    },
    async ({ jobId, actions }) => {
      const r = await httpJson("/api/actions/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId, actions }),
      });
      if (!r.ok) return fail(r.error, { status: r.status, body: r.body });
      return ok(r.body);
    },
  );

  server.registerTool(
    "mymovie_run_director",
    {
      title: "Run AI director",
      description: "AI 디렉터 파이프라인 1회 실행 → 추천 Action[].",
      inputSchema: {
        jobId: z.string().min(1),
        intent: z.string().optional(),
        prefer: z.enum(["auto", "claude-cli", "local-oss"]).optional(),
        skipTranscribe: z.boolean().optional(),
      },
    },
    async (args) => {
      const r = await httpJson("/api/director/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      });
      if (!r.ok) return fail(r.error, { status: r.status, body: r.body });
      return ok(r.body);
    },
  );

  server.registerTool(
    "mymovie_inject_actions",
    {
      title: "Inject actions and render",
      description: "주어진 Action[] 으로 렌더 실행. 다중 클립이면 concat+xfade 체인 자동 적용.",
      inputSchema: {
        jobId: z.string().min(1),
        actions: z.array(z.record(z.string(), z.unknown())),
      },
    },
    async ({ jobId, actions }) => {
      const r = await httpJson(`/api/render/${encodeURIComponent(jobId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actions }),
      });
      if (!r.ok) return fail(r.error, { status: r.status, body: r.body });
      return ok(r.body);
    },
  );

  return server;
}
