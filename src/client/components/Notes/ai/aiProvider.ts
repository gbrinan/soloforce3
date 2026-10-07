// 통합 AI 제공자 라우팅 + 프롬프트 빌더.
// 설정의 provider에 따라 WebLLM(기본·로컬) / Ollama(로컬) / Claude CLI(로컬 서버) / Grok(외부) 중 하나로 위임.
import { loadAIConfig } from './aiConfig';
import { llmGenerate, type ChatMsg, type GenOpts } from './llmEngine';
import { ollamaGenerate } from './ollama';
import { grokGenerate } from './grok';
import { claudeGenerate } from './claudeClient';

export type { ChatMsg, GenOpts } from './llmEngine';

// 라우팅 — provider 설정에 따라 적절한 백엔드 호출.
export async function generate(messages: ChatMsg[], opts: GenOpts = {}): Promise<string> {
  const cfg = loadAIConfig();
  if (cfg.provider === 'ollama' && cfg.ollamaModel) return ollamaGenerate(cfg.ollamaModel, messages, opts);
  if (cfg.provider === 'claude') return claudeGenerate(messages, opts, cfg.claudeModel);
  if (cfg.provider === 'grok' && cfg.grokKey) return grokGenerate(cfg, messages, opts);
  return llmGenerate(messages, opts);
}

// ── 프롬프트 빌더 (입력 언어로 응답하도록 지시) ──────────────────────────────

const LANG_RULE = '입력과 동일한 언어로 답하라. 군더더기 설명 없이 결과만 출력하라.';

export function summarizePrompt(text: string): ChatMsg[] {
  return [
    { role: 'system', content: `너는 노트 요약 도우미다. 핵심을 3~5개 불릿으로 간결히 요약한다. ${LANG_RULE}` },
    { role: 'user', content: `다음 노트를 요약하라:\n\n${text}` },
  ];
}

export function rewritePrompt(text: string): ChatMsg[] {
  return [
    { role: 'system', content: `너는 글쓰기 도우미다. 의미를 보존하며 더 명확하고 매끄럽게 다시 쓴다. ${LANG_RULE}` },
    { role: 'user', content: `다음 문장을 다시 써라:\n\n${text}` },
  ];
}

export function continuePrompt(before: string): ChatMsg[] {
  return [
    { role: 'system', content: `너는 글쓰기 도우미다. 주어진 글의 맥락을 이어 자연스럽게 1~3문장 더 작성한다. ${LANG_RULE}` },
    { role: 'user', content: `다음 글에 이어서 써라:\n\n${before}` },
  ];
}

export function tonePrompt(text: string, tone: string): ChatMsg[] {
  return [
    { role: 'system', content: `너는 글쓰기 도우미다. 의미를 유지하며 요청한 톤으로 바꿔 쓴다. ${LANG_RULE}` },
    { role: 'user', content: `다음 문장을 "${tone}" 톤으로 바꿔라:\n\n${text}` },
  ];
}

export function extractActionsPrompt(text: string): ChatMsg[] {
  return [
    {
      role: 'system',
      content:
        '너는 회의록에서 실행 항목(action items)을 추출한다. ' +
        '반드시 다음 JSON 형식만 출력하라: {"actions": ["항목1", "항목2", ...]}. ' +
        '실행 항목이 없으면 {"actions": []}. 다른 텍스트는 출력하지 마라.',
    },
    { role: 'user', content: `다음 회의록에서 액션 아이템을 추출하라:\n\n${text}` },
  ];
}

// JSON 모드 응답에서 actions 배열을 안전 추출(코드펜스/잡텍스트 방어).
export function parseActions(raw: string): string[] {
  const tryParse = (s: string): string[] | null => {
    try {
      const obj = JSON.parse(s) as { actions?: unknown };
      if (Array.isArray(obj.actions)) return obj.actions.filter((x): x is string => typeof x === 'string');
      return null;
    } catch { return null; }
  };
  const direct = tryParse(raw.trim());
  if (direct) return direct;
  // 코드펜스/본문 중 첫 { ... } 블록 추출 폴백.
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) { const r = tryParse(m[0]); if (r) return r; }
  return [];
}
