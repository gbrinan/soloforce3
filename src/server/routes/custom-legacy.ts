// 구버전(모놀리식 routes.ts)에서 이식한 커스텀 API 엔드포인트 모음.
// - POST /api/web-reader
// - GET  /api/metrics/summary, GET /api/metrics/trace/:jobId
// - 루프 엔진 API (/api/loops*)
// 핸들러 본문은 구버전에서 그대로 복사, import 경로만 조정.
import type { Hono } from "hono";
import { readWebPage } from "../web-reader.js";
import { summarize, getJobMetric } from "../metrics.js";
import { loadLoops } from "../loops/loader.js";
import { loadState as loadLoopState, saveState as saveLoopState, listRuns as listLoopRuns } from "../loops/ledger.js";
import { runLoopManually } from "../loops/index.js";
import { getGenieName } from "../chat.js";
import { getWorkerAgent } from "../../agent-registry.js";

export function registerCustomLegacyRoutes(app: Hono): void {
  // 에이전트 ID → 표시 이름 매핑 (agents.json + onboarding genie name 동적).
  // 미존재 ID는 ID 그대로 fallback (과거 데이터 호환).
  const getAgentDisplayName = (id: string): string => {
    if (id === "genie") return getGenieName();
    const a = getWorkerAgent(id);
    return a?.name ?? id;
  };

  // 웹 리더 — 차단된/일반 웹페이지 본문 텍스트를 우회 수집 (Jina Reader 폴백 포함, SSRF 차단)
  app.post("/api/web-reader", async (c) => {
    const body = await c.req.json<{ url?: string }>().catch(() => ({ url: undefined }));
    const url = body.url;
    if (!url) return c.json({ ok: false, error: "missing_url" }, 400);
    if (url.length > 2048) return c.json({ ok: false, error: "url_too_long" }, 400);
    const data = await readWebPage(url);
    return c.json(data);
  });

  // 작업 지표(metrics) 요약 API — 모델 티어 변경(2026-07-06) 효과 측정용. days 기본 7일.
  app.get("/api/metrics/summary", (c) => {
    const daysParam = Number(c.req.query("days"));
    const days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : 7;
    const sinceTs = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const result = summarize(sinceTs);
    // byAgent의 agentId를 표시 이름으로 보강 (프론트 렌더링 편의).
    const byAgentNamed: Record<string, typeof result.byAgent[string] & { name: string }> = {};
    for (const [agentId, stats] of Object.entries(result.byAgent)) {
      byAgentNamed[agentId] = { ...stats, name: stats.name ?? getAgentDisplayName(agentId) };
    }
    return c.json({ ...result, byAgent: byAgentNamed });
  });

  // 특정 job의 지표 트레이스 상세 조회 — v1은 metric 레코드 단건이 곧 트레이스(스텝별 타임라인 없음).
  app.get("/api/metrics/trace/:jobId", (c) => {
    const jobId = c.req.param("jobId");
    const record = getJobMetric(jobId);
    if (!record) return c.json({ error: "not found" }, 404);
    return c.json(record);
  });

  // 루프 엔진 API — 정의 목록/상태/실행이력, 수동 실행, 일시정지/재개, 검토 완료 처리
  app.get("/api/loops", (c) => {
    const { loops, errors } = loadLoops();
    const items = loops.map((def) => {
      const state = loadLoopState(def.id);
      const runs = listLoopRuns(def.id, 1);
      return { definition: def, state, lastRun: runs[0] };
    });
    return c.json({ loops: items, errors });
  });

  app.get("/api/loops/:id/runs", (c) => {
    const limit = Number(c.req.query("limit")) || 20;
    return c.json(listLoopRuns(c.req.param("id"), limit));
  });

  app.post("/api/loops/:id/run", async (c) => {
    const result = await runLoopManually(c.req.param("id"));
    if (!result.ok) return c.json({ error: result.message ?? "실행 실패" }, 400);
    return c.json({ ok: true });
  });

  app.post("/api/loops/:id/pause", (c) => {
    const loopId = c.req.param("id");
    const state = loadLoopState(loopId);
    state.paused = { reason: "manual", at: new Date().toISOString() };
    saveLoopState(loopId, state);
    return c.json({ ok: true });
  });

  app.post("/api/loops/:id/resume", (c) => {
    const loopId = c.req.param("id");
    const state = loadLoopState(loopId);
    state.paused = undefined;
    saveLoopState(loopId, state);
    return c.json({ ok: true });
  });

  app.post("/api/loops/:id/reviewed", (c) => {
    const loopId = c.req.param("id");
    const state = loadLoopState(loopId);
    state.lastReviewedAt = new Date().toISOString();
    saveLoopState(loopId, state);
    return c.json({ ok: true });
  });
}
