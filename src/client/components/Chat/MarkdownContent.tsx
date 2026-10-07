import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy } from 'lucide-react';
import { useT } from '../../i18n/I18nProvider';

interface MarkdownContentProps {
  html: string;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
}

type CopyState = 'idle' | 'copied' | 'failed';

function CodeCopyButton({ codeBlock }: { codeBlock: HTMLPreElement }) {
  const t = useT();
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    };
  }, []);

  const label =
    copyState === 'copied'
      ? t('chat.codeCopied')
      : copyState === 'failed'
        ? t('meeting.copyFailed')
        : t('chat.copyCode');

  const scheduleReset = () => {
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = window.setTimeout(() => setCopyState('idle'), 1500);
  };

  const handleCopy = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const rawCode = codeBlock.querySelector('code')?.textContent ?? '';
    try {
      await navigator.clipboard.writeText(rawCode);
      setCopyState('copied');
    } catch (err) {
      console.warn('[chat-code-copy] clipboard write failed', err);
      setCopyState('failed');
    }
    scheduleReset();
  };

  return (
    <button
      type="button"
      className={`chat-code-copy-btn ${copyState === 'copied' ? 'is-copied' : ''}`}
      aria-label={label}
      title={label}
      onClick={handleCopy}
    >
      {copyState === 'copied' ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
      <span>{label}</span>
    </button>
  );
}

export default function MarkdownContent({ html, onClick }: MarkdownContentProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [codeBlocks, setCodeBlocks] = useState<HTMLPreElement[]>([]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      setCodeBlocks([]);
      return;
    }

    const blocks = Array.from(root.querySelectorAll<HTMLPreElement>('pre')).filter((pre) => pre.querySelector('code'));
    blocks.forEach((pre) => pre.classList.add('chat-code-block'));
    setCodeBlocks(blocks);
  }, [html]);

  return (
    <>
      <div ref={rootRef} dangerouslySetInnerHTML={{ __html: html }} onClick={onClick} />
      {codeBlocks.map((codeBlock, index) => createPortal(
        <CodeCopyButton codeBlock={codeBlock} />,
        codeBlock,
        `chat-code-copy-${index}`,
      ))}
    </>
  );
}
