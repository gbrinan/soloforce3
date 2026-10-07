import { useEffect, useState } from 'react';
import { t as translate, useI18n } from '../i18n';
import { btn } from '../ui/controls';

type ConfirmOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type ConfirmState =
  | { open: false }
  | { open: true; options: ConfirmOptions; resolve: (ok: boolean) => void };

type Listener = (s: ConfirmState) => void;

let _state: ConfirmState = { open: false };
const _listeners = new Set<Listener>();

function update(next: ConfirmState) {
  _state = next;
  _listeners.forEach((l) => l(next));
}

export function confirmDialog(opts: ConfirmOptions | string): Promise<boolean> {
  const o = typeof opts === 'string' ? { message: opts } : opts;
  return new Promise((resolve) => update({ open: true, options: o, resolve }));
}

export function alertDialog(message: string, title?: string): Promise<void> {
  return confirmDialog({ message, title, cancelLabel: '', confirmLabel: translate('common.confirm') }).then(() => undefined);
}

export default function ConfirmDialog() {
  const { t } = useI18n();
  const [state, setState] = useState<ConfirmState>(_state);

  useEffect(() => {
    _listeners.add(setState);
    return () => { _listeners.delete(setState); };
  }, []);

  useEffect(() => {
    if (!state.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
      else if (e.key === 'Enter') close(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.open]);

  if (!state.open) return null;
  const { options, resolve } = state;
  const close = (ok: boolean) => {
    resolve(ok);
    update({ open: false });
  };
  const hideCancel = options.cancelLabel === '';

  return (
    <div
      onClick={() => close(false)}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'mm-fadein 0.15s ease-out',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 14, padding: '20px 22px', minWidth: 300, maxWidth: 420,
          boxShadow: '0 24px 48px rgba(0,0,0,0.5)',
        }}
      >
        {options.title && (
          <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)', marginBottom: 8 }}>
            {options.title}
          </div>
        )}
        <div style={{
          fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.55,
          marginBottom: 18, whiteSpace: 'pre-wrap',
        }}>
          {options.message}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {!hideCancel && (
            <button
              onClick={() => close(false)}
              style={btn('md', 'subtle')}
            >
              {options.cancelLabel ?? t('common.cancel')}
            </button>
          )}
          <button
            autoFocus
            onClick={() => close(true)}
            style={btn('md', options.danger ? 'danger' : 'primary', { fontWeight: 600 })}
          >
            {options.confirmLabel ?? t('common.confirm')}
          </button>
        </div>
      </div>
      <style>{`@keyframes mm-fadein { from { opacity: 0; } to { opacity: 1; } }`}</style>
    </div>
  );
}
