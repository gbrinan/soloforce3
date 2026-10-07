/**
 * pty-adapter.ts — PtyAdapter (Phase 1, 비파괴 도입).
 *
 * 기획: history/outputs/planner-researcher/worker-redesign-2026-05-22.md §5
 *
 * 현 worker-pty.ts 함수들을 WorkerAdapter 계약으로 래핑. execute()는
 * runInteractiveWorker 흐름을 그대로 호출하고 AgentResult를 WorkerResult로
 * 변환한다(submit_response의 content+summary → WorkerResult).
 *
 * 주의(현행 코드 확인): PTY 워커의 submit_response는 {content, summary}만 전송하며
 * outcome은 보내지 않는다(routes.ts /api/agent-response/:agentId). outcome은
 * 후처리에서 파생되므로 PtyAdapter는 기본 success로 변환하고, outputs_missing 등
 * 세부 판정은 호출측(jobs.ts) 폴백 로직에 위임한다.
 */
import { runInteractiveWorker, abortWorker, hasWorkerSession, resetWorker } from "./worker-pty.js";
import { getWorkerAgent, toAgentConfig } from "../agent-registry.js";
import type { WorkerAdapter, ExecuteContext, WorkerResult } from "./worker-adapter.js";

export class PtyAdapter implements WorkerAdapter {
  async execute(ctx: ExecuteContext): Promise<WorkerResult> {
    const def = getWorkerAgent(ctx.agentId);
    if (!def) throw new Error(`PtyAdapter: 알 수 없는 에이전트 — ${ctx.agentId}`);
    const config = toAgentConfig(def);

    // lease/cancel과 abort 일원화: signal abort → 현재 작업만 중단(ESC), PTY는 유지.
    const onAbort = () => abortWorker(ctx.agentId);
    ctx.signal.addEventListener("abort", onAbort, { once: true });
    try {
      const result = await runInteractiveWorker(config, ctx.jobId, ctx.prompt);
      if (!result.success) {
        const err = result.error ?? `${def.name} 작업 실패`;
        return { outcome: "fail", summary: err, content: err };
      }
      // submit_response의 summary는 라우트가 job.summary에 별도 저장 → 호출측이
      // toResult로 합류시킨다. execute 단독 호출 시엔 summary 미상이므로 빈값.
      return this.toResult(result.output, undefined);
    } finally {
      ctx.signal.removeEventListener("abort", onAbort);
    }
  }

  abort(agentId: string): boolean {
    return abortWorker(agentId);
  }

  hasSession(agentId: string): boolean {
    return hasWorkerSession(agentId);
  }

  reset(agentId: string): void {
    resetWorker(agentId);
  }

  /**
   * PTY submit_response 결과(content + summary)를 WorkerResult로 변환.
   * outcome은 PTY가 직접 전송하지 않으므로 기본 success — 세부 판정(빈응답·
   * outputs_missing → review)은 호출측 폴백에서 결정한다.
   */
  toResult(
    content: string,
    summary: string | undefined,
    outcome: WorkerResult["outcome"] = "success",
  ): WorkerResult {
    return { outcome, summary: summary ?? "", content };
  }
}

export const ptyAdapter = new PtyAdapter();
