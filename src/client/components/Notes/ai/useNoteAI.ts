// 노트 AI 상태 훅 — WebGPU 지원 감지, WebLLM 모델 로딩 진행률, AI 설정(provider/키)을 묶어 제공.
import { useCallback, useEffect, useState } from 'react';
import { hasWebGPU } from './webgpu';
import { onLLMProgress, type LLMProgress } from './llmEngine';
import { loadAIConfig, saveAIConfig, type AIConfig } from './aiConfig';

export interface NoteAIState {
  webgpuOK: boolean | null;     // null = 감지 중
  progress: LLMProgress;        // WebLLM 모델 다운로드/로딩 진행률
  config: AIConfig;
  setConfig: (next: AIConfig) => void;
  aiAvailable: boolean;         // 현재 설정으로 AI 사용 가능 여부
}

export function useNoteAI(): NoteAIState {
  const [webgpuOK, setWebgpuOK] = useState<boolean | null>(null);
  const [progress, setProgress] = useState<LLMProgress>({ text: '', progress: 0 });
  const [config, setConfigState] = useState<AIConfig>(() => loadAIConfig());

  useEffect(() => {
    let alive = true;
    hasWebGPU().then((v) => { if (alive) setWebgpuOK(v); });
    return () => { alive = false; };
  }, []);

  useEffect(() => onLLMProgress(setProgress), []);

  const setConfig = useCallback((next: AIConfig) => {
    setConfigState(next);
    saveAIConfig(next);
  }, []);

  // 사용 토글(enabled) ON일 때만 활성. provider별 설정 완료 조건 + WebLLM은 WebGPU 동반.
  const aiAvailable =
    config.enabled && (
      (config.provider === 'webllm' && webgpuOK === true) ||
      (config.provider === 'ollama' && !!config.ollamaModel) ||
      (config.provider === 'claude') ||
      (config.provider === 'grok' && !!config.grokKey)
    );

  return { webgpuOK, progress, config, setConfig, aiAvailable };
}
