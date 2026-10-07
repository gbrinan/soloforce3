// WebLLM 엔진(메인 스레드 싱글톤) — 워커 엔진을 지연 생성하고, 모델 로딩 진행률을 구독시키며,
// OpenAI 호환 chat API로 스트리밍 생성을 수행한다. 최초 사용 시 모델(약 1.5GB) 다운로드 → 이후 캐시.
// 타입만 정적 import(런타임 코드 0). 런타임 진입점은 getEngine에서 동적 import로 분리 →
// 대형 web-llm 라이브러리를 메인 번들에서 떼어내 AI 최초 사용 시에만 로드(온디맨드, 스펙 Phase 3).
import type {
  MLCEngineInterface,
  InitProgressReport,
  ChatCompletionMessageParam,
} from '@mlc-ai/web-llm';

// prebuiltAppConfig에 존재하는 모델 ID(스펙: Qwen2.5-1.5B, WebGPU 4bit).
export const WEBLLM_MODEL = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';

export interface LLMProgress { text: string; progress: number }
type ProgressCb = (p: LLMProgress) => void;

const progressListeners = new Set<ProgressCb>();
let lastProgress: LLMProgress = { text: '', progress: 0 };
let enginePromise: Promise<MLCEngineInterface> | null = null;

// 모델 로딩 진행률 구독 — 즉시 마지막 진행률로 1회 호출, 해제 함수 반환.
export function onLLMProgress(cb: ProgressCb): () => void {
  progressListeners.add(cb);
  cb(lastProgress);
  return () => { progressListeners.delete(cb); };
}

export function getEngine(): Promise<MLCEngineInterface> {
  if (!enginePromise) {
    enginePromise = (async () => {
      const { CreateWebWorkerMLCEngine } = await import('@mlc-ai/web-llm');
      const worker = new Worker(new URL('./llm.worker.ts', import.meta.url), { type: 'module' });
      return CreateWebWorkerMLCEngine(worker, WEBLLM_MODEL, {
        initProgressCallback: (r: InitProgressReport) => {
          lastProgress = { text: r.text, progress: r.progress };
          progressListeners.forEach((fn) => fn(lastProgress));
        },
      });
    })();
  }
  return enginePromise;
}

export interface ChatMsg { role: 'system' | 'user' | 'assistant'; content: string }
export interface GenOpts {
  onToken?: (full: string) => void;   // 누적 텍스트 콜백(스트리밍)
  json?: boolean;                      // JSON 모드(구조화 추출)
  temperature?: number;
}

// 스트리밍 생성 — 누적 문자열을 onToken으로 흘리고 최종 전체 텍스트를 반환.
export async function llmGenerate(messages: ChatMsg[], opts: GenOpts = {}): Promise<string> {
  const engine = await getEngine();
  const stream = await engine.chat.completions.create({
    messages: messages as ChatCompletionMessageParam[],
    stream: true,
    temperature: opts.temperature ?? 0.7,
    ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
  });
  let full = '';
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? '';
    if (delta) { full += delta; opts.onToken?.(full); }
  }
  return full;
}
