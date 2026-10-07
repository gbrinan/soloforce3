import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { iconBtn } from '../ui/controls';
import { useT } from '../i18n/I18nProvider';

interface Props {
  // Existing ChatPanel passed as children — renders only when modal is open so
  // ChatPanel mounts on demand (messages live in App-level state, no loss).
  children: ReactNode;
  position?: 'right-bottom' | 'left-bottom' | 'right-top';
}

type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const MIN_W = 320;
const MIN_H = 400;
const MAX_W_PX = 700;
const MAX_H_PX = 900;
const EDGE = 6;     // 가장자리 핸들 두께
const CORNER = 16;  // 모서리 핸들 크기

export default function MyCrewFab({ children, position = 'right-bottom' }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [modalPos, setModalPos] = useState(() => {
    try {
      const saved = localStorage.getItem('mycrew-fab-modal-pos');
      if (saved) {
        const parsed = JSON.parse(saved);
        return { x: parsed.x ?? 24, y: parsed.y ?? 96 };
      }
    } catch { /* */ }
    return { x: 24, y: 96 };
  });
  const [modalSize, setModalSize] = useState(() => {
    try {
      const saved = localStorage.getItem('mycrew-fab-modal-size');
      if (saved) {
        const parsed = JSON.parse(saved);
        return { w: parsed.w ?? 440, h: parsed.h ?? 640 };
      }
    } catch { /* */ }
    return { w: 440, h: 640 };
  });
  const [dragging, setDragging] = useState(false);
  const [resizeDir, setResizeDir] = useState<ResizeDir | null>(null);
  const startRef = useRef<{
    mx: number; my: number;
    x: number; y: number;
    w: number; h: number;
  } | null>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);
  const latestMouse = useRef<{ x: number; y: number } | null>(null);

  // 모달이 열릴 때 화면 밖에 저장된 좌표를 안쪽으로 클램프
  useEffect(() => {
    if (!open) return;
    const maxX = Math.max(0, window.innerWidth - modalSize.w - 8);
    const maxY = Math.max(0, window.innerHeight - modalSize.h - 8);
    if (modalPos.x > maxX || modalPos.y > maxY) {
      setModalPos({ x: Math.min(modalPos.x, maxX), y: Math.min(modalPos.y, maxY) });
    }
    // 마운트 한 번 보정. 위치/크기 변경 따라가지 않음.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const persistLater = useCallback((p: { x: number; y: number }, s: { w: number; h: number }) => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      try {
        localStorage.setItem('mycrew-fab-modal-pos', JSON.stringify(p));
        localStorage.setItem('mycrew-fab-modal-size', JSON.stringify(s));
      } catch { /* */ }
    }, 150);
  }, []);

  useEffect(() => {
    if (!dragging && !resizeDir) return;

    const flush = () => {
      rafRef.current = null;
      const m = latestMouse.current;
      const start = startRef.current;
      if (!m || !start) return;
      const dx = m.x - start.mx;
      const dy = m.y - start.my;
      const winW = window.innerWidth;
      const winH = window.innerHeight;
      const maxW = Math.min(MAX_W_PX, winW);
      const maxH = Math.min(MAX_H_PX, winH);

      if (dragging) {
        const nx = Math.max(0, Math.min(winW - start.w, start.x + dx));
        const ny = Math.max(0, Math.min(winH - start.h, start.y + dy));
        setModalPos({ x: nx, y: ny });
        return;
      }

      let nx = start.x;
      let ny = start.y;
      let nw = start.w;
      let nh = start.h;
      const dir = resizeDir!;

      if (dir.includes('e')) {
        nw = Math.max(MIN_W, Math.min(maxW, Math.min(winW - start.x, start.w + dx)));
      }
      if (dir.includes('w')) {
        const wantW = start.w - dx;
        nw = Math.max(MIN_W, Math.min(maxW, wantW));
        nx = start.x + (start.w - nw);
        if (nx < 0) { nw += nx; nx = 0; }
      }
      if (dir.includes('s')) {
        nh = Math.max(MIN_H, Math.min(maxH, Math.min(winH - start.y, start.h + dy)));
      }
      if (dir.includes('n')) {
        const wantH = start.h - dy;
        nh = Math.max(MIN_H, Math.min(maxH, wantH));
        ny = start.y + (start.h - nh);
        if (ny < 0) { nh += ny; ny = 0; }
      }

      setModalPos({ x: nx, y: ny });
      setModalSize({ w: nw, h: nh });
    };

    const handleMove = (e: MouseEvent) => {
      latestMouse.current = { x: e.clientX, y: e.clientY };
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(flush);
    };

    const handleUp = () => {
      if (rafRef.current !== null) {
        // 마지막 프레임을 동기로 한 번 더 처리해서 종료 직전 좌표 누락 방지
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        flush();
      }
      // 최종 상태를 localStorage에 저장
      setModalPos((p) => { setModalSize((s) => { persistLater(p, s); return s; }); return p; });
      setDragging(false);
      setResizeDir(null);
      startRef.current = null;
      latestMouse.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [dragging, resizeDir, persistLater]);

  const beginDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    startRef.current = {
      mx: e.clientX, my: e.clientY,
      x: modalPos.x, y: modalPos.y,
      w: modalSize.w, h: modalSize.h,
    };
    setDragging(true);
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  }, [modalPos, modalSize]);

  const beginResize = useCallback((dir: ResizeDir, cursor: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    startRef.current = {
      mx: e.clientX, my: e.clientY,
      x: modalPos.x, y: modalPos.y,
      w: modalSize.w, h: modalSize.h,
    };
    setResizeDir(dir);
    document.body.style.cursor = cursor;
    document.body.style.userSelect = 'none';
  }, [modalPos, modalSize]);

  const getFabStyle = (): React.CSSProperties => {
    const base: React.CSSProperties = {
      position: 'fixed',
      zIndex: 60,
      width: 56,
      height: 56,
      borderRadius: '50%',
      background: 'var(--accent-info, #6366F1)',
      color: '#fff',
      border: 'none',
      cursor: 'pointer',
      boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
      fontSize: 24,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    };
    switch (position) {
      case 'left-bottom':
        return { ...base, left: 24, bottom: 24 };
      case 'right-top':
        return { ...base, right: 24, top: 80 };
      default:
        return { ...base, right: 24, bottom: 24 };
    }
  };

  const active = dragging || !!resizeDir;
  const borderColor = active
    ? 'var(--accent-info, #6366F1)'
    : 'var(--border-default, var(--mantine-color-default-border, #DFE1E5))';

  const getModalStyle = (): React.CSSProperties => ({
    position: 'fixed',
    left: modalPos.x,
    top: modalPos.y,
    zIndex: 60,
    width: modalSize.w,
    height: modalSize.h,
    background: 'var(--bg-primary, var(--mantine-color-body, #ffffff))',
    border: `1px solid ${borderColor}`,
    borderRadius: 10,
    boxShadow: active
      ? '0 16px 48px rgba(99,102,241,0.32)'
      : '0 12px 40px rgba(0,0,0,0.32)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    willChange: active ? 'left, top, width, height' : 'auto',
    transition: active ? 'none' : 'border-color 0.15s, box-shadow 0.15s',
  });

  // 8방향 리사이즈 핸들 정의
  const handles: Array<{ dir: ResizeDir; cursor: string; style: React.CSSProperties }> = [
    // 가장자리 4개
    { dir: 'n', cursor: 'ns-resize', style: { top: -EDGE / 2, left: CORNER, right: CORNER, height: EDGE } },
    { dir: 's', cursor: 'ns-resize', style: { bottom: -EDGE / 2, left: CORNER, right: CORNER, height: EDGE } },
    { dir: 'w', cursor: 'ew-resize', style: { left: -EDGE / 2, top: CORNER, bottom: CORNER, width: EDGE } },
    { dir: 'e', cursor: 'ew-resize', style: { right: -EDGE / 2, top: CORNER, bottom: CORNER, width: EDGE } },
    // 모서리 4개
    { dir: 'nw', cursor: 'nwse-resize', style: { top: -EDGE / 2, left: -EDGE / 2, width: CORNER, height: CORNER } },
    { dir: 'ne', cursor: 'nesw-resize', style: { top: -EDGE / 2, right: -EDGE / 2, width: CORNER, height: CORNER } },
    { dir: 'sw', cursor: 'nesw-resize', style: { bottom: -EDGE / 2, left: -EDGE / 2, width: CORNER, height: CORNER } },
    { dir: 'se', cursor: 'nwse-resize', style: { bottom: -EDGE / 2, right: -EDGE / 2, width: CORNER, height: CORNER } },
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? t('fab.closeChat') : t('fab.openChat')}
        aria-expanded={open}
        title={t('fab.chatTitle')}
        style={getFabStyle()}
      >
        {open ? '✕' : '💬'}
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label={t('fab.chatPanelAriaLabel')}
          style={getModalStyle()}
        >
          {/* 헤더: 전체 가로 grab 영역 */}
          <div
            onMouseDown={beginDrag}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 12px',
              borderBottom: '1px solid var(--border-default, var(--mantine-color-default-border, #DFE1E5))',
              background: 'var(--bg-secondary, transparent)',
              cursor: dragging ? 'grabbing' : 'grab',
              userSelect: 'none',
              flexShrink: 0,
            }}
            title={t('fab.dragToMove')}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
              <span
                aria-hidden
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  background: 'var(--accent-info, #6366F1)',
                  color: '#fff',
                  flexShrink: 0,
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </span>
              <strong style={{ fontSize: 14 }}>MyCrew</strong>
            </span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setOpen(false); }}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label={t('fab.close')}
              style={iconBtn('sm', 'subtle', {
                border: 'none',
                fontSize: 18,
                color: 'var(--text-primary, inherit)',
                lineHeight: 1,
              })}
            >
              ✕
            </button>
          </div>

          {/* 본문 */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
            {children}
          </div>

          {/* 8방향 리사이즈 핸들 (모달 가장자리 외곽에 배치) */}
          {handles.map((h) => (
            <div
              key={h.dir}
              onMouseDown={beginResize(h.dir, h.cursor)}
              role="separator"
              aria-label={t('fab.resizeAriaLabel', { dir: h.dir })}
              style={{
                position: 'absolute',
                ...h.style,
                cursor: h.cursor,
                zIndex: 10,
                background: 'transparent',
              }}
            />
          ))}
        </div>
      )}
    </>
  );
}
