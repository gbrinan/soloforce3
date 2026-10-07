import React, { useState, useEffect } from 'react';
import { useT } from '../../i18n/I18nProvider';

// 워커 질문 카드 (#13) — ChatBubble이 ❓ 메시지의 qid로 렌더.
// 자체 폴링: /api/worker-questions/:id 를 2초마다 조회 (전역 상태 불필요).

interface WorkerQuestion {
  id: string;
  agentId: string;
  question: string;
  options: string[];
  createdAt: number;
  status: 'pending' | 'answered';
  answer?: string;
  answerSource?: 'user' | 'genie' | 'worker-judge';
  genieOpinion?: string;
}

const WINDOW_SEC = 180;

export default function WorkerQuestionCard({ id }: { id: string }) {
  const t = useT();
  const [q, setQ] = useState<WorkerQuestion | null>(null);
  const [genieName, setGenieName] = useState('');

  useEffect(() => {
    fetch('/api/genie-name').then(r => r.json()).then(d => { if (d.name) setGenieName(d.name); }).catch(() => {});
  }, []);
  const [countdown, setCountdown] = useState(WINDOW_SEC);
  const [answering, setAnswering] = useState(false);
  const [custom, setCustom] = useState('');

  // pending 동안 2초 폴링
  useEffect(() => {
    let cancelled = false;
    let iv: ReturnType<typeof setInterval> | null = null;
    const poll = async () => {
      try {
        const res = await fetch(`/api/worker-questions/${id}`);
        if (!res.ok || cancelled) return;
        const data = await res.json() as WorkerQuestion;
        if (cancelled) return;
        setQ(data);
        if (data.status === 'answered' && iv) { clearInterval(iv); iv = null; }
      } catch { /* */ }
    };
    poll();
    iv = setInterval(poll, 2000);
    return () => { cancelled = true; if (iv) clearInterval(iv); };
  }, [id]);

  // 카운트다운
  useEffect(() => {
    if (!q || q.status === 'answered') return;
    const update = () => {
      const elapsed = Math.round((Date.now() - q.createdAt) / 1000);
      setCountdown(Math.max(WINDOW_SEC - elapsed, 0));
    };
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [q]);

  const submit = async (answer: string) => {
    if (!answer.trim() || answering) return;
    setAnswering(true);
    try {
      await fetch(`/api/worker-questions/${id}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer }),
      });
    } catch { /* 폴링이 상태를 갱신 */ }
    setAnswering(false);
  };

  if (!q) return null;

  if (q.status === 'answered') {
    const srcLabel = q.answerSource === 'user' ? t('worker.srcUser')
      : q.answerSource === 'genie' ? t('worker.srcGenie', { name: genieName })
      : t('worker.srcSelf');
    return (
      <div className="approval-result approval-result-allowed" style={{ marginTop: 8 }}>
        {t('worker.answered')} · {srcLabel}{q.answer ? ` — ${q.answer}` : ''}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 8, background: 'var(--bg-canvas)', border: '1px solid var(--border-default)', borderRadius: 10, padding: 10 }}>
      <div style={{ fontSize: 'var(--font-s)', color: countdown <= 20 ? 'var(--accent-danger)' : 'var(--text-muted)', marginBottom: 6 }}>
        {t('worker.title')} · {countdown > 0 ? t('worker.countdownPending', { n: countdown, name: genieName }) : t('worker.judging')}
      </div>
      {q.genieOpinion && (
        <div className="genie-opinion" style={{ marginBottom: 6 }}>
          <span style={{ fontWeight: 600, color: 'var(--accent-info)' }}>{t('worker.genieOpinionLabel', { name: genieName })}</span>{' '}
          <span style={{ color: 'var(--text-secondary)' }}>{q.genieOpinion}</span>
        </div>
      )}
      {q.options.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {q.options.map((o, i) => (
            <button
              key={i}
              disabled={answering}
              onClick={() => submit(o)}
              className="approval-btn approval-btn-allow"
              style={{ flex: 'unset', padding: '5px 10px' }}
            >
              {o}
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(custom); }}
          placeholder={t('worker.customPlaceholder')}
          disabled={answering}
          style={{
            flex: 1, minWidth: 0, background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
            borderRadius: 6, color: 'var(--text-primary)', fontSize: 'var(--font-s)', padding: '5px 8px',
          }}
        />
        <button
          disabled={answering || !custom.trim()}
          onClick={() => submit(custom)}
          className="approval-btn approval-btn-allow"
          style={{ flex: 'unset', padding: '5px 12px' }}
        >
          {t('worker.send')}
        </button>
      </div>
    </div>
  );
}
