import React, { useState, useEffect } from 'react';
import { Modal, ScrollArea } from '@mantine/core';
import type { ExternalMessage, Partner } from '../../utils/api';
import { approveExternalMessage, rejectExternalMessage, setExternalMessageHidden } from '../../utils/api';
import { formatTime } from '../../utils/format';
import UrlPreviewList from '../UrlPreview/UrlPreviewList';
import ReportViewer from '../ReportViewer/ReportViewer';
import { useT } from '../../i18n/I18nProvider';
import type { MessageKey } from '../../i18n/messages';
import { iconBtn } from '../../ui/controls';

interface Props {
  message: ExternalMessage;
  partner?: Partner;
  highlight?: boolean;
  onAction?: () => void;  // 승인/거부 후 부모 갱신
}

const STATUS_LABEL: Record<string, MessageKey> = {
  pending: 'friend.statusPending',
  sent: 'friend.statusSent',
  delivered: 'friend.statusDelivered',
  received: 'friend.statusReceived',
  auto_handled: 'friend.statusAuto',
  awaiting_approval: 'friend.statusAwaiting',
  approved_handled: 'friend.statusApproved',
  rejected: 'friend.statusRejected',
  error: 'friend.statusError',
};

export default function MessageCard({ message: m, partner, highlight, onAction }: Props) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draftReply, setDraftReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ name: string; raw: string } | null>(null);

  useEffect(() => {
    if (!preview) return;
    let ro: ResizeObserver | null = null;
    const t = setTimeout(() => {
      const el = document.querySelector('.modal-resizable-inbox-md') as HTMLElement | null;
      if (!el) return;
      const saved = sessionStorage.getItem('jarvis:inboxMdModalSize');
      if (saved) {
        try {
          const { w, h } = JSON.parse(saved);
          if (typeof w === 'number' && typeof h === 'number') {
            const minDefaultW = 1000;
            const adjustedW = Math.max(w, minDefaultW);
            el.style.width = Math.min(adjustedW, window.innerWidth * 0.95) + 'px';
            el.style.height = Math.min(h, window.innerHeight * 0.95) + 'px';
          }
        } catch { /* */ }
      }
      ro = new ResizeObserver(() => {
        sessionStorage.setItem('jarvis:inboxMdModalSize', JSON.stringify({
          w: el.offsetWidth,
          h: el.offsetHeight,
        }));
      });
      ro.observe(el);
    }, 50);
    return () => {
      clearTimeout(t);
      ro?.disconnect();
    };
  }, [preview]);

  const isInbound = m.direction === 'inbound';
  const isAwaiting = m.status === 'awaiting_approval';
  const time = formatTime(new Date(m.receivedAt));
  const partnerLabel = partner ? `${partner.companyName} ${partner.contactName}` : m.senderLabel;

  const onApprove = async (withCustom: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await approveExternalMessage(m.id, withCustom ? draftReply : undefined);
      setEditing(false);
      onAction?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onReject = async () => {
    setBusy(true);
    setError(null);
    try {
      await rejectExternalMessage(m.id);
      onAction?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`ext-msg-card ${isInbound ? 'ext-msg-in' : 'ext-msg-out'}${highlight ? ' ext-msg-highlight' : ''}`}>
      <div className="ext-msg-head">
        <span className="ext-msg-arrow">{isInbound ? '📥' : '📤'}</span>
        <span className="ext-msg-sender">{isInbound ? `[${partnerLabel}]` : `[${t('friend.toRecipient', { name: partner?.companyName ?? m.recipientLabel })}]`}</span>
        <span className="ext-msg-time">{time}</span>
        <button
          className="ext-msg-hide-btn"
          title={m.hidden ? t('friend.unhideMessage') : t('friend.hideMessage')}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try { await setExternalMessageHidden(m.id, !m.hidden); onAction?.(); }
            catch (e) { setError(e instanceof Error ? e.message : String(e)); }
            finally { setBusy(false); }
          }}
          style={iconBtn('sm', 'subtle', { marginLeft: 'auto', border: 'none', fontSize: 'var(--font-s)' })}
        >
          {m.hidden ? '↩︎' : '✕'}
        </button>
      </div>
      <div className="ext-msg-body">{m.body}</div>
      <UrlPreviewList text={m.body} />
      {m.attachments?.length ? (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {m.attachments.map((a: any) => {
            const ext = a.filename?.split('.').pop()?.toLowerCase();
            const isPreviewable = ext === 'md' || ext === 'txt';
            const url = `/api/external/attachments/${m.id}/${a.id}`;
            return (
              <a
                key={a.id}
                href={url}
                download={isPreviewable ? undefined : a.filename}
                onClick={isPreviewable ? async (e) => {
                  e.preventDefault();
                  try {
                    const res = await fetch(url);
                    if (!res.ok) return;
                    const text = await res.text();
                    setPreview({ name: a.filename, raw: text });
                  } catch { /* */ }
                } : undefined}
                style={{ fontSize: 'var(--font-s)', color: 'var(--accent-info)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
              >
                📎 {a.filename} ({(a.size / 1024).toFixed(0)}KB)
              </a>
            );
          })}
        </div>
      ) : null}
      <div className="ext-msg-meta">
        <span className={`ext-msg-status ext-msg-status-${m.status}`}>{STATUS_LABEL[m.status] ? t(STATUS_LABEL[m.status]) : m.status}</span>
        {m.classification && (
          <span className="ext-msg-tag">{t('friend.classification', { value: m.classification })}</span>
        )}
        {m.messageType && m.messageType !== 'request' && (
          <span className="ext-msg-tag">{m.messageType}</span>
        )}
      </div>
      {(m.injectionFlags?.length ?? 0) > 0 && (
        <div className="ext-msg-warn">
          {t('friend.injectionWarn', { n: m.injectionFlags!.length, patterns: m.injectionFlags!.map((f) => f.pattern).join(', ') })}
        </div>
      )}
      {m.errorReason && (
        <div className="ext-msg-warn">❌ {m.errorReason}</div>
      )}
      {isAwaiting && !editing && (
        <div className="approval-btns" style={{ marginTop: 8 }}>
          <button className="approval-btn approval-btn-deny" disabled={busy} onClick={onReject}>{t('friend.rejectReply')}</button>
          <button className="approval-btn" disabled={busy} onClick={() => { setEditing(true); setDraftReply(''); }}>{t('friend.editReply')}</button>
          <button className="approval-btn approval-btn-allow" disabled={busy} onClick={() => onApprove(false)}>{t('friend.approveAuto')}</button>
        </div>
      )}
      {isAwaiting && editing && (
        <div style={{ marginTop: 8 }}>
          <textarea
            value={draftReply}
            onChange={(e) => setDraftReply(e.target.value)}
            placeholder={t('friend.replyPlaceholder')}
            rows={3}
            style={{ width: '100%', background: 'var(--bg-canvas)', border: '1px solid var(--border-default)', color: 'var(--text-primary)', padding: 8, borderRadius: 6, fontSize: 'var(--font-s)', resize: 'vertical' }}
          />
          <div className="approval-btns" style={{ marginTop: 4 }}>
            <button className="approval-btn" disabled={busy} onClick={() => setEditing(false)}>{t('common.cancel')}</button>
            <button className="approval-btn approval-btn-allow" disabled={busy || !draftReply.trim()} onClick={() => onApprove(true)}>{t('friend.sendThisReply')}</button>
          </div>
        </div>
      )}
      {error && (
        <div className="ext-msg-warn">❌ {error}</div>
      )}
      <Modal
        opened={!!preview}
        onClose={() => setPreview(null)}
        title={preview?.name}
        size="auto"
        centered
        scrollAreaComponent={ScrollArea.Autosize}
        classNames={{ content: 'modal-resizable modal-resizable-inbox-md' }}
        overlayProps={{ backgroundOpacity: 0.8, blur: 2 }}
      >
        {preview && <ReportViewer raw={preview.raw} fontSize="s" />}
      </Modal>
    </div>
  );
}
