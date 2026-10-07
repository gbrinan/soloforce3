// 공용 @mycrew/ai-client로 위임 — 게이트웨이 모드(MYCREW_AI_GATEWAY_URL) 시 호스트 경유,
// 미설정 시 로컬 스폰. design 고유의 (system, user, opts) 시그니처와 도구 차단 정책은 여기서 유지한다.
// 단발 텍스트 생성기로만 사용(내장 도구 전부 차단, allowRead 시에만 Read 허용).
import { runClaude as runShared } from "@mycrew/ai-client";

const DEFAULT_TIMEOUT_MS = 120_000;

const BLOCKED_TOOLS = [
  "Read", "Write", "Edit", "Glob", "Grep", "Bash", "WebSearch", "WebFetch",
  "Agent", "MultiEdit", "NotebookEdit", "TodoRead", "TodoWrite",
];

export interface RunClaudeOptions {
  // Read 도구만 허용(업로드 스크린샷 검사용). 그 외 도구는 계속 차단.
  allowRead?: boolean;
  timeoutMs?: number;
  // 도구 사용이 턴을 소모하므로 Read 허용 시 늘린다.
  maxTurns?: number;
  // 비용 라벨(게이트웨이 usage 집계용). appId "design"은 자동 부여, feature는 라우트별 세분화.
  feature?: string;
}

// system/user 프롬프트를 받아 claude 결과 텍스트를 반환.
export async function runClaude(
  system: string,
  user: string,
  opts: RunClaudeOptions = {},
): Promise<string> {
  const disallowed = opts.allowRead ? BLOCKED_TOOLS.filter((t) => t !== "Read") : BLOCKED_TOOLS;
  const text = await runShared(user, {
    systemPrompt: system || undefined,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxTurns: opts.maxTurns ?? 1,
    permissionMode: "bypassPermissions",
    disallowedTools: disallowed,
    allowedTools: opts.allowRead ? ["Read"] : undefined,
    appId: "design",
    feature: opts.feature,
  });
  if (!text || !text.trim()) {
    throw new Error("claude returned empty result");
  }
  return text.trim();
}
