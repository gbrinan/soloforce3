// Ollama 로컬 서버 연동 — 파워유저용 폴백(스펙 §2-3). localhost:11434 감지 + /api/chat 스트리밍.
import type { ChatMsg, GenOpts } from './llmEngine';

const OLLAMA_BASE = 'http://localhost:11434';

// Ollama 감지 — 설치/구동 중이면 모델명 배열, 아니면 null.
export async function detectOllama(timeoutMs = 1500): Promise<string[] | null> {
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: ctrl.signal });
    clearTimeout(to);
    if (!res.ok) return null;
    const data = await res.json() as { models?: Array<{ name?: string }> };
    const models = Array.isArray(data?.models)
      ? data.models.map((m) => m.name).filter((n): n is string => !!n)
      : [];
    return models;
  } catch {
    return null;
  }
}

// NDJSON 스트림(/api/chat)을 파싱하며 message.content를 누적.
export async function ollamaGenerate(model: string, messages: ChatMsg[], opts: GenOpts = {}): Promise<string> {
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      ...(opts.json ? { format: 'json' } : {}),
    }),
  });
  if (!res.ok || !res.body) throw new Error(`Ollama 요청 실패 (${res.status})`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed) as { message?: { content?: string }; done?: boolean };
        const delta = obj.message?.content ?? '';
        if (delta) { full += delta; opts.onToken?.(full); }
      } catch { /* 불완전 라인 무시 */ }
    }
  }
  return full;
}
