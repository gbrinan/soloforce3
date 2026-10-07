import type { AgentConfig, AgentResult } from "../types.js";

// Runtime error envelope used by adapter error utilities (error-utils.ts).
// kind=cancelled when user/timeout aborted; kind=unknown for unclassified failures.
export interface RuntimeError {
  kind: "cancelled" | "unknown";
  message: string;
  retryable: boolean;
}

export interface AdapterOptions {
  cwd?: string;
  resumeSessionId?: string;
  onProgress?: (message: string) => void;
  onText?: (chunk: string) => void;
  onSystemMessage?: (event: unknown) => void;
  onSpawn?: (pid: number) => void;
}

export type AdapterResult = AgentResult;

export interface AdapterModelOption {
  id: string;
  label: string;
}

export interface AdapterModelCatalog {
  models: AdapterModelOption[];
  source: "live" | "static" | "fallback";
}

export interface AgentAdapter {
  id: string;
  supportedModels: AdapterModelOption[];
  listModels?: () => Promise<AdapterModelOption[]>;
  execute(
    config: AgentConfig,
    taskId: string,
    prompt: string,
    options?: AdapterOptions,
  ): Promise<AdapterResult>;
}
