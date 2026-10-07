import React, { useMemo, useEffect, useRef, useState } from 'react';
import { ActionIcon, Menu } from '@mantine/core';
import { IconEdit, IconDotsVertical, IconDownload, IconFileTypePdf, IconPrinter, IconClipboard, IconCheck, IconMail, IconShare, IconNote } from '@tabler/icons-react';
import { renderMarkdown, extractTOC, mountMermaid, mountMath } from '../../utils/markdown';
import { uiAlert } from '../Dialog/dialog';
import { openAppWithAsset, isAppAvailable } from '../../utils/assetHandoff';
import { useT } from '../../i18n/I18nProvider';

interface Props {
  raw: string;
  fontSize?: 'm' | 's';
  fileName?: string;
  editable?: boolean;
  onEdit?: () => void;
  onDownload?: () => void;
}

export default function ReportViewer({ raw, fontSize = 's', fileName, editable, onEdit, onDownload }: Props) {
  const t = useT();
  const html = useMemo(() => renderMarkdown(raw || ''), [raw]);
  const toc = useMemo(() => extractTOC(raw || ''), [raw]);
  const showToc = toc.length >= 3;
  const fontSizeVar = fontSize === 'm' ? 'var(--font-m)' : 'var(--font-s)';
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCopyRaw = () => {
    if (!raw) return;
    navigator.clipboard.writeText(raw);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleShare = async () => {
    if (!raw) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: fileName, text: raw });
        return;
      } catch {
        // 사용자 취소 또는 실패 — 클립보드 폴백으로 진행
      }
    }
    navigator.clipboard.writeText(raw);
    await uiAlert({ title: t('report.copied'), variant: 'info' });
  };

  useEffect(() => {
    if (!contentRef.current) return;
    void mountMermaid(contentRef.current);
    void mountMath(contentRef.current);
  }, [html]);

  // 스포일러(`||content||`) 클릭/키보드 reveal. CSS :hover/:focus만으로도 reveal되지만,
  // 클릭 시 영구 reveal(data-revealed=true) 토글로 다시 가릴 때까지 텍스트 유지.
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    const onClick = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target?.classList.contains('spoiler')) return;
      const revealed = target.getAttribute('data-revealed') === 'true';
      target.setAttribute('data-revealed', revealed ? 'false' : 'true');
    };
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.classList.contains('spoiler')) return;
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      const revealed = target.getAttribute('data-revealed') === 'true';
      target.setAttribute('data-revealed', revealed ? 'false' : 'true');
    };
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKey);
    return () => {
      root.removeEventListener('click', onClick);
      root.removeEventListener('keydown', onKey);
    };
  }, [html]);

  const handleTocClick = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    const content = contentRef.current;
    if (!content) return;
    // 페이지 전역이 아닌, 이 ReportViewer 내부의 heading만 잡는다 (id 충돌 회피).
    const target = content.querySelector(`[id="${CSS.escape(id)}"]`) as HTMLElement | null;
    if (!target) return;
    // ancestor를 거슬러 올라가 실제 스크롤 가능한 첫 요소를 찾는다.
    // mantine class 이름에 의존하지 않음. 못 찾으면 무동작 — window scroll 폴백 금지.
    let scroller: HTMLElement | null = content;
    while (scroller && scroller !== document.body && scroller !== document.documentElement) {
      const style = window.getComputedStyle(scroller);
      const oy = style.overflowY;
      if ((oy === 'auto' || oy === 'scroll') && scroller.scrollHeight > scroller.clientHeight) {
        break;
      }
      scroller = scroller.parentElement;
    }
    if (!scroller || scroller === document.body || scroller === document.documentElement) {
      return;
    }
    const top = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    scroller.scrollTo({ top, behavior: 'smooth' });
  };

  // window.print() 직전 body에 print-mode 클래스를 부여해 .report-viewer만 인쇄되도록 한다.
  // afterprint 이벤트로 자동 정리. PDF/프린트 공통.
  const triggerPrint = (mode: 'pdf' | 'print') => {
    const viewerEl = contentRef.current?.closest('.report-viewer') as HTMLElement | null;
    if (!viewerEl) {
      window.print();
      return;
    }
    viewerEl.classList.add('print-area');
    document.body.classList.add('jarvis-print-mode');
    const cleanup = () => {
      viewerEl.classList.remove('print-area');
      document.body.classList.remove('jarvis-print-mode');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    if (mode === 'pdf') {
      void uiAlert({
        title: t('report.pdfSaveTitle'),
        description: t('report.pdfSaveDesc'),
        variant: 'info',
      }).then(() => {
        setTimeout(() => window.print(), 50);
      });
    } else {
      setTimeout(() => window.print(), 50);
    }
  };

  const handleSendMail = () => {
    if (!raw) return;
    const blob = new Blob([raw], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const name = fileName || 'document.md';
    openAppWithAsset({ appId: 'mail', kind: 'file', url, name, localFile: true });
  };

  const handleSendNote = async () => {
    if (!raw) return;
    try {
      const res = await fetch('/api/notes/from-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: fileName, content: raw }),
      });
      if (!res.ok) throw new Error('failed');
      await uiAlert({ title: t('report.sendNoteDone'), variant: 'info' });
    } catch {
      await uiAlert({ title: t('report.sendNoteFailed'), variant: 'info' });
    }
  };

  const handleSave = () => {
    if (onDownload) onDownload();
    else if (raw) {
      const blob = new Blob([raw], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName || 'document.txt';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="report-viewer">
      <div className="report-viewer-toolbar">
        {editable && onEdit && (
          <ActionIcon
            variant="subtle"
            color="jarvis.6"
            size="sm"
            onClick={onEdit}
            aria-label={t('report.edit')}
          >
            <IconEdit size={16} stroke={1.5} />
          </ActionIcon>
        )}
        <Menu shadow="md" width={180} position="bottom-end">
          <Menu.Target>
            <ActionIcon variant="subtle" color="gray" size="sm" aria-label={t('report.more')}>
              <IconDotsVertical size={16} stroke={1.5} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={<IconShare size={14} stroke={1.5} />} onClick={() => void handleShare()}>
              {t('report.share')}
            </Menu.Item>
            <Menu.Item
              leftSection={copied
                ? <IconCheck size={14} stroke={1.5} color="var(--accent-success)" />
                : <IconClipboard size={14} stroke={1.5} />}
              onClick={handleCopyRaw}
            >
              {copied ? t('report.copied') : t('report.copy')}
            </Menu.Item>
            <Menu.Item leftSection={<IconDownload size={14} stroke={1.5} />} onClick={handleSave}>
              {t('report.save')}
            </Menu.Item>
            {isAppAvailable('mail') && (
              <Menu.Item leftSection={<IconMail size={14} stroke={1.5} />} onClick={handleSendMail}>
                {t('report.sendMail')}
              </Menu.Item>
            )}
            <Menu.Item leftSection={<IconNote size={14} stroke={1.5} />} onClick={() => void handleSendNote()}>
              {t('report.sendNote')}
            </Menu.Item>
            <Menu.Item leftSection={<IconFileTypePdf size={14} stroke={1.5} />} onClick={() => triggerPrint('pdf')}>
              {t('report.exportPdf')}
            </Menu.Item>
            <Menu.Item leftSection={<IconPrinter size={14} stroke={1.5} />} onClick={() => triggerPrint('print')}>
              {t('report.print')}
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </div>
      <div className="report-viewer-body">
        {showToc && (
          <aside className="report-toc" aria-label={t('report.tocAriaLabel')}>
            <div className="report-toc-title">{t('report.tocTitle')}</div>
            <ul>
              {toc.map((t, i) => (
                <li key={i} className={`report-toc-l${t.level}`}>
                  <a href={`#${t.id}`} onClick={(e) => handleTocClick(e, t.id)}>{t.text}</a>
                </li>
              ))}
            </ul>
          </aside>
        )}
        <div
          ref={contentRef}
          className="md report-viewer-content"
          style={{ fontSize: fontSizeVar }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}
