import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { notifications } from '@mantine/notifications';
import type { ExternalMessage, Partner, PartnerRequest } from '../../utils/api';
import {
  fetchPartners,
  fetchExternalMessages,
  fetchPendingPartnerRequests,
  pingPartner,
  runFriendSyncNow,
  deletePartner,
} from '../../utils/api';
import PartnerList from './PartnerList';
import MessageTimeline from './MessageTimeline';
import PartnerModal from './PartnerModal';
import PartnerRequestCard from './PartnerRequestCard';
import { btn } from '../../ui/controls';
import SendPartnerRequestModal from './SendPartnerRequestModal';
import { useT } from '../../i18n/I18nProvider';
import PaneResizer from '../PaneResizer';
import { uiConfirm } from '../Dialog/dialog';

interface Props {
  visible: boolean;
  onClose: () => void;
  injectedMessages?: ExternalMessage[];
  onMessagesUpdate?: (msgs: ExternalMessage[]) => void;
  highlightMessageId?: string | null;
  selectedPartnerHint?: string | null;
  onAfterAction?: () => void;
}

export default function InboxPanel({
  visible,
  onClose,
  injectedMessages,
  onMessagesUpdate,
  highlightMessageId,
  selectedPartnerHint,
  onAfterAction,
}: Props) {
  const t = useT();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [messages, setMessages] = useState<ExternalMessage[]>([]);
  const [selectedPartnerId, setSelectedPartnerId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [partnerSearch, setPartnerSearch] = useState('');
  const [editingPartner, setEditingPartner] = useState<Partner | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAttachmentList, setShowAttachmentList] = useState(false);

  const [pendingRequests, setPendingRequests] = useState<PartnerRequest[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [pingingIds, setPingingIds] = useState<Set<string>>(new Set());
  const [syncAllRunning, setSyncAllRunning] = useState(false);
  // 좌측 동료 목록 ↔ 우측 메시지 영역 너비(드래그 조절) — localStorage 영속(기본 170, 140~360). 데스크탑 전용.
  const [leftWidth, setLeftWidth] = useState<number>(() => {
    try { const v = Number(localStorage.getItem('jarvis:inboxLeftWidth')); if (Number.isFinite(v) && v >= 140) return v; } catch { /* */ }
    return 170;
  });
  const [isDesktop, setIsDesktop] = useState<boolean>(() => typeof window !== 'undefined' && window.innerWidth > 768);
  useEffect(() => {
    const onR = () => setIsDesktop(window.innerWidth > 768);
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, []);
  const handleLeftResize = useCallback((next: number) => {
    setLeftWidth(next);
    try { localStorage.setItem('jarvis:inboxLeftWidth', String(next)); } catch { /* */ }
  }, []);

  const loadPartners = useCallback(async () => {
    const list = await fetchPartners();
    setPartners(list);
  }, []);

  // 숨긴 메시지 표시 여부 — 기본 숨김. 토글 시 includeHidden으로 다시 로드.
  const [showHidden, setShowHidden] = useState(false);
  const loadMessages = useCallback(async () => {
    const list = await fetchExternalMessages({ limit: 200, includeHidden: showHidden });
    setMessages(list);
    onMessagesUpdate?.(list);
  }, [onMessagesUpdate, showHidden]);

  const loadPendingRequests = useCallback(async () => {
    const list = await fetchPendingPartnerRequests();
    setPendingRequests(list);
  }, []);

  useEffect(() => {
    if (!visible) return;
    void Promise.all([loadPartners(), loadMessages(), loadPendingRequests()]);
  }, [visible, loadPartners, loadMessages, loadPendingRequests]);

  // partners polling — presence(lastSeenAt) 갱신 반영. 60초 주기 (서버 friend-sync 10분 주기보다 자주).
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => { void loadPartners(); }, 60_000);
    return () => clearInterval(id);
  }, [visible, loadPartners]);

  const prevInboundCountRef = useRef(-1);
  useEffect(() => {
    if (!injectedMessages) return;
    const inboundCount = injectedMessages.filter(m => m.direction === 'inbound').length;
    const prevCount = prevInboundCountRef.current;
    prevInboundCountRef.current = inboundCount;
    setMessages(injectedMessages);
    // 새 inbound 메시지 도착 시 즉시 partners 갱신 — 서버가 touchLastSeen 호출했지만 클라이언트는
    // 60초 poll까지 lastSeenAt 갱신을 모르므로 빨간 점이 오표시됨.
    if (visible && prevCount >= 0 && inboundCount > prevCount) {
      void loadPartners();
    }
  }, [injectedMessages, visible, loadPartners]);

  useEffect(() => {
    if (selectedPartnerHint !== undefined && selectedPartnerHint !== null) {
      setSelectedPartnerId(selectedPartnerHint);
      setSelectedRequestId(null);
    }
  }, [selectedPartnerHint]);

  const filteredMessages = useMemo(() => {
    let filtered = messages;
    if (selectedPartnerId !== null) {
      filtered = filtered.filter((m) => m.partnerId === selectedPartnerId);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (m) => m.body.toLowerCase().includes(q) || m.senderLabel.toLowerCase().includes(q) || (m.recipientLabel && m.recipientLabel.toLowerCase().includes(q)),
      );
    }
    return filtered;
  }, [messages, selectedPartnerId, search]);

  const attachmentCount = useMemo(() => {
    let n = 0;
    for (const m of filteredMessages) {
      n += m.attachments?.length ?? 0;
    }
    return n;
  }, [filteredMessages]);

  const unreadByPartner = useMemo(() => {
    const map: Record<string, number> = {};
    for (const m of messages) {
      if (m.status === 'awaiting_approval' || m.status === 'received') {
        map[m.partnerId] = (map[m.partnerId] ?? 0) + 1;
      }
    }
    return map;
  }, [messages]);

  const handlePing = useCallback(async (partnerId: string) => {
    setPingingIds((prev) => {
      if (prev.has(partnerId)) return prev;
      const next = new Set(prev);
      next.add(partnerId);
      return next;
    });
    const target = partners.find((p) => p.id === partnerId);
    const name = target?.contactName ?? t('friend.defaultName');
    try {
      const r = await pingPartner(partnerId);
      if (r.ok) {
        notifications.show({
          color: 'green',
          title: t('friend.pingOk', { name }),
          message: `${r.responseTimeMs}ms · status ${r.status ?? 200}`,
        });
        await loadPartners();
      } else {
        notifications.show({
          color: 'red',
          title: t('friend.pingNoResp', { name }),
          message: `${r.error ?? 'unknown'} · ${r.responseTimeMs}ms`,
        });
      }
    } catch (err) {
      notifications.show({
        color: 'red',
        title: t('friend.pingFailed', { name }),
        message: err instanceof Error ? err.message : 'unknown',
      });
    } finally {
      setPingingIds((prev) => {
        const next = new Set(prev);
        next.delete(partnerId);
        return next;
      });
    }
  }, [partners, loadPartners]);

  const handleSyncAll = useCallback(async () => {
    if (syncAllRunning) return;
    setSyncAllRunning(true);
    try {
      const r = await runFriendSyncNow();
      if (r.ok && r.result) {
        notifications.show({
          color: 'green',
          title: t('friend.syncDone'),
          message: t('friend.syncDoneMsg', { ok: r.result.pingedOk, total: r.result.totalPartners, req: r.result.scheduleRequestsSent }),
        });
        await loadPartners();
      } else {
        notifications.show({
          color: 'red',
          title: t('friend.syncFailed'),
          message: r.error ?? 'unknown',
        });
      }
    } catch (err) {
      notifications.show({
        color: 'red',
        title: t('friend.syncFailed'),
        message: err instanceof Error ? err.message : 'unknown',
      });
    } finally {
      setSyncAllRunning(false);
    }
  }, [syncAllRunning, loadPartners]);

  const handleAfterAction = useCallback(async () => {
    await Promise.all([loadMessages(), loadPendingRequests(), loadPartners()]);
    onAfterAction?.();
  }, [loadMessages, loadPendingRequests, loadPartners, onAfterAction]);

  const handlePartnerRequestAfterAction = useCallback(async () => {
    await handleAfterAction();
    setSelectedRequestId(null);
  }, [handleAfterAction]);

  const handlePartnerSaved = useCallback((partner: Partner) => {
    setPartners((prev) => {
      const idx = prev.findIndex((p) => p.id === partner.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = partner;
        return next;
      }
      return [...prev, partner];
    });
    setEditingPartner(null);
    setEditingPartner(partner);
  }, []);

  const handlePartnerDeleted = useCallback((id: string) => {
    setPartners((prev) => prev.filter((p) => p.id !== id));
    if (selectedPartnerId === id) setSelectedPartnerId(null);
  }, [selectedPartnerId]);

  const handleDeletePartner = useCallback(async (partner: Partner) => {
    if (!(await uiConfirm({
      title: t('partner.deleteConfirm', { name: partner.companyName }),
      variant: 'danger',
      confirmLabel: t('partner.delete'),
    }))) return;
    try {
      await deletePartner(partner.id);
      handlePartnerDeleted(partner.id);
      notifications.show({ color: 'green', title: t('friend.partnerDeleted'), message: partner.companyName });
    } catch (err) {
      notifications.show({
        color: 'red',
        title: t('friend.partnerDeleteFailed'),
        message: err instanceof Error ? err.message : 'unknown',
      });
    }
  }, [t, handlePartnerDeleted]);

  if (!visible) return null;

  const editPartner = selectedPartnerId ? partners.find((p) => p.id === selectedPartnerId) : null;
  const selectedRequest = selectedRequestId ? pendingRequests.find((r) => r.id === selectedRequestId) ?? null : null;

  const onSelectRequest = (id: string) => {
    setSelectedRequestId(id);
    setSelectedPartnerId(null);
  };

  const onSelectPartner = (id: string | null) => {
    setSelectedPartnerId(id);
    setSelectedRequestId(null);
  };

  return (
    <div className="side-panel open inbox-panel">
      <div className="side-header">
        <h2 style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span>{t('nav.friends')}</span>
          <span style={{ fontSize: 'var(--font-s)', color: 'var(--text-muted)', fontWeight: 400 }}>{partners.length}</span>
        </h2>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            onClick={handleSyncAll}
            disabled={syncAllRunning}
            title={t('friend.syncNowTitle')}
            style={btn('sm', 'neutral', { cursor: syncAllRunning ? 'not-allowed' : 'pointer', opacity: syncAllRunning ? 0.6 : 1 })}
          >
            {syncAllRunning ? t('friend.syncing') : t('friend.syncNow')}
          </button>
          <button
            onClick={() => setSendModalOpen(true)}
            style={btn('sm', 'neutral')}
          >
            {t('friend.addFriend')}
          </button>
          {editPartner && (
            <button
              onClick={() => setEditingPartner(editPartner)}
              style={btn('sm', 'neutral')}
            >
              {t('partner.editTitle')}
            </button>
          )}
          <button className="side-close" onClick={onClose} aria-label={t('common.close')}>&times;</button>
        </div>
      </div>
      <div className="inbox-grid" style={isDesktop ? { gridTemplateColumns: `${leftWidth}px 6px 1fr` } : undefined}>
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%', borderRight: '1px solid var(--mantine-color-default-border)', background: 'var(--jarvis-surface-bg)', color: 'var(--text-primary)' }}>
          <div style={{ padding: '8px 6px' }}>
            <input
              value={partnerSearch}
              onChange={(e) => setPartnerSearch(e.target.value)}
              placeholder={t('friend.searchPartner')}
              style={{ width: '100%', background: 'var(--bg-surface)', border: '1px solid var(--mantine-color-default-border)', color: 'var(--text-primary)', padding: '6px 10px', borderRadius: 6, fontSize: 'var(--font-s)' }}
            />
          </div>
          {pendingRequests.length > 0 && (
            <div style={{ borderBottom: '1px solid var(--mantine-color-default-border)', padding: '8px 0', maxHeight: 240, overflow: 'auto' }}>
              <div style={{ fontSize: 'var(--font-s)', color: 'var(--text-muted)', padding: '0 12px 6px 12px', fontWeight: 600 }}>
                {t('friend.tradeRequests', { n: pendingRequests.length })}
              </div>
              {pendingRequests.map((r) => (
                <div
                  key={r.id}
                  className={`partner-row${selectedRequestId === r.id ? ' selected' : ''}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => onSelectRequest(r.id)}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="partner-name">{r.body.companyName}</div>
                    <div style={{ fontSize: 'var(--font-s)', color: 'var(--text-muted)' }}>
                      {r.body.contactName} · {new Date(r.receivedAt).toLocaleString()}
                    </div>
                  </div>
                  {(r.resultDeliveryAttempts ?? 0) > 0 && (
                    <span style={{ fontSize: 'var(--font-s)', color: 'var(--accent-warning)' }} title={t('friend.callbackFailed')}>⚠️</span>
                  )}
                </div>
              ))}
            </div>
          )}
          <PartnerList
            partners={partnerSearch.trim() ? partners.filter(p => {
              const q = partnerSearch.toLowerCase();
              return p.companyName.toLowerCase().includes(q)
                || p.contactName.toLowerCase().includes(q)
                || (p.department && p.department.toLowerCase().includes(q))
                || (p.secretaryName && p.secretaryName.toLowerCase().includes(q));
            }) : partners}
            selectedId={selectedPartnerId}
            unreadByPartner={unreadByPartner}
            onSelect={onSelectPartner}
            onAddClick={() => setShowAddModal(true)}
            onPing={handlePing}
            pingingIds={pingingIds}
            onDelete={handleDeletePartner}
          />
        </div>
        {isDesktop && <PaneResizer width={leftWidth} onResize={handleLeftResize} min={140} max={360} />}
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--mantine-color-default-border)', display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('friend.searchMessage')}
              style={{ flex: 1, background: 'var(--bg-surface)', border: '1px solid var(--mantine-color-default-border)', color: 'var(--text-primary)', padding: '6px 10px', borderRadius: 6, fontSize: 'var(--font-s)' }}
            />
            {attachmentCount > 0 && (
              <button
                onClick={() => setShowAttachmentList(!showAttachmentList)}
                style={btn('sm', 'neutral', { background: showAttachmentList ? 'var(--ring)' : 'var(--bg-canvas)', border: showAttachmentList ? '1px solid var(--ring)' : '1px solid var(--border-default)', color: showAttachmentList ? '#ffffff' : 'var(--text-primary)', flexShrink: 0 })}
              >
                📎 {attachmentCount}
              </button>
            )}
            <button
              onClick={() => setShowHidden((v) => !v)}
              title={showHidden ? t('friend.hideHidden') : t('friend.showHidden')}
              style={btn('sm', 'neutral', { background: showHidden ? 'var(--ring)' : 'var(--bg-canvas)', border: showHidden ? '1px solid var(--ring)' : '1px solid var(--border-default)', color: showHidden ? '#ffffff' : 'var(--text-secondary)', flexShrink: 0 })}
            >
              {showHidden ? '🙈' : '👁'}
            </button>
          </div>
          {selectedRequest ? (
            <PartnerRequestCard
              request={selectedRequest}
              onAfterAction={handlePartnerRequestAfterAction}
            />
          ) : (
            <MessageTimeline
              messages={filteredMessages}
              partners={partners}
              selectedPartnerId={selectedPartnerId}
              highlightMessageId={highlightMessageId ?? null}
              onAfterAction={handleAfterAction}
              showAttachmentList={showAttachmentList}
            />
          )}
        </div>
      </div>

      {showAddModal && (
        <PartnerModal
          partner={null}
          onClose={() => setShowAddModal(false)}
          onSaved={(p) => { handlePartnerSaved(p); }}
        />
      )}
      {editingPartner && (
        <PartnerModal
          partner={editingPartner}
          onClose={() => setEditingPartner(null)}
          onSaved={handlePartnerSaved}
          onDeleted={handlePartnerDeleted}
        />
      )}
      {sendModalOpen && (
        <SendPartnerRequestModal
          onClose={() => setSendModalOpen(false)}
          onSent={() => { void handleAfterAction(); }}
        />
      )}
    </div>
  );
}
