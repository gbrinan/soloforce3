import React, { useState, useEffect } from 'react';
import { btn } from '../../ui/controls';
import { useT } from '../../i18n/I18nProvider';

interface Props {
  onClose: () => void;
}

// 막메모 — 단일 스크래치 메모. 열면 읽어오고, 저장 버튼 하나.
export default function MemoModal({ onClose }: Props) {
  const t = useT();
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/memo')
      .then((r) => r.json())
      .then((d) => setContent(d.content ?? ''))
      .catch(() => { /* */ });
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await fetch('/api/memo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch { /* */ } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay visible" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true">
      <div className="modal" style={{ maxWidth: 560, width: '90%' }}>
        <div className="modal-header">
          <h3>{t('memo.title')}</h3>
          <button className="modal-close" onClick={onClose} aria-label={t('common.close')}>&times;</button>
        </div>
        <div className="modal-body">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t('memo.placeholder')}
            style={{
              width: '100%', height: 320, boxSizing: 'border-box', resize: 'vertical',
              background: 'var(--bg-canvas)', color: 'var(--text-primary)', border: '1px solid var(--border-default)',
              borderRadius: 6, padding: 10, fontSize: 'var(--font-s)', lineHeight: 1.6,
              fontFamily: 'inherit', outline: 'none',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginTop: 12 }}>
            {saved && <span style={{ fontSize: 'var(--font-s)', color: 'var(--accent-success)' }}>{t('memo.saved')}</span>}
            <button onClick={save} disabled={saving} style={btn('md', 'primary', {
              cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1,
            })}>
              {saving ? t('memo.saving') : t('memo.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
