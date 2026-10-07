import React, { useCallback, useState } from 'react';
import { uiAlert } from '../Dialog/dialog';
import { useT } from '../../i18n/I18nProvider';
import { meetingBtn } from './buttonStyles';

interface Props {
  title: string;
  shortSummary?: string;
  shareUrl: string;
  token?: string;
}

export default function MeetingResultCard({ title, shortSummary, shareUrl, token }: Props) {
  const t = useT();
  const [sendingTodos, setSendingTodos] = useState(false);
  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      await uiAlert({ title: t('meeting.urlCopied'), variant: 'info' });
    } catch {
      await uiAlert({ title: t('meeting.copyFailed'), description: t('meeting.copyManual') + shareUrl, variant: 'info' });
    }
  }, [shareUrl, t]);

  const onSendTodos = useCallback(async () => {
    if (!token || sendingTodos) return;
    setSendingTodos(true);
    try {
      const res = await fetch(`/api/meetings/${token}/actions-to-todos`, { method: 'POST' });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; created?: number } | null;
      if (!res.ok || !data?.ok) throw new Error('failed');
      await uiAlert({
        title: data.created ? t('meeting.todosAdded', { n: data.created }) : t('meeting.noActionItems'),
        variant: 'info',
      });
    } catch {
      await uiAlert({ title: t('meeting.sendTodosFailed'), variant: 'info' });
    } finally {
      setSendingTodos(false);
    }
  }, [token, sendingTodos]);

  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--mantine-color-default-border)',
        borderRadius: 10,
        padding: 14,
        margin: '8px 0',
        maxWidth: 480,
      }}
    >
      <div style={{ fontSize: 'var(--font-s)', color: 'var(--mantine-color-dimmed)', marginBottom: 4 }}>
        📄 {t('meeting.createdDone')}
      </div>
      <div style={{ fontSize: 'var(--font-m)', fontWeight: 600, marginBottom: 6 }}>{title}</div>
      {shortSummary && (
        <div
          style={{
            fontSize: 'var(--font-s)',
            color: 'var(--mantine-color-text)',
            opacity: 0.85,
            marginBottom: 10,
            lineHeight: 1.55,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {shortSummary}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <a
          href={shareUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={meetingBtn.primary}
        >
          🔗 {t('meeting.open')}
        </a>
        <button
          type="button"
          onClick={onCopy}
          style={meetingBtn.neutral}
        >
          📋 {t('meeting.copyUrl')}
        </button>
        {token && (
          <button
            type="button"
            onClick={onSendTodos}
            disabled={sendingTodos}
            style={{ ...meetingBtn.neutral, opacity: sendingTodos ? 0.6 : 1 }}
          >
            ✅ {sendingTodos ? t('meeting.sendingTodos') : t('meeting.sendToTodos')}
          </button>
        )}
      </div>
    </div>
  );
}
