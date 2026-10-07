import React, { useState } from 'react';
import { useT } from '../i18n/I18nProvider';
import { btn } from '../ui/controls';

interface Props {
  text: string;
  size?: number;
  label?: string;
}

export default function CopyButton({ text, size = 20, label }: Props) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (label) {
    return (
      <button
        type="button"
        onClick={handleClick}
        title={t('common.copyClipboard')}
        style={btn('sm', 'neutral', {
          background: copied ? 'color-mix(in srgb, var(--accent-success) 13%, transparent)' : 'var(--mantine-color-default)',
          border: `1px solid ${copied ? 'var(--accent-success)' : 'var(--mantine-color-default-border)'}`,
          color: copied ? 'var(--accent-success)' : 'var(--mantine-color-text)',
          transition: 'color 0.2s, border-color 0.2s',
        })}
      >
        {copied ? t('common.copied') : `📋 ${label}`}
      </button>
    );
  }

  return (
    <span
      onClick={handleClick}
      title={t('common.copyPath')}
      style={{
        cursor: 'pointer',
        color: copied ? 'var(--accent-success)' : 'var(--text-muted)',
        fontSize: size,
        transition: 'color 0.2s',
      }}
    >
      {copied ? '✓' : '⧉'}
    </span>
  );
}
