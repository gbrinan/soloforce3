import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage } from '../../utils/api';
import type { StreamState } from '../../hooks/useChat';
import { useT } from '../../i18n/I18nProvider';
import { useVoiceQueue, type QueueItem, type VoiceProfile } from './useVoiceQueue';
import { useAudioRing } from './useAudioRing';
import { useMic } from './useMic';
import { useWakeWord } from './useWakeWord';
import { segmentSentences, stripNonSpeech, summarizePreview } from './speechText';
import soloforceImg from '../../assets/jarvis/soloforce.jpg';
import ashalImg from '../../assets/jarvis/ashal.jpg';
import qaImg from '../../assets/jarvis/qa.jpg';
import backdropImg from '../../assets/jarvis/backdrop.jpg';
import './jarvis.css';
import { noteVoiceDelegation, noteTextSubmit, isCancelCommand, today as metricsToday, bump as metricsBump } from './voiceMetrics';

// 자비스뷰 — 음성 우선 UI. chat-stream/chat/job-complete-toast는 App.tsx의 단일 useSSE 구독을
// 그대로 통과받은 messages/stream props를 관찰해 재사용한다(별도 EventSource 생성 없음).

interface JarvisViewProps {
  genieName: string;
  ownerName: string;
  messages: ChatMessage[];
  stream: StreamState;
  onExit: () => void;
}

const AVATAR_MAP: Record<string, string> = { genie: soloforceImg, 'dev-pm': ashalImg, qa: qaImg };
const DEFAULT_COLOR = '#4cc6d2';
const AGENT_COLORS: Record<string, string> = { genie: '#4cc6d2', 'dev-pm': '#f0b650', qa: '#7fd184' };

function avatarFor(agentId: string): string | null {
  return AVATAR_MAP[agentId] || null;
}
function colorFor(agentId: string, profiles: Record<string, VoiceProfile>): string {
  return profiles[agentId]?.color || AGENT_COLORS[agentId] || DEFAULT_COLOR;
}
function initialFor(agentId: string, profiles: Record<string, VoiceProfile>): string {
  const name = profiles[agentId]?.name || agentId;
  return name.trim().slice(0, 1).toUpperCase() || '?';
}

interface DetailEntry { agentId: string; text: string; ts: number; }

export default function JarvisView({ genieName, ownerName, messages, stream, onExit }: JarvisViewProps) {
  const t = useT();
  const [profiles, setProfiles] = useState<Record<string, VoiceProfile>>({});
  const [health, setHealth] = useState<{ tts: boolean; stt: boolean }>({ tts: true, stt: true });
  const [ttsFallback, setTtsFallback] = useState(false);
  const [speakerAgent, setSpeakerAgent] = useState('genie');
  const [speakerState, setSpeakerState] = useState<'idle' | 'speaking' | 'listening'>('idle');
  const [caption, setCaption] = useState(t('app.jarvisWaiting'));
  const [details, setDetails] = useState<DetailEntry[]>([]);
  const [textInput, setTextInput] = useState('');
  const [transcriptFlash, setTranscriptFlash] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false);
  // 하단 직원 레일 — /api/staff 폴링으로 전 직원 busy + 알바(autoCount) 표시
  const [staffRail, setStaffRail] = useState<{ id: string; name: string; busy: boolean }[]>([]);
  const [albaCount, setAlbaCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/staff');
        if (!res.ok) return;
        const j = await res.json() as { genie?: { autoCount?: number }; teams?: { lead?: any; members?: any[] }[] };
        if (cancelled) return;
        const list: { id: string; name: string; busy: boolean }[] = [];
        for (const t of j.teams ?? []) {
          for (const a of [t.lead, ...(t.members ?? [])]) {
            if (a?.id) list.push({ id: a.id, name: a.name || a.id, busy: !!a.busy });
          }
        }
        list.sort((a, b) => Number(b.busy) - Number(a.busy));
        setStaffRail(list);
        setAlbaCount(j.genie?.autoCount ?? 0);
      } catch { /* 폴링 실패 무시 */ }
    };
    void load();
    const iv = window.setInterval(load, 15_000);
    return () => { cancelled = true; window.clearInterval(iv); };
  }, []);
  const [wakeCheckLog, setWakeCheckLog] = useState<{ text: string; matched: boolean; engine?: string; ms?: number } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colorRef = useRef(DEFAULT_COLOR);
  const spokenCountRef = useRef(0);
  const prevStreamTextRef = useRef('');
  const prevActiveRef = useRef(false);
  const prevMsgCountRef = useRef(messages.length);
  const detailScrollRef = useRef<HTMLDivElement>(null);

  const onCaption = useCallback((text: string) => setCaption(text), []);
  const onDetail = useCallback((agentId: string, text: string) => {
    setDetails((prev) => [...prev, { agentId, text, ts: Date.now() }]);
  }, []);
  const onSpeakerChange = useCallback((agentId: string, state: 'speaking' | 'idle') => {
    setSpeakerAgent(agentId);
    setSpeakerState(state === 'speaking' ? 'speaking' : 'idle');
    colorRef.current = colorFor(agentId, profilesRef.current);
  }, []);
  const onTtsFallback = useCallback((usingFallback: boolean) => setTtsFallback(usingFallback), []);

  const { enqueue, queueItems, current, bargeIn, muted, toggleMute, analyserRef: playbackAnalyserRef } =
    useVoiceQueue({ onSpeakerChange, onCaption, onDetail, onTtsFallback });

  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;

  // 마이크 활성 시 링 분석기를 마이크 스트림으로 전환하기 위한 결합 ref
  const combinedAnalyserRef = useRef<AnalyserNode | null>(null);
  useAudioRing(canvasRef, combinedAnalyserRef, colorRef);

  const submitText = useCallback((text: string, source: 'voice' | 'text' = 'text') => {
    if (!text.trim()) return;
    // J-R: "방금 거 취소" 류 음성 명령 — 지시로 보내지 않고 현재 턴을 중단한다
    if (source === 'voice' && isCancelCommand(text)) {
      metricsBump('voiceCancels');
      bargeIn();
      fetch('/api/chat/abort', { method: 'POST' }).catch(() => { /* noop */ });
      enqueue({ agent: 'genie', kind: '취소', text: '네, 방금 지시를 취소했습니다.' });
      return;
    }
    if (source === 'voice') noteVoiceDelegation(); else noteTextSubmit();
    const genieProfile = profilesRef.current.genie;
    const fillers = genieProfile?.fillers?.length ? genieProfile.fillers : ['네, 확인하겠습니다.'];
    const filler = fillers[Math.floor(Math.random() * fillers.length)];
    enqueue({ agent: 'genie', kind: '필러', text: filler });
    fetch('/api/voice/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }).catch(() => { /* noop — SSE chat/chat-stream이 실제 응답을 전달 */ });
  }, [enqueue]);

  const { pttDown, pttUp, toggleHandsFree, handsFree, listening, micAnalyserRef } = useMic({
    isAssistantSpeaking: speakerState === 'speaking',
    onTranscript: (text) => setTranscriptFlash(text),
    onSubmitText: (text) => { setTranscriptFlash(null); submitText(text, 'voice'); },
    onListeningChange: (isListening) => {
      combinedAnalyserRef.current = isListening ? micAnalyserRefLive.current : playbackAnalyserRef.current;
      if (isListening) { setSpeakerState('listening'); colorRef.current = '#e0655c'; }
      else { colorRef.current = colorFor(speakerAgent, profilesRef.current); setSpeakerState('idle'); }
    },
    onProcessingChange: (p) => setProcessing(p),
  });
  const micAnalyserRefLive = useRef<AnalyserNode | null>(null);
  useEffect(() => { micAnalyserRefLive.current = micAnalyserRef.current; }, [listening, micAnalyserRef]);

  // 재생 중이 아니고 마이크도 꺼져 있으면 링은 재생 analyser를 기본으로 사용
  useEffect(() => {
    if (!listening) combinedAnalyserRef.current = playbackAnalyserRef.current;
  }, [listening, playbackAnalyserRef]);

  // 웨이크워드 — 핸즈프리가 꺼져 있고 토글이 켜져 있을 때만 VAD+짧은 발화 STT로 호출 단어를 확인한다.
  const wakePhrases = useMemo(() => {
    const list = ['솔로포스', '솔로포스야', '자비스'];
    const genieDisplayName = profiles.genie?.name || genieName;
    if (genieDisplayName && !list.includes(genieDisplayName)) list.push(genieDisplayName);
    return list;
  }, [profiles.genie?.name, genieName]);

  const { state: wakeState } = useWakeWord({
    enabled: wakeWordEnabled && !handsFree,
    isAssistantSpeaking: speakerState === 'speaking',
    wakePhrases,
    onCommand: (text) => { setTranscriptFlash(text); window.setTimeout(() => { setTranscriptFlash(null); submitText(text, 'voice'); }, 1200); },
    onWakeCheckLogged: (info) => {
      setWakeCheckLog(info);
      // eslint-disable-next-line no-console
      console.debug('[wake-word]', info.matched ? 'MATCH' : 'check', JSON.stringify(info));
    },
  });

  useEffect(() => {
    fetch('/api/voice/agents').then((r) => (r.ok ? r.json() : [])).then((list: VoiceProfile[]) => {
      const map: Record<string, VoiceProfile> = {};
      for (const p of list || []) map[p.agentId] = p;
      setProfiles(map);
    }).catch(() => { /* noop */ });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      fetch('/api/voice/health').then((r) => (r.ok ? r.json() : null)).then((data) => {
        if (!cancelled && data) setHealth({ tts: !!data.tts, stt: !!data.stt });
      }).catch(() => { /* noop */ });
    };
    poll();
    const iv = window.setInterval(poll, 20000);
    return () => { cancelled = true; window.clearInterval(iv); };
  }, []);

  // chat-stream 실시간 세그먼테이션 — 완결 문장이 나올 때마다 큐에 넣는다.
  useEffect(() => {
    if (!stream.active) {
      if (prevActiveRef.current) {
        // 스트림 종료 — 남은 remainder는 이후 finalized 'chat' 메시지에서 처리
        spokenCountRef.current = 0;
        prevStreamTextRef.current = '';
      }
      prevActiveRef.current = false;
      return;
    }
    prevActiveRef.current = true;
    const text = stream.text || '';
    if (!text.startsWith(prevStreamTextRef.current)) spokenCountRef.current = 0;
    prevStreamTextRef.current = text;
    const { sentences } = segmentSentences(text);
    if (sentences.length > spokenCountRef.current) {
      for (let i = spokenCountRef.current; i < sentences.length; i++) {
        enqueue({ agent: 'genie', kind: '응답', text: sentences[i] });
      }
      spokenCountRef.current = sentences.length;
    }
  }, [stream.text, stream.active, enqueue]);

  // 확정된 'chat' 메시지 감시 — 남은 remainder만 보충 발화하고, job-complete 마커는 완료/실패 보고로 변환.
  useEffect(() => {
    if (messages.length <= prevMsgCountRef.current) { prevMsgCountRef.current = messages.length; return; }
    const newMsgs = messages.slice(prevMsgCountRef.current);
    prevMsgCountRef.current = messages.length;
    for (const m of newMsgs) {
      if (m.role !== 'genie') continue;
      const jobMatch = m.content.match(/^<!--JOB_COMPLETE:(.*?)-->$/s);
      if (jobMatch) {
        try {
          const data = JSON.parse(jobMatch[1]) as { status?: string; preview?: string; error?: string; agentId?: string; agentName?: string; request?: string };
          const agentId = data.agentId || 'genie';
          const failed = data.status === 'failed';
          const summary = summarizePreview(failed ? (data.error || data.preview || '') : (data.preview || ''));
          if (summary) {
            enqueue({ agent: agentId, kind: failed ? '실패 보고' : '완료 보고', text: summary });
          }
          onDetail(agentId, `<b>${data.request || data.agentName || agentId}</b><pre>${(data.preview || data.error || '').slice(0, 800)}</pre>`);
        } catch { /* noop */ }
        continue;
      }
      // 확정 메시지는 마지막이므로 remainder까지 반드시 발화한다.
      // sentences만 쓰면 10자 미만 종결 문장("네." 등)이 remainder에 남아 영구 누락된다.
      const seg = segmentSentences(stripNonSpeech(m.content) + ' ');
      const parts = seg.sentences.slice(spokenCountRef.current);
      const tail = seg.remainder.trim();
      if (tail) parts.push(tail);
      // 문장별 enqueue — 통짜로 넣으면 장문 보고가 자막을 점령하고 한 TTS 요청이 과대해진다
      for (const sentence of parts) {
        const t = sentence.trim();
        if (t) enqueue({ agent: 'genie', kind: '응답', text: t });
      }
      spokenCountRef.current = 0;
      prevStreamTextRef.current = '';
    }
  }, [messages, enqueue, onDetail]);

  useEffect(() => {
    if (detailScrollRef.current) detailScrollRef.current.scrollTop = detailScrollRef.current.scrollHeight;
  }, [details]);

  // Space 홀드 = PTT / 끼어들기, 입력 포커스 중에는 비활성.
  useEffect(() => {
    const isTyping = () => {
      const el = document.activeElement;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || isTyping()) return;
      e.preventDefault();
      if (current || queueItems.length) bargeIn();
      else if (!handsFree) void pttDown();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTyping() || handsFree) return;
      pttUp();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
    };
  }, [bargeIn, current, queueItems.length, handsFree, pttDown, pttUp]);

  const displayItems: QueueItem[] = useMemo(() => {
    const items = current ? [{ ...current, _cur: true } as QueueItem & { _cur?: boolean }] : [];
    items.push(...queueItems);
    return items;
  }, [current, queueItems]);

  const allAgentIds = useMemo(() => {
    const CORE = ['genie', 'dev-pm', 'qa'];
    const ids = new Set<string>(CORE.filter((id) => id === 'genie' || profiles[id]));
    return Array.from(ids);
  }, [profiles]);

  const activeColor = colorFor(speakerAgent, profiles);
  const avatarSrc = avatarFor(speakerAgent);
  const stateLabel = speakerState === 'speaking' ? t('app.jarvisSpeaking') : speakerState === 'listening' ? t('app.jarvisListening') : t('app.jarvisWaiting');
  // 마이크 상태 라벨 — idle / 듣는 중 / 인식 중(STT 호출) / 호출 대기(웨이크워드)
  const wakeListeningIdle = wakeWordEnabled && !handsFree;
  const micLive = listening || wakeListeningIdle;
  const micStateLabel = processing
    ? '인식 중'
    : wakeState === 'armed'
      ? '호출됨 — 말씀하세요'
      : listening
        ? '듣는 중'
        : wakeListeningIdle
          ? '웨이크워드 대기 중'
          : 'idle';
  const displayName = speakerAgent === 'genie' ? (genieName || 'SoloForce') : (profiles[speakerAgent]?.name || speakerAgent);

  return (
    <div className="jarvis-root" style={{ backgroundImage: `url(${backdropImg})` } as React.CSSProperties}>
      <div className="jarvis-scene" style={{ backgroundImage: `url(${backdropImg})` }}>
        <div className="jarvis-mic">
          <button
            type="button"
            className={`jarvis-btn${listening && !handsFree ? ' rec' : ''}`}
            aria-pressed={listening && !handsFree}
            onMouseDown={() => { if (!handsFree) void pttDown(); }}
            onMouseUp={() => { if (!handsFree) pttUp(); }}
            onMouseLeave={() => { if (!handsFree) pttUp(); }}
          >
            🎙 {t('app.jarvisPtt')}
          </button>
          <button
            type="button"
            className={`jarvis-btn${handsFree ? ' on' : ''}`}
            aria-pressed={handsFree}
            onClick={() => void toggleHandsFree()}
          >
            {handsFree ? t('app.jarvisHandsOn') : t('app.jarvisHandsOff')}
          </button>
          <button
            type="button"
            className={`jarvis-btn${wakeWordEnabled ? ' on' : ''}`}
            aria-pressed={wakeWordEnabled}
            disabled={handsFree}
            title={handsFree ? '핸즈프리 사용 중에는 웨이크워드를 켤 수 없습니다' : undefined}
            onClick={() => setWakeWordEnabled((v) => !v)}
          >
            {wakeWordEnabled ? '웨이크워드 켜짐' : '웨이크워드 꺼짐'}
          </button>
          <button
            type="button"
            className={`jarvis-btn${muted ? ' muted' : ''}`}
            aria-pressed={muted}
            title={muted ? '소리 꺼짐 — 클릭하면 켜기' : '소리 켜짐 — 클릭하면 끄기'}
            onClick={toggleMute}
          >
            {muted ? '🔇 소리 꺼짐' : '🔊 소리 켜짐'}
          </button>
          <button type="button" className="jarvis-btn" onClick={onExit}>
            {t('app.chat')}
          </button>
        </div>
        <div className="jarvis-hint">
          {micStateLabel}
          <br />Space = PTT / barge-in
          {wakeWordEnabled && wakeCheckLog && (
            <div className="jarvis-wake-log" title="웨이크워드 확인 비용 — STT 엔진/처리시간">
              wake-check: "{wakeCheckLog.text || '(무음)'}" {wakeCheckLog.matched ? '✓ 일치' : ''} · {wakeCheckLog.engine || '-'} · {wakeCheckLog.ms ?? '-'}ms
            </div>
          )}
        </div>
        {ttsFallback && <div className="jarvis-banner">{t('app.jarvisTtsFallback')}</div>}
        <div className="jarvis-health">
          {micLive && (
            <span className="pill jarvis-live-pill" role="status" aria-live="polite">
              <span className="dot live-dot" />마이크 켜짐
            </span>
          )}
          <span className="pill" style={{ color: health.tts ? '#7fd184' : '#e0655c' }}>
            <span className="dot" style={{ background: health.tts ? '#7fd184' : '#e0655c' }} />TTS
          </span>
          <span className="pill" style={{ color: health.stt ? '#7fd184' : '#e0655c' }}>
            <span className="dot" style={{ background: health.stt ? '#7fd184' : '#e0655c' }} />STT
          </span>
        </div>
        <div className="jarvis-center">
          <div className="jarvis-halo" style={{ ['--jv-c' as any]: activeColor }}>
            <canvas ref={canvasRef} width={480} height={480} />
            <div className="jarvis-avatar">
              {avatarSrc
                ? <img src={avatarSrc} alt={displayName} />
                : <div className="jarvis-avatar-fallback">{initialFor(speakerAgent, profiles)}</div>}
            </div>
          </div>
          <div className="jarvis-name" style={{ ['--jv-c' as any]: activeColor }}>
            <span>{displayName}</span>
            <span className="state">{stateLabel}</span>
          </div>
          <div className="jarvis-caption">
            {transcriptFlash ? `"${transcriptFlash}"` : caption}
          </div>
        </div>
        <div className="jarvis-queue">
          {displayItems.length
            ? displayItems.slice(0, 3).map((it, idx) => {
                const isCur = (it as any)._cur;
                const c = colorFor(it.agent, profiles);
                const src = avatarFor(it.agent);
                return (
                  <div key={`${it.agent}-${idx}`} className={`jarvis-chip${isCur ? ' active' : ' waiting'}`} style={{ ['--jv-c' as any]: c }}>
                    {src ? <img src={src} alt="" /> : <span className="fallback-img">{initialFor(it.agent, profiles)}</span>}
                    <span>{it.agent === 'genie' ? (genieName || profiles.genie?.name || 'SoloForce') : (profiles[it.agent]?.name || it.agent)}</span>
                    <span className="n">{isCur ? stateLabel : it.kind}</span>
                  </div>
                );
              }).concat(displayItems.length > 3
                ? [<div key="more" className="jarvis-queue-more">+{displayItems.length - 3} 대기</div>]
                : [])
            : allAgentIds.map((id) => {
                const c = colorFor(id, profiles);
                const src = avatarFor(id);
                return (
                  <div key={id} className="jarvis-chip" style={{ ['--jv-c' as any]: c }}>
                    {src ? <img src={src} alt="" /> : <span className="fallback-img">{initialFor(id, profiles)}</span>}
                    <span>{id === 'genie' ? (genieName || profiles.genie?.name || 'SoloForce') : (profiles[id]?.name || id)}</span>
                    <span className="n">{t('app.jarvisWaiting')}</span>
                  </div>
                );
              })}
        </div>
        <div className="jarvis-staff-rail" aria-label="직원 상태">
          {staffRail.map((a) => (
            <React.Fragment key={a.id}>
              <span className={`jarvis-staff-dot${a.busy ? ' busy' : ''}`} title={`${a.name}${a.busy ? ' — 작업 중' : ''}`}>
                {(a.name || '?').slice(0, 1)}
              </span>
              {a.busy && <span className="jarvis-staff-busyname">{a.name}</span>}
            </React.Fragment>
          ))}
          {albaCount > 0 && <span className="jarvis-alba-badge">알바 {albaCount}</span>}
        </div>
      </div>
      <aside className="jarvis-panel">
        <h3>{t('app.jarvisDetailTitle')}</h3>
        <div className="jarvis-metrics" title="JTBD 검증 지표 (localStorage, 오늘)">
          {(() => { const m = metricsToday(); const wakeFalse = Math.max(0, m.wakeChecks - m.wakeMatches);
            return `오늘 — 음성위임 ${m.voiceDelegations} · 재작업의심 ${m.textRedoSuspects} · 취소 ${m.voiceCancels} · 웨이크 ${m.wakeMatches}/${m.wakeChecks}(오탐 ${wakeFalse})`; })()}
        </div>
        <div className="jarvis-detail" ref={detailScrollRef}>
          {details.length === 0 && <div className="m" style={{ color: 'var(--jv-muted)' }}>{t('app.jarvisDetailEmpty')}</div>}
          {details.map((d, idx) => (
            <div className="m" key={idx}>
              <div className="who" style={{ color: colorFor(d.agentId, profiles) }}>{profiles[d.agentId]?.name || d.agentId}</div>
              <div dangerouslySetInnerHTML={{ __html: d.text }} />
            </div>
          ))}
        </div>
        <form
          className="jarvis-input"
          onSubmit={(e) => {
            e.preventDefault();
            const v = textInput.trim();
            if (!v) return;
            setTextInput('');
            if (current || queueItems.length) bargeIn();
            submitText(v);
          }}
        >
          <input
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder={t('app.jarvisInputPlaceholder')}
            autoComplete="off"
            aria-label={t('app.jarvisInputPlaceholder')}
          />
          <button type="submit" className="jarvis-btn">↵</button>
        </form>
      </aside>
    </div>
  );
}
