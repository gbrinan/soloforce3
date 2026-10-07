// 노트 임베딩 웹 워커 — Transformers.js(@huggingface/transformers)로 all-MiniLM-L6-v2를
// 메인 스레드 밖에서 실행한다. 모델(약 23MB)은 최초 1회 HF 허브 CDN에서 받아 브라우저 캐시에 저장.
// (스펙 §2: 완전 로컬 임베딩 → 노트 본문 외부 전송 0)
import { pipeline, env } from '@huggingface/transformers';

// 로컬 모델 경로 탐색 비활성(번들/서버에 모델 없음) → HF 허브 CDN + 브라우저 캐시만 사용.
env.allowLocalModels = false;
// Cache Storage API는 보안 컨텍스트(HTTPS/localhost)에서만 제공된다. 미지원 환경에서
// useBrowserCache=true면 onnx wasm/모델 캐싱이 "Failed to cache ort-..." 경고를 내며 실패한다
// (임베딩 동작 자체엔 무해하나 콘솔 노이즈 유발). 사용 가능할 때만 캐싱을 켜서 근원 차단한다.
env.useBrowserCache = typeof self !== 'undefined' && 'caches' in self
  && typeof (self as unknown as { caches?: unknown }).caches !== 'undefined';

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const MAX_CHARS = 2000; // 임베딩 입력 상한(과도한 토큰화 방지)

// any: 워커 환경에서 postMessage 오버로드(targetOrigin) 충돌 회피용 단일 캐스트.
const post = (m: unknown): void => (self as unknown as { postMessage(x: unknown): void }).postMessage(m);

type ExtractorFn = (text: string, opts: { pooling: 'mean'; normalize: boolean }) => Promise<{ data: ArrayLike<number> }>;

let extractorPromise: Promise<ExtractorFn> | null = null;
let readyNotified = false;

// 파이프라인 지연 로드 — 첫 임베딩 요청 시에만 모델을 받는다.
function getExtractor(): Promise<ExtractorFn> {
  if (!extractorPromise) {
    post({ type: 'status', status: 'loading' });
    // dtype 'q8' = 양자화 ONNX(약 23MB) — 스펙의 23MB 1회 다운로드 기준에 맞춤.
    extractorPromise = pipeline('feature-extraction', MODEL_ID, { dtype: 'q8' }) as unknown as Promise<ExtractorFn>;
  }
  return extractorPromise;
}

interface EmbedRequest { id: number; type: 'embed'; text: string }

self.addEventListener('message', async (e: MessageEvent) => {
  const msg = e.data as EmbedRequest | null;
  if (!msg || msg.type !== 'embed') return;
  try {
    const extractor = await getExtractor();
    if (!readyNotified) { readyNotified = true; post({ type: 'status', status: 'ready' }); }
    const text = (msg.text ?? '').slice(0, MAX_CHARS) || ' ';
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    const vector = Array.from(output.data as ArrayLike<number>);
    post({ id: msg.id, type: 'result', vector });
  } catch (err) {
    post({ id: msg.id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
});
