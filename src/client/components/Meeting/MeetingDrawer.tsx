import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Stack, Group, Text, ActionIcon } from '@mantine/core';
import { IconX } from '@tabler/icons-react';
import MeetingRecorder from './MeetingRecorder';
import RecordingList from './RecordingList';
import { uiAlert, uiConfirm, uiPrompt } from '../Dialog/dialog';
import { useT } from '../../i18n/I18nProvider';
import { meetingBtn } from './buttonStyles';

export interface RecordingMeta {
  id: string;
  ext: string;
  path: string;
  size: number;
  durationSec?: number;
  source: 'mic' | 'upload';
  originalName?: string;
  createdAt: string;
}

export interface MeetingMeta {
  token: string;
  title: string;
  recordingPath: string;
  durationSec?: number;
  status: 'processing' | 'ready' | 'failed';
  shareUrl: string;
  createdAt: string;
  completedAt?: string;
  errorMessage?: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onAttachToChat: (files: File[]) => void;
}

export default function MeetingDrawer({ visible, onClose, onAttachToChat }: Props) {
  const t = useT();
  const [recordings, setRecordings] = useState<RecordingMeta[]>([]);
  const [meetings, setMeetings] = useState<MeetingMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [summaryPending, setSummaryPending] = useState(false);
  const summaryPendingRef = useRef(false);
  const [isRecording, setIsRecording] = useState(false);
  const [summaryLanguage, setSummaryLanguage] = useState<'ko' | 'en' | 'ja'>('ko');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [r1, r2] = await Promise.all([
        fetch('/api/meetings/recordings').then((r) => (r.ok ? r.json() : [])),
        fetch('/api/meetings').then((r) => (r.ok ? r.json() : [])),
      ]);
      setRecordings(r1 || []);
      setMeetings(r2 || []);
    } catch (err) {
      console.error('[MeetingDrawer] refresh failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) void refresh();
  }, [visible, refresh]);

  // processing 상태 회의록이 있으면 폴링
  useEffect(() => {
    if (!visible) return;
    const hasProcessing = meetings.some((m) => m.status === 'processing');
    if (!hasProcessing) return;
    const iv = setInterval(refresh, 10_000);
    return () => clearInterval(iv);
  }, [visible, meetings, refresh]);

  const handleUpload = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('source', 'upload');
      const res = await fetch('/api/meetings/upload', { method: 'POST', body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        await uiAlert({ title: t('meeting.uploadFailed'), description: String(err.error || res.statusText), variant: 'info' });
        return;
      }
      await refresh();
    } catch (err) {
      await uiAlert({ title: t('meeting.uploadFailed'), description: err instanceof Error ? err.message : String(err), variant: 'info' });
    } finally {
      setUploading(false);
    }
  }, [refresh]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // 같은 파일 재선택 가능하게
    for (const f of files) void handleUpload(f);
  }, [handleUpload]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    for (const f of files) void handleUpload(f);
  }, [handleUpload]);

  const handleRecordingComplete = useCallback(async (blob: Blob, durationSec: number) => {
    const file = new File([blob], `recording-${Date.now()}.webm`, { type: blob.type || 'audio/webm' });
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('source', 'mic');
      form.append('durationSec', String(durationSec));
      const res = await fetch('/api/meetings/upload', { method: 'POST', body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        await uiAlert({ title: t('meeting.recordSaveFailed'), description: String(err.error || res.statusText), variant: 'info' });
        return;
      }
      await refresh();
    } finally {
      setUploading(false);
    }
  }, [refresh]);

  const attachRecordingToChat = useCallback(async (rec: RecordingMeta) => {
    // 녹음 파일을 서버에서 받아 File로 변환 후 ChatInput에 추가
    try {
      const res = await fetch(`/api/meetings/recordings/${rec.id}`);
      if (!res.ok) {
        await uiAlert({ title: t('meeting.fetchRecordingFailed'), variant: 'info' });
        return;
      }
      const blob = await res.blob();
      const filename = rec.originalName || `recording-${rec.id}.${rec.ext}`;
      const file = new File([blob], filename, { type: blob.type });
      onAttachToChat([file]);
    } catch (err) {
      await uiAlert({ title: t('meeting.attachFailed'), description: err instanceof Error ? err.message : String(err), variant: 'info' });
    }
  }, [onAttachToChat]);

  const requestSummarize = useCallback(async (rec: RecordingMeta, transcriptionProvider: 'groq' | 'gemini') => {
    if (summaryPendingRef.current) return;
    summaryPendingRef.current = true;
    setSummaryPending(true);
    try {
      const title = await uiPrompt({
        title: t('meeting.promptTitle'),
        description: t(transcriptionProvider === 'gemini' ? 'meeting.geminiQuota' : 'meeting.groqQuota'),
        label: t('meeting.promptLabel'),
        initialValue: t('meeting.defaultTitle', { date: new Date().toISOString().slice(0, 10) }),
        placeholder: t('meeting.promptPlaceholder'),
        confirmLabel: t(transcriptionProvider === 'gemini' ? 'meeting.geminiSummarizeBtn' : 'meeting.groqSummarizeBtn'),
      });
      if (title === null) return;
      const res = await fetch('/api/meetings/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordingId: rec.id, title: title || undefined, language: summaryLanguage, transcriptionProvider }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        await uiAlert({ title: t('meeting.summaryFailed'), description: String(err.error || res.statusText), variant: 'info' });
        return;
      }
      await refresh();
    } catch (err) {
      await uiAlert({ title: t('meeting.summaryFailed'), description: err instanceof Error ? err.message : String(err), variant: 'info' });
    } finally {
      summaryPendingRef.current = false;
      setSummaryPending(false);
    }
  }, [refresh, summaryLanguage, t]);

  const copyShareUrl = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      await uiAlert({ title: t('meeting.urlCopied'), variant: 'info' });
    } catch {
      await uiAlert({ title: t('meeting.copyFailed'), description: t('meeting.copyManual') + url, variant: 'info' });
    }
  }, []);

  const deleteRecording = useCallback(async (rec: RecordingMeta) => {
    const name = rec.originalName || `recording-${rec.id.slice(0, 8)}.${rec.ext}`;
    const ok = await uiConfirm({
      title: t('meeting.deleteRecordingConfirm', { name }),
      description: t('files.irreversible'),
      variant: 'danger',
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/meetings/recordings/${rec.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        await uiAlert({ title: t('common.deleteFailed'), description: String(err.error || res.statusText), variant: 'info' });
        return;
      }
      await refresh();
    } catch (err) {
      await uiAlert({ title: t('common.deleteFailed'), description: err instanceof Error ? err.message : String(err), variant: 'info' });
    }
  }, [refresh]);

  const deleteMeeting = useCallback(async (m: MeetingMeta) => {
    const ok = await uiConfirm({
      title: t('meeting.deleteMeetingConfirm', { title: m.title }),
      description: t('meeting.deleteMeetingDesc'),
      variant: 'danger',
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/meetings/${m.token}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        await uiAlert({ title: t('common.deleteFailed'), description: String(err.error || res.statusText), variant: 'info' });
        return;
      }
      await refresh();
    } catch (err) {
      await uiAlert({ title: t('common.deleteFailed'), description: err instanceof Error ? err.message : String(err), variant: 'info' });
    }
  }, [refresh]);

  if (!visible && !isRecording) return null;

  return (
    <Stack h="100%" gap={0} onDragOver={(e) => e.preventDefault()} onDrop={handleDrop} style={!visible ? { display: 'none' } : undefined}>
      <Group justify="space-between" align="center" p="md" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
        <Text fw={600} size="md">{t('nav.meeting')}</Text>
        <ActionIcon variant="subtle" color="gray" size={36} className="drawer-close" onClick={onClose} aria-label={t('common.close')}>
          <IconX size={18} stroke={1.5} />
        </ActionIcon>
      </Group>
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', flex: 1 }}>
        <MeetingRecorder
          onComplete={handleRecordingComplete}
          onRecordingStateChange={setIsRecording}
          disabled={uploading}
          extra={(
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <strong style={{ fontSize: 'var(--font-m)' }}>{t('meeting.fileUpload')}</strong>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  style={{ ...meetingBtn.neutral, cursor: uploading ? 'not-allowed' : 'pointer', opacity: uploading ? 0.5 : 1 }}
                >
                  {uploading ? t('meeting.uploading') : t('meeting.selectFile')}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*,.webm,.wav,.mp3,.m4a,.ogg,.opus"
                  multiple
                  style={{ display: 'none' }}
                  onChange={handleFileInputChange}
                />
              </div>
              <div style={{ fontSize: 'var(--font-s)', color: 'var(--text-muted)' }}>
                {t('meeting.dropHint')}
              </div>
            </>
          )}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 'var(--font-s)', color: 'var(--text-muted)' }}>{t('meeting.languageLabel')}</span>
          {(['ko', 'en', 'ja'] as const).map((lang) => (
            <button
              key={lang}
              type="button"
              onClick={() => setSummaryLanguage(lang)}
              style={{
                ...meetingBtn.neutral,
                fontWeight: summaryLanguage === lang ? 700 : 400,
                borderColor: summaryLanguage === lang ? 'var(--mantine-color-blue-6)' : undefined,
              }}
              aria-pressed={summaryLanguage === lang}
            >
              {t(`meeting.language.${lang}`)}
            </button>
          ))}
        </div>

        <Text size="sm" c="dimmed" style={{ wordBreak: 'keep-all' }}>
          {t('meeting.providerQuotaHint')}
        </Text>

        <RecordingList
          recordings={recordings}
          meetings={meetings}
          loading={loading}
          summaryPending={summaryPending}
          onAttachToChat={attachRecordingToChat}
          onSummarize={requestSummarize}
          onCopyUrl={copyShareUrl}
          onRefresh={refresh}
          onDeleteRecording={deleteRecording}
          onDeleteMeeting={deleteMeeting}
        />
      </div>
    </Stack>
  );
}
