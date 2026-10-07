#!/usr/bin/env node
// MyMovie MCP server (stdio).
// Exposes read/write tools that bridge to the running MyMovie Next.js dev server.
// Base URL via MYMOVIE_BASE_URL (default http://localhost:13203).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = (process.env.MYMOVIE_BASE_URL || "http://localhost:13203").replace(/\/+$/, "");

async function httpJson(path, init) {
  const url = `${BASE_URL}${path}`;
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    return { ok: false, status: 0, error: `fetch failed: ${err?.message || String(err)}` };
  }
  let body;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, error: body?.error || `HTTP ${res.status}`, body };
  }
  return { ok: true, status: res.status, body };
}

function ok(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

function fail(message, extra) {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({ ok: false, error: message, ...extra }, null, 2),
      },
    ],
  };
}

export function createServer() {
  const server = new McpServer(
    { name: "mymovie", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "MyMovie AI 영상편집 앱 MCP 브리지. 모든 도구는 로컬 Next.js 서버(MYMOVIE_BASE_URL, 기본 http://localhost:13203)에 HTTP 요청한다. 렌더·디렉터는 ingest 단계 완료된 jobId가 필요하다.",
    },
  );

  server.registerTool(
    "mymovie_list_projects",
    {
      title: "List MyMovie projects",
      description: "워크스페이스에 저장된 프로젝트(=jobId) 요약 목록을 반환한다.",
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
      description: "단일 프로젝트(jobId)의 job 메타 + actions + clips 를 반환한다.",
      inputSchema: { jobId: z.string().min(1).describe("ingest job id") },
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
      description:
        "Action[] 스키마·범위만 검사한다(ffmpeg 미실행). UI undo/편집 직전 무결성 확인용.",
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
      description:
        "ingest 완료된 jobId에 대해 AI 디렉터 파이프라인을 1회 실행해 추천 Action[] 을 받는다.",
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
      description:
        "주어진 Action[] 으로 렌더 파이프라인을 실행한다. 다중 클립이면 자동으로 concat+xfade 체인을 적용한다.",
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

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("[mymovie-mcp] fatal:", err);
  process.exit(1);
});
