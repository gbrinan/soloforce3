// LLM Provider 인터페이스 — 마이크루 AI Director 전용.
// 유료 API 금지. primary=Claude Code CLI(`claude -p`), fallback=로컬 OSS(Ollama).

export interface LLMRequest {
  /** 시스템 프롬프트 (역할/제약) */
  system: string;
  /** 사용자 프롬프트 (시그널·메타·요청 액션 JSON 스키마) */
  user: string;
  /** 응답 최대 길이 힌트 (provider 종속, 보장 X) */
  maxOutputChars?: number;
}

export interface LLMResponse {
  /** LLM이 생성한 원본 텍스트 (Action[] JSON 포함 예상) */
  text: string;
  /** 어떤 provider가 처리했는지 */
  provider: "claude-cli" | "local-oss";
  /** 호출 소요 시간 (ms) */
  durationMs: number;
}

export interface LLMProvider {
  name(): "claude-cli" | "local-oss";
  /** 사용 가능 여부 (예: ollama 서버 running, claude bin 존재) */
  isAvailable(): Promise<boolean>;
  /** 1회 호출. 실패 시 throw. */
  generate(req: LLMRequest): Promise<LLMResponse>;
}

export type ProviderPreference = "auto" | "claude-cli" | "local-oss";

export interface LLMRouterOptions {
  /** auto = primary→fallback 자동 전환. 명시 시 강제. */
  prefer?: ProviderPreference;
}
