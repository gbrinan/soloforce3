import { useCallback, useEffect, useRef, useState } from 'react';
import { useVad, type VadSpeechEnd } from './useVad';

// 자비스뷰 마이크 훅 — PTT(Space/버튼 홀드)와 핸즈프리(Silero VAD 기반 발화 세그멘테이션) 두 입력 모드를 지원한다.
// 핸즈프리 모드는 useVad가 감지한 발화 종료 세그먼트를 WAV로 인코딩해 /api/voice/stt 로 전송한다.
// PTT는 기존과 동일하게 MediaRecorder로 녹음 구간 전체를 전송한다(회귀 없음).

interface UseMicOptions {
  onTranscript?: (text: string) => void;
  onSubmitText?: (text: string) => void;
  onListeningChange?: (listening: boolean) => void;
  onProcessingChange?: (processing: boolean) => void;
  /** 어시스턴트가 TTS로 발화 중이면 true — VAD가 자기 음성에 반응하지 않도록 전달한다 */
  isAssistantSpeaking?: boolean;
}

/** 16kHz mono Float32 PCM(-1..1) 샘플을 16-bit PCM WAV Blob으로 인코딩한다. */
export function float32ToWav(samples: Float32Array, sampleRate = 16000): Blob {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

async function sendToStt(blob: Blob, filename: string): Promise<string> {
  const form = new FormData();
  form.append('audio', blob, filename);
  const res = await fetch('/api/voice/stt', { method: 'POST', body: form });
  if (!res.ok) return '';
  const data = await res.json();
  return (data?.text || '').trim();
}

export function useMic(opts: UseMicOptions = {}) {
  const [listening, setListening] = useState(false);
  const [handsFree, setHandsFree] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const handsFreeRef = useRef(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const emitTranscript = useCallback((text: string) => {
    if (!text) return;
    optsRef.current.onTranscript?.(text);
    window.setTimeout(() => optsRef.current.onSubmitText?.(text), 1500);
  }, []);

  // 핸즈프리 발화 종료 세그먼트 → WAV 인코딩 → STT 전송. VAD 세그먼트는 이미 무음으로 트리밍되어 있다.
  const onVadSpeechEnd = useCallback(({ audio }: VadSpeechEnd) => {
    void (async () => {
      const wav = float32ToWav(audio, 16000);
      if (wav.size < 200) return;
      try {
        optsRef.current.onProcessingChange?.(true);
        const text = await sendToStt(wav, "speech.wav");
        emitTranscript(text);
      } catch { /* noop -- STT sidecar off */ } finally {
        optsRef.current.onProcessingChange?.(false);
      }
    })();
  }, [emitTranscript]);

  const vad = useVad({
    isSpeaking: opts.isAssistantSpeaking,
    onSpeechEnd: onVadSpeechEnd,
  });

  // VAD 확률을 오디오 링(useAudioRing)이 소비할 수 있도록 AnalyserNode 더크타이핑 shim으로 노출.
  // 실제 AudioContext 없이 fftSize/getByteTimeDomainData만 구현해 링이 핸즈프리 중에도 반응하게 한다.
  const vadShimRef = useRef<AnalyserNode | null>(null);
  if (!vadShimRef.current) {
    const shimFftSize = 256;
    vadShimRef.current = {
      fftSize: shimFftSize,
      getByteTimeDomainData: (buf: Uint8Array) => {
        const level = vad.probabilityRef.current;
        for (let i = 0; i < buf.length; i++) {
          const wave = Math.sin((i / buf.length) * Math.PI * 8) * level;
          buf[i] = 128 + Math.round(wave * 100);
        }
      },
    } as unknown as AnalyserNode;
  }

  // PTT용 마이크 스트림 + 레벨미터(analyser). 핸즈프리는 useVad가 자체 스트림/오디오컨텍스트를 관리한다.
  const ensureStream = useCallback(async () => {
    if (streamRef.current) return streamRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    streamRef.current = stream;
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = audioCtxRef.current || new Ctx();
    audioCtxRef.current = ctx;
    if (ctx.state === 'suspended') await ctx.resume();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    analyserRef.current = analyser;
    return stream;
  }, []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    analyserRef.current = null;
    setListening(false);
    optsRef.current.onListeningChange?.(false);
  }, []);

  const finishRecording = useCallback(async (): Promise<void> => {
    const mr = recorderRef.current;
    if (!mr) return;
    await new Promise<void>((resolve) => {
      mr.onstop = () => resolve();
      if (mr.state !== 'inactive') mr.stop(); else resolve();
    });
    const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || 'audio/webm' });
    chunksRef.current = [];
    if (blob.size < 200) return;
    try {
      optsRef.current.onProcessingChange?.(true);
      const text = await sendToStt(blob, "speech.webm");
      emitTranscript(text);
    } catch { /* noop -- STT sidecar off */ } finally {
      optsRef.current.onProcessingChange?.(false);
    }
  }, [emitTranscript]);

  const startRecorder = useCallback((stream: MediaStream) => {
    const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    const mimeType = preferred.find((t) => (window as any).MediaRecorder?.isTypeSupported?.(t)) || '';
    const mr = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    chunksRef.current = [];
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    mr.start(250);
    recorderRef.current = mr;
  }, []);

  // PTT — 기존 회귀 없음: 홀드 동안 MediaRecorder로 전체 구간을 녹음해 STT 전송.
  const pttDown = useCallback(async () => {
    if (listening || handsFreeRef.current) return;
    try {
      const stream = await ensureStream();
      startRecorder(stream);
      setListening(true);
      optsRef.current.onListeningChange?.(true);
    } catch { /* mic 권한 거부 */ }
  }, [ensureStream, listening, startRecorder]);

  const pttUp = useCallback(() => {
    if (!listening || handsFreeRef.current) return;
    void finishRecording();
    stopStream();
  }, [finishRecording, listening, stopStream]);

  const toggleHandsFree = useCallback(async () => {
    const next = !handsFreeRef.current;
    handsFreeRef.current = next;
    setHandsFree(next);
    if (next) {
      try {
        analyserRef.current = vadShimRef.current;
        await vad.start();
        setListening(true);
        optsRef.current.onListeningChange?.(true);
      } catch { handsFreeRef.current = false; setHandsFree(false); analyserRef.current = null; }
    } else {
      await vad.stop();
      analyserRef.current = null;
      setListening(false);
      optsRef.current.onListeningChange?.(false);
    }
  }, [vad]);

  // 마운트 해제 시에만 정리 — vad/stopStream 객체는 매 렌더 재생성되므로 deps에 넣으면 매 렌더마다 destroy가 호출된다.
  useEffect(() => {
    return () => { void vad.destroy(); stopStream(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    pttDown,
    pttUp,
    toggleHandsFree,
    handsFree,
    listening,
    micAnalyserRef: analyserRef,
    vadProbability: vad.probability,
    vadProbabilityRef: vad.probabilityRef,
    vadReady: vad.ready,
    vadError: vad.error,
  };
}
