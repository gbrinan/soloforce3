// Claude Code CLI Provider — 공용 @mycrew/ai-client로 위임.
// 게이트웨이 모드(MYCREW_AI_GATEWAY_URL) 시 호스트 경유(인증·합산 레이트리밋·비용집계), 미설정 시 로컬 스폰.
// 단발 텍스트 생성기로만 사용(내장 도구 전부 차단).
import { runClaudeDetailed } from "@mycrew/ai-client";
import type { LLMProvider, LLMRequest, LLMResponse } from "./types";

const DEFAULT_TIMEOUT_MS = 600_000; // 10분 — 긴 영상 요약 생성 대비

const BLOCKED_TOOLS = [
  "Read", "Write", "Edit", "Glob", "Grep", "Bash", "WebSearch", "WebFetch",
  "Agent", "MultiEdit", "NotebookEdit", "TodoRead", "TodoWrite",
];

export class ClaudeCodeCLIProvider implements LLMProvider {
  // binPath 인자는 하위호환용(현재 미사용 — 실행기는 ai-client가 게이트웨이/로컬로 처리).
  constructor(_binPath?: string) {}

  name(): "claude-cli" {
    return "claude-cli";
  }

  async isAvailable(): Promise<boolean> {
    // 가용성은 실제 호출(gateway/local)에서 판정 — 실패 시 factory가 OSS로 폴백.
    return true;
  }

  async generate(req: LLMRequest): Promise<LLMResponse> {
    const started = Date.now();
    const r = await runClaudeDetailed(req.user, {
      systemPrompt: req.system || undefined,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxTurns: 1,
      permissionMode: "bypassPermissions",
      disallowedTools: BLOCKED_TOOLS,
      appId: "movie",
      feature: "director",
    });
    return {
      text: r.text,
      provider: "claude-cli",
      durationMs: r.durationMs ?? Date.now() - started,
    };
  }
}
