import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, ScrollArea, useMantineColorScheme } from '@mantine/core';

const EmojiPicker = lazy(() => import('emoji-picker-react'));
import type { ExternalMessage, Partner } from '../../utils/api';
import { sendOutboundTest } from '../../utils/api';
import MessageCard from './MessageCard';
import { formatTime } from '../../utils/format';
import ReportViewer from '../ReportViewer/ReportViewer';
import { useT } from '../../i18n/I18nProvider';
import { btn, iconBtn } from '../../ui/controls';

interface Props {
  messages: ExternalMessage[];
  partners: Partner[];
  selectedPartnerId: string | null;
  highlightMessageId: string | null;
  onAfterAction: () => void;
  showAttachmentList?: boolean;
}

// 커서 직전의 활성 멘션 토큰(@쿼리)을 찾는다. 없으면 null.
// '@'는 문자열 시작이거나 공백 뒤에 와야 하고, '@'와 커서 사이에 공백이 없어야 한다.
function detectMention(value: string, caret: number): { query: string; start: number } | null {
  const upto = value.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(value[at - 1])) return null;
  const between = value.slice(at + 1, caret);
  if (/\s/.test(between)) return null;
  return { query: between, start: at };
}

// 멘션 라벨 — 공백 없는 토큰으로 삽입(토큰 매칭과 일관). contactName 우선, 공백 시 첫 토큰.
function mentionLabel(p: Partner): string {
  const name = (p.contactName || p.companyName || '').trim();
  return name.split(/\s+/)[0] || name;
}

export default function MessageTimeline({ messages, partners, selectedPartnerId, highlightMessageId, onAfterAction, showAttachmentList }: Props) {
  const t = useT();
  const [reply, setReply] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const emojiBtnRef = useRef<HTMLButtonElement | null>(null);
  const emojiPopRef = useRef<HTMLDivElement | null>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  // === @멘션(동료) 상태 ===
  const [mention, setMention] = useState<{ open: boolean; query: string; start: number; index: number }>(
    { open: false, query: '', start: -1, index: 0 },
  );
  const mentionCaretRef = useRef<number | null>(null);
  const [attachPreview, setAttachPreview] = useState<{ name: string; raw: string } | null>(null);
  const { colorScheme } = useMantineColorScheme();

  useEffect(() => {
    if (!attachPreview) return;
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
  }, [attachPreview]);

  const sorted = [...messages].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  const partnerById = new Map(partners.map((p) => [p.id, p]));

  const targetPartner = selectedPartnerId ? partnerById.get(selectedPartnerId) : null;

  const allAttachments = useMemo(() => {
    const items: Array<{ messageId: string; direction: string; receivedAt: string; att: { id: string; filename: string; mimeType: string; size: number } }> = [];
    for (const m of sorted) {
      if (!m.attachments?.length) continue;
      for (const a of m.attachments) {
        items.push({ messageId: m.id, direction: m.direction, receivedAt: m.receivedAt, att: a as any });
      }
    }
    return items;
  }, [sorted]);

  const scrollToBottom = () => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  };

  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    if (isNearBottom) scrollToBottom();
  }, [sorted.length]);

  useEffect(() => {
    setTimeout(scrollToBottom, 50);
  }, [selectedPartnerId]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => {
      setShowScrollBtn(el.scrollHeight - el.scrollTop - el.clientHeight > 100);
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!highlightMessageId) return;
    const t = setTimeout(() => {
      highlightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
    return () => clearTimeout(t);
  }, [highlightMessageId, sorted.length]);

  useEffect(() => {
    if (!showEmoji) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (emojiPopRef.current?.contains(t)) return;
      if (emojiBtnRef.current?.contains(t)) return;
      setShowEmoji(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowEmoji(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [showEmoji]);

  // @쿼리 부분일치 동료 목록 (활성 partner). 라벨/회사명/연락처명 매칭.
  const mentionMatches = useMemo(() => {
    if (!mention.open) return [] as Partner[];
    const q = mention.query.trim().toLowerCase();
    const base = partners;
    if (!q) return base.slice(0, 20);
    return base.filter((p) =>
      mentionLabel(p).toLowerCase().includes(q)
      || p.contactName.toLowerCase().includes(q)
      || p.companyName.toLowerCase().includes(q),
    ).slice(0, 20);
  }, [mention.open, mention.query, partners]);

  const closeMention = () => setMention((m) => (m.open ? { open: false, query: '', start: -1, index: 0 } : m));

  // 멘션 선택 삽입 — start~caret 구간을 '@라벨 '로 치환 후 커서 복원.
  const selectMention = (p: Partner) => {
    const label = mentionLabel(p);
    setReply((prev) => {
      const before = prev.slice(0, mention.start);
      const afterStart = mention.start + 1 + mention.query.length;
      const after = prev.slice(afterStart);
      const inserted = `@${label} `;
      mentionCaretRef.current = (before + inserted).length;
      return before + inserted + after;
    });
    setMention({ open: false, query: '', start: -1, index: 0 });
  };

  // 멘션 삽입 후 커서 위치 복원.
  useEffect(() => {
    if (mentionCaretRef.current != null && textareaRef.current) {
      const pos = mentionCaretRef.current;
      mentionCaretRef.current = null;
      textareaRef.current.focus();
      try { textareaRef.current.setSelectionRange(pos, pos); } catch { /* */ }
    }
  }, [reply]);

  const insertEmoji = (emoji: string) => {
    const ta = textareaRef.current;
    if (!ta) {
      setReply((prev) => prev + emoji);
      return;
    }
    const start = ta.selectionStart ?? reply.length;
    const end = ta.selectionEnd ?? reply.length;
    const next = reply.slice(0, start) + emoji + reply.slice(end);
    setReply(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + emoji.length;
      try { ta.setSelectionRange(pos, pos); } catch { /* */ }
    });
  };

  const pathToDownloadUrl = (p: string): string | null => {
    if (!p || p.length > 1024) return null;
    if (p.includes('..')) return null;
    if (p.startsWith('history/outputs/')) {
      return '/api/files/download/history/' + encodeURI(p.slice('history/outputs/'.length));
    }
    if (p.startsWith('history/external-reports/')) {
      return '/api/files/download/reports/' + encodeURI(p.slice('history/external-reports/'.length));
    }
    if (p.startsWith('external-reports/')) {
      return '/api/files/download/reports/' + encodeURI(p.slice('external-reports/'.length));
    }
    if (p.startsWith('history/external/attachments/')) {
      return '/api/files/download/external-attachments/' + encodeURI(p.slice('history/external/attachments/'.length));
    }
    return null;
  };

  const PASTE_MAX_FILE_SIZE = 50 * 1024 * 1024;

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData('text');
    if (!text) return;
    const lines = text.split(/\r?\n/);
    const matchedPaths: string[] = [];
    const remainingLines: string[] = [];
    for (const line of lines) {
      const t = line.trim();
      if (t && pathToDownloadUrl(t)) matchedPaths.push(t);
      else remainingLines.push(line);
    }
    if (matchedPaths.length === 0) return;
    e.preventDefault();

    const insertText = remainingLines.join('\n');
    const ta = textareaRef.current;
    if (ta) {
      const start = ta.selectionStart ?? reply.length;
      const end = ta.selectionEnd ?? reply.length;
      const next = reply.slice(0, start) + insertText + reply.slice(end);
      setReply(next);
      requestAnimationFrame(() => {
        ta.focus();
        const pos = start + insertText.length;
        try { ta.setSelectionRange(pos, pos); } catch { /* */ }
      });
    } else {
      setReply((prev) => prev + insertText);
    }

    const fetched: File[] = [];
    const failed: string[] = [];
    for (const p of matchedPaths) {
      const url = pathToDownloadUrl(p);
      if (!url) { failed.push(p); continue; }
      try {
        const res = await fetch(url);
        if (!res.ok) { failed.push(`${p.split('/').pop() ?? p} (HTTP ${res.status})`); continue; }
        const blob = await res.blob();
        if (blob.size > PASTE_MAX_FILE_SIZE) {
          failed.push(t('friend.fileOver50', { name: p.split('/').pop() ?? p }));
          continue;
        }
        const filename = p.split('/').pop() || 'file';
        fetched.push(new File([blob], filename, { type: blob.type || 'application/octet-stream' }));
      } catch {
        failed.push(p.split('/').pop() ?? p);
      }
    }
    if (fetched.length) setFiles((prev) => [...prev, ...fetched]);

    if (fetched.length && !failed.length) {
      setInfo(t('friend.autoAttached', { n: fetched.length }));
      setTimeout(() => setInfo(null), 3000);
    } else if (fetched.length && failed.length) {
      setInfo(t('friend.attached', { n: fetched.length }));
      setError(t('friend.attachFailedN', { n: failed.length, list: failed.join(', ').slice(0, 80) }));
      setTimeout(() => { setInfo(null); setError(null); }, 5000);
    } else {
      setError(t('friend.attachFailedN', { n: failed.length, list: failed.join(', ').slice(0, 80) }));
      setTimeout(() => setError(null), 5000);
    }
  };

  const handleSend = async () => {
    if (!targetPartner || (!reply.trim() && !files.length)) return;
    setSending(true);
    setError(null);
    setInfo(null);
    try {
      let attachments: Array<{ filename: string; mimeType: string; size: number; data: string }> | undefined;
      if (files.length) {
        attachments = await Promise.all(files.map(async (f) => {
          const buf = await f.arrayBuffer();
          const data = btoa(String.fromCharCode(...new Uint8Array(buf)));
          return { filename: f.name, mimeType: f.type || 'application/octet-stream', size: f.size, data };
        }));
      }
      const result = await sendOutboundTest({
        partnerId: targetPartner.id,
        message: reply.trim(),
        messageType: 'request',
        attachments,
      });
      if (result.ok) {
        setReply('');
        setFiles([]);
        setInfo(t('friend.sentHttp', { status: result.status }));
        setTimeout(() => setInfo(null), 3000);
        onAfterAction();
      } else {
        setError(t('friend.sendFailedReason', { reason: result.errorReason ?? 'unknown' }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="msg-timeline" style={{ position: 'relative' }}>
      {showAttachmentList && allAttachments.length > 0 && (
        <div style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-default)', padding: '8px 12px', maxHeight: 200, overflowY: 'auto', fontSize: 'var(--font-s)' }}>
          {allAttachments.map((item, i) => {
            const ext = item.att.filename?.split('.').pop()?.toLowerCase();
            const isPreviewable = ext === 'md' || ext === 'txt';
            const url = `/api/external/attachments/${item.messageId}/${item.att.id}`;
            const time = formatTime(new Date(item.receivedAt));
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: i < allAttachments.length - 1 ? '1px solid var(--border-default)' : 'none' }}>
                <span style={{ color: item.direction === 'inbound' ? 'var(--ring)' : 'var(--partner-brand-success)', flexShrink: 0, minWidth: 36, fontSize: 'var(--font-s)' }}>
                  {item.direction === 'inbound' ? t('friend.received') : t('friend.sent')}
                </span>
                <a
                  href={url}
                  download={isPreviewable ? undefined : item.att.filename}
                  onClick={isPreviewable ? async (e) => {
                    e.preventDefault();
                    try {
                      const res = await fetch(url);
                      if (!res.ok) return;
                      const text = await res.text();
                      setAttachPreview({ name: item.att.filename, raw: text });
                    } catch { /* */ }
                  } : undefined}
                  style={{ color: 'var(--ring)', textDecoration: 'none', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {item.att.filename}
                </a>
                <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{(item.att.size / 1024).toFixed(0)}KB</span>
                <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{time}</span>
              </div>
            );
          })}
        </div>
      )}
      <Modal
        opened={!!attachPreview}
        onClose={() => setAttachPreview(null)}
        title={attachPreview?.name}
        size="auto"
        centered
        scrollAreaComponent={ScrollArea.Autosize}
        classNames={{ content: 'modal-resizable modal-resizable-inbox-md' }}
        overlayProps={{ backgroundOpacity: 0.8, blur: 2 }}
      >
        {attachPreview && <ReportViewer raw={attachPreview.raw} fontSize="s" />}
      </Modal>
      <div className="msg-timeline-list" ref={listRef}>
        {sorted.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 32, fontSize: 'var(--font-s)' }}>
            {t('friend.noMessages')}
          </div>
        ) : (
          sorted.map((m) => {
            const isHighlight = m.id === highlightMessageId;
            return (
              <div key={m.id} ref={isHighlight ? highlightRef : null} style={{ display: 'flex', justifyContent: m.direction === 'outbound' ? 'flex-end' : 'flex-start' }}>
                <MessageCard
                  message={m}
                  partner={partnerById.get(m.partnerId)}
                  highlight={isHighlight}
                  onAction={onAfterAction}
                />
              </div>
            );
          })
        )}
      </div>
      {showScrollBtn && (
        <button onClick={scrollToBottom} style={{
          position: 'absolute', bottom: 80, right: 16,
          background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-default)',
          borderRadius: '50%', width: 32, height: 32, cursor: 'pointer',
          fontSize: 'var(--font-m)', boxShadow: 'var(--shadow-md)', zIndex: 10,
        }}>↓</button>
      )}
      {targetPartner && targetPartner.active && (
        <div className="msg-timeline-input"
          onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) setFiles(prev => [...prev, ...Array.from(e.dataTransfer.files)]); }}
          onDragOver={(e) => e.preventDefault()}
        >
          {files.length > 0 && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
              {files.map((f, i) => (
                <span key={i} style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', padding: '2px 8px', borderRadius: 4, fontSize: 'var(--font-s)', display: 'flex', gap: 4, alignItems: 'center' }}>
                  📎 {f.name.slice(0, 20)} ({(f.size / 1024).toFixed(0)}KB)
                  <button onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: 'var(--partner-brand-danger)', cursor: 'pointer', fontSize: 'var(--font-s)' }}>✕</button>
                </span>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 4 }}>
            <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={(e) => { if (e.target.files) setFiles(prev => [...prev, ...Array.from(e.target.files!)]); e.target.value = ''; }} />
            <div style={{ flex: 1, position: 'relative' }}>
              {mention.open && mentionMatches.length > 0 && (
                <div
                  role="listbox"
                  aria-label={t('friend.mentionList')}
                  style={{
                    position: 'absolute', left: 0, right: 0, bottom: 'calc(100% + 6px)',
                    maxHeight: 220, overflowY: 'auto', zIndex: 30,
                    background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
                    borderRadius: 10, boxShadow: 'var(--shadow-lg)', padding: 4,
                  }}
                >
                  {mentionMatches.map((p, i) => {
                    const active = i === Math.min(mention.index, mentionMatches.length - 1);
                    return (
                      <div
                        key={p.id}
                        role="option"
                        aria-selected={active}
                        onMouseDown={(e) => { e.preventDefault(); selectMention(p); }}
                        onMouseEnter={() => setMention((m) => ({ ...m, index: i }))}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px',
                          borderRadius: 6, cursor: 'pointer',
                          background: active ? 'var(--bg-accent, var(--bg-elevated))' : 'transparent',
                          color: 'var(--text-primary)',
                        }}
                      >
                        <span style={{
                          flexShrink: 0, width: 24, height: 24, borderRadius: '50%',
                          background: 'var(--ring)', color: '#fff', fontSize: 'var(--font-s)', fontWeight: 700,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>{(p.contactName || p.companyName || '?').slice(0, 1)}</span>
                        <span style={{ fontWeight: 600, fontSize: 'var(--font-s)' }}>{p.contactName}</span>
                        <span style={{ marginLeft: 'auto', fontSize: 'var(--font-s)', color: 'var(--text-muted)' }}>{p.companyName}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              <textarea
                ref={textareaRef}
                value={reply}
                onChange={(e) => {
                  const value = e.target.value;
                  setReply(value);
                  const caret = e.target.selectionStart ?? value.length;
                  const m = detectMention(value, caret);
                  if (m) setMention({ open: true, query: m.query, start: m.start, index: 0 });
                  else closeMention();
                }}
                onPaste={handlePaste}
                onBlur={() => setTimeout(closeMention, 120)}
                placeholder={t('friend.sendToPlaceholder', { name: `${targetPartner.companyName} ${targetPartner.contactName}` })}
                rows={2}
                style={{ width: '100%', background: 'var(--bg-surface)', border: '1px solid var(--border-default)', color: 'var(--text-primary)', padding: 8, borderRadius: 6, fontSize: 'var(--font-s)', resize: 'vertical', boxSizing: 'border-box' }}
                onKeyDown={(e) => {
                  if (mention.open && mentionMatches.length > 0 && !e.nativeEvent.isComposing) {
                    if (e.key === 'ArrowDown') { e.preventDefault(); setMention((m) => ({ ...m, index: (m.index + 1) % mentionMatches.length })); return; }
                    if (e.key === 'ArrowUp') { e.preventDefault(); setMention((m) => ({ ...m, index: (m.index - 1 + mentionMatches.length) % mentionMatches.length })); return; }
                    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selectMention(mentionMatches[Math.min(mention.index, mentionMatches.length - 1)]); return; }
                    if (e.key === 'Escape') { e.preventDefault(); closeMention(); return; }
                  }
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'center', position: 'relative', flexWrap: 'wrap' }}>
            <button onClick={() => fileInputRef.current?.click()} style={iconBtn('sm', 'neutral', { fontSize: 'var(--font-m)', flexShrink: 0 })} title={t('friend.attachFile')}>📎</button>
            <button
              ref={emojiBtnRef}
              onClick={() => setShowEmoji((v) => !v)}
              aria-label={t('friend.selectEmoji')}
              aria-pressed={showEmoji}
              style={iconBtn('sm', 'neutral', { fontSize: 'var(--font-m)', flexShrink: 0 })}
              title={t('friend.emoji')}
            >😀</button>
            {info && <span style={{ fontSize: 'var(--font-s)', color: 'var(--partner-brand-success)' }}>{info}</span>}
            {error && <span style={{ fontSize: 'var(--font-s)', color: 'var(--partner-brand-danger)' }}>{error}</span>}
            <button
              onClick={handleSend}
              disabled={sending || (!reply.trim() && !files.length)}
              style={btn('sm', 'primary', { cursor: sending || (!reply.trim() && !files.length) ? 'not-allowed' : 'pointer', opacity: sending || (!reply.trim() && !files.length) ? 0.5 : 1, marginLeft: 'auto', flexShrink: 0 })}
            >
              {sending ? t('friend.sendingMsg') : t('friend.sendCmd')}
            </button>
            {showEmoji && (
              <div
                ref={emojiPopRef}
                style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 6, zIndex: 1000, boxShadow: 'var(--shadow-lg)', borderRadius: 10 }}
              >
                <Suspense fallback={<div style={{ width: 320, height: 360, background: 'var(--bg-elevated)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-s)' }}>{t('friend.emojiLoading')}</div>}>
                  <EmojiPicker
                    onEmojiClick={(d) => { insertEmoji(d.emoji); }}
                    theme={(colorScheme === 'dark' ? 'dark' : 'light') as any}
                    lazyLoadEmojis
                    searchPlaceholder={t('friend.emojiSearch')}
                    width={320}
                    height={360}
                  />
                </Suspense>
              </div>
            )}
          </div>
        </div>
      )}
      {!targetPartner && (
        <div className="msg-timeline-input" style={{ color: 'var(--text-muted)', fontSize: 'var(--font-s)', textAlign: 'center', padding: 12 }}>
          {t('friend.selectFriendToReply')}
        </div>
      )}
      {targetPartner && !targetPartner.active && (
        <div className="msg-timeline-input" style={{ color: 'var(--partner-brand-danger)', fontSize: 'var(--font-s)', textAlign: 'center', padding: 12 }}>
          {t('friend.inactivePartner')}
        </div>
      )}
    </div>
  );
}
