export declare const DEFAULT_TIMEOUT_MS = 60000;
export interface ClaudeUsage {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheCreateTokens?: number;
}
export interface ClaudeResult {
    /** 모델의 최종 텍스트 (plain `-p` stdout과 동일). */
    text: string;
    costUsd?: number;
    usage?: ClaudeUsage;
    model?: string;
    durationMs?: number;
    sessionId?: string;
}
export interface RunClaudeOptions {
    timeoutMs?: number;
    /** 예: "claude-haiku-4-5". 미지정 시 계정 기본값. */
    model?: string;
    /** --append-system-prompt로 전달. */
    systemPrompt?: string;
    /** 비용 귀속용 앱 id (예: "booking"). */
    appId?: string;
    /** 비용 귀속용 기능/라우트 라벨 (예: "parse-booking"). */
    feature?: string;
    /** 기본 true. false면 호스트 usage 집계 POST를 건너뜀. */
    reportCost?: boolean;
    /** 허용 도구 화이트리스트 (예: ["Read"]). 미지정 시 도구 미허용. */
    allowedTools?: string[];
    /** 차단 도구 목록 (--disallowedTools). */
    disallowedTools?: string[];
    /** 도구 사용이 턴을 소모하므로 도구 허용 시 늘린다. 미지정 시 CLI 기본. */
    maxTurns?: number;
    /** 권한 모드 (예: "bypassPermissions"). */
    permissionMode?: string;
    /** 프로바이더 — "ollama"면 게이트웨이가 로컬 Ollama로 실행(비용 0, 실패 시 claude 폴백). */
    provider?: "claude" | "ollama";
}
/**
 * Claude CLI를 --output-format json으로 실행하고 텍스트+usage+cost를 반환한다.
 * execFile은 argv를 직접 전달하므로 셸 인젝션 위험이 없다.
 */
export declare function runClaudeDetailed(prompt: string, options?: RunClaudeOptions): Promise<ClaudeResult>;
/**
 * 하위 호환 래퍼: 기존 호출부(`runClaude(prompt, timeoutMs)`)가 그대로 동작하도록
 * 최종 텍스트(string)만 반환한다. 내부적으로는 json 실행이라 usage/cost가 집계된다.
 * 두 번째 인자로 옵션 객체도 허용한다(모델/appId/feature 지정용).
 */
export declare function runClaude(prompt: string, timeoutMsOrOptions?: number | RunClaudeOptions): Promise<string>;
/**
 * 스트리밍 생성 — 게이트웨이 전용(SSE). onText로 텍스트 델타를 실시간 수신하고
 * 완료 시 전체 결과를 반환한다. 게이트웨이 미설정 환경에서는 runClaudeDetailed로 폴백(스트리밍 없음).
 */
export declare function runClaudeStream(prompt: string, onText: (delta: string) => void, options?: RunClaudeOptions): Promise<ClaudeResult>;
/** Claude 응답에서 JSON 추출 (코드펜스/전후 설명 텍스트 허용). */
export declare function extractJson<T>(raw: string): T | null;
/** exec 에러를 사람이 읽을 메시지로 변환 (타임아웃 구분). */
export declare function claudeErrorDetail(err: unknown, timeoutMs?: number): string;
/** HTML 본문에서 태그를 제거해 프롬프트용 텍스트로 변환. */
export declare function stripHtml(input: string): string;
