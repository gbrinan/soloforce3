import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Modal, ActionIcon } from '@mantine/core';
import { IconX, IconPlus, IconMinus } from '@tabler/icons-react';
import { useT } from '../i18n/I18nProvider';
import MediaActions from './Chat/MediaActions';

interface Props {
  src: string | null;
  onClose: () => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const clamp = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

// 대화 박스 이미지 확대 뷰 — 휠/버튼/핀치 줌(1x~4x), 줌 상태 드래그 팬, 더블클릭/더블탭 토글.
// 새 의존성 없이 transform(scale+translate)으로 직접 구현.
export default function ImageZoomModal({ src, onClose }: Props) {
  const t = useT();
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [dragging, setDragging] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const mouse = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const touch = useRef<{ mode: 'pan' | 'pinch'; x: number; y: number; tx: number; ty: number; dist: number; scale: number } | null>(null);
  const lastTap = useRef(0);

  // 이미지 변경/열림 시 줌·팬 리셋
  useEffect(() => { setScale(1); setTx(0); setTy(0); }, [src]);

  const toggleZoom = useCallback(() => {
    setScale((prev) => { if (prev > 1) { setTx(0); setTy(0); return 1; } return 2.5; });
  }, []);

  const zoomBy = useCallback((factor: number) => {
    setScale((prev) => {
      const next = clamp(prev * factor);
      if (next === 1) { setTx(0); setTy(0); }
      return next;
    });
  }, []);

  // wheel + touchmove는 preventDefault가 필요(passive 기본값 회피) → 네이티브 리스너로 등록
  useEffect(() => {
    const el = stageRef.current;
    if (!el || !src) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setScale((prev) => {
        const next = clamp(prev * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
        if (next === 1) { setTx(0); setTy(0); }
        return next;
      });
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = touch.current;
      if (!t) return;
      if (t.mode === 'pinch' && e.touches.length >= 2) {
        e.preventDefault();
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        setScale(clamp(t.scale * (d / t.dist)));
      } else if (t.mode === 'pan' && e.touches.length === 1) {
        e.preventDefault();
        setTx(t.tx + (e.touches[0].clientX - t.x));
        setTy(t.ty + (e.touches[0].clientY - t.y));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchmove', onTouchMove);
    };
  }, [src]);

  // 마우스 드래그 팬 (줌 상태에서만)
  const onMouseDown = (e: React.MouseEvent) => {
    if (scale <= 1) return;
    e.preventDefault();
    mouse.current = { x: e.clientX, y: e.clientY, tx, ty };
    setDragging(true);
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!mouse.current) return;
    setTx(mouse.current.tx + (e.clientX - mouse.current.x));
    setTy(mouse.current.ty + (e.clientY - mouse.current.y));
  };
  const endMouse = () => { mouse.current = null; setDragging(false); };

  // 터치: 1손가락 팬 / 2손가락 핀치 / 더블탭 토글
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      touch.current = { mode: 'pinch', x: 0, y: 0, tx, ty, dist: d || 1, scale };
    } else if (e.touches.length === 1) {
      const now = Date.now();
      if (now - lastTap.current < 300) { toggleZoom(); lastTap.current = 0; }
      else lastTap.current = now;
      touch.current = scale > 1
        ? { mode: 'pan', x: e.touches[0].clientX, y: e.touches[0].clientY, tx, ty, dist: 0, scale }
        : null;
    }
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length === 0) {
      touch.current = null;
      setScale((s) => { if (s <= 1) { setTx(0); setTy(0); } return s; });
    } else if (e.touches.length === 1) {
      touch.current = scale > 1
        ? { mode: 'pan', x: e.touches[0].clientX, y: e.touches[0].clientY, tx, ty, dist: 0, scale }
        : null;
    }
  };

  const stopGesture = (e: React.SyntheticEvent) => { e.stopPropagation(); };

  return (
    <Modal
      opened={!!src}
      onClose={onClose}
      size="auto"
      centered
      padding={0}
      withCloseButton={false}
      classNames={{ content: 'zoom-modal-content' }}
      overlayProps={{ backgroundOpacity: 0.85, blur: 2 }}
      styles={{
        content: { backgroundColor: 'transparent', boxShadow: 'none', overflow: 'visible' },
        body: { padding: 0 },
      }}
    >
      {src && (
        <div
          ref={stageRef}
          style={{
            position: 'relative',
            width: '92vw',
            height: '90vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            touchAction: 'none',
          }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={endMouse}
          onMouseLeave={endMouse}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          onDoubleClick={toggleZoom}
        >
          <img
            src={src}
            alt=""
            draggable={false}
            style={{
              maxWidth: '92vw',
              maxHeight: '90vh',
              width: 'auto',
              height: 'auto',
              transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
              transformOrigin: 'center center',
              transition: dragging || touch.current ? 'none' : 'transform 0.12s ease-out',
              cursor: scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'zoom-in',
              userSelect: 'none',
              borderRadius: 6,
            }}
          />

          <div
            onMouseDown={stopGesture}
            onDoubleClick={stopGesture}
            style={{ position: 'absolute', top: 12, left: 12, display: 'flex' }}
          >
            <MediaActions kind="image" url={src} variant="bar" />
          </div>

          <ActionIcon
            variant="filled"
            radius="xl"
            size={40}
            onClick={onClose}
            onMouseDown={stopGesture}
            onDoubleClick={stopGesture}
            aria-label={t('common.close')}
            style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(0,0,0,0.55)', color: '#fff' }}
          >
            <IconX size={20} stroke={2} />
          </ActionIcon>

          <div
            onMouseDown={stopGesture}
            onDoubleClick={stopGesture}
            style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 8 }}
          >
            <ActionIcon variant="filled" radius="xl" size={40} onClick={() => zoomBy(1 / 1.3)} aria-label={t('common.zoomOut')} style={{ background: 'rgba(0,0,0,0.55)', color: '#fff' }}>
              <IconMinus size={20} stroke={2} />
            </ActionIcon>
            <ActionIcon variant="filled" radius="xl" size={40} onClick={() => zoomBy(1.3)} aria-label={t('common.zoomIn')} style={{ background: 'rgba(0,0,0,0.55)', color: '#fff' }}>
              <IconPlus size={20} stroke={2} />
            </ActionIcon>
          </div>
        </div>
      )}
    </Modal>
  );
}
