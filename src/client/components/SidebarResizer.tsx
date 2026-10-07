import React, { useEffect, useRef } from 'react';
import { useT } from '../i18n/I18nProvider';

interface Props {
  onResize: (newWidth: number) => void;
  minWidth?: number;
  maxWidthVw?: number;
}

export default function SidebarResizer({ onResize, minWidth = 320, maxWidthVw = 2 / 3 }: Props) {
  const t = useT();
  const draggingRef = useRef(false);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!draggingRef.current) return;
      const next = Math.min(
        Math.max(window.innerWidth - e.clientX, minWidth),
        Math.floor(window.innerWidth * maxWidthVw),
      );
      onResize(next);
    }
    function onUp() {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [onResize, minWidth, maxWidthVw]);

  const start = (e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('common.resizeSidebar')}
      onMouseDown={start}
      style={{
        position: 'absolute',
        top: 0,
        left: -3,
        width: 6,
        height: '100%',
        cursor: 'ew-resize',
        zIndex: 10,
        background: 'transparent',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--mantine-color-jarvis-6)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
    />
  );
}
