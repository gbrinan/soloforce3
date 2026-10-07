import React, { useState, useRef, useCallback, useEffect } from 'react';
import { ActionIcon } from '@mantine/core';
import { IconSend } from '@tabler/icons-react';
import { uiAlert } from '../Dialog/dialog';
import { useT } from '../../i18n/I18nProvider';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_ATTACHMENTS = 10;

export interface AppAttachment {
  type: 'library' | 'note' | 'meeting-note' | 'contact' | 'mail' | 'place';
  name: string;
  path?: string;     // 자료실/회의록: relativePath (마이크루가 SafeRead로 읽을 경로)
  content?: string;  // 노트/연락처/메일: 본문 직접 포함
  // place-specific
  address?: string;
  lat?: number;
  lng?: number;
  color?: string;
  featureId?: string;
}

function filterBySize(files: File[], t: ReturnType<typeof useT>): File[] {
  const tooBig = files.filter(f => f.size > MAX_FILE_SIZE);
  if (tooBig.length) {
    const names = tooBig.map(f => `${f.name} (${(f.size / 1024 / 1024).toFixed(1)}MB)`).join(', ');
    void uiAlert({ title: t('chat.fileTooBig'), description: t('chat.fileTooBigDesc', { names }), variant: 'info' });
  }
  return files.filter(f => f.size <= MAX_FILE_SIZE);
}

function applyAttachmentLimit(current: File[], incoming: File[], t: ReturnType<typeof useT>): File[] {
  const room = Math.max(0, MAX_ATTACHMENTS - current.length);
  if (incoming.length <= room) return [...current, ...incoming];
  const dropped = incoming.length - room;
  void uiAlert({
    title: t('chat.maxAttachments'),
    description: t('chat.maxAttachmentsDesc', { dropped: String(dropped) }),
    variant: 'info',
  });
  return [...current, ...incoming.slice(0, room)];
}

interface Props {
  onSend: (message: string, files?: File[]) => void;
  onAbort?: () => void;
  inputDisabled: boolean;
  sendDisabled: boolean;
  genieName?: string;
  busyStartTime?: number;
  progress?: string;
  externalFiles?: File[];
  onClearExternalFiles?: () => void;
  externalCustomItems?: AppAttachment[];
  onClearCustomItems?: () => void;
}

export default function ChatInput({ onSend, onAbort, inputDisabled, sendDisabled, genieName, busyStartTime, progress, externalFiles, onClearExternalFiles, externalCustomItems, onClearCustomItems }: Props) {
  const t = useT();
  const resolvedGenieName = genieName ?? t('chat.defaultAssistantName');
  const [text, setText] = useState(() => localStorage.getItem('chat-draft') || '');
  const [files, setFiles] = useState<File[]>([]);
  const [imageUrls, setImageUrls] = useState<(string | null)[]>([]);
  const [customAttachments, setCustomAttachments] = useState<AppAttachment[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isCoarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

  // busy 타이머
  useEffect(() => {
    if (!busyStartTime) { setElapsed(0); return; }
    const tick = () => setElapsed(Math.floor((Date.now() - busyStartTime) / 1000));
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [busyStartTime]);

  // 첨부 이미지 썸네일 URL 생성/해제
  useEffect(() => {
    const urls = files.map(f => f.type.startsWith('image/') ? URL.createObjectURL(f) : null);
    setImageUrls(urls);
    return () => {
      urls.forEach(u => { if (u) URL.revokeObjectURL(u); });
    };
  }, [files]);

  // 외부 드롭 파일 합치기 (10개 cap 적용)
  useEffect(() => {
    if (externalFiles?.length) {
      setFiles(prev => applyAttachmentLimit(prev, externalFiles, t));
      onClearExternalFiles?.();
    }
  }, [externalFiles]);

  // 외부 커스텀 첨부 (자료실/노트) 합치기
  useEffect(() => {
    if (externalCustomItems?.length) {
      setCustomAttachments(prev => [...prev, ...externalCustomItems]);
      onClearCustomItems?.();
    }
  }, [externalCustomItems]);

  // 자동 높이 조절
  const adjustHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'; }
  }, []);

  // 텍스트 변경 시 높이 동기화
  useEffect(() => { adjustHeight(); }, [text, elapsed, progress, sendDisabled, adjustHeight]);

  // 페이지 떠날 때만 입력 내용 보존 (beforeunload)
  useEffect(() => {
    const save = () => {
      if (text) localStorage.setItem('chat-draft', text);
      else localStorage.removeItem('chat-draft');
    };
    window.addEventListener('beforeunload', save);
    return () => window.removeEventListener('beforeunload', save);
  }, [text]);

  // 데스크탑: 자동 포커스
  useEffect(() => {
    if (!isCoarse && textareaRef.current) textareaRef.current.focus();
  }, [inputDisabled]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
  }, []);

  const handleSend = useCallback(() => {
    if (sendDisabled) return;
    if (!text.trim() && !files.length && !customAttachments.length) return;
    let finalMessage = text;
    if (customAttachments.length) {
      const attachText = customAttachments.map(a => {
        if (a.type === 'note') {
          return `${t('chat.attachNotePrefix', { name: a.name })}\n${a.content ?? ''}`;
        }
        if (a.type === 'contact') {
          return `${t('chat.attachContactPrefix', { name: a.name })}\n${a.content ?? ''}`;
        }
        if (a.type === 'mail') {
          return `${t('chat.attachMailPrefix', { name: a.name })}\n${a.content ?? ''}`;
        }
        if (a.type === 'meeting-note') {
          return `${t('chat.attachMeetingNotePrefix', { name: a.name })}\n${t('chat.pathLabel', { path: a.path ?? '' })}\n${t('chat.meetingNoteSafeReadHint')}`;
        }
        if (a.type === 'place') {
          const parts = [t('chat.placeSharePrefix', { name: a.name })];
          if (a.address) parts.push(t('chat.addressLabel', { address: a.address }));
          if (a.lat != null && a.lng != null) parts.push(t('chat.coordsLabel', { lat: a.lat.toFixed(6), lng: a.lng.toFixed(6) }));
          return parts.join('\n');
        }
        return `${t('chat.attachDefaultPrefix', { name: a.name })}\n${t('chat.pathLabel', { path: a.path ?? '' })}\n${t('chat.safeReadHint')}`;
      }).join('\n\n');
      finalMessage = attachText + (text.trim() ? '\n\n---\n' + text : '');
    }
    onSend(finalMessage, files.length ? files : undefined);
    setText('');
    setFiles([]);
    setCustomAttachments([]);
    if (!isCoarse) setTimeout(() => textareaRef.current?.focus(), 50);
  }, [text, files, customAttachments, onSend, sendDisabled]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (isCoarse) return; // 모바일: Enter = 줄바꿈
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend, isCoarse]);

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') { setText(''); setFiles([]); return; }
    handleKeyDown(e);
  }, [handleKeyDown]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const accepted = filterBySize(Array.from(e.target.files), t);
      if (accepted.length) setFiles(prev => applyAttachmentLimit(prev, accepted, t));
    }
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const pastedFiles = Array.from(e.clipboardData.files);
    if (pastedFiles.length) {
      const accepted = filterBySize(pastedFiles, t);
      if (accepted.length) setFiles(prev => applyAttachmentLimit(prev, accepted, t));
    }
  }, []);

  return (
    <div>
      {customAttachments.length > 0 && (
        <div style={{ padding: '8px 16px', display: 'flex', gap: 8, flexWrap: 'wrap', background: 'var(--bg-surface)', borderTop: '1px solid var(--border-default)' }}>
          {customAttachments.map((a, i) => (
            <div key={i} style={{ background: 'var(--border-default)', padding: '4px 10px', borderRadius: 6, fontSize: 'var(--font-s)', display: 'flex', gap: 6, alignItems: 'center', maxWidth: 240 }}>
              <span>{a.type === 'note' ? '📝' : a.type === 'meeting-note' ? '📋' : a.type === 'contact' ? '👤' : a.type === 'mail' ? '✉️' : a.type === 'place' ? '📍' : '📄'}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{a.name}</span>
              <button onClick={() => setCustomAttachments(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: 'var(--accent-danger)', cursor: 'pointer', fontSize: 'var(--font-s)', flexShrink: 0 }}>✕</button>
            </div>
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div style={{ padding: '10px 16px', display: 'flex', gap: 8, flexWrap: 'wrap', background: 'var(--bg-surface)', borderTop: '1px solid var(--border-default)' }}>
          {files.map((f, i) => {
            const url = imageUrls[i];
            const remove = () => setFiles(prev => prev.filter((_, j) => j !== i));
            if (url) {
              return (
                <div key={i} style={{ position: 'relative', width: 110, height: 110, borderRadius: 10, overflow: 'hidden', background: 'var(--bg-canvas)', border: '1px solid var(--border-default)' }} title={f.name}>
                  <img src={url} alt={f.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  <button
                    onClick={remove}
                    aria-label={t('chat.removeAttachment')}
                    style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.65)', border: 'none', color: 'var(--accent-danger)', cursor: 'pointer', fontSize: 'var(--font-s)', width: 22, height: 22, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}
                  >✕</button>
                </div>
              );
            }
            return (
              <div key={i} style={{ background: 'var(--border-default)', padding: '4px 10px', borderRadius: 6, fontSize: 'var(--font-s)', display: 'flex', gap: 4, alignItems: 'center', alignSelf: 'flex-start' }}>
                {f.name.slice(0, 25)}
                <button onClick={remove} style={{ background: 'none', border: 'none', color: 'var(--accent-danger)', cursor: 'pointer', fontSize: 'var(--font-s)' }}>✕</button>
              </div>
            );
          })}
        </div>
      )}
    <div className="input-area" style={{ position: 'relative' }}>
      <button className="btn-attach" onClick={() => fileInputRef.current?.click()} type="button">+</button>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleChange}
        onKeyDown={handleInputKeyDown}
        onPaste={handlePaste}
        placeholder={busyStartTime ? `${t('chat.inputBusy', { name: resolvedGenieName })}${elapsed > 0 ? ` (${elapsed}s)` : ''}${progress ? ` · ${progress.replace(/🔧\s*/g, '')}` : ''}` : t('chat.inputPlaceholder', { name: resolvedGenieName })}
        rows={1}
        disabled={inputDisabled}
      />
      <ActionIcon
        variant="filled"
        color="jarvis"
        size={44}
        radius="xl"
        onClick={handleSend}
        disabled={!text.trim() && !files.length && !customAttachments.length}
        aria-label={t('chat.send')}
      >
        <IconSend size={18} stroke={1.8} />
      </ActionIcon>
    </div>
    </div>
  );
}
