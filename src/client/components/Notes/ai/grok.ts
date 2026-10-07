// Grok(xAI) 외부 API — 사용자 자기 키로 OpenAI 호환 /chat/completions 호출.
// 키는 브라우저에만 보관(서버 미전송). 비스트리밍 1회 응답 후 onToken(full) 1회 호출.
import type { ChatMsg, GenOpts } from './llmEngine';
import type { AIConfig } from './aiConfig';

const GROK_BASE = 'https://api.x.ai/v1';

export async function grokGenerate(cfg: AIConfig, messages: ChatMsg[], opts: GenOpts = {}): Promise<string> {
  if (!cfg.grokKey) throw new Error('Grok API 키가 설정되지 않았습니다');
  const model = cfg.grokModel.trim() || 'grok-2-latest';
  const res = await fetch(`${GROK_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.grokKey}` },
    body: JSON.stringify({
      model,
      messages,
      ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Grok 요청 실패 (${res.status})`);
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  const full = data.choices?.[0]?.message?.content ?? '';
  opts.onToken?.(full);
  return full;
}
