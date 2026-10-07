import React, { useMemo } from 'react';
import { Paper, Typography } from '@mantine/core';
import type { ChatMessage, ApprovalRequest } from '../../utils/api';
import { formatTime } from '../../utils/format';
import { renderMarkdown } from '../../utils/markdown';
import ApprovalCard from '../Approval/ApprovalCard';
import CompleteToast from '../Jobs/CompleteToast';
import MeetingResultCard from '../Meeting/MeetingResultCard';
import VideoSummaryCard from './VideoSummaryCard';
import PlaceCard, { type PlaceData } from './PlaceCard';
import MediaActions from './MediaActions';
import TypingIndicator from './TypingIndicator';
import MarkdownContent from './MarkdownContent';
import UrlPreviewList from '../UrlPreview/UrlPreviewList';
import { useT } from '../../i18n/I18nProvider';

interface Props {
  message: ChatMessage;
  approvals: {
    pending: Map<string, number>;
    resolved: Map<string, ApprovalRequest>;
    opinions: Map<string, { allow: boolean; reason?: string }>;
  };
  onApprovalResolve: (id: string, allow: boolean) => void;
  onJobClick: (id: string) => void;
  onFileClick?: (path: string) => void;
  onExternalMessageClick?: (messageId: string, partnerId: string) => void;
  genieName?: string;
  ownerName?: string;
}

const EXTERNAL_REF_RE = /<!--\s*EXTERNAL_REF\s*:\s*(\{[^}]+\})\s*-->/i;

export default function ChatBubble({ message, approvals, onApprovalResolve, onJobClick, onFileClick, onExternalMessageClick, genieName, ownerName }: Props) {
  const t = useT();
  const { role, content, timestamp, jobs, attachments, pending, aborted } = message;
  const d = new Date(timestamp);
  const time = formatTime(d);
  const isGenie = role === 'genie';
  const isPending = pending === true;

  const jobCompleteMatch = content.match(/^<!--JOB_COMPLETE:(.*?)-->$/s);
  const meetingResultMatch = content.match(/<!--MEETING_RESULT:(\{.*?\})-->/);
  const videoSummaryData = useMemo(() => {
    if (!isGenie || !content.includes('<!--VIDEO_SUMMARY:')) return null;
    const prefix = '<!--VIDEO_SUMMARY:';
    const jsonStart = content.indexOf(prefix) + prefix.length;
    const jsonEnd = content.lastIndexOf('-->');
    if (jsonEnd <= jsonStart) return null;
    try { return JSON.parse(content.slice(jsonStart, jsonEnd)) as { url: string; videoId?: string; shortSummary?: string; transcript?: string; hasTranscript?: boolean; loading?: boolean; error?: string }; }
    catch { return null; }
  }, [content, isGenie]);

  const placeCardData = useMemo(() => {
    if (!isGenie || !content.includes('<!--PLACE_CARD:')) return null;
    const prefix = '<!--PLACE_CARD:';
    const jsonStart = content.indexOf(prefix) + prefix.length;
    const jsonEnd = content.indexOf('-->', jsonStart);
    if (jsonEnd <= jsonStart) return null;
    try { return JSON.parse(content.slice(jsonStart, jsonEnd)) as PlaceData; }
    catch { return null; }
  }, [content, isGenie]);

  const externalRef = useMemo(() => {
    if (!isGenie) return null;
    const m = content.match(EXTERNAL_REF_RE);
    if (!m) return null;
    try {
      const data = JSON.parse(m[1]) as { messageId?: string; partnerId?: string; status?: string; classification?: string };
      if (data.messageId && data.partnerId) return data;
    } catch { /* */ }
    return null;
  }, [content, isGenie]);

  const cleanContent = useMemo(() => {
    let c = content;
    if (isGenie) c = c.replace(EXTERNAL_REF_RE, '').replace(/<!--MEETING_RESULT:[\s\S]*?-->/g, '').replace(/<!--VIDEO_SUMMARY:[\s\S]*?-->/g, '').replace(/<!--PLACE_CARD:[\s\S]*?-->/g, '').trim();
    if (!isGenie || !c.includes('🔧')) return c;
    return c.split('\n').filter(l => !l.includes('🔧')).join('\n').trim();
  }, [content, isGenie]);

  const html = useMemo(() => {
    if (isGenie) return renderMarkdown(cleanContent);
    return cleanContent;
  }, [cleanContent, isGenie]);

  // 연결 오류 — 에러 텍스트 대신 typing indicator 표시. (Hooks 호출 이후 early return)
  if (isGenie && content.includes('<!--RECONNECTING-->')) {
    return <TypingIndicator />;
  }

  if (jobCompleteMatch) {
    try {
      const data = JSON.parse(jobCompleteMatch[1]);
      return <CompleteToast data={data} onResultClick={onJobClick} onFileClick={onFileClick} />;
    } catch { /* fall through */ }
  }

  if (meetingResultMatch) {
    try {
      const data = JSON.parse(meetingResultMatch[1]) as { token: string; shareUrl: string; title: string; shortSummary?: string };
      if (data.token && data.shareUrl && data.title) {
        return (
          <div className={`msg-wrap msg-wrap-${role}`} style={{ gap: 6 }}>
            <MeetingResultCard title={data.title} shareUrl={data.shareUrl} shortSummary={data.shortSummary} token={data.token} />
          </div>
        );
      }
    } catch { /* fall through */ }
  }

  if (videoSummaryData) {
    return (
      <div className={`msg-wrap msg-wrap-${role}`} style={{ gap: 6 }}>
        <VideoSummaryCard url={videoSummaryData.url} videoId={videoSummaryData.videoId} shortSummary={videoSummaryData.shortSummary} transcript={videoSummaryData.transcript} hasTranscript={videoSummaryData.hasTranscript} loading={videoSummaryData.loading} error={videoSummaryData.error} />
      </div>
    );
  }

  const approvalMatch = isGenie && content.includes('🔐')
    ? content.match(/<!--\s*APPROVAL\s*:\s*\{[^}]*"id"\s*:\s*"([^"]+)"[^}]*\}\s*-->/i)
    : null;
  const approvalId = approvalMatch?.[1];

  // 최후 방어선: 렌더링할 내용이 전혀 없으면 null 반환 (빈 말풍선 방지)
  const hasContent = cleanContent.trim().length > 0 || html.trim().length > 0;
  const hasDisplayElements = (jobs && jobs.length > 0) || (attachments && attachments.length > 0) || approvalId || aborted || externalRef;
  if (!hasContent && !hasDisplayElements) {
    return null;
  }

  return (
    <div className={`msg-wrap msg-wrap-${role}`} style={{ gap: 6 }}>
      {!isGenie && <span className="msg-time">{time}</span>}
      <Paper
        component="div"
        className={isGenie ? 'md' : undefined}
        radius="lg"
        p="xs"
        bg={isGenie ? 'var(--bg-muted)' : 'var(--color-user-message-bg)'}
        c={isGenie ? undefined : 'white'}
        style={{
          maxWidth: '85%',
          minWidth: 0,
          alignSelf: isGenie ? 'flex-start' : 'flex-end',
          ...(isPending ? { opacity: 0.55 } : {}),
        }}
      >
        {isPending && !isGenie && <span style={{ marginRight: 4 }}>⏳</span>}
        {isGenie ? (
          <Typography>
            <MarkdownContent
              html={html}
              onClick={(e) => {
                const link = (e.target as HTMLElement).closest?.('.file-path-link') as HTMLElement | null;
                if (!link || !onFileClick) return;
                e.preventDefault();
                const path = link.dataset.path;
                if (path) onFileClick(path);
              }}
            />
          </Typography>
        ) : (
          <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{cleanContent}</span>
        )}
        {placeCardData && <PlaceCard data={placeCardData} />}
        <UrlPreviewList text={cleanContent} />
        {attachments?.length ? (
          <div style={{ marginTop: 8 }}>
            {attachments.map((a, i) => {
              const isObj = typeof a === 'object';
              const name = isObj ? (a as any).name : a.split('/').pop();
              const url = isObj ? (a as any).url : '/attachments/' + a.split('/attachments/').pop();
              const isImage = /\.(png|jpg|jpeg|gif|webp)$/i.test(name || '');
              const isVideo = /\.(mp4|webm|mov|m4v)$/i.test(name || '');
              if (isImage) return (
                <div key={i} className="image-zoomable" style={{ position: 'relative', display: 'inline-block' }}>
                  <img src={url} alt={name} style={{ borderRadius: 10 }} />
                  <MediaActions kind="image" url={url} name={name} />
                </div>
              );
              if (isVideo) return (
                <div key={i} className="media-wrap">
                  <video src={url} controls />
                  <MediaActions kind="video" url={url} name={name} />
                </div>
              );
              return <span key={i} style={{ fontSize: 'var(--font-s)', color: 'var(--text-muted)' }}>{name}</span>;
            })}
          </div>
        ) : null}
        {jobs?.length ? (
          <div style={{ marginTop: 8 }}>
            {jobs.map(j => (
              <span key={j.id} className="job-tag" onClick={() => onJobClick(j.id)}>
                {j.agent ? t('chat.delegatePrefix', { agent: j.agent }) : ''}{j.request.split('\n')[0]}
              </span>
            ))}
          </div>
        ) : null}
        {approvalId && (
          <ApprovalCard
            id={approvalId}
            pending={approvals.pending}
            resolved={approvals.resolved}
            opinions={approvals.opinions}
            onResolve={onApprovalResolve}
            genieName={genieName}
            ownerName={ownerName}
          />
        )}
        {externalRef && onExternalMessageClick && (
          <button
            onClick={() => onExternalMessageClick(externalRef.messageId!, externalRef.partnerId!)}
            className="ext-ref-btn"
            title={t('chat.viewFromFriend')}
          >
            📨 {t('chat.viewFromFriend')}
            {externalRef.status === 'awaiting_approval' && <span className="ext-ref-pill">{t('chat.awaitingApproval')}</span>}
            {externalRef.classification && <span className="ext-ref-pill">{externalRef.classification}</span>}
          </button>
        )}
        {aborted && (
          <span style={{ display: 'block', marginTop: 4, color: 'var(--text-muted)', fontSize: 'var(--font-s)', fontStyle: 'italic' }}>
            {t('chat.aborted')}
          </span>
        )}
      </Paper>
      {isGenie && <span className="msg-time">{time}</span>}
    </div>
  );
}
