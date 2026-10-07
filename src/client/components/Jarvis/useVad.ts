import { useCallback, useEffect, useRef, useState } from 'react';
import { MicVAD } from '@ricky0123/vad-web';

// Silero VAD(음성 활동 감지) 훅 — RMS 기반 useMic의 침묵 타이머를 대체한다.
// 오프라인 동작을 위해 모델/워크릿/wasm 에셋을 src/client/public/vad/ 에서 직접 로드한다(CDN 미사용).
// isSpeaking이 true인 동안(어시스턴트 TTS 재생 중)에는 VAD를 pause()하여 자기 음성에 반응하지 않도록 한다.

export interface VadSpeechEnd {
  audio: Float32Array; // 16kHz mono PCM float32 (-1..1), Silero 세그멘테이션 결과
  durationMs: number;
}

interface UseVadOptions {
  /** true인 동안 VAD 처리를 정지한다(어시스턴트 발화 중 에코 오탐 방지) */
  isSpeaking?: boolean;
  onSpeechStart?: () => void;
  onSpeechEnd?: (result: VadSpeechEnd) => void;
  onMisfire?: () => void;
  /** 무음 판정까지의 유예 시간(ms). 기본 600ms */
  redemptionMs?: number;
  /** 클릭/기침 등 오탐 제거를 위한 최소 발화 길이(ms). 기본 250ms */
  minSpeechMs?: number;
  positiveSpeechThreshold?: number;
  negativeSpeechThreshold?: number;
}

const VAD_ASSET_PATH = '/vad/';

export function useVad(opts: UseVadOptions = {}) {
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [probability, setProbability] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const vadRef = useRef<MicVAD | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const speechStartTsRef = useRef(0);
  const probabilityRef = useRef(0);
  const lastProbEmitRef = useRef(0);
  const destroyedRef = useRef(false);

  const start = useCallback(async () => {
    destroyedRef.current = false;
    if (vadRef.current) {
      await vadRef.current.start();
      setRunning(true);
      return;
    }
    try {
      const instance = await MicVAD.new({
        model: 'v5',
        baseAssetPath: VAD_ASSET_PATH,
        onnxWASMBasePath: VAD_ASSET_PATH,
        // 스피커 에코 억제 — 어시스턴트 TTS가 마이크로 되먹임되는 것을 하드웨어/브라우저 레벨에서 1차 차단
        getStream: () => navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        }),
        redemptionMs: optsRef.current.redemptionMs ?? 600,
        minSpeechMs: optsRef.current.minSpeechMs ?? 250,
        positiveSpeechThreshold: optsRef.current.positiveSpeechThreshold ?? 0.5,
        negativeSpeechThreshold: optsRef.current.negativeSpeechThreshold ?? 0.35,
        onFrameProcessed: (probs) => {
          probabilityRef.current = probs.isSpeech;
          const now = performance.now();
          if (now - lastProbEmitRef.current > 120) { lastProbEmitRef.current = now; setProbability(probs.isSpeech); }
        },
        onSpeechStart: () => {
          speechStartTsRef.current = Date.now();
          optsRef.current.onSpeechStart?.();
        },
        onSpeechEnd: (audio: Float32Array) => {
          const durationMs = Date.now() - speechStartTsRef.current;
          optsRef.current.onSpeechEnd?.({ audio, durationMs });
        },
        onVADMisfire: () => optsRef.current.onMisfire?.(),
      });
      if (destroyedRef.current) { await instance.destroy(); return; }
      vadRef.current = instance;
      setReady(true);
      await instance.start();
      setRunning(true);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const stop = useCallback(async () => {
    setRunning(false);
    setProbability(0);
    await vadRef.current?.pause();
  }, []);

  const destroy = useCallback(async () => {
    destroyedRef.current = true;
    setRunning(false);
    setReady(false);
    setProbability(0);
    const instance = vadRef.current;
    vadRef.current = null;
    await instance?.destroy();
  }, []);

  // 어시스턴트 발화 중에는 완전히 pause() — 프레임 처리 자체를 끊어 에코로 인한 오탐을 원천 차단.
  useEffect(() => {
    if (!vadRef.current) return;
    if (opts.isSpeaking) void vadRef.current.pause().then(() => setRunning(false));
    else if (running === false && ready) void vadRef.current.start().then(() => setRunning(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.isSpeaking, ready]);

  useEffect(() => () => { void destroy(); }, [destroy]);

  return { start, stop, destroy, ready, running, probability, probabilityRef, error };
}
