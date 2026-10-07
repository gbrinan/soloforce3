// Claude CLI 연동(클라이언트) — 마이크루 서버의 로컬 claude CLI를 통해 감지/생성.
// 노트 내용은 브라우저 → 로컬 마이크루 서버 → claude CLI 경로로만 전달된다.
import type { ChatMsg, GenOpts } from './llmEngine';

export interface ClaudeDetect {
  ok: boolean;
  installed: boolean;
  version?: string;
  authenticated?: boolean;
  error?: string;
}

// `GET /api/notes/ai/claude/detect` — `claude --version` 실행 결과.
export async function detectClaude(): Promise<ClaudeDetect> {
  try {
    const res = await fetch('/api/notes/ai/claude/detect');
    if (!res.ok) return { ok: false, installed: false, error: `HTTP ${res.status}` };
    return await res.json() as ClaudeDetect;
  } catch (e) {
    return { ok: false, installed: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// `POST /api/notes/ai/claude/generate` — `claude -p <prompt>` 실행. 비스트리밍 1회 응답.
export async function claudeGenerate(messages: ChatMsg[], opts: GenOpts = {}, model = ''): Promise<string> {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const prompt = messages.filter((m) => m.role !== 'system').map((m) => m.content).join('\n\n');
  const res = await fetch('/api/notes/ai/claude/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, system, model: model || undefined }),
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(msg?.error || `Claude CLI 요청 실패 (${res.status})`);
  }
  const data = await res.json() as { ok?: boolean; text?: string; error?: string };
  if (!data.ok) throw new Error(data.error || 'Claude CLI 생성 실패');
  const full = data.text ?? '';
  opts.onToken?.(full);
  return full;
}
