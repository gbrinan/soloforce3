// WorkerAdapter — PTY/API 통합 인터페이스 (Phase 1)
// Phase 1: 인터페이스 정의만. 구현은 PtyAdapter(pty-adapter.ts)에서.

export interface ExecuteContext {
  agentId: string;
  jobId: string;
  prompt: string;
  signal: AbortSignal;
}

export interface WorkerResult {
  outcome: "success" | "fail" | "review";
  summary: string;
  content: string;
  outputFiles?: string[];
}

export interface WorkerAdapter {
  execute(ctx: ExecuteContext): Promise<WorkerResult>;
  abort(agentId: string): boolean;
  hasSession(agentId: string): boolean;
  reset(agentId: string): void;
}

// ApiAdapter: 다른 LLM 연동용 — 인터페이스 정의만, 구현은 후속 Phase
export interface ApiAdapter extends WorkerAdapter {
  historyLength(): number;
}
