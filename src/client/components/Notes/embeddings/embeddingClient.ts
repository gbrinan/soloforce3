// 임베딩 워커 클라이언트(메인 스레드 싱글톤) — 워커와의 요청/응답 매칭, 모델 상태 구독,
// 코사인 유사도 계산을 담당한다. 워커는 첫 embed() 호출 시 지연 생성(노트 미사용 시 모델 미로드).

export type EmbedStatus = 'idle' | 'loading' | 'ready' | 'error';

interface Pending { resolve: (v: number[]) => void; reject: (e: Error) => void }

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

let status: EmbedStatus = 'idle';
const statusListeners = new Set<(s: EmbedStatus) => void>();

function setStatus(s: EmbedStatus): void {
  if (status === s) return;
  status = s;
  statusListeners.forEach((fn) => fn(s));
}

export function getStatus(): EmbedStatus { return status; }

// 상태 구독 — 즉시 현재 상태로 1회 호출, 해제 함수 반환.
export function onStatus(fn: (s: EmbedStatus) => void): () => void {
  statusListeners.add(fn);
  fn(status);
  return () => { statusListeners.delete(fn); };
}

interface WorkerMessage {
  id?: number;
  type: 'status' | 'result' | 'error';
  status?: EmbedStatus;
  vector?: number[];
  message?: string;
}

function ensureWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./embeddings.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    setStatus('error');
    return null;
  }
  worker.addEventListener('message', (e: MessageEvent) => {
    const m = e.data as WorkerMessage;
    if (m.type === 'status' && m.status) { setStatus(m.status); return; }
    if (typeof m.id !== 'number') return;
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.type === 'result' && m.vector) p.resolve(m.vector);
    else p.reject(new Error(m.message || 'embed failed'));
  });
  worker.addEventListener('error', () => setStatus('error'));
  return worker;
}

// 단일 텍스트 임베딩(384차원, 정규화됨). 워커 사용 불가 시 reject.
export function embed(text: string): Promise<number[]> {
  const w = ensureWorker();
  if (!w) return Promise.reject(new Error('embedding worker unavailable'));
  const id = ++seq;
  return new Promise<number[]>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, type: 'embed', text });
  });
}

// 코사인 유사도. 워커가 정규화하므로 보통 내적과 같지만, 안전하게 전체 식을 사용.
export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
