import React, { useEffect, useId, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../../i18n/I18nProvider';

export type DialogVariant = 'default' | 'danger' | 'info';

interface BaseOptions {
  title: string;
  description?: string;
  variant?: DialogVariant;
  confirmLabel?: string;
}

export interface ConfirmOptions extends BaseOptions {
  cancelLabel?: string;
  dismissOnOverlay?: boolean;
}

export interface AlertOptions extends BaseOptions {
  // Alert: confirm only
}

export interface PromptOptions extends ConfirmOptions {
  label?: string;
  placeholder?: string;
  initialValue?: string;
  helperText?: string;
  validate?: (value: string) => string | null;
  multiline?: boolean;
}

type Request =
  | { id: number; type: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { id: number; type: 'alert'; opts: AlertOptions; resolve: () => void }
  | { id: number; type: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void };

const queue: Request[] = [];
const listeners = new Set<() => void>();
let lastId = 0;

function notify() { for (const l of listeners) l(); }

function enqueue<T extends Request>(req: T): void {
  queue.push(req);
  notify();
}

export function uiConfirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    enqueue({ id: ++lastId, type: 'confirm', opts, resolve });
  });
}

export function uiAlert(opts: AlertOptions): Promise<void> {
  return new Promise((resolve) => {
    enqueue({ id: ++lastId, type: 'alert', opts, resolve });
  });
}

export function uiPrompt(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    enqueue({ id: ++lastId, type: 'prompt', opts, resolve });
  });
}

export function useDialog() {
  return { confirm: uiConfirm, alert: uiAlert, prompt: uiPrompt };
}

function focusableSelector(): string {
  return [
    'button:not([disabled])',
    'input:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
    'a[href]',
  ].join(',');
}

function UiDialog({ req, onResolve }: { req: Request; onResolve: (value: unknown) => void }) {
  const t = useT();
  const id = useId();
  const variant: DialogVariant =
    req.opts.variant ?? (req.type === 'alert' ? 'info' : 'default');
  const titleId = `dialog-title-${id}`;
  const descId = req.opts.description ? `dialog-desc-${id}` : undefined;
  const helperId = req.type === 'prompt' && (req.opts as PromptOptions).helperText ? `dialog-helper-${id}` : undefined;

  const panelRef = useRef<HTMLDivElement | null>(null);
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const isPrompt = req.type === 'prompt';
  const isAlert = req.type === 'alert';
  const dismissOnOverlay = (req.opts as ConfirmOptions).dismissOnOverlay
    ?? (variant === 'danger' ? false : true);

  const [value, setValue] = useState<string>(
    isPrompt ? ((req.opts as PromptOptions).initialValue ?? '') : '',
  );
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  const close = useCallback((result: unknown) => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => onResolve(result), 140);
  }, [closing, onResolve]);

  const handleConfirm = useCallback(() => {
    if (isPrompt) {
      const p = req.opts as PromptOptions;
      const v = value;
      const err = p.validate ? p.validate(v) : null;
      if (err) { setError(err); return; }
      close(v);
    } else if (isAlert) {
      close(undefined);
    } else {
      close(true);
    }
  }, [close, isPrompt, isAlert, req.opts, value]);

  const handleCancel = useCallback(() => {
    if (isPrompt) close(null);
    else if (isAlert) close(undefined);
    else close(false);
  }, [close, isPrompt, isAlert]);

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const initialFocus = (() => {
      if (variant === 'danger') return cancelBtnRef.current;
      if (isPrompt) return inputRef.current;
      return confirmBtnRef.current;
    })();
    initialFocus?.focus();

    return () => {
      document.body.style.overflow = prevOverflow;
      previouslyFocusedRef.current?.focus?.();
    };
  }, [variant, isPrompt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
        return;
      }
      if (e.key === 'Enter') {
        if (isPrompt) {
          const p = req.opts as PromptOptions;
          if (p.multiline && !(e.metaKey || e.ctrlKey)) return;
        }
        e.preventDefault();
        handleConfirm();
        return;
      }
      if (e.key === 'Tab') {
        const panel = panelRef.current;
        if (!panel) return;
        const list = Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector()));
        if (list.length === 0) return;
        const first = list[0]!;
        const last = list[list.length - 1]!;
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleCancel, handleConfirm, isPrompt, req.opts]);

  const variantIcon = variant === 'danger' ? (
    <svg className="dialog-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M10 1.5L19 17.5H1L10 1.5Z M10 7v5 M10 14v1" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  ) : variant === 'info' ? (
    <svg className="dialog-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M10 6h0 M10 9v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ) : null;

  const role = isAlert ? 'alertdialog' : 'dialog';
  const confirmClass = `dialog-btn ${variant === 'danger' ? 'dialog-btn-destructive' : 'dialog-btn-primary'}`;
  const cancelLabel = (req.opts as ConfirmOptions).cancelLabel ?? t('common.cancel');
  const confirmLabel = req.opts.confirmLabel ?? t('common.confirm');

  return (
    <>
      <div
        className={`dialog-overlay${closing ? ' closing' : ''}`}
        role="presentation"
        onClick={() => { if (dismissOnOverlay) handleCancel(); }}
      />
      <div
        ref={panelRef}
        className={`dialog-panel ${variant}${closing ? ' closing' : ''}`}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <div className="dialog-stripe" aria-hidden="true" />
        <header className="dialog-header">
          {variantIcon}
          <h2 id={titleId} className="dialog-title">{req.opts.title}</h2>
        </header>
        {req.opts.description && (
          <p id={descId} className="dialog-desc">{req.opts.description}</p>
        )}
        {isPrompt && (
          <>
            {(req.opts as PromptOptions).label && (
              <label className="dialog-input-label" htmlFor={`dialog-input-${id}`}>
                {(req.opts as PromptOptions).label}
              </label>
            )}
            {(req.opts as PromptOptions).multiline ? (
              <textarea
                ref={(el) => { inputRef.current = el; }}
                id={`dialog-input-${id}`}
                className={`dialog-input${error ? ' has-error' : ''}`}
                placeholder={(req.opts as PromptOptions).placeholder}
                value={value}
                onChange={(e) => { setValue(e.currentTarget.value); if (error) setError(null); }}
                aria-describedby={helperId}
                rows={3}
              />
            ) : (
              <input
                ref={(el) => { inputRef.current = el; }}
                id={`dialog-input-${id}`}
                className={`dialog-input${error ? ' has-error' : ''}`}
                placeholder={(req.opts as PromptOptions).placeholder}
                value={value}
                onChange={(e) => { setValue(e.currentTarget.value); if (error) setError(null); }}
                aria-describedby={helperId}
              />
            )}
            {(error || (req.opts as PromptOptions).helperText) && (
              <p id={helperId} className={`dialog-helper${error ? ' is-error' : ''}`}>
                {error ?? (req.opts as PromptOptions).helperText}
              </p>
            )}
          </>
        )}
        <footer className={`dialog-footer${isAlert ? ' alert' : ''}`}>
          {!isAlert && (
            <button
              ref={cancelBtnRef}
              type="button"
              className="dialog-btn dialog-btn-ghost"
              onClick={handleCancel}
            >
              {cancelLabel}
            </button>
          )}
          <button
            ref={confirmBtnRef}
            type="button"
            className={confirmClass}
            onClick={handleConfirm}
          >
            {confirmLabel}
          </button>
        </footer>
      </div>
    </>
  );
}

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<Request | null>(null);

  useEffect(() => {
    const sync = () => {
      if (!active && queue.length > 0) {
        setActive(queue[0]!);
      }
    };
    listeners.add(sync);
    sync();
    return () => { listeners.delete(sync); };
  }, [active]);

  const handleResolve = useCallback((value: unknown) => {
    if (!active) return;
    const head = queue.shift();
    if (head && head.id === active.id) {
      if (head.type === 'confirm') head.resolve(Boolean(value));
      else if (head.type === 'alert') head.resolve();
      else head.resolve(value as string | null);
    }
    setActive(null);
    window.setTimeout(() => {
      if (queue.length > 0) setActive(queue[0]!);
    }, 0);
  }, [active]);

  return (
    <>
      {children}
      {active && typeof document !== 'undefined'
        ? createPortal(<UiDialog req={active} onResolve={handleResolve} />, document.body)
        : null}
    </>
  );
}
