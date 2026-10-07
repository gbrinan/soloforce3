import { useCallback, useEffect, useRef, useState } from 'react';
import { bump as metricsBump } from './voiceMetrics';
import { useVad } from './useVad';
import { float32ToWav } from './useMic';

// 웨이크워드 훅 — 한국어용 오프더셸 웨이크워드 모델이 없어 "VAD로 구간을 자르고 짧은 발화만 STT로 확인" 방식을 쓴다.
// 핸즈프리가 꺼져 있고 웨이크워드 모드가 켜져 있을 때만 동작한다.
// 1) VAD가 발화 구간을 감지 → 2초 미만이면 STT 호출 → 2) 웨이크 문구와 일치하면 다음 발화를 실제 명령으로 처리.

const DEFAULT_WAKE_PHRASES = ['솔로포스', '솔로포스야', '자비스'];
const WAKE_CHECK_MIN_INTERVAL_MS = 1500; // 비용 상한 — 최대 1.5초당 1회 STT 호출
const WAKE_UTTERANCE_MAX_MS = 2000; // 이보다 긴 발화는 웨이크워드 확인 대상에서 제외(일반 대화로 간주)
const ARMED_WINDOW_MS = 8000; // 호출 성공 후 다음 발화를 기다리는 최대 시간

export type WakeState = 'idle' | 'listening' | 'armed';

interface UseWakeWordOptions {
  enabled: boolean;
  isAssistantSpeaking?: boolean;
  wakePhrases?: string[];
  onWake?: () => void;
  onCommand?: (text: string) => void;
  /** 웨이크 체크마다 엔진/ms 로그 — 화면 로그/콘솔 노출용 */
  onWakeCheckLogged?: (info: { text: string; matched: boolean; engine?: string; ms?: number }) => void;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s.,!?~\-_]/g, '');
}

export function useWakeWord(opts: UseWakeWordOptions) {
  const [state, setState] = useState<WakeState>('idle');
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const lastCheckTsRef = useRef(0);
  const armedRef = useRef(false);
  const armedTimerRef = useRef<number | null>(null);

  const wakePhrasesNorm = (opts.wakePhrases?.length ? opts.wakePhrases : DEFAULT_WAKE_PHRASES).map(normalize);

  const disarm = useCallback(() => {
    armedRef.current = false;
    if (armedTimerRef.current) { window.clearTimeout(armedTimerRef.current); armedTimerRef.current = null; }
    setState(optsRef.current.enabled ? 'listening' : 'idle');
  }, []);

  const arm = useCallback(() => {
    armedRef.current = true;
    setState('armed');
    optsRef.current.onWake?.();
    if (armedTimerRef.current) window.clearTimeout(armedTimerRef.current);
    armedTimerRef.current = window.setTimeout(disarm, ARMED_WINDOW_MS);
  }, [disarm]);

  const onSpeechEnd = useCallback(({ audio, durationMs }: { audio: Float32Array; durationMs: number }) => {
    void (async () => {
      // 호출된 상태(armed) — 다음 발화는 곧바로 실제 명령으로 처리, STT 1회만 호출.
      if (armedRef.current) {
        disarm();
        try {
          const wav = float32ToWav(audio, 16000);
          if (wav.size < 200) return;
          const form = new FormData();
          form.append('audio', wav, 'command.wav');
          const t0 = performance.now();
          const res = await fetch('/api/voice/stt', { method: 'POST', body: form });
          if (!res.ok) return;
          const data = await res.json();
          const text = (data?.text || '').trim();
          metricsBump('wakeChecks'); metricsBump('wakeMatches');
          optsRef.current.onWakeCheckLogged?.({ text, matched: true, engine: data?.engine, ms: data?.ms ?? Math.round(performance.now() - t0) });
          if (text) optsRef.current.onCommand?.(text);
        } catch { /* noop */ }
        return;
      }
      // 비용 상한: 너무 긴 발화(일반 대화 가능성 높음)나 레이트리밋 구간은 STT 호출 자체를 건너뛴다.
      if (durationMs > WAKE_UTTERANCE_MAX_MS) return;
      const now = Date.now();
      if (now - lastCheckTsRef.current < WAKE_CHECK_MIN_INTERVAL_MS) return;
      lastCheckTsRef.current = now;
      try {
        const wav = float32ToWav(audio, 16000);
        if (wav.size < 200) return;
        const form = new FormData();
        form.append('audio', wav, 'wakecheck.wav');
        const t0 = performance.now();
        const res = await fetch('/api/voice/stt', { method: 'POST', body: form });
        if (!res.ok) return;
        const data = await res.json();
        const text = (data?.text || '').trim();
        const matched = wakePhrasesNorm.some((p) => normalize(text).includes(p));
        metricsBump('wakeChecks'); if (matched) metricsBump('wakeMatches');
        optsRef.current.onWakeCheckLogged?.({ text, matched, engine: data?.engine, ms: data?.ms ?? Math.round(performance.now() - t0) });
        if (matched) arm();
      } catch { /* noop — STT 사이드카 꺼짐 */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arm, disarm]);

  const vad = useVad({
    isSpeaking: opts.isAssistantSpeaking,
    onSpeechEnd,
    minSpeechMs: 250,
    redemptionMs: 500,
  });

  useEffect(() => {
    if (opts.enabled) {
      void vad.start();
      setState((s) => (s === 'armed' ? s : 'listening'));
    } else {
      void vad.stop();
      disarm();
      setState('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.enabled]);

  useEffect(() => {
    return () => { void vad.destroy(); if (armedTimerRef.current) window.clearTimeout(armedTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { state };
}
