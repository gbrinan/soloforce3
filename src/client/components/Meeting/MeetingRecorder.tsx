import React, { useState, useRef, useCallback, useEffect } from 'react';
import { uiAlert } from '../Dialog/dialog';
import { useT } from '../../i18n/I18nProvider';
import { meetingBtn } from './buttonStyles';

interface Props {
  onComplete: (blob: Blob, durationSec: number) => void | Promise<void>;
  onRecordingStateChange?: (isRecording: boolean) => void;
  disabled?: boolean;
  extra?: React.ReactNode;
}

function fmtTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function MeetingRecorder({ onComplete, onRecordingStateChange, disabled, extra }: Props) {
  const t = useT();
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startTimeRef = useRef(0);
  const pausedAccumRef = useRef(0);
  const pauseStartRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  const tick = useCallback(() => {
    if (paused) return;
    const now = Date.now();
    const e = Math.floor((now - startTimeRef.current - pausedAccumRef.current) / 1000);
    setElapsed(e);
  }, [paused]);

  useEffect(() => {
    if (!recording) return;
    const iv = window.setInterval(tick, 500);
    timerRef.current = iv;
    return () => { if (timerRef.current) window.clearInterval(timerRef.current); };
  }, [recording, tick]);

  const cleanup = useCallback(() => {
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    recorderRef.current = null;
    chunksRef.current = [];
    pausedAccumRef.current = 0;
    pauseStartRef.current = 0;
  }, []);

  const start = useCallback(async () => {
    if (recording || disabled) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      void uiAlert({ title: t('meeting.micUnsupported'), variant: 'info' });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
      const mimeType = preferred.find((t) => MediaRecorder.isTypeSupported(t)) || '';
      const mr = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = mr;
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start(1000);
      startTimeRef.current = Date.now();
      pausedAccumRef.current = 0;
      setRecording(true);
      onRecordingStateChange?.(true);
      setPaused(false);
      setElapsed(0);
    } catch (err) {
      void uiAlert({
        title: t('meeting.micDenied'),
        description: err instanceof Error ? err.message : String(err),
        variant: 'info',
      });
      cleanup();
    }
  }, [recording, disabled, cleanup]);

  const togglePause = useCallback(() => {
    const mr = recorderRef.current;
    if (!mr) return;
    if (paused) {
      try { mr.resume(); } catch { /* */ }
      const now = Date.now();
      pausedAccumRef.current += (now - pauseStartRef.current);
      setPaused(false);
    } else {
      try { mr.pause(); } catch { /* */ }
      pauseStartRef.current = Date.now();
      setPaused(true);
    }
  }, [paused]);

  const stop = useCallback(() => {
    const mr = recorderRef.current;
    if (!mr) return;
    const dur = elapsed;
    mr.onstop = () => {
      const type = chunksRef.current[0]?.type || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type });
      cleanup();
      setRecording(false);
      onRecordingStateChange?.(false);
      setPaused(false);
      setElapsed(0);
      void onComplete(blob, dur);
    };
    try { mr.stop(); } catch { cleanup(); setRecording(false); onRecordingStateChange?.(false); }
  }, [elapsed, onComplete, cleanup]);

  useEffect(() => () => cleanup(), [cleanup]);

  useEffect(() => {
    if (!recording) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [recording]);

  useEffect(() => {
    if (!recording) return;
    const handler = () => {
      if (document.hidden) return;
      const mr = recorderRef.current;
      if (mr && mr.state === 'inactive' && chunksRef.current.length > 0) {
        // 탭 복귀 시 예기치 않게 멈췄으면 chunks 보존됨
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [recording]);

  return (
    <div style={{ background: 'var(--bg-surface, #070D1A)', border: '1px solid var(--border-default, #1F293D)', borderRadius: 10, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 'var(--font-m)' }}>{t('meeting.recorderTitle')}</strong>
        {recording && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--font-s)', color: paused ? 'var(--text-muted, #7D8699)' : 'var(--accent-danger)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: paused ? '#7D8699' : 'var(--accent-danger)', display: 'inline-block', animation: paused ? 'none' : 'pulse 1s infinite' }} />
            {paused ? t('meeting.paused') : t('meeting.recording')} · {fmtTime(elapsed)}
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {!recording ? (
            <button
              type="button"
              onClick={start}
              disabled={disabled}
              style={{ ...meetingBtn.danger, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 }}
            >
              {t('meeting.startRecording')}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={togglePause}
                style={meetingBtn.neutral}
              >
                {paused ? t('meeting.resume') : t('meeting.pauseBtn')}
              </button>
              <button
                type="button"
                onClick={stop}
                style={meetingBtn.primary}
              >
                {t('meeting.stop')}
              </button>
            </>
          )}
        </div>
      </div>
      {extra && (
        <>
          <div style={{ borderTop: '1px solid var(--border-default, #1F293D)', margin: '12px 8px 0' }} />
          <div style={{ marginTop: 12 }}>{extra}</div>
        </>
      )}
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
    </div>
  );
}
