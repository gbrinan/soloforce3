import { useCallback, useEffect, useRef, useState } from 'react';

// 자비스뷰 전역 단일 재생 큐 — 동시 발화 금지, 화자 전환 시 250ms 정적.
// /api/voice/tts 가 503(tts_unavailable)이면 브라우저 speechSynthesis로 폴백한다.

export interface VoiceProfile {
  agentId: string;
  name: string;
  voice?: string;
  speed?: number;
  lang?: string;
  fillers: string[];
  color?: string;
}

export interface QueueItem {
  agent: string;
  kind: string;
  text: string;
  detailHtml?: string;
}

interface UseVoiceQueueOptions {
  onSpeakerChange?: (agentId: string, state: 'speaking' | 'idle') => void;
  onCaption?: (text: string) => void;
  onDetail?: (agentId: string, text: string) => void;
  onTtsFallback?: (usingFallback: boolean) => void;
}

export function useVoiceQueue(opts: UseVoiceQueueOptions = {}) {
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [current, setCurrent] = useState<QueueItem | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const queueRef = useRef<QueueItem[]>([]);
  const speakingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);

  const [muted, setMuted] = useState<boolean>(() => {
    try { return localStorage.getItem('jarvis-muted') === '1'; } catch { return false; }
  });
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const masterGainRef = useRef<GainNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const fxInputRef = useRef<GainNode | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  const optsRef = useRef(opts);
  optsRef.current = opts;

  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      audioCtxRef.current = new Ctx();
      const analyser = audioCtxRef.current.createAnalyser();
      analyser.fftSize = 1024;
      const master = audioCtxRef.current.createGain();
      master.gain.value = mutedRef.current ? 0 : 1;
      master.connect(audioCtxRef.current.destination);
      analyser.connect(master);
      masterGainRef.current = master;
      analyserRef.current = analyser;
      // '기계적' 질감 FX 체인: 협대역 EQ + 얕은 코러스. fxInput → [dry+chorus] → analyser
      const ctx = audioCtxRef.current;
      const fxIn = ctx.createGain();
      // 대역: hp150(기본주파수 ~170Hz 보존, 체감 두께만 덜어냄) / lp12000(밝기 유지).
      // lp5800으로 조이면 스펙트럼 중심이 3490→1946Hz로 깎여 '기계적'이 아니라 '먹먹함'이 된다 (실측 2026-08-25).
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 150;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 12000;
      fxIn.connect(hp); hp.connect(lp);
      const dry = ctx.createGain(); dry.gain.value = 0.75;
      const wet = ctx.createGain(); wet.gain.value = 0.25;
      const delay = ctx.createDelay(0.05); delay.delayTime.value = 0.012;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.7;
      const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.0025;
      lfo.connect(lfoGain); lfoGain.connect(delay.delayTime); lfo.start();
      lp.connect(dry); lp.connect(delay); delay.connect(wet);
      dry.connect(analyser); wet.connect(analyser);
      fxInputRef.current = fxIn;
    }
    return audioCtxRef.current;
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      mutedRef.current = next;
      if (masterGainRef.current) masterGainRef.current.gain.value = next ? 0 : 1;
      // 음소거 중에는 브라우저 TTS 폴백도 즉시 중단한다
      if (next && 'speechSynthesis' in window) speechSynthesis.cancel();
      try { localStorage.setItem('jarvis-muted', next ? '1' : '0'); } catch { /* noop */ }
      return next;
    });
  }, []);

  const speakViaAudioBuffer = useCallback(async (buf: ArrayBuffer, useFx = false) => {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') await ctx.resume();
    const audioBuf = await ctx.decodeAudioData(buf.slice(0));
    return new Promise<void>((resolve) => {
      const src = ctx.createBufferSource();
      src.buffer = audioBuf;
      if (useFx && fxInputRef.current) {
        src.detune.value = -35; // 미세 하향 — 합성감/기계감
        src.connect(fxInputRef.current);
      } else {
        src.connect(analyserRef.current!);
      }
      sourceRef.current = src;
      src.onended = () => { sourceRef.current = null; resolve(); };
      if (cancelledRef.current) { resolve(); return; }
      src.start();
    });
  }, [getAudioCtx]);

  const speakViaBrowserTts = useCallback((text: string, lang: string) => {
    return new Promise<void>((resolve) => {
      if (mutedRef.current) { resolve(); return; }   // 음소거 시 폴백 발화도 건너뛴다
      if (!('speechSynthesis' in window)) { resolve(); return; }
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang || 'ko-KR';
      const vs = speechSynthesis.getVoices();
      const v = vs.find((x) => x.lang === u.lang) || vs.find((x) => x.lang?.startsWith(u.lang.slice(0, 2)));
      if (v) u.voice = v;
      let done = false;
      const finish = () => { if (done) return; done = true; resolve(); };
      u.onend = finish;
      u.onerror = finish;
      speechSynthesis.speak(u);
      setTimeout(finish, Math.max(4000, text.length * 160) + 2000);
    });
  }, []);

  const speakOne = useCallback(async (item: QueueItem) => {
    cancelledRef.current = false;
    optsRef.current.onSpeakerChange?.(item.agent, 'speaking');
    optsRef.current.onCaption?.(item.text);
    if (item.detailHtml) optsRef.current.onDetail?.(item.agent, item.detailHtml);

    await new Promise((r) => setTimeout(r, 250)); // 화자 전환 정적 250ms
    if (cancelledRef.current) return;

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const doFetch = () => fetch('/api/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: item.agent, text: item.text, kind: item.kind }),
        signal: controller.signal,
      });
      let res = await doFetch();
      if (res.status === 503 && !cancelledRef.current) {
        // 일시적 사이드카 오류 대비 1회 재시도 (첫 필러가 브라우저 음성으로 새는 것 방지)
        await new Promise((r) => setTimeout(r, 300));
        res = await doFetch();
      }
      if (res.status === 503) {
        optsRef.current.onTtsFallback?.(true);
        await speakViaBrowserTts(item.text, 'ko-KR');
      } else if (res.ok) {
        optsRef.current.onTtsFallback?.(false);
        const buf = await res.arrayBuffer();
        await speakViaAudioBuffer(buf, item.agent === 'genie');
      } else {
        optsRef.current.onTtsFallback?.(true);
        await speakViaBrowserTts(item.text, 'ko-KR');
      }
    } catch (e) {
      if (!cancelledRef.current) {
        optsRef.current.onTtsFallback?.(true);
        await speakViaBrowserTts(item.text, 'ko-KR');
      }
    } finally {
      abortRef.current = null;
    }
  }, [speakViaAudioBuffer, speakViaBrowserTts]);

  const pump = useCallback(async () => {
    if (speakingRef.current || queueRef.current.length === 0) return;
    const next = queueRef.current.shift()!;
    setQueueItems([...queueRef.current]);
    setCurrent(next);
    speakingRef.current = true;
    setSpeaking(true);
    await speakOne(next);
    speakingRef.current = false;
    setSpeaking(false);
    setCurrent(null);
    optsRef.current.onSpeakerChange?.(next.agent, 'idle');
    void pump();
  }, [speakOne]);

  const enqueue = useCallback((item: QueueItem) => {
    queueRef.current.push(item);
    setQueueItems([...queueRef.current]);
    void pump();
  }, [pump]);

  const bargeIn = useCallback(() => {
    cancelledRef.current = true;
    queueRef.current = [];
    setQueueItems([]);
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
    if (sourceRef.current) { try { sourceRef.current.stop(); } catch { /* noop */ } sourceRef.current = null; }
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    speakingRef.current = false;
    setSpeaking(false);
    setCurrent(null);
    fetch('/api/chat/abort', { method: 'POST' }).catch(() => { /* noop */ });
  }, []);

  useEffect(() => () => {
    if (audioCtxRef.current) audioCtxRef.current.close().catch(() => { /* noop */ });
  }, []);

  return { enqueue, queueItems, current, speaking, bargeIn, analyserRef, muted, toggleMute };
}
