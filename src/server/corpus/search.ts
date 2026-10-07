import type { CorpusHit, CorpusSearchResult, CorpusSnapshot } from '../../shared/corpus.js';
import { CorpusError } from './extract.js';
import type { CorpusStore } from './store.js';
import { readChunkContext } from './source-reader.js';

export interface CorpusEmbedder { model: string; embed(texts: string[]): Promise<number[][]> }
export function validateVectors(vectors: unknown, count: number, dimension?: number): vectors is number[][] {
  if (!Array.isArray(vectors) || vectors.length !== count || !count) return false;
  const d = dimension ?? (Array.isArray(vectors[0]) ? vectors[0].length : 0);
  return d > 0 && d <= 8192 && vectors.every(v => Array.isArray(v) && v.length === d && v.every(n => typeof n === 'number' && Number.isFinite(n)) && v.some(n => n !== 0));
}

/** 명시 설정한 로컬 Ollama만 사용. 모델 자동 다운로드/외부 유료 호출은 하지 않는다. */
export function localEmbedder(env: NodeJS.ProcessEnv): CorpusEmbedder | undefined {
  const model = env.CORPUS_EMBED_MODEL?.trim();
  if (!model) return undefined;
  const url = new URL(env.CORPUS_EMBED_URL ?? 'http://127.0.0.1:11434/api/embed');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.protocol !== 'http:' || url.username || url.password) throw new CorpusError('embedding_requires_local_endpoint', 400);
  return {
    model: `${url.origin}${url.pathname}#${model}`,
    async embed(texts) {
      const vectors: number[][] = [];
      for (let i = 0; i < texts.length; i += 16) {
        const batch = texts.slice(i, i + 16);
        const response = await fetch(url, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model, input: batch, truncate: false }), signal: AbortSignal.timeout(60_000) });
        if (!response.ok) throw new CorpusError('embedding_unavailable', 503);
        const body = await response.json() as { embeddings?: unknown };
        if (!validateVectors(body.embeddings, batch.length, vectors[0]?.length)) throw new CorpusError('invalid_embedding', 502);
        vectors.push(...body.embeddings);
      }
      return vectors;
    },
  };
}

function terms(text: string): string[] {
  const words = text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [];
  // 한국어 조사가 붙어도 부분 검색 가능하도록 한글 어절에 bigram을 함께 사용한다.
  return words.flatMap(word => /[가-힣]/.test(word) && word.length > 2 ? [word, ...Array.from({ length: word.length - 1 }, (_, i) => word.slice(i, i + 2))] : [word]);
}
function cosine(a: number[], b: number[]): number {
  let dot = 0; let aa = 0; let bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return dot / Math.sqrt(aa * bb);
}

export async function searchCorpus(store: CorpusStore, query: string, options: { limit?: number; embedder?: CorpusEmbedder; allowed?: (snapshot: CorpusSnapshot) => boolean } = {}): Promise<CorpusSearchResult> {
  const q = query.trim(); const warnings: string[] = [];
  if (!q || q.length > 500) throw new CorpusError('query_length_1_to_500', 400);
  const sources = store.list().filter(s => s.enabled).map(s => store.snapshot(s.sourceId)!).filter(s => !options.allowed || options.allowed(s));
  const records = sources.flatMap(source => source.chunks.map((chunk, index) => ({ source, chunk, index, tokens: terms(`${source.name} ${chunk.text}`) })));
  if (records.length > 100_000) throw new CorpusError('corpus_search_limit_100000_chunks', 413);
  const qTerms = [...new Set(terms(q))];
  const avgLength = records.reduce((n, r) => n + r.tokens.length, 0) / (records.length || 1);
  const df = new Map(qTerms.map(t => [t, records.filter(r => r.tokens.includes(t)).length]));
  const keyword = records.map((r, i) => {
    let score = 0;
    for (const t of qTerms) {
      const tf = r.tokens.filter(token => token === t).length;
      if (tf) score += Math.log(1 + (records.length - df.get(t)! + 0.5) / (df.get(t)! + 0.5)) * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * r.tokens.length / (avgLength || 1)));
    }
    return { i, score };
  }).filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, 80);
  // 이분 그래프: chunk -> source -> 사용자 지정 label -> source -> chunk.
  // 질의와 직접 맞는 label만 확장하며 순수 벡터 이웃을 사실/관계로 승격하지 않는다.
  const labels = new Set(sources.flatMap(s => s.labels).filter(label => terms(label).some(t => qTerms.includes(t))));
  const graph = records.map((r, i) => ({ i, score: r.source.labels.filter(label => labels.has(label)).length }))
    .filter(r => r.score > 0).sort((a, b) => b.score - a.score || a.i - b.i).slice(0, 80);
  let vector: { i: number; score: number }[] = []; let vectorUsed = false;
  if (options.embedder && records.length) {
    try {
      const vectors = await options.embedder.embed([q]);
      if (!validateVectors(vectors, 1)) throw new CorpusError('invalid_query_embedding');
      const cached = new Map(sources.map(s => {
        const rows = store.readVectors(s.sourceId, s.revision, options.embedder!.model);
        return [s.sourceId, validateVectors(rows, s.chunks.length, vectors[0].length) ? rows : null] as const;
      }));
      let missing = false;
      vector = records.flatMap((r, i) => {
        const rows = cached.get(r.source.sourceId);
        if (!rows) { missing = true; return []; }
        vectorUsed = true;
        const score = cosine(vectors[0], rows[r.index]);
        return score > 0 ? [{ i, score }] : [];
      }).sort((a, b) => b.score - a.score).slice(0, 80);
      if (missing) warnings.push('일부 자료의 임베딩이 없거나 모델·차원이 다릅니다. 벡터 색인을 실행하세요.');
    } catch { warnings.push('로컬 임베딩을 사용할 수 없어 키워드·업무 분류 검색으로 처리했습니다.'); }
  }
  const scores = new Map<number, { score: number; signals: CorpusHit['signals'] }>();
  for (const [signal, ranking, weight] of [['keyword', keyword, 1], ['vector', vector, 1], ['graph', graph, 0.35]] as const) {
    ranking.forEach((hit, rank) => {
      const current = scores.get(hit.i) ?? { score: 0, signals: [] };
      current.score += weight / (60 + rank + 1); current.signals.push(signal); scores.set(hit.i, current);
    });
  }
  // RRF 이후 문서당 최대 3개로 중복 맥락을 억제한다. 의미 cross-encoder 점수로 표시하지 않는다.
  const counts = new Map<string, number>(); const hits: CorpusHit[] = [];
  const currentSources = new Map(store.list().map(s => [s.sourceId, s]));
  for (const [i, fused] of [...scores].sort((a, b) => b[1].score - a[1].score || a[0] - b[0])) {
    const { source, chunk } = records[i];
    // await 중 사용자가 검색 제외/버전 변경한 자료가 다시 노출되지 않도록 최신 상태를 확인한다.
    const current = currentSources.get(source.sourceId);
    if (!current?.enabled || current.revision !== source.revision || (options.allowed && !options.allowed(source))) continue;
    if ((counts.get(source.sourceId) ?? 0) >= 3) continue;
    counts.set(source.sourceId, (counts.get(source.sourceId) ?? 0) + 1);
    const context = readChunkContext(source, chunk);
    if (!context.complete) warnings.push(`${source.name}: ${context.reason === 'legacy_source_requires_reimport' ? '이전 추출판입니다. 구조 문맥을 연결하려면 다시 가져오세요.' : '절·표 전체가 문맥 예산을 넘습니다. 원문을 추가 확인해야 합니다.'}`);
    hits.push({ sourceId: source.sourceId, revision: source.revision, chunkId: chunk.id, title: source.name, locator: chunk.locator, text: chunk.text, context, ...fused });
    if (hits.length >= Math.max(1, Math.min(options.limit ?? 8, 30))) break;
  }
  return { hits, mode: vectorUsed ? 'keyword_vector_graph' : 'keyword_graph', warnings };
}
