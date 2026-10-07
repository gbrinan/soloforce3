import { runAgent } from "../agent.js";
import type { AgentAdapter } from "./types.js";

export const claudeCodeAdapter: AgentAdapter = {
  id: "claude-code",
  supportedModels: [
    { id: "claude-fable-5", label: "Fable 5" },
    { id: "claude-opus-5", label: "Opus 5" },
    { id: "claude-opus-4-8", label: "Opus 4.8" },
    { id: "claude-sonnet-5", label: "Sonnet 5" },
    { id: "claude-haiku-4-5", label: "Haiku 4.5" },
    { id: "claude-opus-4-7", label: "Opus 4.7 (지원 종료 예정)" },
    { id: "claude-sonnet-4-6", label: "Sonnet 4.6 (지원 종료 예정)" },
  ],
  execute(config, taskId, prompt, options) {
    return runAgent(config, taskId, prompt, options);
  },
};
