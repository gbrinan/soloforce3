// 노트 AI 설정 영속화(localStorage). 제공자 선택(WebLLM/Ollama/Claude CLI/Grok)과 제공자별 설정을 보관.
// Grok API 키는 브라우저에만 저장되며 마이크루 서버로 전송하지 않는다(프라이버시).

export type AIProvider = 'webllm' | 'ollama' | 'claude' | 'grok';

export interface AIConfig {
  provider: AIProvider;
  enabled: boolean;          // 사용 토글 ON — 설정 완료 후 사용 확정 상태
  ollamaModel: string;       // 선택된 Ollama 모델명
  grokKey: string;           // Grok(xAI) API 키 — 브라우저 localStorage 전용(서버 미전송)
  grokModel: string;         // Grok 모델명(빈값=기본)
  claudeModel: string;       // Claude CLI 모델(빈값=CLI 기본)
}

const KEY = 'jarvis:noteAI';

export const AI_DEFAULTS: AIConfig = {
  provider: 'webllm',
  enabled: false,
  ollamaModel: '',
  grokKey: '',
  grokModel: '',
  claudeModel: '',
};

const VALID_PROVIDERS: AIProvider[] = ['webllm', 'ollama', 'claude', 'grok'];

export function loadAIConfig(): AIConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...AI_DEFAULTS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...AI_DEFAULTS };
    const merged: AIConfig = { ...AI_DEFAULTS, ...parsed };
    // 하위호환: 구버전 provider('byok' 등 폐기값) → 기본(webllm)으로 마이그레이션.
    if (!VALID_PROVIDERS.includes(merged.provider)) merged.provider = 'webllm';
    return merged;
  } catch {
    return { ...AI_DEFAULTS };
  }
}

export function saveAIConfig(cfg: AIConfig): void {
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* quota/비활성 */ }
}

// 외부 클라우드로 노트 내용이 전송되는 제공자 여부(Grok=xAI). 프라이버시 안내용.
export function isExternalProvider(cfg: AIConfig): boolean {
  return cfg.provider === 'grok';
}
