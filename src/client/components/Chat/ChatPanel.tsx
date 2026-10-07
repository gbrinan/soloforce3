import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import type { ChatMessage, ApprovalRequest } from '../../utils/api';
import type { StreamState } from '../../hooks/useChat';
import ChatBubble from './ChatBubble';
import StreamBubble from './StreamBubble';
import ChatInput, { type AppAttachment } from './ChatInput';
import { formatDate } from '../../utils/format';
import { useT } from '../../i18n/I18nProvider';

interface Props {
  genieName: string;
  ownerName?: string;
  messages: ChatMessage[];
  stream: StreamState;
  loading: boolean;
  sendDisabled?: boolean;
  busyStartTime?: number;
  approvals: {
    pending: Map<string, number>;
    resolved: Map<string, ApprovalRequest>;
    opinions: Map<string, { allow: boolean; reason?: string }>;
  };
  onSend: (message: string, files?: File[]) => void;
  onAbort?: () => void;
  onApprovalResolve: (id: string, allow: boolean) => void;
  onJobClick: (id: string) => void;
  onFileClick?: (path: string) => void;
  onExternalMessageClick?: (messageId: string, partnerId: string) => void;
  externalAttachFiles?: File[];
  onConsumeAttachFiles?: () => void;
}

// 🔧 라인 기준으로 메시지 분리 (히스토리 로드 시)
function splitByProgress(msg: ChatMessage): ChatMessage[] {
  if (msg.role !== 'genie' || !msg.content.includes('🔧')) return [msg];
  const parts = msg.content.split('\n');
  const segments: string[] = [];
  let current: string[] = [];
  for (const line of parts) {
    if (line.includes('🔧')) {
      if (current.length) { segments.push(current.join('\n')); current = []; }
    } else {
      current.push(line);
    }
  }
  if (current.length) segments.push(current.join('\n'));
  return segments
    .filter(s => s.trim())
    .map((s, i) => ({
      ...msg,
      content: s.trim(),
      jobs: i === segments.length - 1 ? msg.jobs : undefined,
      attachments: i === 0 ? msg.attachments : undefined,
    }));
}

export default function ChatPanel({ genieName, ownerName, messages, stream, loading, sendDisabled, busyStartTime, approvals, onSend, onAbort, onApprovalResolve, onJobClick, onFileClick, onExternalMessageClick, externalAttachFiles, onConsumeAttachFiles }: Props) {
  const chatRef = useRef<HTMLDivElement>(null);
  const t = useT();

  // 메시지 분리 (🔧 기준) + 빈 genie 메시지 필터링
  const displayMessages = useMemo(() => {
    return messages.flatMap(splitByProgress).filter(msg => {
      // genie 메시지이고 content가 비어있고 표시요소가 없으면 필터링 (빈 말풍선 방지)
      if (msg.role !== 'genie') return true;
      const content = msg.content || '';
      if (!content.trim()) {
        const hasDisplayElements = (msg.jobs && msg.jobs.length > 0) || 
                                    (msg.attachments && msg.attachments.length > 0) ||
                                    msg.aborted;
        return hasDisplayElements;
      }
      return true;
    });
  }, [messages]);

  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const prevLenRef = useRef(0);

  const NEAR_BOTTOM_PX = 150;
  const isNearBottom = useCallback((el: HTMLDivElement) => {
    return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  }, []);

  // 자동 스크롤
  // - 하단 근처(<150px) 또는 스트리밍 중: 그대로 하단 추적
  // - 사용자가 위로 스크롤한 상태에서 새 메시지: 보류 + unreadCount 증가
  // - 단, 승인 요청(🔐)은 위치 무관 강제 스크롤 (놓치면 안 됨)
  useEffect(() => {
    const el = chatRef.current;
    if (!el) return;
    const prevLen = prevLenRef.current;
    const newLen = displayMessages.length;
    const added = Math.max(0, newLen - prevLen);
    prevLenRef.current = newLen;

    const last = displayMessages[newLen - 1];
    const isApproval = !!last && last.role === 'genie' && last.content.includes('🔐');
    const nearBottom = isNearBottom(el);
    // 최초 마운트(또는 모달 재진입) — 무조건 맨 하단으로 진입해 최신 메시지 노출.
    // MyCrewFab 모달은 닫힐 때 unmount되므로 다음 열림 시 ChatPanel이 새로 마운트되고
    // prevLen이 0으로 리셋된다. 그 시점에 scrollTop=0이라 nearBottom 판정이 false가 되어
    // 맨 위에 머무는 회귀 방지. (관련: 페이지 전환 후 ChatPanel 재마운트도 동일 처리)
    const isFirstPaint = prevLen === 0 && newLen > 0;

    if (nearBottom || stream.active || isApproval || isFirstPaint) {
      el.scrollTop = el.scrollHeight;
      if (isFirstPaint) {
        // markdown/이미지 등 늦은 paint로 scrollHeight가 추후 늘어나는 경우 보정
        requestAnimationFrame(() => {
          if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
        });
      }
      setUnreadCount(0);
    } else if (added > 0) {
      setUnreadCount((c) => c + added);
    }
  }, [displayMessages, stream.text, stream.progress, stream.active, isNearBottom]);

  // 스크롤 위치 감지 → 하단 버튼 표시 + 하단 도달 시 unread 리셋
  const handleScroll = useCallback(() => {
    const el = chatRef.current;
    if (!el) return;
    const nearBottom = isNearBottom(el);
    setShowScrollBtn(!nearBottom);
    if (nearBottom) setUnreadCount(0);
  }, [isNearBottom]);

  const scrollToBottom = useCallback(() => {
    const el = chatRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setUnreadCount(0);
  }, []);

  // 날짜별 그룹핑
  let lastDate = '';

  useEffect(() => {
    const handler = (e: Event) => {
      const place = (e as CustomEvent).detail as AppAttachment | null;
      if (place?.type && place?.name) {
        setDroppedCustomItems((prev) => [...prev, place]);
      }
    };
    window.addEventListener('mycrew:place-attach', handler);
    return () => window.removeEventListener('mycrew:place-attach', handler);
  }, []);

  const [dragOver, setDragOver] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
  const [droppedCustomItems, setDroppedCustomItems] = useState<AppAttachment[]>([]);
  const dragCounterRef = useRef(0);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setDragOver(false);
    const customData = e.dataTransfer.getData('application/x-mycrew-attachment');
    if (customData) {
      try {
        const item = JSON.parse(customData) as AppAttachment;
        if (item?.type && item?.name) {
          setDroppedCustomItems(prev => [...prev, item]);
          return;
        }
      } catch { /* fall through to file handling */ }
    }
    // postMessage bridge fallback — sandboxed cross-origin iframes (사진앱) can strip the
    // custom dataTransfer entry; AppHostFrame stages the attachment here on drag.start.
    const bridgedAttachment = (window as unknown as { __mycrewDropAttachment?: AppAttachment | null }).__mycrewDropAttachment;
    if (bridgedAttachment?.type && bridgedAttachment?.name) {
      (window as unknown as { __mycrewDropAttachment?: AppAttachment | null }).__mycrewDropAttachment = null;
      setDroppedCustomItems(prev => [...prev, bridgedAttachment]);
      return;
    }
    if (e.dataTransfer.files.length) {
      // Drag&drop accepts images only; non-image files are silently ignored.
      const images = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
      if (images.length) {
        setDroppedFiles(prev => [...prev, ...images]);
        return;
      }
    }
    // Cross-origin iframe(사진앱 등)에서 드래그된 이미지: files는 비고 URL만 전달된다.
    // text/uri-list / text/plain / text/html src 폴백 순으로 절대 URL을 추출 후
    // fetch → Blob → File로 승격. credentials는 omit — 서버가 ACAC를 응답하지 않는 한
    // include 모드는 spec 위반으로 응답 차단된다.
    const uriList = e.dataTransfer.getData('text/uri-list');
    const html = e.dataTransfer.getData('text/html');
    const htmlSrc = html ? (html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] ?? '') : '';
    // postMessage bridge fallback — sandboxed cross-origin iframes (사진앱) can strip
    // dataTransfer entirely; AppHostFrame stages the dragged URL here on drag.start.
    const dropMeta = (window as unknown as { __mycrewDropMeta?: { url: string; name: string } | null }).__mycrewDropMeta;
    const bridged = (window as unknown as { __mycrewDropUrl?: string | null }).__mycrewDropUrl || dropMeta?.url || '';
    const url =
      e.dataTransfer.getData('application/x-mycrew-photo-url') ||
      (uriList ? uriList.split(/\r?\n/).find(s => s && !s.startsWith('#')) : '') ||
      e.dataTransfer.getData('text/plain') ||
      htmlSrc ||
      bridged;
    if (url && /^https?:\/\//i.test(url)) {
      // Consume bridge slots so a follow-up drop doesn't re-pull stale data.
      (window as unknown as { __mycrewDropUrl?: string | null; __mycrewDropMeta?: unknown }).__mycrewDropUrl = null;
      (window as unknown as { __mycrewDropMeta?: unknown }).__mycrewDropMeta = null;
      const bookTitle = typeof dropMeta?.name === 'string' ? dropMeta.name.replace(/[/\\?%*:|"<>]/g, '-').trim() : '';
      fetch(`/api/proxy-image?url=${encodeURIComponent(url)}`, { credentials: 'include' })
        .then(r => { if (!r.ok) throw new Error('http ' + r.status); return r.blob(); })
        .then(blob => {
          if (!blob.type.startsWith('image/')) return;
          const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
          const name = bookTitle ? `${bookTitle}.${ext}` : `photo-${Date.now()}.${ext}`;
          const file = new File([blob], name, { type: blob.type });
          setDroppedFiles(prev => [...prev, file]);
        })
        .catch(err => console.warn('[chat-drop] proxy fetch failed', url, err));
    }
  }, []);

  return (
    <div
      style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', outline: dragOver ? '2px dashed var(--accent-info)' : 'none' }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
      onDragEnter={(e) => { e.preventDefault(); dragCounterRef.current++; setDragOver(true); }}
      onDragLeave={() => { dragCounterRef.current--; if (dragCounterRef.current <= 0) { dragCounterRef.current = 0; setDragOver(false); } }}
      onDrop={handleDrop}
    >
      <div className="chat" ref={chatRef} onScroll={handleScroll}>
        {displayMessages.length === 0 && !stream.active && (
          <div className="msg-wrap msg-wrap-genie">
            <div className="msg msg-genie">{t('chat.greeting', { name: genieName })}</div>
          </div>
        )}
        {displayMessages.map((msg, i) => {
          const d = new Date(msg.timestamp);
          const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          let dateSep = null;
          if (dateStr !== lastDate) {
            lastDate = dateStr;
            dateSep = <div className="date-sep" key={`date-${dateStr}`}>{formatDate(d)}</div>;
          }
          return (
            <React.Fragment key={`msg-${i}`}>
              {dateSep}
              <ChatBubble
                message={msg}
                approvals={approvals}
                onApprovalResolve={onApprovalResolve}
                onJobClick={onJobClick}
                onFileClick={onFileClick}
                onExternalMessageClick={onExternalMessageClick}
                genieName={genieName}
                ownerName={ownerName}
              />
            </React.Fragment>
          );
        })}
        <StreamBubble stream={stream} />
      </div>
      {(showScrollBtn || unreadCount > 0) && (
        <button
          onClick={scrollToBottom}
          aria-label={unreadCount > 0 ? t('chat.unreadAria', { n: unreadCount }) : t('chat.toBottom')}
          style={{
            position: 'absolute', bottom: 80, right: 24,
            background: 'var(--border-default)', color: 'var(--text-primary)', border: 'none',
            borderRadius: unreadCount > 0 ? 18 : '50%',
            height: 36,
            minWidth: 36,
            padding: unreadCount > 0 ? '0 12px' : 0,
            cursor: 'pointer',
            fontSize: 'var(--font-l)',
            boxShadow: 'var(--shadow-md)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}
        >
          {unreadCount > 0 ? `↓ ${unreadCount}` : '↓'}
        </button>
      )}
      <ChatInput
        onSend={onSend}
        onAbort={onAbort}
        inputDisabled={false}
        sendDisabled={sendDisabled ?? false}
        genieName={genieName}
        busyStartTime={busyStartTime}
        progress={stream.progress}
        externalFiles={[...droppedFiles, ...(externalAttachFiles ?? [])]}
        onClearExternalFiles={() => {
          setDroppedFiles([]);
          onConsumeAttachFiles?.();
        }}
        externalCustomItems={droppedCustomItems}
        onClearCustomItems={() => setDroppedCustomItems([])}
      />
    </div>
  );
}
