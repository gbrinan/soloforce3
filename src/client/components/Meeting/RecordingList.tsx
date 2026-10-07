import React from 'react';
import { Badge } from '@mantine/core';
import { BadgeDot } from '../Todos/TodoGauge';
import { aggregateBadgeColor } from '../Todos/todoStatus';
import type { RecordingMeta, MeetingMeta } from './MeetingDrawer';
import { useT } from '../../i18n/I18nProvider';
import { openAppWithAsset, isAppAvailable } from '../../utils/assetHandoff';
import { meetingBtn } from './buttonStyles';
import { uiAlert } from '../Dialog/dialog';

interface Props {
  recordings: RecordingMeta[];
  meetings: MeetingMeta[];
  loading: boolean;
  summaryPending: boolean;
  onAttachToChat: (rec: RecordingMeta) => void;
  onSummarize: (rec: RecordingMeta, provider: 'groq' | 'gemini') => void;
  onCopyUrl: (url: string) => void;
  onRefresh: () => void;
  onDeleteRecording: (rec: RecordingMeta) => void;
  onDeleteMeeting: (m: MeetingMeta) => void;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtDur(sec: number | undefined): string {
  if (!sec || !Number.isFinite(sec)) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtRelative(iso: string | undefined | null, t: ReturnType<typeof useT>): string {
  if (!iso) return '';
  const d = new Date(iso);
  const time = d.getTime();
  if (!Number.isFinite(time)) return '';
  const diff = Date.now() - time;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return t('meeting.justNow');
  if (min < 60) return t('meeting.minsAgo', { n: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t('meeting.hoursAgo', { n: hr });
  const day = Math.floor(hr / 24);
  if (day < 7) return t('meeting.daysAgo', { n: day });
  return d.toISOString().slice(0, 10);
}

export default function RecordingList({ recordings, meetings, loading, summaryPending, onAttachToChat, onSummarize, onCopyUrl, onRefresh, onDeleteRecording, onDeleteMeeting }: Props) {
  const t = useT();

  const sendToNote = async (token: string) => {
    try {
      const res = await fetch(`/api/meetings/${token}/send-to-note`, { method: 'POST' });
      if (!res.ok) throw new Error('failed');
      await uiAlert({ title: t('meeting.sendNoteDone'), variant: 'info' });
    } catch {
      await uiAlert({ title: t('meeting.sendNoteFailed'), variant: 'info' });
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <strong style={{ fontSize: 'var(--font-m)' }}>{t('meeting.recordingsCount', { n: recordings.length })}</strong>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          aria-label={t('meeting.refresh')}
          style={meetingBtn.subtle}
        >
          {loading ? '⟳' : '↻'}
        </button>
      </div>

      {recordings.length === 0 && !loading && (
        <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-s)', padding: '12px 0' }}>
          {t('meeting.noRecordings')}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {recordings.map((r) => (
          <div
            key={r.id}
            style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border-default)', borderRadius: 6, padding: 10 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 'var(--font-s)', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.source === 'mic' ? '🎤 ' : '📁 '}
                  {r.originalName || `recording-${r.id.slice(0, 8)}.${r.ext}`}
                </div>
                <div style={{ fontSize: 'var(--font-s)', color: 'var(--text-muted)', marginTop: 2 }}>
                  {fmtSize(r.size)}{r.durationSec ? ` · ${fmtDur(r.durationSec)}` : ''} · {fmtRelative(r.createdAt, t)}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => onAttachToChat(r)}
                style={meetingBtn.neutral}
              >
                {t('meeting.attachToChat')}
              </button>
              <button
                type="button"
                onClick={() => onSummarize(r, 'groq')}
                disabled={summaryPending || meetings.some((m) => m.recordingPath === r.path && m.status === 'processing')}
                style={meetingBtn.neutral}
              >
                {t('meeting.groqSummarizeBtn')}
              </button>
              <button
                type="button"
                onClick={() => onSummarize(r, 'gemini')}
                disabled={summaryPending || meetings.some((m) => m.recordingPath === r.path && m.status === 'processing')}
                style={meetingBtn.neutral}
              >
                {t('meeting.geminiSummarizeBtn')}
              </button>
              <button
                type="button"
                onClick={() => onDeleteRecording(r)}
                aria-label={t('meeting.deleteRecording')}
                title={t('common.delete')}
                style={{ ...meetingBtn.dangerSubtle, marginLeft: 'auto' }}
              >
                🗑
              </button>
            </div>
          </div>
        ))}
      </div>

      {meetings.length > 0 && (
        <>
          <div style={{ marginTop: 16, marginBottom: 8 }}>
            <strong style={{ fontSize: 'var(--font-m)' }}>{t('meeting.meetingsCount', { n: meetings.length })}</strong>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {meetings.map((m) => {
              const isReady = m.status === 'ready';
              const isProcessing = m.status === 'processing';
              const isFailed = m.status === 'failed';
              return (
                <div
                  key={m.token}
                  draggable={isReady}
                  onDragStart={isReady ? (e) => {
                    e.dataTransfer.setData(
                      'application/x-mycrew-attachment',
                      JSON.stringify({ type: 'meeting-note', name: m.title, path: 'history/outputs/meetings/' + m.token + '.html' })
                    );
                    e.dataTransfer.effectAllowed = 'copy';
                  } : undefined}
                  style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border-default)', borderRadius: 6, padding: 10, cursor: isReady ? 'grab' : undefined }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 'var(--font-s)', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        📄 {m.title}
                      </div>
                      <div style={{ fontSize: 'var(--font-s)', color: 'var(--text-muted)', marginTop: 2 }}>
                        {fmtRelative(m.createdAt, t)} ·{' '}
                        {isReady ? (
                          // 업무 카드(TaskCard) 완료 배지와 동일 스타일로 통일 — 기본 filled variant + aggregateBadgeColor('all-done').
                          <Badge size="xs" leftSection={BadgeDot} color={aggregateBadgeColor('all-done')}>{t('todo.stateDone')}</Badge>
                        ) : (
                          <Badge
                            size="xs"
                            variant="light"
                            color={isProcessing ? 'yellow' : 'red'}
                            leftSection={BadgeDot}
                          >
                            {isProcessing ? t('meeting.processing') : t('job.statusFailed')}
                          </Badge>
                        )}
                        {isFailed && m.errorMessage ? ` — ${m.errorMessage.slice(0, 40)}` : ''}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
                    {isReady && (
                      <>
                        <a
                          href={m.shareUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={meetingBtn.neutral}
                        >
                          🔗 {t('meeting.open')}
                        </a>
                        <button
                          type="button"
                          onClick={() => onCopyUrl(m.shareUrl)}
                          style={meetingBtn.neutral}
                        >
                          📋 {t('meeting.copyUrl')}
                        </button>
                        {isAppAvailable('mail') && (
                          <button
                            type="button"
                            onClick={() => {
                              const url = `${window.location.origin}/api/files/download/history/meetings/${m.token}.html`;
                              openAppWithAsset({ appId: 'mail', kind: 'file', url, name: `${m.title}.html` });
                            }}
                            style={meetingBtn.neutral}
                          >
                            {t('meeting.sendMail')}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void sendToNote(m.token)}
                          style={meetingBtn.neutral}
                        >
                          {t('meeting.sendNote')}
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => onDeleteMeeting(m)}
                      aria-label={t('meeting.deleteMeeting')}
                      title={t('common.delete')}
                      style={{ ...meetingBtn.dangerSubtle, marginLeft: 'auto' }}
                    >
                      🗑
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
