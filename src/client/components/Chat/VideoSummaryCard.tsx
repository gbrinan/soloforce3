import React, { useState } from 'react';
import MediaActions from './MediaActions';
import { btn } from '../../ui/controls';
import { useT } from '../../i18n/I18nProvider';

interface Props {
  url: string;
  videoId?: string;
  shortSummary?: string;
  transcript?: string;
  hasTranscript?: boolean;
  loading?: boolean;
  error?: string;
}

export default function VideoSummaryCard({ url, videoId, shortSummary, transcript, hasTranscript, loading, error }: Props) {
  const t = useT();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');

  const handleSaveLibrary = async () => {
    if (!transcript) return;
    setSaving(true);
    setErr('');
    try {
      const res = await fetch('/api/video/save-library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, transcript, videoId }),
      });
      const data = await res.json() as { ok?: boolean; filename?: string; error?: string };
      if (!data.ok) throw new Error(data.error ?? 'save failed');
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('chat.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ border: '1px solid var(--border-default)', borderRadius: 10, padding: '12px 14px', background: 'var(--bg-surface)', maxWidth: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 16 }}>▶️</span>
          <span style={{ fontSize: 'var(--font-s)', color: 'var(--text-muted)' }}>{t('chat.videoSummaryLoading')}</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      border: '1px solid var(--border-default)',
      borderRadius: 10,
      padding: '12px 14px',
      background: 'var(--bg-surface)',
      maxWidth: '100%',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 16 }}>▶️</span>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 'var(--font-s)', color: 'var(--text-muted)', wordBreak: 'break-all' }}
        >
          {url}
        </a>
      </div>

      {error === 'fetch_failed' || error === 'timeout' ? (
        <p style={{ color: 'var(--accent-danger)', fontSize: 'var(--font-s)', margin: 0 }}>
          {error === 'timeout' ? t('chat.videoSummaryTimeout') : t('chat.videoSummaryFetchFailed')}
        </p>
      ) : !hasTranscript ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-s)', margin: 0 }}>
          {t('chat.videoSummaryNoTranscript')}
        </p>
      ) : (
        <>
          <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', margin: '0 0 4px', fontWeight: 600 }}>
            {t('chat.videoSummaryTitle')}
          </p>
          <p style={{ whiteSpace: 'pre-wrap', margin: '0 0 10px', fontSize: 'var(--font-m)', lineHeight: 1.65 }}>
            {shortSummary}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {!saved ? (
              <button
                onClick={handleSaveLibrary}
                disabled={saving || !transcript}
                style={btn('sm', 'neutral', { cursor: saving ? 'wait' : 'pointer' })}
              >
                {saving ? t('chat.savingEllipsis') : t('chat.viewDetails')}
              </button>
            ) : (
              <span style={{ fontSize: 'var(--font-s)', color: 'var(--color-primary)' }}>
                {t('chat.savedToLibrary')}
              </span>
            )}
            {err && (
              <span style={{ fontSize: 'var(--font-s)', color: 'var(--accent-danger)' }}>{err}</span>
            )}
          </div>
        </>
      )}
      <MediaActions kind="video" url={url} variant="bar" mode="url" />
    </div>
  );
}
